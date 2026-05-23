import express from 'express'
import { createServer } from 'http'
import { Server } from 'socket.io'
import path from 'path'
import { fileURLToPath } from 'url'
import { RoomManager } from './RoomManager.js'
import type { ClientToServerEvents, ServerToClientEvents } from '../shared/protocol.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const app = express()
const httpServer = createServer(app)
const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
})

const rooms = new RoomManager()

// ===== 多人模式战斗初始化数据构造 (从设计图生成舰船/手牌/玩家/队伍/回合顺序) =====

const TEAM_COLORS = [
  '#409EFF', '#F56C6C', '#67C23A', '#E6A23C',
  '#9060EB', '#20B2AA', '#FF6B6B', '#48D1CC',
  '#FF8C00', '#8B008B', '#2E8B57', '#DC143C',
]

const EQUIPMENT_PROPS: Record<string, { compartmentSpan: number; hpModifier: number }> = {
  dual_cannon:         { compartmentSpan: 1, hpModifier: 10 },
  triple_cannon:       { compartmentSpan: 1, hpModifier: 10 },
  quad_torpedo:        { compartmentSpan: 1, hpModifier: 5 },
  small_hangar:        { compartmentSpan: 1, hpModifier: 0 },
  large_hangar:        { compartmentSpan: 2, hpModifier: 0 },
  ammo_depot:          { compartmentSpan: 1, hpModifier: -5 },
  fire_control:        { compartmentSpan: 1, hpModifier: 0 },
  command_room:        { compartmentSpan: 1, hpModifier: -5 },
  command_center:      { compartmentSpan: 2, hpModifier: 0 },
  integrated_command:  { compartmentSpan: 3, hpModifier: 5 },
  lifeboat:            { compartmentSpan: 1, hpModifier: 0 },
  damage_control:      { compartmentSpan: 1, hpModifier: 0 },
  smoke_generator:     { compartmentSpan: 1, hpModifier: -5 },
  afterburner:         { compartmentSpan: 1, hpModifier: 0 },
  depth_charge:        { compartmentSpan: 1, hpModifier: 0 },
  aa_gun:              { compartmentSpan: 1, hpModifier: 5 },
  dormitory:           { compartmentSpan: 1, hpModifier: 10 },
  comms_hub:           { compartmentSpan: 1, hpModifier: 5 },
}

