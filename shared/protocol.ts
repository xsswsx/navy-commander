// ==================== 通用卡牌类型 ====================

export type CardType = 'move' | 'command' | 'action' | 'coffee' | 'scheme'

export interface CardData {
  id: string
  type: CardType
}

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
  readyTeams?: string[]  // 已准备的队伍ID列表
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

/** 一次战斗操作的结果 (用于跨客户端同步) */
export interface DamageResult {
  compartmentId: string
  damage: number
  /** 该舱段是否在此次伤害中被击毁 */
  destroyed?: boolean
}

export interface CombatActionResult {
  /** 操作类型 */
  op: 'damage' | 'addTorpedo' | 'addEffect' | 'addFighter' | 'compHeal' | 'move'
  /** 来源装备类型 */
  source?: string
  /** 伤害列表 (op='damage') */
  damages?: DamageResult[]
  /** 发射鱼雷 (op='addTorpedo') */
  torpSourceCompId?: string
  torpTargetCompId?: string
  torpCount?: number
  torpTurns?: number
  /** 添加效果 (op='addEffect') */
  effectType?: string
  effectSourceCompId?: string
  effectAffectedCompIds?: string[]
  effectTurns?: number
  /** 起飞战斗机 (op='addFighter') */
  fighterShipId?: string
  fighterTeamId?: string
  fighterCompId?: string
  fighterTurns?: number
  /** 维修 (op='compHeal') */
  healCompId?: string
  healAmount?: number
  /** 移动 (op='move') */
  fromCompIdx?: number
  toCompIdx?: number
}

export interface BattleAction {
  type: BattleActionType
  cardId?: string
  actionType?: 'move' | 'command' | 'pass'
  compartmentId?: string
  shipId?: string
  commandId?: string
  senderSlotIndex?: number
  /** 战斗日志消息 */
  logMessage?: string
  logType?: string
  /** 战斗结果 (用于跨客户端同步) */
  results?: CombatActionResult[]
}

// ==================== BattleInit 全量数据 ====================

export interface BattleInitPayload {
  ships: Record<string, any[]>       // teamId → Ship[]
  players: { name: string; teamId: string; slotIndex: number }[]
  teams: { id: string; name: string; color: string }[]
  turnOrder: number[]               // slotIndex 顺序
  playerHands: Record<number, CardData[]> // slotIndex → Card[]
  drawPile: CardData[]              // 服务器洗好的抽牌堆
  discardPile: CardData[]           // 弃牌堆
  spawnOrder: number[]              // 出生顺序 (slotIndex 排列)
}

// ==================== BattleState 全量同步 ====================

export interface BattleStateCompartment {
  compId: string; position: number; equipmentType: string | null
  maxHp: number; currentHp: number; isDestroyed: boolean
  multiCompRootId: string | null; multiCompSlaveIds: string[]
}

export interface BattleStateShip {
  shipId: string; teamId: string; name: string; ownerPlayerId: string
  compartments: BattleStateCompartment[]
}

export interface BattleStateSnapshot {
  ships: BattleStateShip[]
  playerPositions: Record<number, { shipId: string; compIndex: number }>
  fighterTokens: { id: string; shipId: string; ownerTeamId: string; sourceCompartmentId: string; sourcePlayerId: string; remainingTurns: number }[]
  torpedoSalvoes: { id: string; sourceCompartmentId: string; targetCompartmentId: string; torpedoCount: number; remainingTurns: number }[]
  activeEffects: { id: string; effectType: string; sourceCompartmentId: string; affectedCompartmentIds: string[]; remainingTurns: number }[]
  torpedoLoaded: Record<string, boolean>
  currentTurnSlot: number
  roundNumber: number
}

// ==================== 工具 ====================

export function generateRoomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let code = ''
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)]
  return code
}

/** 构建一副完整的116张牌堆 */
export function buildDeckCards(): CardData[] {
  const cards: CardData[] = []
  let id = 0
  const add = (type: CardType, count: number) => {
    for (let i = 0; i < count; i++) cards.push({ id: `deck_${++id}`, type })
  }
  add('move', 40)
  add('command', 40)
  add('action', 20)
  add('coffee', 8)
  add('scheme', 8)
  return cards
}

/** Fisher-Yates 洗牌 */
export function shuffleCards<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

/** 从牌堆抽牌，自动洗入弃牌堆 */
export function drawFromDeck(
  drawPile: CardData[],
  discardPile: CardData[],
  count: number
): { drawn: CardData[]; newDraw: CardData[]; newDiscard: CardData[] } {
  let d = [...drawPile]
  let disc = [...discardPile]
  const drawn: CardData[] = []
  for (let i = 0; i < count; i++) {
    if (d.length === 0) {
      if (disc.length === 0) break
      d = shuffleCards(disc)
      disc = []
    }
    drawn.push(d.pop()!)
  }
  return { drawn, newDraw: d, newDiscard: disc }
}
