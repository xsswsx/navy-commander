import { createServer } from 'http'
import { Server } from 'socket.io'
import { generateRoomCode, buildDeckCards, shuffleCards, drawFromDeck } from '../shared/protocol.js'
import type { RoomConfig, ShipDesignData, BattleAction, CardData } from '../shared/protocol.js'
import { newRoom, getRoom, getRoomBySocket, setSocketRoom, removeSocketRoom } from './state.js'

const httpServer = createServer()
const io = new Server(httpServer, { cors: { origin: '*' } })

// 监听每个玩家在每个房间的槽位 → 用于权限判断
const socketSlotMap = new Map<string, { code: string; slotIndex: number }>()

function getMySlot(socketId: string): { code: string; slotIndex: number } | null {
  return socketSlotMap.get(socketId) ?? null
}

const INITIAL_HAND_SIZE = 7

io.on('connection', (socket) => {
  console.log(`[connect] ${socket.id}`)

  // ===================== 房间操作 =====================
  socket.on('room:create', (config: RoomConfig) => {
    const code = generateRoomCode()
    const slots: any[] = []
    for (let ti = 0; ti < config.teams.length; ti++) {
      const names = config.slotNames[ti] || []
      for (const _ of names) {
        slots.push({
          index: slots.length,
          teamId: config.teams[ti].name,
          playerName: null,
          socketId: null,
          isReady: false,
        })
      }
    }
    const room = newRoom(code, {
      code, hostSocketId: socket.id, slots, phase: 'lobby',
      teamCount: config.teams.length, totalCompartments: config.totalCompartments,
      readyTeams: [],
    })
    socket.join(code)
    setSocketRoom(socket.id, code)
    // 保存房主名字
    room.playerNames.set(socket.id, config.hostName)
    io.to(code).emit('room:state', room.state)
    console.log(`[room:create] ${code} by ${config.hostName} (${slots.length} slots)`)
  })

  socket.on('room:join', ({ roomCode, playerName }) => {
    const room = getRoom(roomCode)
    if (!room) { socket.emit('error', { message: '房间不存在' }); return }
    socket.join(roomCode)
    setSocketRoom(socket.id, roomCode)
    // 保存玩家名 (后续 slot:join 时使用)
    room.playerNames.set(socket.id, playerName || 'Unknown')
    io.to(roomCode).emit('room:state', room.state)
    console.log(`[room:join] ${roomCode} joined by ${playerName}`)
  })

  socket.on('room:startGame', () => {
    const info = getRoomBySocket(socket.id)
    if (!info || info.room.state.hostSocketId !== socket.id) return
    // 检查至少每队有一个已占用的槽位
    const occupied = info.room.state.slots.filter(s => s.playerName)
    const teamsWithPlayers = new Set(occupied.map(s => s.teamId))
    if (teamsWithPlayers.size < info.room.state.teamCount) {
      socket.emit('error', { message: '每个队伍至少需要一名玩家' })
      return
    }
    info.room.state.phase = 'design'
    io.to(info.code).emit('room:state', info.room.state)
    console.log(`[room:startGame] ${info.code} → design`)
  })

  // ===================== 槽位操作 =====================
  socket.on('slot:join', ({ slotIndex, playerName }) => {
    const info = getRoomBySocket(socket.id)
    if (!info) return
    const slot = info.room.state.slots[slotIndex]
    if (!slot || slot.playerName) return
    // 释放旧槽位
    const prev = getMySlot(socket.id)
    if (prev) {
      const prevRoom = getRoom(prev.code)
      if (prevRoom) {
        const oldSlot = prevRoom.state.slots[prev.slotIndex]
        if (oldSlot) { oldSlot.playerName = null; oldSlot.socketId = null; oldSlot.isReady = false }
      }
    }
    slot.socketId = socket.id
    // 使用传入的 playerName，或从 room.playerNames 获取，或默认名
    const name = playerName || info.room.playerNames.get(socket.id) || `P${slotIndex + 1}`
    slot.playerName = name
    socketSlotMap.set(socket.id, { code: info.code, slotIndex })
    io.to(info.code).emit('room:state', info.room.state)

    // 如果在设计阶段，发送当前设计状态给新加入的玩家
    if (info.room.state.phase === 'design') {
      const teamId = slot.teamId
      const ds = info.room.designs.get(teamId)
      if (ds) {
        socket.emit('design:state', {
          teamId,
          ships: ds.ships,
          readySlots: [...ds.readySlots],
          isTeamReady: info.room.readyTeams.has(teamId),
        })
      }
    }
    console.log(`[slot:join] ${info.code} slot ${slotIndex} ← ${name}`)
  })

  socket.on('slot:leave', () => {
    const prev = getMySlot(socket.id)
    if (!prev) return
    const room = getRoom(prev.code)
    if (room) {
      const slot = room.state.slots[prev.slotIndex]
      if (slot) {
        const teamId = slot.teamId
        slot.playerName = null; slot.socketId = null; slot.isReady = false
        // 清除设计准备状态
        for (const [, ds] of room.designs) ds.readySlots.delete(prev.slotIndex)
        // 检查该队伍是否还有人占用槽位，没有则清除队伍准备状态
        const teamStillOccupied = room.state.slots.some(s => s.teamId === teamId && s.playerName)
        if (!teamStillOccupied) {
          room.readyTeams.delete(teamId)
        }
      }
    }
    socketSlotMap.delete(socket.id)
    if (room) io.to(prev.code).emit('room:state', room.state)
  })

  // ===================== 设计阶段 =====================
  socket.on('design:update', (ships: ShipDesignData[]) => {
    const slot = getMySlot(socket.id)
    if (!slot) return
    const room = getRoom(slot.code)
    if (!room || room.state.phase !== 'design') return
    const teamId = room.state.slots[slot.slotIndex]?.teamId
    if (!teamId) return
    // 队伍已准备则不允许修改
    if (room.readyTeams.has(teamId)) return
    if (!room.designs.has(teamId)) room.designs.set(teamId, { ships: [], readySlots: new Set() })
    room.designs.get(teamId)!.ships = ships
    // 广播给同阵营
    broadcastDesignState(io, room, teamId)
  })

  socket.on('design:ready', () => {
    const slot = getMySlot(socket.id)
    if (!slot) return
    const room = getRoom(slot.code)
    if (!room || room.state.phase !== 'design') return
    const teamId = room.state.slots[slot.slotIndex]?.teamId
    if (!teamId) return
    // 标记队伍为已准备
    room.readyTeams.add(teamId)
    // 同步更新所有槽位的 isReady
    for (const s of room.state.slots) {
      if (s.teamId === teamId && s.playerName) s.isReady = true
    }
    room.state.readyTeams = [...room.readyTeams]
    io.to(slot.code).emit('room:state', room.state)
    broadcastDesignState(io, room, teamId)
    checkAllReady(io, room, slot.code)
  })

  socket.on('design:cancel', () => {
    const slot = getMySlot(socket.id)
    if (!slot) return
    const room = getRoom(slot.code)
    if (!room || room.state.phase !== 'design') return
    const teamId = room.state.slots[slot.slotIndex]?.teamId
    if (!teamId) return
    // 取消队伍准备
    room.readyTeams.delete(teamId)
    for (const s of room.state.slots) {
      if (s.teamId === teamId) s.isReady = false
    }
    if (room.designs.has(teamId)) room.designs.get(teamId)!.readySlots.delete(slot.slotIndex)
    room.state.readyTeams = [...room.readyTeams]
    io.to(slot.code).emit('room:state', room.state)
    broadcastDesignState(io, room, teamId)
  })

  // ===================== 战斗阶段 =====================

  /** 获取有玩家的槽位索引数组 (按 slot.index 排序) */
  function occupiedSlots(room: ReturnType<typeof getRoom>): number[] {
    if (!room) return []
    return room.state.slots.filter(s => s.playerName).map(s => s.index).sort((a, b) => a - b)
  }

  socket.on('battle:request', () => {
    const slot = getMySlot(socket.id)
    if (!slot) return
    const room = getRoom(slot.code)
    if (!room || !room.lastBattleInit) return
    // 发送完整的 battle init + 当前状态
    socket.emit('battle:init', {
      ...room.lastBattleInit,
      currentTurnSlot: room.currentTurnSlot,
      roundNumber: room.roundNumber,
      spawns: [...room.spawns.entries()].map(([k, v]) => ({ slotIndex: k, shipId: v.shipId, compIndex: v.compIndex })),
      battleLog: room.battleLog.slice(-100),
      drawPile: room.drawPile,
      discardPile: room.discardPile,
      playerHands: Object.fromEntries(room.playerHands),
    })
  })

  socket.on('battle:spawn', ({ compartmentId, shipId }) => {
    const slot = getMySlot(socket.id)
    if (!slot) return
    const room = getRoom(slot.code)
    if (!room || room.state.phase !== 'battle') return
    room.spawns.set(slot.slotIndex, { shipId: shipId || '', compIndex: 0 })
    const logMsg = `${room.state.slots[slot.slotIndex]?.playerName || '?'} 选择出生点`
    room.battleLog.push({ message: logMsg, type: 'system', timestamp: Date.now() })
    io.to(slot.code).emit('battle:action', {
      type: 'selectSpawn', compartmentId,
      senderSlotIndex: slot.slotIndex,
      logMessage: logMsg, logType: 'system',
    })
    io.to(slot.code).emit('battle:log', { message: logMsg, type: 'system', timestamp: Date.now() })
    // 检查所有玩家是否都选择了出生点
    const occ = occupiedSlots(room)
    const allSpawned = occ.every(idx => room.spawns.has(idx))
    if (allSpawned && occ.length > 0) {
      room.currentTurnSlot = occ[0]
      io.to(slot.code).emit('battle:turn', { playerSlotIndex: occ[0], roundNumber: room.roundNumber })
    }
  })

  socket.on('battle:endTurn', () => {
    const slot = getMySlot(socket.id)
    if (!slot) return
    const room = getRoom(slot.code)
    if (!room || room.state.phase !== 'battle') return
    if (room.currentTurnSlot !== slot.slotIndex) return
    const occ = occupiedSlots(room)
    const curIdx = occ.indexOf(room.currentTurnSlot)
    if (curIdx < 0) return
    const nextIdx = (curIdx + 1) % occ.length
    // 检测回合数变化 (绕回一圈 → 新回合)
    if (nextIdx === 0) room.roundNumber++
    room.currentTurnSlot = occ[nextIdx]
    const payload = { playerSlotIndex: room.currentTurnSlot, roundNumber: room.roundNumber }
    io.to(slot.code).emit('battle:turn', payload)
    const playerName = room.state.slots[room.currentTurnSlot]?.playerName || '?'
    const logMsg = `--- ${playerName} 的回合 (第${room.roundNumber}轮) ---`
    room.battleLog.push({ message: logMsg, type: 'system', timestamp: Date.now() })
    io.to(slot.code).emit('battle:log', { message: logMsg, type: 'system', timestamp: Date.now() })
    console.log(`[battle:turn] ${slot.code} → slot ${room.currentTurnSlot} (round ${room.roundNumber})`)
  })

  socket.on('battle:action', (action: BattleAction) => {
    const slot = getMySlot(socket.id)
    if (!slot) return
    const room = getRoom(slot.code)
    if (!room || room.state.phase !== 'battle') return
    // 校验: 只有当前回合槽位可以发送行动 (出生阶段允许 spawn)
    if (action.type !== 'selectSpawn' && room.currentTurnSlot !== slot.slotIndex) return
    action.senderSlotIndex = slot.slotIndex
    io.to(slot.code).emit('battle:action', action)
    // 如果有日志消息，广播
    if (action.logMessage) {
      const entry = { message: action.logMessage, type: action.logType || 'info', timestamp: Date.now() }
      room.battleLog.push(entry)
      io.to(slot.code).emit('battle:log', entry)
    }
  })

  // ===================== 卡牌操作 (服务端管理牌堆) =====================
  socket.on('card:draw', ({ count }) => {
    const slot = getMySlot(socket.id)
    if (!slot) return
    const room = getRoom(slot.code)
    if (!room || room.state.phase !== 'battle') return
    if (room.currentTurnSlot !== slot.slotIndex) return
    const { drawn, newDraw, newDiscard } = drawFromDeck(room.drawPile, room.discardPile, count || 1)
    room.drawPile = newDraw
    room.discardPile = newDiscard
    const hand = room.playerHands.get(slot.slotIndex) || []
    hand.push(...drawn)
    room.playerHands.set(slot.slotIndex, hand)
    // 只发给当前玩家 (手牌隐私)
    socket.emit('card:drawn', { cards: drawn, hand: hand })
    const playerName = room.state.slots[slot.slotIndex]?.playerName || '?'
    io.to(slot.code).emit('battle:log', {
      message: `${playerName} 抽了 ${drawn.length} 张牌`,
      type: 'system', timestamp: Date.now(),
    })
  })

  socket.on('card:discard', ({ cardIds }) => {
    const slot = getMySlot(socket.id)
    if (!slot) return
    const room = getRoom(slot.code)
    if (!room) return
    const hand = room.playerHands.get(slot.slotIndex) || []
    const discarded: CardData[] = []
    for (const cid of (cardIds || [])) {
      const idx = hand.findIndex((c: CardData) => c.id === cid)
      if (idx !== -1) {
        const [card] = hand.splice(idx, 1)
        room.discardPile.push(card)
        discarded.push(card)
      }
    }
    room.playerHands.set(slot.slotIndex, hand)
    socket.emit('card:drawn', { cards: [], hand: hand })
    const playerName = room.state.slots[slot.slotIndex]?.playerName || '?'
    io.to(slot.code).emit('battle:log', {
      message: `${playerName} 弃了 ${discarded.length} 张牌`,
      type: 'system', timestamp: Date.now(),
    })
  })

  socket.on('card:discardDownTo', ({ maxCards }) => {
    const slot = getMySlot(socket.id)
    if (!slot) return
    const room = getRoom(slot.code)
    if (!room) return
    const hand = room.playerHands.get(slot.slotIndex) || []
    if (hand.length > maxCards) {
      const discarded = hand.splice(maxCards)
      room.discardPile.push(...discarded)
    }
    room.playerHands.set(slot.slotIndex, hand)
    socket.emit('card:drawn', { cards: [], hand: hand })
  })

  // ===================== 战斗日志 =====================
  socket.on('battle:log', ({ message, type }) => {
    const slot = getMySlot(socket.id)
    if (!slot) return
    const room = getRoom(slot.code)
    if (!room) return
    const entry = { message, type: type || 'info', timestamp: Date.now() }
    room.battleLog.push(entry)
    io.to(slot.code).emit('battle:log', entry)
  })

  // ===================== 断开 =====================
  socket.on('disconnect', () => {
    const prev = getMySlot(socket.id)
    if (prev) {
      const room = getRoom(prev.code)
      if (room) {
        const slot = room.state.slots[prev.slotIndex]
        if (slot) {
          const teamId = slot.teamId
          slot.playerName = null; slot.socketId = null; slot.isReady = false
          // 检查该队伍是否还有人占用槽位
          const teamStillOccupied = room.state.slots.some(s => s.teamId === teamId && s.playerName)
          if (!teamStillOccupied) {
            room.readyTeams.delete(teamId)
            room.state.readyTeams = [...room.readyTeams]
          }
        }
        io.to(prev.code).emit('room:state', room.state)
      }
      socketSlotMap.delete(socket.id)
    }
    removeSocketRoom(socket.id)
    console.log(`[disconnect] ${socket.id}`)
  })
})