/** 从 room 与 allDesigns 生成完整的 BattleInitPayload */
function buildBattleInit(room: import('../shared/protocol.js').RoomState): import('../shared/protocol.js').BattleInitPayload {
  const allDesigns = rooms.getAllDesigns(room.code)

  // 1. 队伍
  const uniqueTeamIds = [...new Set(room.slots.map(s => s.teamId))]
  const teams = uniqueTeamIds.map((id, i) => ({
    id: `team_${i}`,
    name: id,
    color: TEAM_COLORS[i % TEAM_COLORS.length],
    playerIds: [] as string[],
  }))

  // 2. 玩家
  const players = room.players.map((p, i) => {
    const slot = p.slotIndex != null ? room.slots[p.slotIndex] : null
    const teamIdx = slot ? Math.max(0, uniqueTeamIds.indexOf(slot.teamId)) : 0
    const teamId = `team_${teamIdx}`
    return {
      id: `player_${i}`,
      name: p.playerName,
      teamId,
      isAlive: true,
      currentShipId: null as string | null,
      currentCompartmentIndex: null as number | null,
      hand: [] as string[],
    }
  })

  // 3. 从设计图构造舰船
  const totalComps = room.totalCompartments || 10
  let shipIdCounter = 0
  let compIdCounter = 0
  const ships: any[] = []

  for (const teamIdRaw of uniqueTeamIds) {
    const design = allDesigns[teamIdRaw]
    if (!design) continue
    const teamIdx = uniqueTeamIds.indexOf(teamIdRaw)
    const teamId = `team_${teamIdx}`
    const teamPlayers = players.filter(p => p.teamId === teamId)
    const ownerPlayerId = teamPlayers[0]?.id || players[0]?.id

    for (const sd of design.ships) {
      shipIdCounter++
      const shipId = `ship_${shipIdCounter}`
      const baseHp = Math.max(1, 25 - totalComps)
      const compartments: any[] = []

      // 创建全量舱段（先不加装备修正）
      for (let pos = 0; pos < totalComps; pos++) {
        compIdCounter++
        const compartment: any = {
          id: `comp_${compIdCounter}`,
          shipId,
          position: pos,
          equipmentType: null as string | null,
          baseHp,
          equipmentHpMod: 0,
          maxHp: baseHp,
          currentHp: baseHp,
          isDestroyed: false,
          multiCompRootId: null as string | null,
          multiCompSlaveIds: [] as string[],
        }
        // 应用设备
        const designComp = sd.compartments.find((c: any) => c.compartmentIndex === pos)
        if (designComp?.equipmentType) {
          compartment.equipmentType = designComp.equipmentType
        }
        compartments.push(compartment)
      }

      // 二次遍历处理多舱段军备 + HP修正
      for (let pos = 0; pos < compartments.length; pos++) {
        const comp = compartments[pos]
        if (!comp.equipmentType) continue
        const info = EQUIPMENT_PROPS[comp.equipmentType] || { compartmentSpan: 1, hpModifier: 0 }

        if (info.compartmentSpan > 1) {
          const slaveIds: string[] = []
          for (let s = 1; s < info.compartmentSpan; s++) {
            const slavePos = pos + s
            if (slavePos < compartments.length) {
              compartments[slavePos].multiCompRootId = comp.id
              slaveIds.push(compartments[slavePos].id)
            }
          }
          comp.multiCompSlaveIds = slaveIds
        }

        comp.equipmentHpMod = info.hpModifier
        comp.maxHp = baseHp + info.hpModifier
        comp.currentHp = comp.maxHp

        // 加力引擎同舰多装惩罚
        if (comp.equipmentType === 'afterburner') {
          const abCount = compartments.filter(
            (c: any) => c.equipmentType === 'afterburner' && c.id !== comp.id
          ).length
          if (abCount >= 1) {
            comp.equipmentHpMod -= 1
            comp.maxHp -= 1
            comp.currentHp -= 1
          }
        }
      }

      ships.push({
        id: shipId,
        name: sd.name,
        ownerTeamId: teamId,
        ownerPlayerId,
        compartments,
      })
    }
  }

  // 4. 构建卡组、洗牌、发初始手牌
  const DECK_COMP: Record<string, number> = { move: 40, command: 40, action: 20, coffee: 8, scheme: 8 }
  let cardIdCounter = 0
  const deck: any[] = []
  for (const [type, count] of Object.entries(DECK_COMP)) {
    for (let i = 0; i < count; i++) {
      cardIdCounter++
      deck.push({ id: `card_${cardIdCounter}`, type })
    }
  }
  // Fisher-Yates shuffle
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]]
  }

  const INITIAL_HAND_SIZE = 2
  const playerHands: Record<string, any[]> = {}
  let drawIdx = 0
  for (const p of players) {
    playerHands[p.id] = []
    for (let h = 0; h < INITIAL_HAND_SIZE; h++) {
      if (drawIdx < deck.length) {
        playerHands[p.id].push(deck[drawIdx])
        drawIdx++
      }
    }
  }

  // 5. 交错回合顺序（每队轮出一人）
  const turnOrder: string[] = []
  const teamQueues: Record<string, string[]> = {}
  for (const t of teams) {
    teamQueues[t.id] = players.filter(p => p.teamId === t.id).map(p => p.id)
  }
  let added = true
  while (added) {
    added = false
    for (const t of teams) {
      const q = teamQueues[t.id]
      if (q && q.length > 0) {
        turnOrder.push(q.shift()!)
        added = true
      }
    }
  }

  return {
    ships,
    playerHands,
    players,
    teams,
    turnOrder,
    currentTurnIndex: 0,
    currentTurnPhase: 'draw',
  }
}

// 生产环境: 服务 dist 静态文件
const distPath = path.join(__dirname, '..', 'dist')
app.use(express.static(distPath))
app.get('/health', (_req, res) => res.json({ ok: true }))

