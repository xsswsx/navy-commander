<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { useGameStore } from '@/stores/game'
import { useShipStore } from '@/stores/ship'
import { useCardStore } from '@/stores/card'
import { useCombatStore } from '@/stores/combat'
import { getAllEquipment, getEquipmentByCategory } from '@/game/equipment/registry'
import { baseHp } from '@/game/constants'
import type { EquipmentType, ShipDesign, DesignSlot } from '@/game/types'
import { ElMessage, ElMessageBox } from 'element-plus'
import { multiplayerClient } from '@/modes/multiplayer/MultiplayerClient'

const router = useRouter()
const gameStore = useGameStore()
const shipStore = useShipStore()
const cardStore = useCardStore()
const combatStore = useCombatStore()

const allEquipment = getAllEquipment()
const combatEquipment = getEquipmentByCategory('combat')
const supportEquipment = getEquipmentByCategory('support')
const resourceEquipment = getEquipmentByCategory('resource')

// 阵营级设计: 热座轮流 / 多人同时
const designTeamIndex = ref(0)
const designerTeams = computed(() => gameStore.teams.map(t => t.id))
const currentTeamId = computed(() => {
  if (isMultiplayer.value) {
    // 多人模式: 用 multiplayerClient.myPlayerId 找到当前会话的玩家
    const myPlayer = gameStore.players.find(p => p.id === multiplayerClient.myPlayerId)
    return myPlayer?.teamId ?? null
  }
  return designerTeams.value[designTeamIndex.value] ?? null
})
const currentTeam = computed(() =>
  gameStore.teams.find(t => t.id === currentTeamId.value) ?? null
)

const teamCompartmentBudget = computed(() => gameStore.totalCompartments)

// 设计中的舰船 [{ name, compartments: [{ compartmentIndex, equipmentType, slaveOfSlot }] }]
interface DesignCompartment {
  compartmentIndex: number
  equipmentType: EquipmentType | null
  /** 如果此舱段被多舱段军备占用，指向主舱段index */
  slaveOfSlot: number | null
  /** 如果此舱段是多舱段军备的主舱段，记录从属舱段indices */
  slaveIndices: number[]
}

const ships = ref<{ name: string; compartments: DesignCompartment[] }[]>([])

const usedCompartments = computed(() =>
  ships.value.reduce((sum, s) => sum + s.compartments.length, 0)
)
const remainingCompartments = computed(() => teamCompartmentBudget.value - usedCompartments.value)

const selectedEquipment = ref<EquipmentType | null>(null)
const isMultiplayer = computed(() => gameStore.mode === 'multiplayer')
const isReady = ref(false)
const allReady = ref(false)
const mpRoomSlots = ref<{ index: number; teamId: string; playerName: string | null; isReady: boolean }[]>([])

function syncDesign(): void {
  if (!isMultiplayer.value) return
  const design = {
    ships: ships.value.map(s => ({
      name: s.name,
      compartments: s.compartments.map(c => ({
        compartmentIndex: c.compartmentIndex,
        equipmentType: c.equipmentType,
      })),
    })),
  }
  multiplayerClient.sendDesignSync(design)
}

function onRemoteDesign(data: any): void {
  if (!isMultiplayer.value) return
  const myPlayer = gameStore.players.find(p => p.id === gameStore.currentPlayerId)
  if (!myPlayer || data.teamId !== myPlayer.teamId) return
  ships.value = data.ships.map((s: any) => ({
    name: s.name,
    compartments: s.compartments.map((c: any) => ({
      compartmentIndex: c.compartmentIndex,
      equipmentType: c.equipmentType as EquipmentType | null,
      slaveOfSlot: null as number | null,
      slaveIndices: [] as number[],
    })),
  }))
  for (let si = 0; si < ships.value.length; si++) {
    rebuildMultiComp(si)
  }
}

onMounted(() => {
  if (isMultiplayer.value) {
    multiplayerClient.onDesignSync(onRemoteDesign)
    multiplayerClient.onAllReady((allDesigns: Record<string, any>) => {
      // 将其他阵营的设计也 finalize (本阵营已在 prepare 时 finalize)
      for (const [teamId, design] of Object.entries(allDesigns)) {
        if (!design || !design.ships) continue
        const existingShips = shipStore.ships.filter(s => s.ownerTeamId === teamId)
        if (existingShips.length > 0) continue // 本阵营已 finalize, 跳过
        const teamPlayers = gameStore.players.filter(p => p.teamId === teamId)
        const repPlayerId = teamPlayers[0]?.id ?? ''
        const designs: ShipDesign[] = design.ships.map((s: any) => ({
          name: s.name,
          compartmentCount: s.compartments.length,
          slots: s.compartments
            .filter((c: any) => c.equipmentType)
            .map((c: any) => ({
              compartmentIndex: c.compartmentIndex,
              equipmentType: c.equipmentType!,
            })),
        }))
        shipStore.finalizeDesign(repPlayerId, teamId, designs)
        combatStore.log(`接收阵营 ${teamId} 的舰船设计 (${designs.length}艘)`, 'system')
      }
      allReady.value = true
    })
    // 立即请求房间状态以显示准备指示灯
    multiplayerClient.requestRoomState()
    multiplayerClient.onRoomUpdate((r: any) => {
      mpRoomSlots.value = r.slots || []
    })
  }
})

