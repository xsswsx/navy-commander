import { createServer } from 'http'
import { Server } from 'socket.io'
import { generateRoomCode } from '../shared/protocol.js'
import type { RoomConfig, ShipDesignData, BattleAction } from '../shared/protocol.js'
import { newRoom, getRoom, getRoomBySocket, deleteRoom } from './state.js'

const httpServer = createServer()
const io = new Server(httpServer, { cors: { origin: '*' } })

// 监听每个玩家在每个房间的槽位 → 用于权限判断
const socketSlotMap = new Map<string, { code: string; slotIndex: number }>()

function getMySlot(socketId: string): { code: string; slotIndex: number } | null {
  return socketSlotMap.get(socketId) ?? null
}

io.on('connection', (socket) => {
  console.log(`[connect] ${socket.id}`)

  // ===================== 房间操作 =====================
  socket.on('room:create', (config: RoomConfig) => {
    const code = generateRoomCode()
    const slots: any[] = []
    for (let ti = 0; ti < config.teams.length; ti++) {
      const names = config.slotNames[ti] || []
      for (const _ of names) {
        slots.push({ index: slots.length, teamId: config.teams[ti].name, playerName: null, socketId: null, isReady: false })
      }
    }
    const room = newRoom(code, {
      code, hostSocketId: socket.id, slots, phase: 'lobby',
      teamCount: config.teams.length, totalCompartments: config.totalCompartments,
    })
    socket.join(code)
    io.to(code).emit('room:state', room.state)
    console.log(`[room:create] ${code} by ${config.hostName} (${slots.length} slots)`)
  })

  socket.on('room:join', ({ roomCode, playerName }) => {
    const room = getRoom(roomCode)
    if (!room) { socket.emit('error', { message: '房间不存在' }); return }
    socket.join(roomCode)
    io.to(roomCode).emit('room:state', room.state)
    console.log(`[room:join] ${roomCode} joined by ${playerName}`)
  })

  socket.on('room:startGame', () => {
    const info = getRoomBySocket(socket.id)
    if (!info || info.room.state.hostSocketId !== socket.id) return
    info.room.state.phase = 'design'
    io.to(info.code).emit('room:state', info.room.state)
  })

  // ===================== 槽位操作 =====================
  socket.on('slot:join', ({ slotIndex }) => {
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
    slot.playerName = `P${slotIndex + 1}`  // 用槽位号作为默认名
    socketSlotMap.set(socket.id, { code: info.code, slotIndex })
    io.to(info.code).emit('room:state', info.room.state)
  })

  socket.on('slot:leave', () => {
    const prev = getMySlot(socket.id)
    if (!prev) return
    const room = getRoom(prev.code)
    if (room) {
      const slot = room.state.slots[prev.slotIndex]
      if (slot) { slot.playerName = null; slot.socketId = null; slot.isReady = false }
      // 清除设计准备状态
      for (const [, ds] of room.designs) ds.readySlots.delete(prev.slotIndex)
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
    if (!room.designs.has(teamId)) room.designs.set(teamId, { ships: [], readySlots: new Set() })
    room.designs.get(teamId)!.ships = ships
    // 广播给同阵营 (包括发送者)
    for (const s of room.state.slots) {
      if (s.teamId === teamId && s.socketId) {
        io.to(s.socketId).emit('design:state', { teamId, ships, readySlots: [...room.designs.get(teamId)!.readySlots] })
      }
    }
  })

  socket.on('design:ready', () => {
    const slot = getMySlot(socket.id)
    if (!slot) return
    const room = getRoom(slot.code)
    if (!room || room.state.phase !== 'design') return
    const teamId = room.state.slots[slot.slotIndex]?.teamId
    if (!teamId) return
    if (!room.designs.has(teamId)) room.designs.set(teamId, { ships: [], readySlots: new Set() })
    room.designs.get(teamId)!.readySlots.add(slot.slotIndex)
    room.state.slots[slot.slotIndex].isReady = true
    io.to(slot.code).emit('room:state', room.state)
    checkAllReady(io, room, slot.code)
  })

  socket.on('design:cancel', () => {
    const slot = getMySlot(socket.id)
    if (!slot) return
    const room = getRoom(slot.code)
    if (!room || room.state.phase !== 'design') return
    const teamId = room.state.slots[slot.slotIndex]?.teamId
    if (!teamId) return
    if (room.designs.has(teamId)) room.designs.get(teamId)!.readySlots.delete(slot.slotIndex)
    room.state.slots[slot.slotIndex].isReady = false
    io.to(slot.code).emit('room:state', room.state)
  })

  // ===================== 战斗阶段 =====================

  /** 获取有玩家的槽位索引数组 (按 slot.index 排序) */
  function occupiedSlots(room: ReturnType<typeof getRoom>): number[] {
    if (!room) return []
    return room.state.slots.filter(s => s.playerName).map(s => s.index).sort((a, b) => a - b)
  }

  socket.on('battle:spawn', ({ compartmentId }) => {
    const slot = getMySlot(socket.id)
    if (!slot) return
    const room = getRoom(slot.code)
    if (!room || room.state.phase !== 'battle') return
    room.spawns.set(slot.slotIndex, { shipId: '', compIndex: 0 })
    io.to(slot.code).emit('battle:action', { type: 'selectSpawn', compartmentId, senderSlotIndex: slot.slotIndex })
    io.to(slot.code).emit('battle:log', { message: `槽位${slot.slotIndex + 1} 选择出生点`, type: 'system', timestamp: Date.now() })
    const occ = occupiedSlots(room)
    const allSpawned = occ.every(idx => room.spawns.has(idx))
    if (allSpawned && occ.length > 0) {
      room.currentTurnSlot = occ[0]
      io.to(slot.code).emit('battle:turn', { playerSlotIndex: occ[0] })
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
    room.currentTurnSlot = occ[(curIdx + 1) % occ.length]
    io.to(slot.code).emit('battle:turn', { playerSlotIndex: room.currentTurnSlot })
    console.log(`[battle:turn] ${slot.code} → slot ${room.currentTurnSlot}`)
  })

  socket.on('battle:action', (action: BattleAction) => {
    const slot = getMySlot(socket.id)
    if (!slot) return
    const room = getRoom(slot.code)
    if (!room || room.state.phase !== 'battle') return
    // 校验: 只有当前回合槽位可以发送行动
    if (action.type !== 'selectSpawn' && room.currentTurnSlot !== slot.slotIndex) return
    action.senderSlotIndex = slot.slotIndex
    io.to(slot.code).emit('battle:action', action)
  })

  // ===================== 断开 =====================
  socket.on('disconnect', () => {
    const prev = getMySlot(socket.id)
    if (prev) {
      const room = getRoom(prev.code)
      if (room) {
        const slot = room.state.slots[prev.slotIndex]
        if (slot) { slot.playerName = null; slot.socketId = null; slot.isReady = false }
        io.to(prev.code).emit('room:state', room.state)
      }
      socketSlotMap.delete(socket.id)
    }
    console.log(`[disconnect] ${socket.id}`)
  })
})

function checkAllReady(io: Server, room: ReturnType<typeof getRoom>, code: string) {
  if (!room) return
  const occupied = room.state.slots.filter(s => s.playerName)
  if (occupied.length === 0) return
  if (occupied.every(s => s.isReady)) {
    room.state.phase = 'battle'
    // 构造 BattleInitPayload
    const teams = [...new Set(room.state.slots.map(s => s.teamId))]
    const initPayload = {
      ships: {} as Record<string, any[]>,
      players: room.state.slots.filter(s => s.playerName).map(s => ({ name: s.playerName!, teamId: s.teamId, slotIndex: s.index })),
      teams: teams.map((id, i) => ({ id, name: id, color: ['#409EFF','#F56C6C','#67C23A','#E6A23C'][i % 4] })),
      turnOrder: room.state.slots.filter(s => s.playerName).map(s => s.index),
      playerHands: {} as Record<number, any[]>,
    }
    // 收集所有阵营的设计
    for (const [teamId, ds] of room.designs) {
      if (ds.ships.length > 0) initPayload.ships[teamId] = ds.ships
    }
    io.to(code).emit('battle:init', initPayload)
    io.to(code).emit('room:state', room.state)
    console.log(`[battle:init] room ${code}`)
  }
}

const PORT = process.env.PORT || 3001
httpServer.listen(PORT, () => console.log(`Server running on port ${PORT}`))
