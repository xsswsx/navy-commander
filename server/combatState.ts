// ==================== 服务端战斗数据层 ====================
// 服务端维护完整规范化的战斗状态，作为唯一数据权威源

export interface ServerCompartment {
  compId: string
  position: number
  equipmentType: string | null
  maxHp: number
  currentHp: number
  isDestroyed: boolean
  multiCompRootId: string | null
  multiCompSlaveIds: string[]
}

export interface ServerShip {
  shipId: string
  teamId: string
  name: string
  ownerPlayerId: string
  compartments: ServerCompartment[]
}

export interface ServerFighterToken {
  id: string
  shipId: string
  ownerTeamId: string
  sourceCompartmentId: string
  sourcePlayerId: string  // slotIndex
  remainingTurns: number
}

export interface ServerTorpedoSalvo {
  id: string
  sourceCompartmentId: string
  targetCompartmentId: string
  torpedoCount: number
  remainingTurns: number
}

export interface ServerActiveEffect {
  id: string
  effectType: 'smoke_short' | 'smoke_long'
  sourceCompartmentId: string
  affectedCompartmentIds: string[]
  remainingTurns: number
}

export interface ServerCombatState {
  ships: ServerShip[]
  playerPositions: Record<number, { shipId: string; compIndex: number }>
  fighterTokens: ServerFighterToken[]
  torpedoSalvoes: ServerTorpedoSalvo[]
  activeEffects: ServerActiveEffect[]
  torpedoLoaded: Record<string, boolean>
  ammoDepotUsed: Record<string, boolean>
  commandsUsed: Record<string, number>
  sortiesUsed: Record<string, number>
}

// ID 计数器 (仅用于 token IDs)
let tokenIdCtr = 0
let torpIdCtr = 0
let effectIdCtr = 0

export function resetStateCounters(): void {
  tokenIdCtr = 0; torpIdCtr = 0; effectIdCtr = 0
}

/** 从设计数据构建初始战斗状态 (使用确定性ID与客户端一致) */
export function buildCombatState(
  designs: Map<string, { ships: { name: string; compartmentCount: number; slots: { compartmentIndex: number; equipmentType: string | null }[] }[] }>,
  slotPlayerMap: Map<number, string>,  // slotIndex → teamId
  spawnEntries: Map<number, { shipId: string; compIndex: number }>
): { state: ServerCombatState } {
  const ships: ServerShip[] = []

  for (const [teamId, ds] of designs) {
    for (let si = 0; si < ds.ships.length; si++) {
      const design = ds.ships[si]
      const shipId = `${teamId}_s${si}`
      const compartments: ServerCompartment[] = []

      for (let ci = 0; ci < design.slots.length; ci++) {
        const slot = design.slots[ci]
        const compId = `${teamId}_s${si}_comp_${slot.compartmentIndex}`
        const maxHp = 25 - design.compartmentCount
        compartments.push({
          compId,
          position: slot.compartmentIndex,
          equipmentType: slot.equipmentType,
          maxHp,
          currentHp: maxHp,
          isDestroyed: false,
          multiCompRootId: null,
          multiCompSlaveIds: [],
        })
      }

      // 建立从属关系（多舱段军备）
      for (const comp of compartments) {
        if (comp.equipmentType) {
          const spanMap: Record<string, number> = {
            large_hangar: 2, command_center: 2, integrated_command: 3,
          }
          const span = spanMap[comp.equipmentType]
          if (span) {
            for (let i = comp.position + 1; i < comp.position + span && i < compartments.length; i++) {
              const slave = compartments.find(c => c.position === i)
              if (slave) {
                comp.multiCompSlaveIds.push(slave.compId)
                slave.multiCompRootId = comp.compId
              }
            }
          }
        }
      }

      const teamPlayers = [...slotPlayerMap.entries()].filter(([, t]) => t === teamId)
      const repPlayerId = teamPlayers[0]?.[0]?.toString() ?? ''

      ships.push({ shipId, teamId, name: design.name, ownerPlayerId: repPlayerId, compartments })
    }
  }

  // 玩家位置
  const playerPositions: Record<number, { shipId: string; compIndex: number }> = {}
  for (const [slotIdx, spawn] of spawnEntries) {
    playerPositions[slotIdx] = { shipId: spawn.shipId, compIndex: spawn.compIndex }
  }

  return {
    state: {
      ships,
      playerPositions,
      fighterTokens: [],
      torpedoSalvoes: [],
      activeEffects: [],
      torpedoLoaded: {},
      ammoDepotUsed: {},
      commandsUsed: {},
      sortiesUsed: {},
    },
  }
}