onUnmounted(() => {
  if (isMultiplayer.value) {
    multiplayerClient.off('design:sync', onRemoteDesign)
    multiplayerClient.off('design:allReady', () => {})
  }
})

watch(ships, () => { syncDesign() }, { deep: true })

watch(allReady, (val) => {
  if (val && isMultiplayer.value) {
    // 各阵营已在自己准备时调过 finalizeDesign, 这里只需启动战斗
    gameStore.startBattlePhase()
    cardStore.dealInitialHands(gameStore.players.map(p => p.id))
    ElMessage.success('全部就绪，进入战斗！')
    router.push('/battle')
  }
})

function addShip(): void {
  ships.value.push({ name: `舰船${ships.value.length + 1}`, compartments: [] })
}

function removeShip(index: number): void {
  ships.value.splice(index, 1)
}

function addCompartment(shipIndex: number): void {
  if (remainingCompartments.value < 1) {
    ElMessage.warning('没有剩余舱段配额')
    return
  }
  const ship = ships.value[shipIndex]
  ship.compartments.push({
    compartmentIndex: ship.compartments.length,
    equipmentType: null,
    slaveOfSlot: null,
    slaveIndices: [],
  })
  ship.compartments.forEach((s, i) => (s.compartmentIndex = i))
}

function removeCompartment(shipIndex: number, slotIndex: number): void {
  const ship = ships.value[shipIndex]
  const slot = ship.compartments[slotIndex]

  // 如果是多舱段军备的从属，移除主舱段
  if (slot.slaveOfSlot != null) {
    const master = ship.compartments[slot.slaveOfSlot]
    if (master) {
      master.equipmentType = null
      master.slaveIndices = []
    }
  }

  // 如果是多舱段军备的主舱段，释放从属
  for (const si of slot.slaveIndices) {
    const slave = ship.compartments[si]
    if (slave) {
      slave.slaveOfSlot = null
    }
  }

  ship.compartments.splice(slotIndex, 1)
  ship.compartments.forEach((s, i) => {
    s.compartmentIndex = i
    // 更新所有slaveOfSlot引用
  })
  // 修复引用
  for (const s of ship.compartments) {
    if (s.slaveOfSlot != null && s.slaveOfSlot >= ship.compartments.length) {
      s.slaveOfSlot = null
    }
    s.slaveIndices = s.slaveIndices.filter(i => i < ship.compartments.length)
  }
}

function selectEquipment(type: EquipmentType): void {
  selectedEquipment.value = type
}

function placeEquipment(shipIndex: number, slotIndex: number): void {
  if (!selectedEquipment.value) return
  const ship = ships.value[shipIndex]
  const slot = ship.compartments[slotIndex]
  if (!slot) return

  // 检查是否已被多舱段军备占用
  if (slot.slaveOfSlot != null) {
    ElMessage.warning('此舱段已被多舱段军备占用')
    return
  }
  if (slot.equipmentType) {
    // 已有军备，先移除再放置
    removeEquipmentFromSlot(ship, slotIndex)
  }

  const eq = allEquipment.find(e => e.type === selectedEquipment.value)
  if (!eq) return

  // 多舱段军备检查
  if (eq.compartmentSpan > 1) {
    const endIdx = slotIndex + eq.compartmentSpan - 1
    if (endIdx >= ship.compartments.length) {
      ElMessage.warning('多舱段军备超出舰船范围')
      return
    }
    for (let i = slotIndex + 1; i <= endIdx; i++) {
      const s = ship.compartments[i]
      if (s.equipmentType || s.slaveOfSlot != null) {
        ElMessage.warning('军备所占舱段与其他军备冲突')
        return
      }
    }
    // 标记从属舱段
    const slaveIndices: number[] = []
    for (let i = slotIndex + 1; i <= endIdx; i++) {
      ship.compartments[i].slaveOfSlot = slotIndex
      slaveIndices.push(i)
    }
    slot.slaveIndices = slaveIndices
  }

  slot.equipmentType = selectedEquipment.value
  selectedEquipment.value = null
}

function removeEquipmentFromSlot(ship: typeof ships.value[0], slotIndex: number): void {
  const slot = ship.compartments[slotIndex]
  if (!slot) return

  // 释放从属舱段
  for (const si of slot.slaveIndices) {
    const slave = ship.compartments[si]
    if (slave) slave.slaveOfSlot = null
  }
  slot.slaveIndices = []
  slot.equipmentType = null
}

function removeEquipment(shipIndex: number, slotIndex: number): void {
  const ship = ships.value[shipIndex]
  const slot = ship.compartments[slotIndex]
  if (!slot) return

  // 如果是从属舱段，对主舱段操作
  if (slot.slaveOfSlot != null) {
    removeEquipmentFromSlot(ship, slot.slaveOfSlot)
  } else {
    removeEquipmentFromSlot(ship, slotIndex)
  }
}

