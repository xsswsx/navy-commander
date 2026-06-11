// server/__tests__/data/CombatState.test.ts
import { describe, it, expect } from 'vitest'

// === Test helpers ===

interface TestCompartment {
  compId: string; position: number; equipmentType: string | null
  maxHp: number; currentHp: number; isDestroyed: boolean
  multiCompRootId: string | null; multiCompSlaveIds: string[]
}

interface TestShip {
  shipId: string; teamId: string; name: string; ownerPlayerId: string
  compartments: TestCompartment[]
}

interface TestState {
  ships: TestShip[]
  playerPositions: Record<number, { shipId: string; compIndex: number }>
  fighterTokens: any[]; torpedoSalvoes: any[]; activeEffects: any[]
  torpedoLoaded: Record<string, boolean>
  ammoDepotUsed: Record<string, boolean>
  commandsUsed: Record<string, number>
  sortiesUsed: Record<string, number>
}

function makeTestState(): TestState {
  const comp: TestCompartment = {
    compId: 'teamA_s0_comp_0', position: 0, equipmentType: 'dual_cannon',
    maxHp: 20, currentHp: 20, isDestroyed: false,
    multiCompRootId: null, multiCompSlaveIds: [],
  }
  const comp1: TestCompartment = {
    compId: 'teamA_s0_comp_1', position: 1, equipmentType: 'ammo_depot',
    maxHp: 20, currentHp: 20, isDestroyed: false,
    multiCompRootId: null, multiCompSlaveIds: [],
  }
  const ship: TestShip = {
    shipId: 'teamA_s0', teamId: 'teamA', name: 'TestShip',
    ownerPlayerId: '0', compartments: [comp, comp1],
  }
  return {
    ships: [ship],
    playerPositions: { 0: { shipId: 'teamA_s0', compIndex: 0 } },
    fighterTokens: [], torpedoSalvoes: [], activeEffects: [],
    torpedoLoaded: {}, ammoDepotUsed: {}, commandsUsed: {}, sortiesUsed: {},
  }
}

// === Tests ===

describe('applyDamage', () => {
  it('reduces hp and marks destroyed when hp reaches 0', async () => {
    const { applyDamage } = await import('../../data/CombatState.js')
    const state: any = makeTestState()
    const result = applyDamage(state, 'teamA_s0_comp_0', 25)
    expect(result.state.ships[0].compartments[0].currentHp).toBe(0)
    expect(result.state.ships[0].compartments[0].isDestroyed).toBe(true)
    expect(result.destroyed).toBe(true)
  })

  it('reduces hp but does not destroy when hp stays above 0', async () => {
    const { applyDamage } = await import('../../data/CombatState.js')
    const state: any = makeTestState()
    const result = applyDamage(state, 'teamA_s0_comp_0', 10)
    expect(result.state.ships[0].compartments[0].currentHp).toBe(10)
    expect(result.state.ships[0].compartments[0].isDestroyed).toBe(false)
    expect(result.destroyed).toBe(false)
  })

  it('does nothing if already destroyed', async () => {
    const { applyDamage } = await import('../../data/CombatState.js')
    const state: any = makeTestState()
    state.ships[0].compartments[0].isDestroyed = true
    state.ships[0].compartments[0].currentHp = 0
    const result = applyDamage(state, 'teamA_s0_comp_0', 10)
    expect(result.state.ships[0].compartments[0].currentHp).toBe(0)
    expect(result.destroyed).toBe(false)
  })

  it('returns unchanged state for non-existent compartment', async () => {
    const { applyDamage } = await import('../../data/CombatState.js')
    const state: any = makeTestState()
    const result = applyDamage(state, 'nonexistent', 10)
    expect(result.state).toBe(state)
    expect(result.destroyed).toBe(false)
  })
})

describe('healCompartment', () => {
  it('heals but caps at maxHp', async () => {
    const { healCompartment } = await import('../../data/CombatState.js')
    const state: any = makeTestState()
    state.ships[0].compartments[0].currentHp = 5
    const result = healCompartment(state, 'teamA_s0_comp_0', 10)
    expect(result.ships[0].compartments[0].currentHp).toBe(15)
  })

  it('does nothing for destroyed compartment', async () => {
    const { healCompartment } = await import('../../data/CombatState.js')
    const state: any = makeTestState()
    state.ships[0].compartments[0].isDestroyed = true
    state.ships[0].compartments[0].currentHp = 0
    const result = healCompartment(state, 'teamA_s0_comp_0', 10)
    expect(result.ships[0].compartments[0].currentHp).toBe(0)
  })
})

