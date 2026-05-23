import type { SlotState, RoomState, ShipDesignData } from '../shared/protocol.js'

interface DesignState {
  ships: ShipDesignData[]
  readySlots: Set<number>
}

export interface ServerRoom {
  state: RoomState
  designs: Map<string, DesignState>    // teamId → DesignState
  spawns: Map<number, { shipId: string; compIndex: number }> // slotIndex → spawn
  currentTurnSlot: number
  battleLog: { message: string; type: string; timestamp: number }[]
}

const rooms = new Map<string, ServerRoom>()

export function getRoom(code: string): ServerRoom | undefined { return rooms.get(code) }
export function setRoom(code: string, room: ServerRoom): void { rooms.set(code, room) }
export function deleteRoom(code: string): void { rooms.delete(code) }
export function getRoomBySocket(socketId: string): { room: ServerRoom; code: string } | null {
  for (const [code, room] of rooms) {
    if (room.state.slots.some(s => s.socketId === socketId)) return { room, code }
  }
  return null
}

export function newRoom(code: string, state: RoomState): ServerRoom {
  const room: ServerRoom = { state, designs: new Map(), spawns: new Map(), currentTurnSlot: 0, battleLog: [] }
  rooms.set(code, room)
  return room
}