function validateDesign(): boolean {
  if (ships.value.length === 0) {
    ElMessage.warning('至少需要1艘舰船')
    return false
  }
  if (usedCompartments.value !== teamCompartmentBudget.value) {
    ElMessage.warning(`必须用完所有舱段配额（${usedCompartments.value}/${teamCompartmentBudget.value}）`)
    return false
  }
  for (const ship of ships.value) {
    for (const slot of ship.compartments) {
      if (!slot.equipmentType && slot.slaveOfSlot == null) {
        ElMessage.warning('所有舱段必须安装军备（或被多舱段军备占用）')
        return false
      }
    }
  }
  return true
}

function handleReady(): void {
  if (!validateDesign()) {
    ElMessage.warning('设计不符合要求，无法准备就绪')
    return
  }
  confirmDesign()
  multiplayerClient.setReady()
}

function handleCancelReady(): void {
  multiplayerClient.cancelReady()
  isReady.value = false
}

function confirmDesign(): void {
  if (!validateDesign()) return
  if (!currentTeam.value) return

  const teamId = currentTeam.value.id
  const teamPlayers = gameStore.players.filter(p => p.teamId === teamId)
  const repPlayerId = teamPlayers[0]?.id ?? ''

  const designs: ShipDesign[] = ships.value.map(s => ({
    name: s.name,
    compartmentCount: s.compartments.length,
    slots: s.compartments
      .filter(c => c.slaveOfSlot == null)
      .map(c => ({
        compartmentIndex: c.compartmentIndex,
        equipmentType: c.equipmentType!,
      })),
  }))

  shipStore.finalizeDesign(repPlayerId, teamId, designs)

  if (isMultiplayer.value) {
    // 多人模式: 仅本阵营完成设计，等待其他阵营
    isReady.value = true
    ElMessage.success('设计已提交，等待其他阵营准备就绪...')
  } else if (designTeamIndex.value < designerTeams.value.length - 1) {
    designTeamIndex.value++
    ships.value = []
    selectedEquipment.value = null
    ElMessage.success(`阵营 ${currentTeam.value.name} 设计确认！请将设备递给下个阵营`)
  } else {
    gameStore.startBattlePhase()
    cardStore.dealInitialHands(gameStore.players.map(p => p.id))
    ElMessage.success('所有阵营设计完毕，进入出生点选择！')
    router.push('/battle')
  }
}

function compPreviewHP(shipIndex: number, slotIndex: number): number {
  const ship = ships.value[shipIndex]
  const compCount = ship.compartments.length
  const base = baseHp(compCount)
  const slot = ship.compartments[slotIndex]
  // 如果是从属舱段，显示主舱段军备的HP修正
  let eqType = slot.equipmentType
  if (slot.slaveOfSlot != null) {
    eqType = ship.compartments[slot.slaveOfSlot].equipmentType
  }
  if (!eqType) return base
  const eq = allEquipment.find(e => e.type === eqType)
  return base + (eq?.hpModifier ?? 0)
}

function getEqDef(type: EquipmentType) {
  return allEquipment.find(e => e.type === type)
}