io.on('connection', (socket) => {
  console.log(`[connect] ${socket.id}`)

  // ===== 房间操作 =====
  socket.on('room:create', ({ playerName, totalCompartments, slots }) => {
    const prev = rooms.leaveRoom(socket.id)
    if (prev.room) {
      io.to(prev.room.code).emit('room:update', prev.room)
    }

    const room = rooms.createRoom(socket.id, playerName, totalCompartments || 10, slots || [])
    socket.join(room.code)
    socket.emit('room:update', room)
    console.log(`[room:create] ${room.code} by ${playerName} (${room.slots.length} slots, ${room.totalCompartments} comps)`)
  })

  socket.on('room:join', ({ roomCode, playerName }) => {
    const prev = rooms.leaveRoom(socket.id)
    if (prev.room) {
      io.to(prev.room.code).emit('room:update', prev.room)
    }

    const room = rooms.joinRoom(roomCode.toUpperCase(), socket.id, playerName)
    if (!room) {
      socket.emit('room:error', { message: '房间不存在或已满' })
      return
    }
    socket.join(room.code)
    io.to(room.code).emit('room:update', room)
    io.to(room.code).emit('room:playerJoined', room.players[room.players.length - 1])
    console.log(`[room:join] ${room.code} joined by ${playerName}`)
  })

  socket.on('room:leave', () => {
    const { room, wasHost } = rooms.leaveRoom(socket.id)
    if (room) {
      socket.leave(room.code)
      io.to(room.code).emit('room:update', room)
      if (wasHost && room.players.length > 0) {
        io.to(room.code).emit('room:update', room)
      }
    }
    socket.emit('room:update', { code: '', hostSocketId: null, players: [], slots: [], phase: 'lobby' as const, teamCount: 0, totalCompartments: 0 })
  })

  socket.on('room:startDesign', ({ teamCount, totalCompartments }) => {
    const room = rooms.getRoomBySocket(socket.id)
    if (!room || room.hostSocketId !== socket.id) {
      socket.emit('room:error', { message: '仅房主可开始设计' })
      return
    }
    room.teamCount = teamCount || room.teamCount
    room.totalCompartments = totalCompartments || room.totalCompartments
    room.phase = 'design'
    io.to(room.code).emit('room:update', room)
    console.log(`[design:start] room ${room.code}`)
  })

  // 客户端请求当前房间状态
  socket.on('room:state', () => {
    const room = rooms.getRoomBySocket(socket.id)
    if (room) socket.emit('room:update', room)
  })

  // ===== 槽位操作 =====
  socket.on('slot:join', ({ slotIndex }) => {
    const room = rooms.getRoomBySocket(socket.id)
    if (!room) return
    const ok = rooms.joinSlot(room, socket.id, slotIndex)
    if (ok) {
      io.to(room.code).emit('room:update', room)
    }
  })

  socket.on('slot:leave', () => {
    const room = rooms.getRoomBySocket(socket.id)
    if (!room) return
    rooms.leaveSlot(room, socket.id)
    io.to(room.code).emit('room:update', room)
  })

  socket.on('slot:ready', () => {
    const room = rooms.getRoomBySocket(socket.id)
    if (!room || room.phase !== 'design') return
    rooms.setReady(room, socket.id, true)
    io.to(room.code).emit('room:update', room)
    if (rooms.isAllReady(room)) {
      // 1) 通知所有玩家设计完成
      const allDesigns = rooms.getAllDesigns(room.code)
      io.to(room.code).emit('design:allReady', allDesigns)
      // 2) 构造全量战斗初始数据并广播 (权威同步)
      const battleInit = buildBattleInit(room)
      room.phase = 'battle'
      io.to(room.code).emit('room:update', room)
      io.to(room.code).emit('battle:init', battleInit)
      console.log(`[design:allReady → battle:init] room ${room.code} (${room.players.length} players, ${battleInit.ships.length} ships)`)
    }
  })

  socket.on('slot:cancelReady', () => {
    const room = rooms.getRoomBySocket(socket.id)
    if (!room) return
    rooms.setReady(room, socket.id, false)
    io.to(room.code).emit('room:update', room)
  })

  // ===== 设计同步 =====
  socket.on('design:sync', (design) => {
    const room = rooms.getRoomBySocket(socket.id)
    if (!room) return
    const player = room.players.find(p => p.socketId === socket.id)
    if (!player || player.slotIndex == null) return
    const slot = room.slots[player.slotIndex]
    if (!slot) return
    rooms.updateDesign(room.code, slot.teamId, design)
    // 广播给同阵营
    socket.to(room.code).emit('design:sync', { ...design, teamId: slot.teamId })
  })

  // ===== 战斗行动中继 (全房间广播, 服务端为唯一权威) =====
  socket.on('battle:action', (action) => {
    const room = rooms.getRoomBySocket(socket.id)
    if (!room) return
    // 附加发送者信息
    const player = room.players.find(p => p.socketId === socket.id)
    if (player && player.slotIndex != null) {
      action.senderPlayerId = room.slots[player.slotIndex]?.playerName ?? ''
    }
    // 全房间广播 (含发送者自身)
    io.to(room.code).emit('battle:action', action)
    console.log(`[battle:action] room ${room.code} type=${action.type}`)
  })

  // ===== 断开连接 =====
  socket.on('disconnect', () => {
    console.log(`[disconnect] ${socket.id}`)
    const { room } = rooms.leaveRoom(socket.id)
    if (room) {
      io.to(room.code).emit('room:update', room)
      io.to(room.code).emit('room:playerLeft', socket.id)
    }
  })
})

// SPA fallback: 非静态文件/API路由返回 index.html (Express 5 语法)
app.use((_req, res) => {
  res.sendFile(path.join(distPath, 'index.html'))
})

const PORT = process.env.PORT || 3001
httpServer.listen(PORT, () => {
  console.log(`Navy Commander server running on port ${PORT}`)
})
