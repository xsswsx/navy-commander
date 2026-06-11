// server/display/snapshotBuilder.ts
import type { BattleStateSnapshot } from '../../shared/protocol.js'
import type { ServerCombatState } from '../combatState.js'
import type { ServerRoom } from '../state.js'

export function buildSnapshot(
  combatState: ServerCombatState,
  room: ServerRoom
): BattleStateSnapshot {
  return {
    ships: combatState.ships.map(s => ({
      shipId: s.shipId,
      teamId: s.teamId,
      name: s.name,
      ownerPlayerId: s.ownerPlayerId,
      compartments: s.compartments.map(c => ({
        compId: c.compId,
        position: c.position,
        equipmentType: c.equipmentType,
        maxHp: c.maxHp,
        currentHp: c.currentHp,
        isDestroyed: c.isDestroyed,
        multiCompRootId: c.multiCompRootId,
        multiCompSlaveIds: c.multiCompSlaveIds,
      })),
    })),
    playerPositions: combatState.playerPositions,
    fighterTokens: combatState.fighterTokens.map(t => ({ ...t })),
    torpedoSalvoes: combatState.torpedoSalvoes.map(t => ({ ...t })),
    activeEffects: combatState.activeEffects.map(e => ({ ...e })),
    torpedoLoaded: combatState.torpedoLoaded,
    currentTurnSlot: room.currentTurnSlot,
    roundNumber: room.roundNumber,
    winner: room.winner ?? null,
    phase: getBattlePhase(combatState, room),
  }
}

/** 判断当前处于 spawn 还是 battle 阶段 */
function getBattlePhase(
  combatState: ServerCombatState,
  room: ServerRoom
): 'spawn' | 'battle' {
  if (room.state.phase !== 'battle') return 'spawn'

  // 检查所有有玩家的槽位是否都已选择出生点
  const occupied = room.state.slots.filter(s => s.playerName).map(s => s.index)
  const allSpawned = occupied.every(idx => combatState.playerPositions[idx] != null)
  return allSpawned ? 'battle' : 'spawn'
}