function getEqTooltip(eq: ReturnType<typeof getEqDef>): string {
  if (!eq) return ''
  const lines: string[] = []
  const catName = eq.category === 'combat' ? '战斗军备' : eq.category === 'support' ? '支援军备' : '资源军备'
  lines.push(`<b>【${eq.name}】${catName}</b>`)
  lines.push(`抽牌 ${eq.drawValue} | HP ${eq.hpModifier >= 0 ? '+' : ''}${eq.hpModifier}`)
  if (eq.compartmentSpan > 1) lines.push(`<b>占用 ${eq.compartmentSpan} 个舱段</b>`)
  if (eq.commandsPerTurn > 0) lines.push(`每回合可指挥 <b>${eq.commandsPerTurn}</b> 次`)
  else if (eq.commandsPerTurn === 0 && eq.commands.length > 0) lines.push(`每回合可指挥: <b>无限制</b>`)
  if (eq.sortieCapacity > 0) lines.push(`机库出击上限: <b>${eq.sortieCapacity}</b> 架次/回合`)

  // 装备特定效果
  switch (eq.type) {
    case 'dual_cannon':
      lines.push('')
      lines.push('<b>【射击】</b>D8命中: 3-6=当前舱段, 2=前一舱段, 7=后一舱段')
      lines.push('伤害: <b>2D6</b>')
      lines.push('<b>【盲射】</b>D8命中: 3-6=随机舱段')
      lines.push('伤害: <b>2D6</b>')
      break
    case 'triple_cannon':
      lines.push('')
      lines.push('<b>【射击】</b>D8命中: 3-6=当前舱段, 2=前一舱段, 7=后一舱段')
      lines.push('伤害: <b>3D6</b>')
      lines.push('<b>【盲射】</b>D8命中: 3-6=随机舱段')
      lines.push('伤害: <b>3D6</b>')
      break
    case 'quad_torpedo':
      lines.push('')
      lines.push('<b>【装填】</b>进入装填状态')
      lines.push('<b>【发射】</b>退出装填, 发射 <b>4颗</b> 鱼雷')
      lines.push(`每颗 <b>1D12</b> 伤害, <b>全玩家回合</b>后到达`)
      lines.push('<b style="color:#f56c6c">被击毁时若装填中: 殉爆5</b>')
      break
    case 'small_hangar':
      lines.push('')
      lines.push('机库 <b>1</b> (每回合最多出击1架次)')
      lines.push('<b>【起飞战斗机】</b>我方空优+2 (占用架次直到取消)')
      lines.push('<b>【起飞轰炸机】</b>16 - 非我方空优×D12')
      lines.push('<b>【起飞鱼雷机】</b>1D12 - 非我方空优×2')
      break
    case 'large_hangar':
      lines.push('')
      lines.push('<b>两舱段</b> 机库 (出击无单库限制)')
      lines.push('<b>【起飞战斗机】</b>我方空优+2 (占用架次直到取消)')
      lines.push('<b>【起飞轰炸机】</b>16 - 非我方空优×D12')
      lines.push('<b>【起飞鱼雷机】</b>1D12 - 非我方空优×2')
      break
    case 'ammo_depot':
      lines.push('')
      lines.push('<b>【效果】</b>相邻战斗军备指挥所需行动 <b>-1</b>')
      lines.push('<b style="color:#f56c6c">被击毁时: 殉爆8 (相邻HP-8)</b>')
      break
    case 'fire_control':
      lines.push('')
      lines.push('<b>【效果】</b>本舰舰炮攻击判定可调整 <b>±1</b>')
      break
    case 'command_room':
      lines.push('')
      lines.push('<b>【发令】</b>对本舰任意舱段执行一次指挥 (冷却2回合)')
      break
    case 'command_center':
      lines.push('')
      lines.push('<b>【发令】</b>对本舰任意舱段执行一次指挥 (无冷却)')
      break
    case 'integrated_command':
      lines.push('')
      lines.push('<b>【发令】</b>对本方任意舱段执行一次指挥 (无冷却)')
      lines.push('<b>【效果】</b>一回合一次: 移动牌当作指挥牌打出')
      break
    case 'lifeboat':
      lines.push('')
      lines.push('<b>【效果】</b>本方其他舰船战沉时, 其上玩家可')
      lines.push('弃置所有手牌并出生至救生艇舱段')
      break
    case 'damage_control':
      lines.push('')
      lines.push('<b>【综合修复】</b>本舱段与所有二相邻舱段 <b>HP+2</b>')
      lines.push('<b>【快速抢修】</b>一个二相邻舱段 <b>HP+8</b>')
      break
    case 'smoke_generator':
      lines.push('')
      lines.push('<b>【快速发烟】</b>半玩家回合内, 本舱段与二相邻舱段不可被取为对象')
      lines.push(`  (半回合 = ceil(存活玩家数/2) 回合)`)
      lines.push('<b>【持续发烟】</b>全玩家回合内, 本舱段与相邻舱段不可被取为对象')
      lines.push(`  (全回合 = 存活玩家数 回合)`)
      break
    case 'afterburner':
      lines.push('')
      lines.push('<b>【效果】</b>舰炮射击本舰时, 命中表修改为:')
      lines.push('  <b>D8: 4,5=当前 | 3=前一 | 6=后一 | 其他=未命中</b>')
      lines.push('<b style="color:#f56c6c">额外加力引擎: 判定调整-2→-1, 且舱段HP-1</b>')
      break
    case 'depth_charge':
      lines.push('')
      lines.push('<b>【反鱼雷】</b>对每颗取本舰船为目标的鱼雷:')
      lines.push('  <b>50%</b> 概率使之失效')
      break
    case 'aa_gun':
      lines.push('')
      lines.push('<b>【效果】</b>本舰船获得我方空优 <b>+3</b>')
      break
    case 'dormitory':
      lines.push('')
      lines.push('抽牌 <b>4</b> | HP <b>+10</b>')
      break
    case 'comms_hub':
      lines.push('')
      lines.push('抽牌 <b>3</b> | HP <b>+5</b>')
      lines.push('<b>【效果】</b>自由行动传递牌数目 <b>+2</b> (最多4张)')
      break
  }

  return lines.join('<br/>')
}

// ===== 预设系统 (官方 + 用户) =====
interface Preset {
  id: string
  name: string
  isOfficial: boolean
  design: { name: string; compartments: { compartmentIndex: number; equipmentType: EquipmentType | null }[] }
}
const USER_PRESETS_KEY = 'navy_commander_user_presets'

