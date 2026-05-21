import type { EquipmentDefinition } from '../types'

const allEquipment: EquipmentDefinition[] = [
  // ===== 战斗军备 =====
  {
    type: 'dual_cannon',
    name: '二联装炮',
    category: 'combat',
    drawValue: 1,
    hpModifier: 10,
    compartmentSpan: 1,
    tags: ['naval_gun'],
    commandsPerTurn: 2,
    sortieCapacity: 0,
    passiveEffects: [],
    commands: [
      {
        id: 'dual_cannon_shoot',
        name: '射击',
        actionType: 'command',
        targeting: { scope: 'enemy-compartment', range: Infinity },
      },
      {
        id: 'dual_cannon_blindfire',
        name: '盲射',
        actionType: 'command',
        targeting: { scope: 'enemy-ship', range: Infinity },
      },
    ],
    triggers: [],
  },
  {
    type: 'triple_cannon',
    name: '三联装炮',
    category: 'combat',
    drawValue: 1,
    hpModifier: 10,
    compartmentSpan: 1,
    tags: ['naval_gun'],
    commandsPerTurn: 1,
    sortieCapacity: 0,
    passiveEffects: [],
    commands: [
      {
        id: 'triple_cannon_shoot',
        name: '射击',
        actionType: 'command',
        targeting: { scope: 'enemy-compartment', range: Infinity },
      },
      {
        id: 'triple_cannon_blindfire',
        name: '盲射',
        actionType: 'command',
        targeting: { scope: 'enemy-ship', range: Infinity },
      },
    ],
    triggers: [],
  },
  {
    type: 'quad_torpedo',
    name: '四联装鱼雷',
    category: 'combat',
    drawValue: 1,
    hpModifier: 5,
    compartmentSpan: 1,
    tags: ['torpedo'],
    commandsPerTurn: 2,
    sortieCapacity: 0,
    passiveEffects: [],
    commands: [
      {
        id: 'quad_torpedo_load',
        name: '装填',
        actionType: 'command',
        targeting: { scope: 'self', range: 0 },
      },
      {
        id: 'quad_torpedo_fire',
        name: '发射',
        actionType: 'command',
        targeting: { scope: 'enemy-compartment', range: Infinity },
      },
    ],
    triggers: [
      { id: 'quad_torpedo_explosion', event: 'compartment-destroyed' },
    ],
  },
  {
    type: 'small_hangar',
    name: '小型机库',
    category: 'combat',
    drawValue: 1,
    hpModifier: 0,
    compartmentSpan: 1,
    tags: ['hangar'],
    commandsPerTurn: 1,
    sortieCapacity: 1,
    passiveEffects: [],
    commands: [
      {
        id: 'small_hangar_launch_fighter',
        name: '起飞战斗机',
        actionType: 'command',
        targeting: { scope: 'any-compartment', range: Infinity },
      },
      {
        id: 'small_hangar_launch_bomber',
        name: '起飞轰炸机',
        actionType: 'command',
        targeting: { scope: 'any-compartment', range: Infinity },
      },
      {
        id: 'small_hangar_launch_torpedo_bomber',
        name: '起飞鱼雷机',
        actionType: 'command',
        targeting: { scope: 'any-compartment', range: Infinity },
      },
    ],
    triggers: [],
  },
  {
    type: 'large_hangar',
    name: '大型机库',
    category: 'combat',
    drawValue: 1,
    hpModifier: 0,
    compartmentSpan: 2,
    tags: ['hangar'],
    commandsPerTurn: 0,  // 无限制
    sortieCapacity: 0,  // 由机库总数决定
    passiveEffects: [],
    commands: [
      {
        id: 'large_hangar_launch_fighter',
        name: '起飞战斗机',
        actionType: 'command',
        targeting: { scope: 'any-compartment', range: Infinity },
      },
      {
        id: 'large_hangar_launch_bomber',
        name: '起飞轰炸机',
        actionType: 'command',
        targeting: { scope: 'any-compartment', range: Infinity },
      },
      {
        id: 'large_hangar_launch_torpedo_bomber',
        name: '起飞鱼雷机',
        actionType: 'command',
        targeting: { scope: 'any-compartment', range: Infinity },
      },
    ],
    triggers: [],
  },

  // ===== 支援军备 =====
  {
    type: 'ammo_depot',
    name: '弹药库',
    category: 'support',
    drawValue: 2,
    hpModifier: -5,
    compartmentSpan: 1,
    tags: ['utility'],
    commandsPerTurn: 0,
    sortieCapacity: 0,
    passiveEffects: [
      { id: 'ammo_depot_adjacent', event: 'command-resolving' },
    ],
    commands: [],
    triggers: [
      { id: 'ammo_depot_explosion', event: 'compartment-destroyed' },
    ],
  },
  {
    type: 'fire_control',
    name: '火控计算机',
    category: 'support',
    drawValue: 2,
    hpModifier: 0,
    compartmentSpan: 1,
    tags: ['utility'],
    commandsPerTurn: 0,
    sortieCapacity: 0,
    passiveEffects: [
      { id: 'fire_control_adjust', event: 'command-resolving' },
    ],
    commands: [],
    triggers: [],
  },
  {
    type: 'command_room',
    name: '指挥室',
    category: 'support',
    drawValue: 1,
    hpModifier: -5,
    compartmentSpan: 1,
    tags: ['command'],
    commandsPerTurn: 2,
    sortieCapacity: 0,
    passiveEffects: [],
    commands: [
      {
        id: 'command_room_relay',
        name: '发令',
        actionType: 'command',
        targeting: { scope: 'own-compartment', range: Infinity },
      },
    ],
    triggers: [],
  },
  {
    type: 'command_center',
    name: '指挥中心',
    category: 'support',
    drawValue: 1,
    hpModifier: 0,
    compartmentSpan: 2,
    tags: ['command'],
    commandsPerTurn: 0,
    sortieCapacity: 0,
    passiveEffects: [],
    commands: [
      {
        id: 'command_center_relay',
        name: '发令',
        actionType: 'command',
        targeting: { scope: 'own-ship', range: Infinity },
      },
    ],
    triggers: [],
  },
  {
    type: 'integrated_command',
    name: '综合指挥中心',
    category: 'support',
    drawValue: 2,
    hpModifier: 5,
    compartmentSpan: 3,
    tags: ['command'],
    commandsPerTurn: 0,
    sortieCapacity: 0,
    passiveEffects: [
      { id: 'integrated_command_convert', event: 'card-played' },
    ],
    commands: [
      {
        id: 'integrated_command_relay',
        name: '发令',
        actionType: 'command',
        targeting: { scope: 'any-compartment', range: Infinity },
      },
    ],
    triggers: [],
  },
  {
    type: 'lifeboat',
    name: '救生艇',
    category: 'support',
    drawValue: 1,
    hpModifier: 0,
    compartmentSpan: 1,
    tags: ['utility'],
    commandsPerTurn: 0,
    sortieCapacity: 0,
    passiveEffects: [
      { id: 'lifeboat_escape', event: 'ship-sunk' },
    ],
    commands: [],
    triggers: [],
  },
  {
    type: 'damage_control',
    name: '损管模块',
    category: 'support',
    drawValue: 1,
    hpModifier: 0,
    compartmentSpan: 1,
    tags: ['repair'],
    commandsPerTurn: 1,
    sortieCapacity: 0,
    passiveEffects: [],
    commands: [
      {
        id: 'damage_control_repair',
        name: '综合修复',
        actionType: 'command',
        targeting: { scope: 'self', range: 0 },
      },
      {
        id: 'damage_control_quick_repair',
        name: '快速抢修',
        actionType: 'command',
        targeting: { scope: 'own-ship', range: 2 },
      },
    ],
    triggers: [],
  },
  {
    type: 'smoke_generator',
    name: '烟幕发生器',
    category: 'support',
    drawValue: 1,
    hpModifier: -5,
    compartmentSpan: 1,
    tags: ['utility'],
    commandsPerTurn: 0,
    sortieCapacity: 0,
    passiveEffects: [],
    commands: [
      {
        id: 'smoke_short',
        name: '快速发烟',
        actionType: 'command',
        targeting: { scope: 'self', range: 0 },
      },
      {
        id: 'smoke_long',
        name: '持续发烟',
        actionType: 'command',
        targeting: { scope: 'self', range: 0 },
      },
    ],
    triggers: [],
  },
  {
    type: 'afterburner',
    name: '加力引擎',
    category: 'support',
    drawValue: 2,
    hpModifier: 0,
    compartmentSpan: 1,
    tags: ['utility'],
    commandsPerTurn: 0,
    sortieCapacity: 0,
    passiveEffects: [
      { id: 'afterburner_hit_mod', event: 'command-resolving' },
    ],
    commands: [],
    triggers: [],
  },
  {
    type: 'depth_charge',
    name: '深水炸弹',
    category: 'support',
    drawValue: 2,
    hpModifier: 0,
    compartmentSpan: 1,
    tags: ['utility'],
    commandsPerTurn: 0,
    sortieCapacity: 0,
    passiveEffects: [
      { id: 'depth_charge_defense', event: 'damage-about-to-apply' },
    ],
    commands: [
      {
        id: 'depth_charge_anti_torpedo',
        name: '反鱼雷',
        actionType: 'command',
        targeting: { scope: 'any-compartment', range: Infinity },
      },
    ],
    triggers: [],
  },
  {
    type: 'aa_gun',
    name: '防空炮',
    category: 'support',
    drawValue: 2,
    hpModifier: 5,
    compartmentSpan: 1,
    tags: ['utility'],
    commandsPerTurn: 0,
    sortieCapacity: 0,
    passiveEffects: [
      { id: 'aa_gun_airpower', event: 'command-resolving' },
    ],
    commands: [],
    triggers: [],
  },

  // ===== 资源军备 =====
  {
    type: 'dormitory',
    name: '宿舍',
    category: 'resource',
    drawValue: 4,
    hpModifier: 10,
    compartmentSpan: 1,
    tags: [],
    commandsPerTurn: 0,
    sortieCapacity: 0,
    passiveEffects: [],
    commands: [],
    triggers: [],
  },
  {
    type: 'comms_hub',
    name: '通讯中枢',
    category: 'resource',
    drawValue: 3,
    hpModifier: 5,
    compartmentSpan: 1,
    tags: [],
    commandsPerTurn: 0,
    sortieCapacity: 0,
    passiveEffects: [],
    commands: [],
    triggers: [],
  },
]

export const equipmentRegistry = new Map(
  allEquipment.map((eq) => [eq.type, eq])
)

export function getEquipment(type: EquipmentDefinition['type']): EquipmentDefinition {
  const eq = equipmentRegistry.get(type)
  if (!eq) throw new Error(`Unknown equipment: ${type}`)
  return eq
}

export function getAllEquipment(): EquipmentDefinition[] {
  return allEquipment
}

export function getEquipmentByCategory(cat: EquipmentDefinition['category']): EquipmentDefinition[] {
  return allEquipment.filter((e) => e.category === cat)
}
