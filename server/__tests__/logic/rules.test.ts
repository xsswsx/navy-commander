import { describe, it, expect } from 'vitest'

describe('resolveNavalGunHit', () => {
  const noAdjacent = (_cid: string, _off: number) => null

  it('D8=4 hits current compartment (no afterburner)', async () => {
    const { resolveNavalGunHit } = await import('../../logic/rules/hitResolution.js')
    expect(resolveNavalGunHit(4, 'c2', false, noAdjacent)).toBe('c2')
  })

  it('D8=2 hits previous compartment (no afterburner)', async () => {
    const { resolveNavalGunHit } = await import('../../logic/rules/hitResolution.js')
    const adjacent = (cid: string, off: number) => off === -1 ? 'c1' : null
    expect(resolveNavalGunHit(2, 'c2', false, adjacent)).toBe('c1')
  })

  it('D8=1 misses', async () => {
    const { resolveNavalGunHit } = await import('../../logic/rules/hitResolution.js')
    expect(resolveNavalGunHit(1, 'c2', false, noAdjacent)).toBeNull()
  })

  it('D8=8 misses', async () => {
    const { resolveNavalGunHit } = await import('../../logic/rules/hitResolution.js')
    expect(resolveNavalGunHit(8, 'c2', false, noAdjacent)).toBeNull()
  })

  it('D8=7 hits rear comp (no afterburner)', async () => {
    const { resolveNavalGunHit } = await import('../../logic/rules/hitResolution.js')
    const adjacent = (cid: string, off: number) => off === 1 ? 'c3' : null
    expect(resolveNavalGunHit(7, 'c2', false, adjacent)).toBe('c3')
  })

  it('D8=4 hits current with afterburner', async () => {
    const { resolveNavalGunHit } = await import('../../logic/rules/hitResolution.js')
    expect(resolveNavalGunHit(4, 'c2', true, noAdjacent)).toBe('c2')
  })

  it('D8=7 misses with afterburner', async () => {
    const { resolveNavalGunHit } = await import('../../logic/rules/hitResolution.js')
    expect(resolveNavalGunHit(7, 'c2', true, noAdjacent)).toBeNull()
  })
})

describe('resolveBlindfireHit', () => {
  it('hits on 3-6, misses otherwise', async () => {
    const { resolveBlindfireHit } = await import('../../logic/rules/hitResolution.js')
    expect(resolveBlindfireHit(3)).toBe(true)
    expect(resolveBlindfireHit(6)).toBe(true)
    expect(resolveBlindfireHit(1)).toBe(false)
    expect(resolveBlindfireHit(8)).toBe(false)
  })
})

describe('rollGunDamage', () => {
  it('dual cannon rolls 2D6', async () => {
    const { mockRng } = await import('../../logic/rules/dice.js')
    const { rollGunDamage } = await import('../../logic/rules/damageRoll.js')
    const rng = mockRng([3, 4])
    expect(rollGunDamage(rng, 'dual_cannon')).toBe(7)
  })

  it('triple cannon rolls 3D6', async () => {
    const { mockRng } = await import('../../logic/rules/dice.js')
    const { rollGunDamage } = await import('../../logic/rules/damageRoll.js')
    const rng = mockRng([2, 3, 5])
    expect(rollGunDamage(rng, 'triple_cannon')).toBe(10)
  })
})

describe('rollBomberDamage', () => {
  it('computes 16 - nfa * D12, clamped to 0', async () => {
    const { mockRng } = await import('../../logic/rules/dice.js')
    const { rollBomberDamage } = await import('../../logic/rules/damageRoll.js')
    expect(rollBomberDamage(mockRng([3]), 0)).toBe(16)
    expect(rollBomberDamage(mockRng([5]), 2)).toBe(6)
    expect(rollBomberDamage(mockRng([2]), 10)).toBe(0)
  })
})