// 官方预设 (不可删除) — 必须定义在 loadPresets() 之前
const OFFICIAL_PRESETS: Preset[] = [
  {
    id: 'official_balanced', name: '均衡战舰 (5舱段)', isOfficial: true,
    design: {
      name: '均衡号',
      compartments: [
        { compartmentIndex: 0, equipmentType: 'dormitory' },
        { compartmentIndex: 1, equipmentType: 'dual_cannon' },
        { compartmentIndex: 2, equipmentType: 'fire_control' },
        { compartmentIndex: 3, equipmentType: 'damage_control' },
        { compartmentIndex: 4, equipmentType: 'aa_gun' },
      ],
    },
  },
  {
    id: 'official_carrier', name: '航空母舰 (5舱段)', isOfficial: true,
    design: {
      name: '航空母舰',
      compartments: [
        { compartmentIndex: 0, equipmentType: 'dormitory' },
        { compartmentIndex: 1, equipmentType: 'large_hangar' },
        { compartmentIndex: 2, equipmentType: null },
        { compartmentIndex: 3, equipmentType: 'aa_gun' },
        { compartmentIndex: 4, equipmentType: 'comms_hub' },
      ],
    },
  },
  {
    id: 'official_torpedo', name: '鱼雷快艇 (3舱段)', isOfficial: true,
    design: {
      name: '快艇',
      compartments: [
        { compartmentIndex: 0, equipmentType: 'quad_torpedo' },
        { compartmentIndex: 1, equipmentType: 'afterburner' },
        { compartmentIndex: 2, equipmentType: 'dormitory' },
      ],
    },
  },
  {
    id: 'official_battleship', name: '重型战列舰 (8舱段)', isOfficial: true,
    design: {
      name: '战列舰',
      compartments: [
        { compartmentIndex: 0, equipmentType: 'dormitory' },
        { compartmentIndex: 1, equipmentType: 'triple_cannon' },
        { compartmentIndex: 2, equipmentType: 'ammo_depot' },
        { compartmentIndex: 3, equipmentType: 'dual_cannon' },
        { compartmentIndex: 4, equipmentType: 'fire_control' },
        { compartmentIndex: 5, equipmentType: 'integrated_command' },
        { compartmentIndex: 6, equipmentType: null },
        { compartmentIndex: 7, equipmentType: null },
      ],
    },
  },
]

const allPresets = ref<Preset[]>([])

function loadPresets(): void {
  const list: Preset[] = [...OFFICIAL_PRESETS]
  try {
    const userPresets = JSON.parse(localStorage.getItem(USER_PRESETS_KEY) || '[]') as Preset[]
    for (const p of userPresets) {
      list.push({ ...p, isOfficial: false })
    }
  } catch { /* ignore */ }
  allPresets.value = list
}

function saveShipAsPreset(shipIndex: number): void {
  const ship = ships.value[shipIndex]
  if (!ship) return
  const design = {
    name: ship.name,
    compartments: ship.compartments.map(c => ({
      compartmentIndex: c.compartmentIndex,
      equipmentType: c.equipmentType,
    })),
  }
  const preset = {
    id: `user_${Date.now()}`,
    name: ship.name,
    design,
  }
  try {
    const userPresets = JSON.parse(localStorage.getItem(USER_PRESETS_KEY) || '[]') as any[]
    userPresets.push(preset)
    localStorage.setItem(USER_PRESETS_KEY, JSON.stringify(userPresets))
    ElMessage.success(`"${ship.name}" 已保存为预设`)
    loadPresets()
  } catch {
    ElMessage.error('保存失败')
  }
}

function addPresetToShips(index: number): void {
  const preset = allPresets.value[index]
  if (!preset) return
  const compCount = preset.design.compartments.length
  if (usedCompartments.value + compCount > teamCompartmentBudget.value) {
    ElMessage.warning(`舱段不足: 当前${usedCompartments.value}/${teamCompartmentBudget.value}, 需要${compCount}`)
    return
  }
  const newShip = {
    name: preset.design.name,
    compartments: preset.design.compartments.map((c) => ({
      compartmentIndex: c.compartmentIndex,
      equipmentType: c.equipmentType as EquipmentType | null,
      slaveOfSlot: null as number | null,
      slaveIndices: [] as number[],
    })),
  }
  ships.value.push(newShip)
  rebuildMultiComp(ships.value.length - 1)
  ElMessage.success(`已添加 "${preset.design.name}"`)
}

function deleteUserPreset(index: number): void {
  const preset = allPresets.value[index]
  if (!preset || preset.isOfficial) return
  ElMessageBox.confirm(`确定删除预设 "${preset.name}"？`, '删除', { type: 'warning' }).then(() => {
    try {
      const userPresets = JSON.parse(localStorage.getItem(USER_PRESETS_KEY) || '[]') as any[]
      const filtered = userPresets.filter((p: any) => p.id !== preset.id)
      localStorage.setItem(USER_PRESETS_KEY, JSON.stringify(filtered))
      ElMessage.success('预设已删除')
      loadPresets()
    } catch { ElMessage.error('删除失败') }
  }).catch(() => {})
}

function getPresetTooltip(preset: Preset): string {
  const lines: string[] = []
  lines.push(`<b>${preset.design.name}</b> — ${preset.design.compartments.length}舱段`)
  const comps = preset.design.compartments || []
  for (let i = 0; i < comps.length; i++) {
    const eq = comps[i].equipmentType
    const eqName = eq ? getEqDef(eq)?.name : '(空)'
    const hp = eq ? baseHp(comps.length) + (getEqDef(eq)?.hpModifier ?? 0) : baseHp(comps.length)
    lines.push(`#${i + 1}: ${eqName} [HP:${hp}]`)
  }
  return lines.join('<br/>')
}

