import type { RoomState, RoomPlayer, SlotState, DesignSyncPayload, BattleAction } from '../shared/protocol.js'
import { generateRoomCode } from '../shared/protocol.js'

export class RoomManager {
  private rooms = new Map<string, RoomState>()

  createRoom(
    hostSocketId: string,
    playerName: string,
    totalCompartments: number,
    slotConfig: { teamId: string; playerName: string }[]
  ): RoomState {
    const code = generateRoomCode()
    const slots: import('../shared/protocol.js').SlotState[] = slotConfig.map((s, i) => ({
      index: i,
      teamId: s.teamId,
      playerName: null,
      socketId: null,
      isReady: false,
    }))
    const room: RoomState = {
      code,
      hostSocketId,
      players: [{ socketId: hostSocketId, playerName, slotIndex: null, isReady: false }],
      slots,
      phase: 'lobby',
      teamCount: new Set(slotConfig.map(s => s.teamId)).size,
      totalCompartments,
    }
    this.rooms.set(code, room)
    return room
  }

  joinRoom(code: string, socketId: string, playerName: string): RoomState | null {
    const room = this.rooms.get(code)
    if (!room) return null
    if (room.players.some(p => p.socketId === socketId)) return room // 已在房间中
    room.players.push({ socketId, playerName, slotIndex: null, isReady: false })
    return room
  }

  leaveRoom(socketId: string): { room: RoomState | null; wasHost: boolean } {
    for (const [code, room] of this.rooms) {
      const idx = room.players.findIndex(p => p.socketId === socketId)
      if (idx !== -1) {
        const player = room.players[idx]
        // 释放槽位
        if (player.slotIndex != null) {
          const slot = room.slots[player.slotIndex]
          if (slot) { slot.playerName = null; slot.socketId = null; slot.isReady = false }
        }
        room.players.splice(idx, 1)
        const wasHost = room.hostSocketId === socketId
        if (wasHost) {
          room.hostSocketId = room.players[0]?.socketId ?? null
        }
        if (room.players.length === 0) {
          this.rooms.delete(code)
          return { room: null, wasHost: true }
        }
        return { room, wasHost }
      }
    }
    return { room: null, wasHost: false }
  }

  getRoomBySocket(socketId: string): RoomState | null {
    for (const room of this.rooms.values()) {
      if (room.players.some(p => p.socketId === socketId)) return room
    }
    return null
  }

  getRoomByPlayerName(playerName: string): RoomState | null {
    for (const room of this.rooms.values()) {
      if (room.players.some(p => p.playerName === playerName)) return room
    }
    return null
  }

  // ===== 槽位管理 =====

  initSlots(room: RoomState, teams: { id: string; name: string; color: string }[]): void {
    room.slots = []
    const playerPool = [...room.players]
    let slotIdx = 0
    for (const team of teams) {
      const teamPlayer = playerPool.find(p => p.slotIndex == null)
      const playerName = teamPlayer?.playerName ?? null
      const socketId = teamPlayer?.socketId ?? null
      if (teamPlayer) teamPlayer.slotIndex = slotIdx
      room.slots.push({ index: slotIdx, teamId: team.id, playerName, socketId, isReady: false })
      slotIdx++
    }
    // 额外槽位 — 方便添加更多玩家
    for (const player of playerPool) {
      if (player.slotIndex != null) continue
      const teamIdx = room.slots.length % teams.length
      player.slotIndex = slotIdx
      room.slots.push({ index: slotIdx, teamId: teams[teamIdx].id, playerName: player.playerName, socketId: player.socketId, isReady: false })
      slotIdx++
    }
  }

  joinSlot(room: RoomState, socketId: string, slotIndex: number): boolean {
    const slot = room.slots[slotIndex]
    if (!slot || slot.playerName != null) return false
    const player = room.players.find(p => p.socketId === socketId)
    if (!player) return false
    // 先释放之前的槽位
    if (player.slotIndex != null) {
      const oldSlot = room.slots[player.slotIndex]
      if (oldSlot) { oldSlot.playerName = null; oldSlot.socketId = null; oldSlot.isReady = false }
    }
    player.slotIndex = slotIndex
    slot.playerName = player.playerName
    slot.socketId = socketId
    slot.isReady = false
    return true
  }

  leaveSlot(room: RoomState, socketId: string): boolean {
    const player = room.players.find(p => p.socketId === socketId)
    if (!player || player.slotIndex == null) return false
    const slot = room.slots[player.slotIndex]
    if (slot) { slot.playerName = null; slot.socketId = null; slot.isReady = false }
    player.slotIndex = null
    player.isReady = false
    return true
  }

  setReady(room: RoomState, socketId: string, ready: boolean): void {
    const player = room.players.find(p => p.socketId === socketId)
    if (!player || player.slotIndex == null) return
    player.isReady = ready
    const slot = room.slots[player.slotIndex]
    if (slot) slot.isReady = ready
  }

  isAllReady(room: RoomState): boolean {
    const assignedSlots = room.slots.filter(s => s.playerName != null)
    return assignedSlots.length > 0 && assignedSlots.every(s => s.isReady)
  }

  getAllDesigns(roomCode: string): Record<string, import('../shared/protocol.js').DesignSyncPayload | null> {
    const teamDesigns = this.designStates.get(roomCode)
    if (!teamDesigns) return {}
    const result: Record<string, any> = {}
    for (const [teamId, design] of teamDesigns) {
      result[teamId] = design
    }
    return result
  }

  // ===== 设计阶段 =====
  private designStates = new Map<string, Map<string, DesignSyncPayload>>() // roomCode -> teamId -> design

  updateDesign(roomCode: string, teamId: string, design: DesignSyncPayload): void {
    if (!this.designStates.has(roomCode)) {
      this.designStates.set(roomCode, new Map())
    }
    this.designStates.get(roomCode)!.set(teamId, design)
  }

  getDesign(roomCode: string, teamId: string): DesignSyncPayload | null {
    return this.designStates.get(roomCode)?.get(teamId) ?? null
  }

  removeRoom(roomCode: string): void {
    this.rooms.delete(roomCode)
    this.designStates.delete(roomCode)
  }

  getAllRooms(): RoomState[] {
    return [...this.rooms.values()]
  }
}
