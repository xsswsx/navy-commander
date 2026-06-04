import type { SlotState, RoomState, ShipDesignData, CardData } from '../shared/protocol.js'

interface DesignState {
  ships: ShipDesignData[]
  readySlots: Set<number>
}

export interface ServerRoom {
  state: RoomState
  designs: Map<string, DesignState>    // teamId → DesignState
  readyTeams: Set<string>              // 已准备的队伍ID
  spawns: Map<number, { shipId: string; compIndex: number }> // slotIndex → spawn
  currentTurnSlot: number
  roundNumber: number
  lastBattleInit: any                  // 缓存最近一次 battle:init payload
  battleLog: { message: string; type: string; timestamp: number }[]
  // 服务端牌堆
  drawPile: CardData[]
  discardPile: CardData[]
  playerHands: Map<number, CardData[]> // slotIndex → Card[]
  playerNames: Map<string, string>     // socketId → playerName (临时存储，用于 slot join)
}

const rooms = new Map<string, ServerRoom>()
const socketRoomMap = new Map<string, string>() // socketId → roomCode

export function getRoom(code: string): ServerRoom | undefined { return rooms.get(code) }
export function setRoom(code: string, room: ServerRoom): void { rooms.set(code, room) }
export function deleteRoom(code: string): void { rooms.delete(code) }
export function setSocketRoom(socketId: string, code: string): void { socketRoomMap.set(socketId, code) }
export function removeSocketRoom(socketId: string): void { socketRoomMap.delete(socketId) }

export function getRoomBySocket(socketId: string): { room: ServerRoom; code: string } | null {
  // 优先查找槽位
  for (const [code, room] of rooms) {
    if (room.state.slots.some(s => s.socketId === socketId)) return { room, code }
  }
  // 其次从 socket→room 映射查找 (未加入槽位时)
  const code = socketRoomMap.get(socketId)
  if (code) { const room = rooms.get(code); if (room) return { room, code } }
  return null
}

export function newRoom(code: string, state: RoomState): ServerRoom {
  const room: ServerRoom = {
    state,
    designs: new Map(),
    readyTeams: new Set(),
    spawns: new Map(),
    currentTurnSlot: 0,
    roundNumber: 1,
    battleLog: [],
    drawPile: [],
    discardPile: [],
    playerHands: new Map(),
    playerNames: new Map(),
  }
  rooms.set(code, room)
  return room
}