// 初始化
loadPresets()

function rebuildMultiComp(shipIndex: number): void {
  const ship = ships.value[shipIndex]
  if (!ship) return
  for (const comp of ship.compartments) {
    if (comp.equipmentType) {
      const eq = allEquipment.find(e => e.type === comp.equipmentType)
      if (eq && eq.compartmentSpan > 1) {
        const endIdx = comp.compartmentIndex + eq.compartmentSpan - 1
        const slaveIndices: number[] = []
        for (let i = comp.compartmentIndex + 1; i <= endIdx && i < ship.compartments.length; i++) {
          ship.compartments[i].slaveOfSlot = comp.compartmentIndex
          slaveIndices.push(i)
        }
        comp.slaveIndices = slaveIndices
      }
    }
  }
}

function isSlotMaster(slot: DesignCompartment): boolean {
  return slot.equipmentType != null && slot.slaveIndices.length > 0
}

function getSlotEquipmentName(shipIdx: number, slot: DesignCompartment): string {
  if (slot.slaveOfSlot != null) {
    const s = ships.value[shipIdx]
    const master = s.compartments[slot.slaveOfSlot]
    if (master?.equipmentType) {
      return `[${getEqDef(master.equipmentType)?.name}]`
    }
    return '[从属]'
  }
  if (!slot.equipmentType) return '空'
  return getEqDef(slot.equipmentType)?.name ?? '空'
}
</script>

