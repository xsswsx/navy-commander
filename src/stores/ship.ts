import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { Ship, Compartment, EquipmentType, ShipDesign } from '@/game/types'
import { baseHp } from '@/game/constants'
import { getEquipment } from '@/game/equipment/registry'

export const useShipStore = defineStore('ship', () => {
  const ships = ref<Ship[]>([])

  // ===== 设计阶段状态 =====
  const designCurrentPlayerIndex = ref(0)
  const pendingDesigns = ref<Map<string, ShipDesign[]>>(new Map())
  const confirmedDesigners = ref<string[]>([])

  let compIdCounter = 0
  let shipIdCounter = 0

  function nextCompId(): string {
    return `comp_${++compIdCounter}`
  }
  function nextShipId(): string {
    return `ship_${++shipIdCounter}`
  }

  // ===== 舰船设计方法 =====
  function createShip(playerId: string, name: string, compartmentCount: number): Ship {
    const ship: Ship = {
      id: nextShipId(),
      name,
      ownerTeamId: '',
      ownerPlayerId: playerId,
      compartments: [],
    }

    for (let i = 0; i < compartmentCount; i++) {
      const comp: Compartment = {
        id: nextCompId(),
        shipId: ship.id,
        position: i,
        equipmentType: null,
        baseHp: baseHp(compartmentCount),
        equipmentHpMod: 0,
        maxHp: baseHp(compartmentCount),
        currentHp: baseHp(compartmentCount),
        isDestroyed: false,
        multiCompRootId: null,
        multiCompSlaveIds: [],
      }
      ship.compartments.push(comp)
    }

    return ship
  }

  function installEquipment(
    ship: Ship,
    compartmentIndex: number,
    equipmentType: EquipmentType
  ): boolean {
    const eq = getEquipment(equipmentType)
    const comp = ship.compartments[compartmentIndex]
    if (!comp) return false
    if (comp.multiCompRootId) return false // 已属于多舱段军备

    // 多舱段军备检查
    if (eq.compartmentSpan > 1) {
      const endIndex = compartmentIndex + eq.compartmentSpan - 1
      if (endIndex >= ship.compartments.length) return false
      for (let i = compartmentIndex; i <= endIndex; i++) {
        const c = ship.compartments[i]
        if (c.equipmentType || c.multiCompRootId) return false
      }
      // 标记从属舱段
      const slaveIds: string[] = []
      for (let i = compartmentIndex + 1; i <= endIndex; i++) {
        ship.compartments[i].multiCompRootId = comp.id
        slaveIds.push(ship.compartments[i].id)
      }
      comp.multiCompSlaveIds = slaveIds
    }

    comp.equipmentType = equipmentType
    comp.equipmentHpMod = eq.hpModifier
    comp.maxHp = comp.baseHp + eq.hpModifier
    comp.currentHp = comp.maxHp

    // 额外加力引擎减血
    if (equipmentType === 'afterburner') {
      const afterburnerCount = ship.compartments.filter(
        (c) => c.equipmentType === 'afterburner' && c.id !== comp.id && !c.isDestroyed
      ).length
      if (afterburnerCount >= 1) {
        comp.equipmentHpMod -= 1
        comp.maxHp -= 1
        comp.currentHp -= 1
      }
    }

    return true
  }

  function removeEquipment(ship: Ship, compartmentIndex: number): void {
    const comp = ship.compartments[compartmentIndex]
    if (!comp || !comp.equipmentType) return

    // 处理多舱段
    for (const slaveId of comp.multiCompSlaveIds) {
      const slave = ship.compartments.find((c) => c.id === slaveId)
      if (slave) {
        slave.multiCompRootId = null
      }
    }
    comp.multiCompSlaveIds = []
    comp.equipmentType = null
    comp.equipmentHpMod = 0
    comp.maxHp = comp.baseHp
    comp.currentHp = Math.min(comp.currentHp, comp.maxHp)
  }

  /** 完成设计后将设计图实例化为正式舰船 */
  function finalizeDesign(playerId: string, teamId: string, designs: ShipDesign[]): void {
    for (const design of designs) {
      const ship = createShip(playerId, design.name, design.compartmentCount)
      ship.ownerTeamId = teamId
      for (const slot of design.slots) {
        if (slot.equipmentType) {
          installEquipment(ship, slot.compartmentIndex, slot.equipmentType)
        }
      }
      ships.value.push(ship)
    }
  }

  function applyDamage(compartmentId: string, damage: number): {
    destroyed: boolean
    overflowDamage: number
  } {
    const comp = findCompartment(compartmentId)
    if (!comp || comp.isDestroyed) return { destroyed: false, overflowDamage: 0 }

    comp.currentHp -= damage
    if (comp.currentHp <= 0) {
      comp.currentHp = 0
      comp.isDestroyed = true
      return { destroyed: true, overflowDamage: Math.abs(comp.currentHp) }
    }
    return { destroyed: false, overflowDamage: 0 }
  }

  function healCompartment(compartmentId: string, amount: number): void {
    const comp = findCompartment(compartmentId)
    if (!comp || comp.isDestroyed) return
    comp.currentHp = Math.min(comp.currentHp + amount, comp.maxHp)
  }

  function findCompartment(id: string): Compartment | null {
    for (const ship of ships.value) {
      const comp = ship.compartments.find((c) => c.id === id)
      if (comp) return comp
    }
    return null
  }

  function findShip(id: string): Ship | null {
    return ships.value.find((s) => s.id === id) ?? null
  }

  function getShipByCompartment(compId: string): Ship | null {
    for (const ship of ships.value) {
      if (ship.compartments.some((c) => c.id === compId)) return ship
    }
    return null
  }

  function isShipSunk(shipId: string): boolean {
    const ship = findShip(shipId)
    if (!ship) return false
    return ship.compartments.every((c) => c.isDestroyed)
  }

  function isTeamDefeated(teamId: string): boolean {
    const teamShips = ships.value.filter((s) => s.ownerTeamId === teamId)
    if (teamShips.length === 0) return true
    return teamShips.every((s) => isShipSunk(s.id))
  }

  function getDrawValue(comp: Compartment): number {
    if (comp.isDestroyed) return 1
    if (!comp.equipmentType) return 1
    return getEquipment(comp.equipmentType).drawValue
  }

  function getAdjacentCompartments(
    compartmentId: string,
    distance: number
  ): Compartment[] {
    const ship = getShipByCompartment(compartmentId)
    if (!ship) return []
    const comp = ship.compartments.find((c) => c.id === compartmentId)
    if (!comp) return []

    return ship.compartments.filter((c) => {
      if (c.id === compartmentId) return false
      const dist = Math.abs(c.position - comp.position)
      return dist > 0 && dist <= distance
    })
  }

  function getLivingCompartments(shipId: string): Compartment[] {
    const ship = findShip(shipId)
    if (!ship) return []
    return ship.compartments.filter((c) => !c.isDestroyed)
  }

  function resetShipStore(): void {
    ships.value = []
    designCurrentPlayerIndex.value = 0
    pendingDesigns.value = new Map()
    confirmedDesigners.value = []
    compIdCounter = 0
    shipIdCounter = 0
  }

  return {
    ships,
    designCurrentPlayerIndex,
    pendingDesigns,
    confirmedDesigners,
    createShip,
    installEquipment,
    removeEquipment,
    finalizeDesign,
    applyDamage,
    healCompartment,
    findCompartment,
    findShip,
    getShipByCompartment,
    isShipSunk,
    isTeamDefeated,
    getDrawValue,
    getAdjacentCompartments,
    getLivingCompartments,
    resetShipStore,
  }
})
