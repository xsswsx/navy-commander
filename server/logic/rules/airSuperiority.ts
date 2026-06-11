// server/logic/rules/airSuperiority.ts
import type { ServerCombatState } from '../../data/CombatState.js'
import { findShip } from '../../data/CombatState.js'

const FIGHTER_AS = 2
const AA_GUN_AS = 3

export function calculateAirSuperiority(
  state: ServerCombatState, shipId: string, teamId: string
): number {
  const ship = findShip(state, shipId)
  if (!ship) return 0

  let ownAS = 0
  let enemyAS = 0

  for (const f of state.fighterTokens) {
    if (f.shipId !== shipId) continue
    if (f.ownerTeamId === teamId) {
      ownAS += FIGHTER_AS
    } else {
      enemyAS += FIGHTER_AS
    }
  }

  for (const c of ship.compartments) {
    if (c.equipmentType === 'aa_gun' && !c.isDestroyed) {
      if (ship.teamId === teamId) {
        ownAS += AA_GUN_AS
      } else {
        enemyAS += AA_GUN_AS
      }
    }
  }

  return Math.max(0, enemyAS - ownAS)
}