<template>
  <div class="design-view">
    <div class="design-layout">
      <!-- 左侧: 军备面板 -->
      <aside class="equipment-panel">
        <h3>军备面板</h3>
        <p class="panel-hint" v-if="selectedEquipment">
          已选: <strong>{{ getEqDef(selectedEquipment)?.name }}</strong> — 点击舱段放置
        </p>
        <p class="panel-hint" v-else>选择军备，再点击舱段放置</p>

        <div v-for="group in [
          { label: '战斗军备', list: combatEquipment },
          { label: '支援军备', list: supportEquipment },
          { label: '资源军备', list: resourceEquipment },
        ]" :key="group.label" class="eq-group">
          <h4>{{ group.label }}</h4>
          <div class="eq-grid">
            <el-tooltip
              v-for="eq in group.list"
              :key="eq.type"
              :content="getEqTooltip(eq)"
              placement="right"
              effect="dark"
              :show-after="500"
              raw-content
            >
              <div
                class="eq-card"
                :class="{
                  selected: selectedEquipment === eq.type,
                  'multi-comp': eq.compartmentSpan > 1,
                }"
                @click="selectEquipment(eq.type as EquipmentType)"
              >
                <div class="eq-name">{{ eq.name }}</div>
                <div class="eq-stats">
                  <span class="stat">抽牌{{ eq.drawValue }}</span>
                  <span class="stat" :class="eq.hpModifier >= 0 ? 'hp-positive' : 'hp-negative'">
                    HP{{ eq.hpModifier >= 0 ? '+' : '' }}{{ eq.hpModifier }}
                  </span>
                  <span v-if="eq.compartmentSpan > 1" class="stat span">{{ eq.compartmentSpan }}舱段</span>
                  <span v-if="eq.commandsPerTurn > 0" class="stat cmd">指挥×{{ eq.commandsPerTurn }}</span>
                </div>
              </div>
            </el-tooltip>
          </div>
        </div>

        <el-divider />

        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px">
          <h4>预设设计</h4>
          <el-button size="small" text @click="loadPresets" title="刷新预设列表">
            ↻
          </el-button>
        </div>
        <div v-if="allPresets.length === 0" class="no-saved">
          暂无预设
        </div>
        <el-tooltip
          v-for="(preset, idx) in allPresets"
          :key="preset.id"
          :content="getPresetTooltip(preset)"
          placement="right"
          effect="dark"
          :show-after="400"
          raw-content
        >
          <div class="preset-card" :class="{ official: preset.isOfficial }">
            <div class="preset-name">
              {{ preset.name }}
              <el-tag v-if="preset.isOfficial" size="small" type="info" effect="plain">官方</el-tag>
              <el-tag v-else size="small" type="warning" effect="plain">自订</el-tag>
            </div>
            <div class="preset-info">
              {{ preset.design.name }} · {{ preset.design.compartments.length }}舱段
            </div>
            <div class="preset-buttons">
              <el-button size="small" type="primary" @click.stop="addPresetToShips(idx)">添加</el-button>
              <el-button
                v-if="!preset.isOfficial"
                size="small"
                type="danger"
                @click.stop="deleteUserPreset(idx)"
              >删除</el-button>
            </div>
          </div>
        </el-tooltip>
      </aside>

      <!-- 中央: 设计区域 -->
      <main class="design-area">
        <div class="design-header">
          <div>
            <h2 v-if="currentTeam">
              <span class="color-dot" :style="{ background: currentTeam!.color }"></span>
              {{ currentTeam!.name }} 设计舰船
              <span style="font-size:14px;color:#6a8aaa;font-weight:normal;margin-left:8px">
                ({{ gameStore.players.filter(p => p.teamId === currentTeam!.id).map(p => p.name).join(', ') }})
              </span>
            </h2>

            <!-- 多人模式: 全局准备状态指示灯 -->
            <div v-if="isMultiplayer && mpRoomSlots.length > 0" class="ready-lights">
              <div v-for="teamId in [...new Set(mpRoomSlots.map(s => s.teamId))]" :key="teamId" class="ready-team">
                <span class="ready-team-name">{{ teamId }}</span>
                <span
                  v-for="s in mpRoomSlots.filter(s => s.teamId === teamId)"
                  :key="s.index"
                  class="ready-dot"
                  :class="{ on: s.isReady, occupied: !!s.playerName }"
                  :title="`${s.playerName || '空槽位'} — ${s.isReady ? '已准备' : '未准备'}`"
                >●</span>
              </div>
            </div>
          </div>
          <div class="budget-info">
            <span>舱段配额: {{ usedCompartments }} / {{ teamCompartmentBudget }}</span>
            <span class="remaining" :class="{ warning: remainingCompartments < 0 }">
              (剩余: {{ remainingCompartments }})
            </span>
          </div>
          <div class="design-actions">
            <el-button type="primary" @click="addShip" :disabled="isMultiplayer && isReady">添加舰船</el-button>
          </div>
        </div>

        <div v-if="ships.length === 0" class="empty-hint">
          <p>点击"添加舰船"开始设计，或从左侧加载预设</p>
        </div>

        <div v-for="(ship, si) in ships" :key="si" class="ship-designer">
          <div class="ship-header">
            <el-input v-model="ship.name" size="small" style="width: 180px" :disabled="isMultiplayer && isReady" />
            <span>舱段数: {{ ship.compartments.length }}</span>
            <el-button size="small" @click="addCompartment(si)" :disabled="(isMultiplayer && isReady) || remainingCompartments < 1">
              添加舱段
            </el-button>
            <el-button size="small" type="success" @click="saveShipAsPreset(si)">保存为预设</el-button>
            <el-button size="small" type="danger" @click="removeShip(si)" :disabled="isMultiplayer && isReady">移除舰船</el-button>
          </div>

          <div class="compartment-row">
            <div
              v-for="(slot, ci) in ship.compartments"
              :key="ci"
              class="compartment-slot"
              :class="{
                'has-equipment': slot.equipmentType || slot.slaveOfSlot != null,
                targeted: selectedEquipment && slot.slaveOfSlot == null,
                slave: slot.slaveOfSlot != null,
                master: isSlotMaster(slot),
              }"
              @click="(isMultiplayer && isReady) ? undefined : (slot.slaveOfSlot != null ? removeEquipment(si, ci) : (slot.equipmentType ? removeEquipment(si, ci) : placeEquipment(si, ci)))"
            >
              <div class="slot-index">#{{ ci + 1 }}</div>
              <div class="slot-equipment">
                {{ getSlotEquipmentName(si, slot) }}
              </div>
              <div v-if="slot.slaveOfSlot == null && !slot.equipmentType" class="slot-empty-msg">
                空
              </div>
              <div class="slot-hp">
                HP: {{ compPreviewHP(si, ci) }}
              </div>
              <el-button
                v-if="ship.compartments.length > 1 && slot.slaveOfSlot == null && !(isMultiplayer && isReady)"
                class="slot-remove"
                size="small"
                type="danger"
                :icon="'Close'"
                circle
                @click.stop="removeCompartment(si, ci)"
              />
            </div>
          </div>
        </div>

        <div v-if="ships.length > 0" class="design-footer">
          <!-- 多人模式: 准备就绪 -->
          <template v-if="isMultiplayer">
            <el-tag v-if="isReady" type="success" size="large" style="margin-right:12px">已准备就绪</el-tag>
            <template v-if="isReady">
              <el-button type="warning" @click="handleCancelReady()">取消准备</el-button>
            </template>
            <template v-else>
              <el-button type="primary" size="large" @click="handleReady()">准备就绪</el-button>
            </template>
          </template>
          <!-- 热座模式: 确认设计 -->
          <template v-else>
            <el-button type="primary" size="large" @click="confirmDesign">
              <template v-if="designTeamIndex < designerTeams.length - 1">
                确认设计，下一个阵营
              </template>
              <template v-else>
                确认设计，选择出生点
              </template>
            </el-button>
          </template>
        </div>
      </main>
    </div>
  </div>
</template>

<style scoped>
.design-view {
  height: calc(100vh - 60px);
  overflow: hidden;
}

.design-layout {
  display: flex;
  height: 100%;
}

.equipment-panel {
  width: 280px;
  flex-shrink: 0;
  background: rgba(13, 33, 55, 0.8);
  border-right: 2px solid #1a3355;
  padding: 16px;
  overflow-y: auto;
}

.equipment-panel h3 {
  font-size: 16px;
  margin-bottom: 4px;
  color: #409eff;
}

.panel-hint {
  font-size: 12px;
  color: #a0b8d0;
  margin-bottom: 12px;
}

.eq-group {
  margin-bottom: 16px;
}