describe('movePlayer', () => {
  it('changes player compartment position', async () => {
    const { movePlayer } = await import('../../data/CombatState.js')
    const state: any = makeTestState()
    const result = movePlayer(state, 0, 'teamA_s0', 2)
    expect(result.playerPositions[0].compIndex).toBe(2)
  })
})

describe('addTorpedoSalvo', () => {
  it('adds a torpedo salvo to the state', async () => {
    const { addTorpedoSalvo } = await import('../../data/CombatState.js')
    const state: any = makeTestState()
    const salvo = {
      id: 't1', sourceCompartmentId: 'teamA_s0_comp_0',
      targetCompartmentId: 'teamB_s0_comp_0', torpedoCount: 4, remainingTurns: 3,
    }
    const result = addTorpedoSalvo(state, salvo)
    expect(result.torpedoSalvoes).toHaveLength(1)
    expect(result.torpedoSalvoes[0].torpedoCount).toBe(4)
  })
})

describe('tickTorpedoes', () => {
  it('decrements turns and resolves expired salvoes', async () => {
    const { tickTorpedoes } = await import('../../data/CombatState.js')
    const state: any = makeTestState()
    state.torpedoSalvoes = [{
      id: 't1', sourceCompartmentId: 'teamA_s0_comp_0',
      targetCompartmentId: 'teamB_s0_comp_0', torpedoCount: 2, remainingTurns: 1,
    }]
    const result = tickTorpedoes(state)
    expect(result.resolved).toHaveLength(1)
    expect(result.state.torpedoSalvoes).toHaveLength(0)
  })

  it('keeps salvoes with remaining turns > 0', async () => {
    const { tickTorpedoes } = await import('../../data/CombatState.js')
    const state: any = makeTestState()
    state.torpedoSalvoes = [{
      id: 't1', sourceCompartmentId: 'c1',
    targetCompartmentId: 'c2', torpedoCount: 2, remainingTurns: 3,
    }]
    const result = tickTorpedoes(state)
    expect(result.resolved).toHaveLength(0)
    expect(result.state.torpedoSalvoes).toHaveLength(1)
    expect(result.state.torpedoSalvoes[0].remainingTurns).toBe(2)
  })
})

describe('addFighterToken / tickFighters / removeFightersByPlayer', () => {
  it('full lifecycle: add, tick, remove by player', async () => {
    const { addFighterToken, tickFighters, removeFightersByPlayer } = await import('../../data/CombatState.js')
    const state: any = makeTestState()
    const token = {
      id: 'f1', shipId: 'teamA_s0', ownerTeamId: 'teamA',
      sourceCompartmentId: 'teamA_s0_comp_0', sourcePlayerId: '0', remainingTurns: 2,
    }
    let s = addFighterToken(state, token)
    expect(s.fighterTokens).toHaveLength(1)

    s = tickFighters(s)
    expect(s.fighterTokens[0].remainingTurns).toBe(1)

    s = removeFightersByPlayer(s, 0)
    expect(s.fighterTokens).toHaveLength(0)
  })
})

describe('addEffect / tickEffects', () => {
  it('adds effect and decrements remaining turns', async () => {
    const { addEffect, tickEffects } = await import('../../data/CombatState.js')
    const state: any = makeTestState()
    const effect = {
      id: 'e1', effectType: 'smoke_short' as const,
      sourceCompartmentId: 'teamA_s0_comp_0', affectedCompartmentIds: ['teamA_s0_comp_0', 'teamA_s0_comp_1'],
      remainingTurns: 2,
    }
    let s = addEffect(state, effect)
    expect(s.activeEffects).toHaveLength(1)

    s = tickEffects(s)
    expect(s.activeEffects[0].remainingTurns).toBe(1)

    s = tickEffects(s)
    expect(s.activeEffects).toHaveLength(0)
  })
})
