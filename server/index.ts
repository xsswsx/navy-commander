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
      io.to(room.code).emit('design:allReady')
      room.phase = 'battle'
      io.to(room.code).emit('room:update', room)
      console.log(`[design:allReady] room ${room.code}`)
    }
    if (rooms.isAllReady(room)) {
      io.to(room.code).emit('design:allReady')
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

  // ===== 战斗行动中继 =====
  socket.on('battle:action', (action) => {
    const room = rooms.getRoomBySocket(socket.id)
    if (!room) return
    // 广播给同房间其他客户端
    socket.to(room.code).emit('battle:action', action)
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