.eq-group h4 {
  font-size: 13px;
  color: #6a8aaa;
  margin-bottom: 6px;
  padding-bottom: 4px;
  border-bottom: 1px solid #1a3355;
}

.eq-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.eq-card {
  background: rgba(20, 50, 80, 0.6);
  border: 1px solid #2a4a6f;
  border-radius: 6px;
  padding: 8px;
  cursor: pointer;
  font-size: 12px;
  transition: all 0.15s;
  min-width: 75px;
}

.eq-card:hover {
  border-color: #409eff;
  background: rgba(64, 158, 255, 0.15);
}

.eq-card.selected {
  border-color: #409eff;
  background: rgba(64, 158, 255, 0.25);
  box-shadow: 0 0 8px rgba(64, 158, 255, 0.3);
}

.eq-card.multi-comp {
  border-style: dashed;
}

.eq-name {
  font-weight: bold;
  margin-bottom: 4px;
  color: #d0e0f0;
}

.eq-stats {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
}

.stat {
  background: rgba(0, 0, 0, 0.3);
  padding: 1px 5px;
  border-radius: 3px;
  font-size: 11px;
}

.hp-positive { color: #67c23a; }
.hp-negative { color: #f56c6c; }
.span { color: #e6a23c; }
.cmd { color: #9060eb; }

.preset-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.no-saved {
  color: #4a6a8a;
  font-size: 12px;
  text-align: center;
  padding: 12px 0;
}

.preset-card {
  background: rgba(20, 40, 70, 0.5);
  border: 1px solid #2a4a6f;
  border-radius: 6px;
  padding: 8px 10px;
  margin-bottom: 8px;
  cursor: pointer;
  transition: all 0.15s;
  font-size: 12px;
}

.preset-card:hover {
  border-color: #409eff;
  background: rgba(64, 158, 255, 0.08);
}

.preset-card.official {
  border-left: 3px solid #409eff;
}

.preset-name {
  font-weight: bold;
  color: #d0e0f0;
  margin-bottom: 2px;
  display: flex;
  align-items: center;
  gap: 4px;
  flex-wrap: wrap;
}

.preset-info {
  color: #6a8aaa;
  font-size: 11px;
  margin-bottom: 6px;
}

.preset-buttons {
  display: flex;
  gap: 4px;
}

.design-area {
  flex: 1;
  padding: 20px;
  overflow-y: auto;
}

.design-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 20px;
  flex-wrap: wrap;
  gap: 12px;
}

.ready-lights {
  display: flex;
  gap: 16px;
  flex-wrap: wrap;
  padding: 6px 0;
}

.ready-team {
  display: flex;
  align-items: center;
  gap: 4px;
}

.ready-team-name {
  font-size: 12px;
  color: #6a8aaa;
  margin-right: 4px;
}

.ready-dot {
  font-size: 16px;
  color: #2a3a5f;
  transition: color 0.3s;
}

.ready-dot.occupied {
  color: #e6a23c;
}

.ready-dot.on {
  color: #67c23a;
  text-shadow: 0 0 6px rgba(103, 194, 58, 0.5);
}

.color-dot {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  display: inline-block;
  margin-right: 8px;
  vertical-align: middle;
}

.budget-info {
  font-size: 14px;
}

.remaining { color: #67c23a; }
.remaining.warning { color: #f56c6c; }

.design-actions {
  display: flex;
  gap: 6px;
}

.ship-designer {
  background: rgba(20, 40, 70, 0.5);
  border: 1px solid #1a3355;
  border-radius: 10px;
  padding: 16px;
  margin-bottom: 20px;
}

.ship-header {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 14px;
  flex-wrap: wrap;
}

.compartment-row {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

.compartment-slot {
  width: 100px;
  min-height: 100px;
  background: rgba(10, 22, 40, 0.8);
  border: 2px dashed #2a4a6f;
  border-radius: 8px;
  padding: 8px;
  cursor: pointer;
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  transition: all 0.15s;
  position: relative;
}

.compartment-slot:hover {
  border-color: #409eff;
}

.compartment-slot.has-equipment {
  border-style: solid;
  border-color: #3a5a7f;
  background: rgba(20, 50, 80, 0.6);
}

.compartment-slot.targeted {
  border-color: #67c23a;
  box-shadow: 0 0 10px rgba(103, 194, 58, 0.3);
}

.compartment-slot.slave {
  border-style: dotted;
  border-color: #e6a23c;
  background: rgba(230, 162, 60, 0.1);
}

.compartment-slot.master {
  border-color: #e6a23c;
}

.slot-index {
  font-size: 11px;
  color: #5a7a9a;
}

.slot-equipment {
  font-size: 12px;
  font-weight: bold;
  color: #d0e0f0;
  text-align: center;
}

.slot-empty-msg {
  font-size: 14px;
  color: #3a5a7f;
}

.slot-hp {
  font-size: 10px;
  color: #6a8aaa;
}

.slot-remove {
  position: absolute;
  top: -6px;
  right: -6px;
}

.design-footer {
  text-align: center;
  padding: 20px;
}

.empty-hint {
  text-align: center;
  padding: 80px 0;
  color: #4a6a8a;
  font-size: 16px;
}
</style>