// ===================== 辅助函数 =====================

function broadcastDesignState(io: Server, room: ReturnType<typeof getRoom>, teamId: string) {
  if (!room) return
  const ds = room.designs.get(teamId)
  const payload = {
    teamId,
    ships: ds?.ships || [],
    readySlots: ds ? [...ds.readySlots] : [],
    isTeamReady: room.readyTeams.has(teamId),
  }
  // 广播给同阵营所有玩家
  for (const s of room.state.slots) {
    if (s.teamId === teamId && s.socketId) {
      io.to(s.socketId).emit('design:state', payload)
    }
  }
}

function checkAllReady(io: Server, room: ReturnType<typeof getRoom>, code: string) {
  if (!room) return
  // 找出所有有玩家的队伍
  const occupiedTeams = new Set<string>()
  for (const s of room.state.slots) {
    if (s.playerName) occupiedTeams.add(s.teamId)
  }
  if (occupiedTeams.size === 0) return
  // 所有队伍都准备就绪?
  const allReady = [...occupiedTeams].every(tid => room.readyTeams.has(tid))
  if (!allReady) return

  room.state.phase = 'battle'
  room.state.readyTeams = [...room.readyTeams]

  // 构建队伍信息
  const teamIds = [...new Set(room.state.slots.map(s => s.teamId))]
  const players = room.state.slots.filter(s => s.playerName).map(s => ({
    name: s.playerName!,
    teamId: s.teamId,
    slotIndex: s.index,
  }))

  // 交错回合顺序: 每队依次出一人
  const turnOrder: number[] = []
  const teamQueues: Record<string, number[]> = {}
  for (const p of players) {
    if (!teamQueues[p.teamId]) teamQueues[p.teamId] = []
    teamQueues[p.teamId].push(p.slotIndex)
  }
  let added = true
  while (added) {
    added = false
    for (const tid of teamIds) {
      const q = teamQueues[tid]
      if (q && q.length > 0) {
        turnOrder.push(q.shift()!)
        added = true
      }
    }
  }

  // 构建服务端牌堆
  const deck = shuffleCards(buildDeckCards())
  const playerHands: Record<number, CardData[]> = {}

  // 发初始手牌
  let drawPile = [...deck]
  let discardPile: CardData[] = []
  for (const p of players) {
    const { drawn, newDraw, newDiscard } = drawFromDeck(drawPile, discardPile, INITIAL_HAND_SIZE)
    drawPile = newDraw
    discardPile = newDiscard
    playerHands[p.slotIndex] = drawn
  }

  // 收集所有阵营的设计
  const ships: Record<string, any[]> = {}
  for (const [teamId, ds] of room.designs) {
    if (ds.ships.length > 0) ships[teamId] = ds.ships
  }

  const initPayload = {
    ships,
    players,
    teams: teamIds.map((id, i) => ({
      id,
      name: id,
      color: ['#409EFF', '#F56C6C', '#67C23A', '#E6A23C'][i % 4],
    })),
    turnOrder,
    playerHands,
    drawPile,
    discardPile,
  }

  // 保存牌堆状态到 room
  room.drawPile = drawPile
  room.discardPile = discardPile
  for (const [si, hand] of Object.entries(playerHands)) {
    room.playerHands.set(Number(si), hand)
  }
  room.lastBattleInit = initPayload
  room.roundNumber = 1

  io.to(code).emit('battle:init', initPayload)
  io.to(code).emit('room:state', room.state)
  console.log(`[battle:init] room ${code} — ${players.length} players, ${turnOrder.length} turn slots`)
}

const PORT = process.env.PORT || 3001
httpServer.listen(PORT, () => console.log(`Server running on port ${PORT}`))
