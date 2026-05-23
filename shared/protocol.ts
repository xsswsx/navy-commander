// ==================== 服务端状态类型 ====================

export interface SlotState {
  index: number
  teamId: string
  playerName: string | null
  socketId: string | null
  isReady: boolean
}

export interface RoomState {
  code: string
  hostSocketId: string
  slots: SlotState[]
  phase: 'lobby' | 'design' | 'battle'
  teamCount: number
  totalCompartments: number
}

// ==================== 客户端→服务端事件 ====================

export interface RoomConfig {
  hostName: string
  teamCount: number
  totalCompartments: number
  teams: { name: string; color: string }[]
  slotNames: string[][]  // teamIndex → playerNames[]
}

export interface ShipDesignData {
  name: string
  compartments: { compartmentIndex: number; equipmentType: string | null }[]
}

export type BattleActionType =
  | 'playCard' | 'freeAction' | 'selectTarget' | 'selectShip'
  | 'selectCommand' | 'selectSpawn' | 'endTurn'

export interface BattleAction {
  type: BattleActionType
  cardId?: string
  actionType?: 'move' | 'command' | 'pass'
  compartmentId?: string
  shipId?: string
  commandId?: string
  senderSlotIndex?: number
}

// ==================== BattleInit 全量数据 ====================

export interface BattleInitPayload {
  ships: Record<string, any[]>       // teamId → Ship[]
  players: { name: string; teamId: string; slotIndex: number }[]
  teams: { id: string; name: string; color: string }[]
  turnOrder: number[]               // slotIndex 顺序
  playerHands: Record<number, any[]> // slotIndex → Card[]
}

// ==================== 工具 ====================

export function generateRoomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let code = ''
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)]
  return code
}
