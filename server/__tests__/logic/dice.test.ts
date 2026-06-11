import { describe, it, expect } from 'vitest'

describe('createRng', () => {
  it('returns values within [1, sides]', async () => {
    const { createRng } = await import('../../logic/rules/dice.js')
    const rng = createRng()
    for (let i = 0; i < 100; i++) {
      const v = rng(6)
      expect(v).toBeGreaterThanOrEqual(1)
      expect(v).toBeLessThanOrEqual(6)
    }
  })
})

describe('rollMultiple', () => {
  it('returns array of required length', async () => {
    const { rollMultiple, createRng } = await import('../../logic/rules/dice.js')
    const rng = createRng()
    const results = rollMultiple(rng, 8, 3)
    expect(results).toHaveLength(3)
    results.forEach(v => {
      expect(v).toBeGreaterThanOrEqual(1)
      expect(v).toBeLessThanOrEqual(8)
    })
  })
})

describe('mockRng', () => {
  it('returns fixed values for testing', async () => {
    const { mockRng } = await import('../../logic/rules/dice.js')
    const rng = mockRng([3, 5, 1])
    expect(rng(8)).toBe(3)
    expect(rng(8)).toBe(5)
    expect(rng(8)).toBe(1)
  })
})
