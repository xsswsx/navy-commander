// ==================== 基础枚举 ====================

export type GameMode = 'hotseat' | 'single' | 'multiplayer'

export type GamePhase = 'setup' | 'design' | 'battle' | 'results'

export type TurnPhase = 'draw' | 'action' | 'discard'

export type CardType = 'move' | 'command' | 'action' | 'coffee' | 'scheme'

export type EquipmentCategory = 'combat' | 'support' | 'resource'

export type EquipmentType =
  | 'dual_cannon'
  | 'triple_cannon'
  | 'quad_torpedo'
  | 'small_hangar'
  | 'large_hangar'
  | 'ammo_depot'
  | 'fire_control'
  | 'command_room'
  | 'command_center'
  | 'integrated_command'
  | 'lifeboat'
  | 'damage_control'
  | 'smoke_generator'
  | 'afterburner'
  | 'depth_charge'
  | 'aa_gun'
  | 'dormitory'
  | 'comms_hub'

export type EquipmentTag = 'naval_gun' | 'torpedo' | 'hangar' | 'command' | 'repair' | 'utility'

// ==================== 玩家与队伍 ====================

export interface Player {
  id: string
  name: string
  teamId: string
  isAlive: boolean
  currentShipId: string | null
  currentCompartmentIndex: number | null
  hand: string[]
}

export interface Team {
  id: string
  name: string
  color: string
  playerIds: string[]
}

// ==================== 舰船与舱段 ====================

export interface Ship {
  id: string
  name: string
  ownerTeamId: string
  ownerPlayerId: string
  compartments: Compartment[]
}

export interface Compartment {
  id: string
  shipId: string
  position: number
  equipmentType: EquipmentType | null
  baseHp: number
  equipmentHpMod: number
  maxHp: number
  currentHp: number
  isDestroyed: boolean
  /** 如果此舱段属于多舱段军备，指向主舱段ID */
  multiCompRootId: string | null
  /** 如果此舱段是多舱段军备的主舱段，列出从属舱段ID */
  multiCompSlaveIds: string[]
}

// ==================== 卡牌 ====================

export interface Card {
  id: string
  type: CardType
}

// ==================== 战斗 ====================

export interface ActiveEffect {
  id: string
  effectType: 'smoke_short' | 'smoke_long' | 'fighter' | 'depth_charge_cover'
  sourceCompartmentId: string
  affectedCompartmentIds: string[]
  remainingTurns: number
}

export interface TorpedoSalvo {
  id: string
  sourceCompartmentId: string
  targetCompartmentId: string
  torpedoCount: number
  remainingTurns: number
}

export interface FighterToken {
  id: string
  shipId: string
  ownerTeamId: string
  occupiesSortie: boolean
  sourceCompartmentId: string
}

export interface LogEntry {
  id: string
  timestamp: number
  message: string
  type: 'info' | 'damage' | 'destroy' | 'effect' | 'system'
}

export interface DiceRoll {
  diceType: 'D4' | 'D6' | 'D8' | 'D12'
  count: number
  results: number[]
  label: string
}

export interface TargetingState {
  sourceCompartmentId: string
  commandId: string
  scope: 'enemy-compartment' | 'enemy-ship' | 'own-ship' | 'own-compartment' | 'any-compartment'
  validTargetIds: string[]
}

// ==================== 军备定义 ====================

export interface CommandAbility {
  id: string
  name: string
  actionType: 'command'
  targeting: TargetingRule
}

export interface TargetingRule {
  scope: 'self' | 'own-compartment' | 'own-ship' | 'enemy-compartment' | 'enemy-ship' | 'any-compartment'
  range: number
}

export interface PassiveEffect {
  id: string
  event: GameEventType
}

export interface TriggeredEffect {
  id: string
  event: GameEventType
}

export type GameEventType =
  | 'turn-start'
  | 'turn-draw-phase'
  | 'turn-action-phase'
  | 'turn-discard-phase'
  | 'turn-end'
  | 'player-moved'
  | 'damage-about-to-apply'
  | 'damage-applied'
  | 'compartment-destroyed'
  | 'ship-sunk'
  | 'player-eliminated'
  | 'command-resolving'
  | 'command-resolved'
  | 'card-played'

export interface EquipmentDefinition {
  type: EquipmentType
  name: string
  category: EquipmentCategory
  drawValue: number
  hpModifier: number
  compartmentSpan: number
  tags: EquipmentTag[]
  /** 每回合最多可被指挥的次数 (0 = 无限制, 如大型机库) */
  commandsPerTurn: number
  /** 机库类军备的每回合出击架次上限 (0 = 非机库) */
  sortieCapacity: number
  passiveEffects: PassiveEffect[]
  commands: CommandAbility[]
  triggers: TriggeredEffect[]
}

// ==================== 设计阶段 ====================

export interface DesignSlot {
  compartmentIndex: number
  equipmentType: EquipmentType | null
}

export interface ShipDesign {
  name: string
  compartmentCount: number
  slots: DesignSlot[]
}
