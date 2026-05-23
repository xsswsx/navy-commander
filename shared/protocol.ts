// ==================== 房间协议 ====================

export interface RoomState {
  code: string
  hostSocketId: string | null
  players: RoomPlayer[]
  slots: SlotState[]
  phase: 'lobby' | 'design' | 'battle' | 'results'
  teamCount: number
  totalCompartments: number
}

export interface RoomPlayer {
  socketId: string
  playerName: string
  slotIndex: number | null
  isReady: boolean
}

export interface SlotState {
  index: number
  teamId: string
  playerName: string | null
  socketId: string | null
  isReady: boolean
}

// ==================== 客户端→服务端 ====================

export type ClientToServerEvents = {
  'room:create': (payload: { playerName: string; totalCompartments: number; slots: { teamId: string; playerName: string }[] }) => void
  'room:join': (payload: { roomCode: string; playerName: string }) => void
  'room:leave': () => void
  'room:startDesign': (payload: { teamCount: number; totalCompartments: number; teams: { name: string; color: string }[] }) => void

  'slot:join': (payload: { slotIndex: number }) => void
  'slot:leave': () => void
  'slot:ready': () => void
  'slot:cancelReady': () => void

  'design:sync': (payload: DesignSyncPayload) => void

  'battle:action': (payload: BattleAction) => void
}

export interface DesignSyncPayload {
  ships: ShipDesignData[]
}

export interface ShipDesignData {
  name: string
  compartments: { compartmentIndex: number; equipmentType: string | null }[]
}

export type BattleAction = {
  senderPlayerId?: string
} & (
  | { type: 'playCard'; cardId: string }
  | { type: 'freeAction'; actionType: 'move' | 'command' | 'pass' }
  | { type: 'selectTarget'; compartmentId: string }
  | { type: 'selectShip'; shipId: string }
  | { type: 'selectCommand'; commandId: string }
  | { type: 'selectSpawn'; compartmentId: string }
  | { type: 'endTurn' }
)

// ==================== 服务端→客户端 ====================

export type ServerToClientEvents = {
  'room:update': (room: RoomState) => void
  'room:error': (error: { message: string }) => void
  'room:playerJoined': (player: RoomPlayer) => void
  'room:playerLeft': (socketId: string) => void

  'slot:update': (slots: SlotState[]) => void

  'design:sync': (payload: DesignSyncPayload & { teamId: string }) => void
  'design:allReady': () => void

  'battle:state': (state: any) => void
  'battle:log': (entry: { message: string; type: string }) => void
  'battle:turnChange': (payload: { playerId: string; playerName: string; phase: string }) => void
  'battle:action': (action: BattleAction) => void
  'battle:init': (payload: BattleInitPayload) => void
}

// ==================== 类型工具 ====================

export function generateRoomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let code = ''
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)]
  }
  return code
}

// ==================== 多人模式战斗初始化协议 ====================
export interface BattleInitPayload {
  ships: any[]
  playerHands: Record<string, any[]>
  players: any[]
  teams: any[]
  turnOrder: string[]
  currentTurnIndex: number
  currentTurnPhase: string
}
