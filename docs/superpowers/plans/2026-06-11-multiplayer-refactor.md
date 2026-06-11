# 多人联机模式重构 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将多人联机模式重构为完全服务器权威的三层架构：数据层（纯函数）→ 逻辑层（意图处理+骰子+规则）→ 显示层（全量快照推送），客户端变为只读渲染终端。

**Architecture:** 新建 `server/data/`、`server/logic/`、`server/display/` 三个目录落实三层分离。每个意图操作经过统一的 handleIntent 路由。客户端 BattleView 去掉所有骰子和远程重放逻辑。

**Tech Stack:** TypeScript, Node.js (tsx), Socket.IO, Vue 3 + Pinia, vitest

**Design Spec:** `docs/superpowers/specs/2026-06-11-multiplayer-refactor-design.md`

---

## 文件结构图

```
New files:
  server/data/CombatState.ts              # 数据层：纯函数 mutation + query
  server/logic/intentRouter.ts            # 逻辑层入口
  server/logic/handlers/spawnHandler.ts
  server/logic/handlers/endTurnHandler.ts
  server/logic/handlers/playCardHandler.ts
  server/logic/handlers/freeMoveHandler.ts
  server/logic/handlers/freeCommandHandler.ts
  server/logic/handlers/commandHandler.ts
  server/logic/rules/dice.ts
  server/logic/rules/hitResolution.ts
  server/logic/rules/damageRoll.ts
  server/logic/rules/airSuperiority.ts
  server/display/types.ts
  server/display/FullSnapshotDisplay.ts
  server/display/snapshotBuilder.ts
  server/__tests__/data/CombatState.test.ts
  server/__tests__/logic/intentRouter.test.ts

Modified files:
  shared/protocol.ts                      # +ClientIntent, +winner to snapshot
  server/index.ts                         # 重构为三层调用
  server/state.ts                         # +winner field
  server/combatLogic.ts                   # → 移除已迁移的代码
  server/combatState.ts                   # 保持不变（类型定义源）
  src/modes/multiplayer/MultiplayerClient.ts  # +sendIntent, -sendAction
  src/views/BattleView.vue                # 去掉骰子/重放/pendingResults
  src/views/DesignView.vue                # 简化 battle:init 处理
  package.json                            # +vitest依赖, +test脚本
```

---

### Task 1: Set up vitest test infrastructure

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`

- [ ] **Step 1: Install vitest**

Run: `npm install -D vitest`

- [ ] **Step 2: Create vitest.config.ts**

```typescript
// vitest.config.ts
import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'shared'),
    },
  },
  test: {
    include: ['server/__tests__/**/*.test.ts'],
  },
})
```

- [ ] **Step 3: Add test script to package.json**

Open `package.json` and add in `"scripts"`:
```
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 4: Verify test runs**

Run: `npm test`
Expected: "No test files found"

- [ ] **Step 5: Create first trivial test to verify infrastructure**

Create `server/__tests__/data/CombatState.test.ts`:

```typescript
// server/__tests__/data/CombatState.test.ts
import { describe, it, expect } from 'vitest'

describe('CombatState', () => {
  it('placeholder', () => {
    expect(1 + 1).toBe(2)
  })
})
```

Run: `npm test`
Expected: 1 test passed

- [ ] **Step 6: Update tsconfig.json to include server/__tests__**

Add `"server/**/*.ts"` to `include` array in `tsconfig.json`.

- [ ] **Step 7: Commit**

```bash
git add package.json vitest.config.ts tsconfig.json server/__tests__/
git commit -m "chore: setup vitest test infrastructure"
```

---

### Task 2: Data层 Damage/Heal/Move 纯函数

**Files:**
- Create: `server/data/CombatState.ts`
- Modify: `server/__tests__/data/CombatState.test.ts`

- [ ] **Step 1: Create helpers to build test state**

Write to `server/__tests__/data/CombatState.test.ts` (replace placeholder):

```typescript
// server/__tests__/data/CombatState.test.ts
import { describe, it, expect } from 'vitest'

// Will import from data layer once created
// For now, define types inline for TDD
interface ServerCompartment {
  compId: string
  position: number
  equipmentType: string | null
  maxHp: number
  currentHp: number
  isDestroyed: boolean
  multiCompRootId: string | null
  multiCompSlaveIds: string[]
}

interface ServerShip {
  shipId: string
  teamId: string
  name: string
  ownerPlayerId: string
  compartments: ServerCompartment[]
}

interface ServerCombatState {
  ships: ServerShip[]
  playerPositions: Record<number, { shipId: string; compIndex: number }>
  fighterTokens: any[]
  torpedoSalvoes: any[]
  activeEffects: any[]
  torpedoLoaded: Record<string, boolean>
  ammoDepotUsed: Record<string, boolean>
  commandsUsed: Record<string, number>
  sortiesUsed: Record<string, number>
}

function makeTestState(): ServerCombatState {
  const comp: ServerCompartment = {
    compId: 'teamA_s0_comp_0',
    position: 0,
    equipmentType: 'dual_cannon',
    maxHp: 20,
    currentHp: 20,
    isDestroyed: false,
    multiCompRootId: null,
    multiCompSlaveIds: [],
  }
  const ship: ServerShip = {
    shipId: 'teamA_s0',
    teamId: 'teamA',
    name: 'TestShip',
    ownerPlayerId: '0',
    compartments: [comp],
  }
  return {
    ships: [ship],
    playerPositions: { 0: { shipId: 'teamA_s0', compIndex: 0 } },
    fighterTokens: [],
    torpedoSalvoes: [],
    activeEffects: [],
    torpedoLoaded: {},
    ammoDepotUsed: {},
    commandsUsed: {},
    sortiesUsed: {},
  }
}
```

- [ ] **Step 2: Write executable tests for applyDamage / healCompartment / movePlayer**

Replace the test file's placeholder test block with real tests. Since the data layer module doesn't exist yet, import directly from the soon-to-be-created file path:

```typescript
// server/__tests__/data/CombatState.test.ts
import { describe, it, expect } from 'vitest'

// === Test helpers (inline until data layer compiles) ===

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

// === Tests (will import from server/data/CombatState.js once Step 3 is done) ===

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
```

Run: `npm test`
Expected: FAIL (imports don't exist yet)

- [ ] **Step 3: Create data layer file with applyDamage, healCompartment, movePlayer**

Write `server/data/CombatState.ts`:

```typescript
// server/data/CombatState.ts
// 数据层：纯函数。每个函数 (state, ...params) → { state, ...outputs }
// 不掷骰子、不发 socket、不做权限检查。

import type {
  ServerCombatState, ServerCompartment, ServerShip,
  ServerFighterToken, ServerTorpedoSalvo, ServerActiveEffect,
} from '../combatState.js'

// ===== helpers =====
function clone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj))
}

function findCompartmentIndex(
  state: ServerCombatState, compId: string
): { shipIdx: number; compIdx: number } | null {
  for (let si = 0; si < state.ships.length; si++) {
    const ci = state.ships[si].compartments.findIndex(c => c.compId === compId)
    if (ci !== -1) return { shipIdx: si, compIdx: ci }
  }
  return null
}

// ===== Mutation Functions =====

export interface DamageResult {
  state: ServerCombatState
  destroyed: boolean
}

/** 对舱段施加伤害，血量归零时标记 isDestroyed */
export function applyDamage(
  state: ServerCombatState, compId: string, damage: number
): DamageResult {
  const idx = findCompartmentIndex(state, compId)
  if (!idx) return { state, destroyed: false }

  const s = clone(state)
  const comp = s.ships[idx.shipIdx].compartments[idx.compIdx]

  if (comp.isDestroyed) return { state: s, destroyed: false }

  comp.currentHp = Math.max(0, comp.currentHp - damage)
  const destroyed = comp.currentHp <= 0
  if (destroyed) {
    comp.isDestroyed = true
  }

  return { state: s, destroyed }
}

/** 维修血量，不超过 maxHp */
export function healCompartment(
  state: ServerCombatState, compId: string, amount: number
): ServerCombatState {
  const idx = findCompartmentIndex(state, compId)
  if (!idx) return state

  const s = clone(state)
  const comp = s.ships[idx.shipIdx].compartments[idx.compIdx]
  if (comp.isDestroyed) return state

  comp.currentHp = Math.min(comp.currentHp + amount, comp.maxHp)
  return s
}

/** 玩家移动 */
export function movePlayer(
  state: ServerCombatState, slotIndex: number, shipId: string, compIndex: number
): ServerCombatState {
  const s = clone(state)
  s.playerPositions[slotIndex] = { shipId, compIndex }
  return s
}

/** 设置鱼雷装填状态 */
export function setTorpedoLoaded(
  state: ServerCombatState, compId: string, loaded: boolean
): ServerCombatState {
  const s = clone(state)
  s.torpedoLoaded[compId] = loaded
  return s
}

/** 记录一次指挥使用 */
export function useCommand(
  state: ServerCombatState, compId: string
): ServerCombatState {
  const s = clone(state)
  s.commandsUsed[compId] = (s.commandsUsed[compId] ?? 0) + 1
  return s
}

/** 记录一次出击 */
export function useSortie(
  state: ServerCombatState, compId: string
): ServerCombatState {
  const s = clone(state)
  s.sortiesUsed[compId] = (s.sortiesUsed[compId] ?? 0) + 1
  return s
}

/** 标记弹药库本回合已使用 */
export function markAmmoDepotUsed(
  state: ServerCombatState, compId: string
): ServerCombatState {
  const s = clone(state)
  s.ammoDepotUsed[compId] = true
  return s
}

/** 重置每回合计数器 */
export function resetPerTurn(state: ServerCombatState): ServerCombatState {
  const s = clone(state)
  s.commandsUsed = {}
  s.sortiesUsed = {}
  s.ammoDepotUsed = {}
  return s
}

// Re-export types for convenience
export type { ServerCombatState, ServerCompartment, ServerShip, ServerFighterToken, ServerTorpedoSalvo, ServerActiveEffect }
```

- [ ] **Step 4: Run tests to verify**

Update test file to import and call functions. Run: `npx vitest run`
Expected: all tests pass

- [ ] **Step 5: Commit**

```bash
git add server/data/CombatState.ts server/__tests__/data/CombatState.test.ts
git commit -m "feat: data layer — applyDamage, healCompartment, movePlayer 纯函数"
```

---

### Task 3: Data层 Token/Effect 纯函数

**Files:**
- Modify: `server/data/CombatState.ts`
- Modify: `server/__tests__/data/CombatState.test.ts`

- [ ] **Step 1: Write executable tests for torpedo/fighter/effect functions**

Append to `server/__tests__/data/CombatState.test.ts`:

```typescript
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
```

- [ ] **Step 2: Implement torpedo/fighter/effect functions**

Append to `server/data/CombatState.ts`:

```typescript
// ===== Torpedo =====

export function addTorpedoSalvo(
  state: ServerCombatState, salvo: ServerTorpedoSalvo
): ServerCombatState {
  const s = clone(state)
  s.torpedoSalvoes.push({ ...salvo })
  return s
}

export interface TickTorpedoResult {
  state: ServerCombatState
  resolved: ServerTorpedoSalvo[]
}

export function tickTorpedoes(state: ServerCombatState): TickTorpedoResult {
  const s = clone(state)
  const resolved: ServerTorpedoSalvo[] = []
  s.torpedoSalvoes = s.torpedoSalvoes.filter(t => {
    t.remainingTurns--
    if (t.remainingTurns <= 0) { resolved.push(t); return false }
    return true
  })
  return { state: s, resolved }
}

// ===== Fighter =====

export function addFighterToken(
  state: ServerCombatState, token: ServerFighterToken
): ServerCombatState {
  const s = clone(state)
  s.fighterTokens.push({ ...token })
  return s
}

export function tickFighters(state: ServerCombatState): ServerCombatState {
  const s = clone(state)
  for (const f of s.fighterTokens) {
    if (f.remainingTurns > 0) f.remainingTurns--
  }
  s.fighterTokens = s.fighterTokens.filter(f => f.remainingTurns > 0)
  return s
}

export function removeFightersByPlayer(
  state: ServerCombatState, slotIndex: number
): ServerCombatState {
  const s = clone(state)
  s.fighterTokens = s.fighterTokens.filter(f => f.sourcePlayerId !== String(slotIndex))
  return s
}

// ===== Effects =====

export function addEffect(
  state: ServerCombatState, effect: ServerActiveEffect
): ServerCombatState {
  const s = clone(state)
  s.activeEffects.push({ ...effect })
  return s
}

export function tickEffects(state: ServerCombatState): ServerCombatState {
  const s = clone(state)
  s.activeEffects = s.activeEffects.filter(e => {
    e.remainingTurns--
    return e.remainingTurns > 0
  })
  return s
}
```

- [ ] **Step 3: Run tests**

Run: `npx vitest run`
Expected: All tests pass

- [ ] **Step 4: Commit**

```bash
git add server/data/CombatState.ts server/__tests__/data/CombatState.test.ts
git commit -m "feat: data layer — torpedo/fighter/effect 纯函数"
```

---

### Task 4: Data层 查询函数 + 殉爆链

**Files:**
- Modify: `server/data/CombatState.ts`
- Modify: `server/__tests__/data/CombatState.test.ts`

- [ ] **Step 1: Write executable tests for query functions and handleDestruction**

Append to `server/__tests__/data/CombatState.test.ts`:

```typescript
describe('findCompartment', () => {
  it('finds existing compartment', async () => {
    const { findCompartment } = await import('../../data/CombatState.js')
    const state: any = makeTestState()
    const result = findCompartment(state, 'teamA_s0_comp_0')
    expect(result).not.toBeNull()
    expect(result!.equipmentType).toBe('dual_cannon')
  })

  it('returns null for non-existent', async () => {
    const { findCompartment } = await import('../../data/CombatState.js')
    const state: any = makeTestState()
    expect(findCompartment(state, 'nope')).toBeNull()
  })
})

describe('getAdjacentComps', () => {
  it('returns compartments within distance 2', async () => {
    const { getAdjacentComps } = await import('../../data/CombatState.js')
    const state: any = makeTestState()
    // comp_0 has one adjacent comp at position 1
    const result = getAdjacentComps(state, 'teamA_s0_comp_0', 2)
    expect(result).toHaveLength(1)
    expect(result[0].compId).toBe('teamA_s0_comp_1')
  })
})

describe('isCompartmentSmoked', () => {
  it('returns true if compartment is in smoke effect', async () => {
    const { isCompartmentSmoked } = await import('../../data/CombatState.js')
    const state: any = makeTestState()
    state.activeEffects = [{
      id: 'e1', effectType: 'smoke_short',
      sourceCompartmentId: 'teamA_s0_comp_1',
      affectedCompartmentIds: ['teamA_s0_comp_0'], remainingTurns: 1,
    }]
    expect(isCompartmentSmoked(state, 'teamA_s0_comp_0')).toBe(true)
    expect(isCompartmentSmoked(state, 'teamA_s0_comp_1')).toBe(false)
  })
})

describe('handleDestruction', () => {
  it('triggers ammo depot explosion (殉爆8) to adjacent compartments', async () => {
    const { handleDestruction } = await import('../../data/CombatState.js')
    const state: any = makeTestState()
    // Mark the ammo_depot compartment as destroyed
    state.ships[0].compartments[1].isDestroyed = true
    state.ships[0].compartments[1].currentHp = 0

    const result = handleDestruction(state, 'teamA_s0_comp_1')
    // Adjacent comp_0 should take 8 damage
    expect(result.state.ships[0].compartments[0].currentHp).toBe(12) // 20 - 8
    expect(result.logs.some((l: any) => l.message.includes('弹药库殉爆'))).toBe(true)
  })

  it('detects ship sunk when all compartments destroyed', async () => {
    const { handleDestruction } = await import('../../data/CombatState.js')
    const state: any = makeTestState()
    // Only 1 compartment in this ship
    state.ships[0].compartments.length = 1  // keep only comp_0
    state.ships[0].compartments[0].isDestroyed = true
    state.ships[0].compartments[0].currentHp = 0

    const result = handleDestruction(state, 'teamA_s0_comp_0')
    expect(result.logs.some((l: any) => l.message.includes('战沉'))).toBe(true)
  })

  it('does nothing for non-explosive equipment', async () => {
    const { handleDestruction } = await import('../../data/CombatState.js')
    const state: any = makeTestState()
    state.ships[0].compartments[0].isDestroyed = true
    state.ships[0].compartments[0].currentHp = 0

    // dual_cannon is not explosive, but ship has 2 comps so not sunk
    const result = handleDestruction(state, 'teamA_s0_comp_0')
    // No explosion messages
    expect(result.logs.filter((l: any) => l.message.includes('殉爆'))).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Implement query functions**

Append to `server/data/CombatState.ts`:

```typescript
// ===== Query Functions =====

export function findCompartment(
  state: ServerCombatState, compId: string
): ServerCompartment | null {
  for (const ship of state.ships) {
    const c = ship.compartments.find(co => co.compId === compId)
    if (c) return c
  }
  return null
}

export function findShip(
  state: ServerCombatState, shipId: string
): ServerShip | null {
  return state.ships.find(s => s.shipId === shipId) ?? null
}

export function findShipByComp(
  state: ServerCombatState, compId: string
): ServerShip | null {
  for (const ship of state.ships) {
    if (ship.compartments.some(c => c.compId === compId)) return ship
  }
  return null
}

export function getCompartmentByPosition(
  ship: ServerShip, position: number
): ServerCompartment | null {
  return ship.compartments.find(c => c.position === position) ?? null
}

/** 获取与指定舱段距离 > 0 且 <= distance 的所有舱段 */
export function getAdjacentComps(
  state: ServerCombatState, compId: string, distance: number
): ServerCompartment[] {
  const ship = findShipByComp(state, compId)
  if (!ship) return []
  const comp = findCompartment(state, compId)
  if (!comp) return []
  return ship.compartments.filter(c =>
    c.compId !== compId &&
    Math.abs(c.position - comp.position) > 0 &&
    Math.abs(c.position - comp.position) <= distance
  )
}

export function isCompartmentSmoked(
  state: ServerCombatState, compId: string
): boolean {
  return state.activeEffects.some(
    e => (e.effectType === 'smoke_short' || e.effectType === 'smoke_long') &&
      e.affectedCompartmentIds.includes(compId)
  )
}

export function isShipSunk(
  state: ServerCombatState, shipId: string
): boolean {
  const ship = findShip(state, shipId)
  if (!ship) return false
  return ship.compartments.every(c => c.isDestroyed)
}

export function isTeamDefeated(
  state: ServerCombatState, teamId: string
): boolean {
  const teamShips = state.ships.filter(s => s.teamId === teamId)
  if (teamShips.length === 0) return true
  return teamShips.every(s => isShipSunk(state, s.shipId))
}

export function getCommandsUsed(
  state: ServerCombatState, compId: string
): number {
  return state.commandsUsed[compId] ?? 0
}

export function isTorpedoLoaded(
  state: ServerCombatState, compId: string
): boolean {
  return state.torpedoLoaded[compId] ?? false
}

export function canUseAmmoDepot(
  state: ServerCombatState, compId: string
): boolean {
  return !state.ammoDepotUsed[compId]
}

export function getRandomLivingCompartment(
  state: ServerCombatState, shipId: string
): ServerCompartment | null {
  const ship = findShip(state, shipId)
  if (!ship) return null
  const living = ship.compartments.filter(c => !c.isDestroyed)
  if (living.length === 0) return null
  return living[Math.floor(Math.random() * living.length)]
}
```

- [ ] **Step 3: Implement handleDestruction**

Append to `server/data/CombatState.ts`:

```typescript
export interface DestructionResult {
  state: ServerCombatState
  logs: { message: string; type: string }[]
}

/** 处理击毁后的链式反应。调用前确保 comp.isDestroyed === true */
export function handleDestruction(
  state: ServerCombatState, compId: string
): DestructionResult {
  let s = clone(state)
  const logs: { message: string; type: string }[] = []
  const comp = findCompartment(s, compId)
  if (!comp) return { state: s, logs }

  // 弹药库殉爆
  if (comp.equipmentType === 'ammo_depot') {
    logs.push({ message: '弹药库殉爆! 殉爆8', type: 'destroy' })
    const adj = getAdjacentComps(s, compId, 1)
    for (const ac of adj) {
      const result = applyDamage(s, ac.compId, 8)
      s = result.state
      const acShip = findShipByComp(s, ac.compId)
      const shipName = acShip?.name ?? '?'
      logs.push({
        message: `殉爆 → ${shipName} 第${ac.position + 1}舱段 8伤害${result.destroyed ? ' — 击毁!' : ''}`,
        type: result.destroyed ? 'destroy' : 'damage',
      })
      if (result.destroyed) {
        const next = handleDestruction(s, ac.compId)
        s = next.state
        logs.push(...next.logs)
      }
    }
  }

  // 鱼雷装填状态殉爆
  if (comp.equipmentType === 'quad_torpedo' && isTorpedoLoaded(state, compId)) {
    logs.push({ message: '鱼雷殉爆! 殉爆5', type: 'destroy' })
    const adj = getAdjacentComps(s, compId, 1)
    for (const ac of adj) {
      const result = applyDamage(s, ac.compId, 5)
      s = result.state
      const acShip = findShipByComp(s, ac.compId)
      const shipName = acShip?.name ?? '?'
      logs.push({
        message: `殉爆 → ${shipName} 第${ac.position + 1}舱段 5伤害${result.destroyed ? ' — 击毁!' : ''}`,
        type: result.destroyed ? 'destroy' : 'damage',
      })
      if (result.destroyed) {
        const next = handleDestruction(s, ac.compId)
        s = next.state
        logs.push(...next.logs)
      }
    }
  }

  // 检查舰船沉没
  const ship = findShipByComp(s, compId)
  if (ship && isShipSunk(s, ship.shipId)) {
    logs.push({ message: `${ship.name} 战沉!`, type: 'destroy' })
  }

  return { state: s, logs }
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run`
Expected: All tests pass

- [ ] **Step 5: Commit**

```bash
git add server/data/CombatState.ts server/__tests__/data/CombatState.test.ts
git commit -m "feat: data layer — 查询函数 + handleDestruction 殉爆链"
```

---

### Task 5: 逻辑层 — 骰子工具

**Files:**
- Create: `server/logic/rules/dice.ts`
- Create: `server/__tests__/logic/dice.test.ts`

- [ ] **Step 1: Write failing test**

Create `server/__tests__/logic/dice.test.ts`:

```typescript
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
```

- [ ] **Step 2: Implement dice**

Create `server/logic/rules/dice.ts`:

```typescript
// server/logic/rules/dice.ts
// 逻辑层骰子工具

export type DiceRng = (sides: number) => number

/** 基于 Math.random 的真随机骰子 */
export function createRng(): DiceRng {
  return (sides: number) => Math.floor(Math.random() * sides) + 1
}

/** 测试用固定值骰子：依次返回预设值 */
export function mockRng(sequence: number[]): DiceRng {
  let i = 0
  return () => {
    const v = sequence[i % sequence.length]
    i++
    return v
  }
}

/** 投掷多个同面数骰子 */
export function rollMultiple(rng: DiceRng, sides: number, count: number): number[] {
  return Array.from({ length: count }, () => rng(sides))
}

/** 投掷一个骰子 */
export function rollOne(rng: DiceRng, sides: number): number {
  return rng(sides)
}
```

- [ ] **Step 3: Run tests**

Run: `npx vitest run`
Expected: All tests pass

- [ ] **Step 4: Commit**

```bash
git add server/logic/rules/dice.ts server/__tests__/logic/dice.test.ts
git commit -m "feat: logic layer — dice utilities"
```

---

### Task 6: 逻辑层 — 命中判定与伤害计算规则

**Files:**
- Create: `server/logic/rules/hitResolution.ts`
- Create: `server/logic/rules/damageRoll.ts`
- Create: `server/logic/rules/airSuperiority.ts`
- Create: `server/__tests__/logic/rules.test.ts`

- [ ] **Step 1: Write executable tests for hit/damage/air-superiority rules**

Create `server/__tests__/logic/rules.test.ts`:

```typescript
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
    expect(rollGunDamage(rng, 'dual_cannon')).toBe(7) // 3+4
  })

  it('triple cannon rolls 3D6', async () => {
    const { mockRng } = await import('../../logic/rules/dice.js')
    const { rollGunDamage } = await import('../../logic/rules/damageRoll.js')
    const rng = mockRng([2, 3, 5])
    expect(rollGunDamage(rng, 'triple_cannon')).toBe(10) // 2+3+5
  })
})

describe('rollBomberDamage', () => {
  it('computes 16 - nfa * D12, clamped to 0', async () => {
    const { mockRng } = await import('../../logic/rules/dice.js')
    const { rollBomberDamage } = await import('../../logic/rules/damageRoll.js')
    expect(rollBomberDamage(mockRng([3]), 0)).toBe(16)   // 16 - 0*3
    expect(rollBomberDamage(mockRng([5]), 2)).toBe(6)    // 16 - 2*5
    expect(rollBomberDamage(mockRng([2]), 10)).toBe(0)   // 16 - 10*2 = -4 → 0
  })
})
```

- [ ] **Step 2: Implement hitResolution.ts**

```typescript
// server/logic/rules/hitResolution.ts
// 舰炮命中判定

/**
 * 标准命中表：D8 → 结果
 *  3-6: 命中当前舱段
 *  2:   命中前一舱段
 *  7:   命中后一舱段
 *  其他: 未命中
 *
 * 加力引擎修改表：
 *  4,5: 命中当前舱段
 *  3:   命中前一舱段
 *  6:   命中后一舱段
 *  其他: 未命中
 */
export type AdjacentFn = (compId: string, offset: number) => string | null

export function resolveNavalGunHit(
  d8: number,
  targetCompId: string,
  hasAfterburner: boolean,
  adjacentComp: AdjacentFn
): string | null {
  if (hasAfterburner) {
    if (d8 === 4 || d8 === 5) return targetCompId
    if (d8 === 3) return adjacentComp(targetCompId, -1)
    if (d8 === 6) return adjacentComp(targetCompId, 1)
    return null
  }

  // 标准表
  if (d8 >= 3 && d8 <= 6) return targetCompId
  if (d8 === 2) return adjacentComp(targetCompId, -1)
  if (d8 === 7) return adjacentComp(targetCompId, 1)
  return null
}

/** 盲射命中判定：D8 3-6 命中随机舱段 */
export function resolveBlindfireHit(d8: number): boolean {
  return d8 >= 3 && d8 <= 6
}
```

- [ ] **Step 3: Implement damageRoll.ts**

```typescript
// server/logic/rules/damageRoll.ts
import type { DiceRng } from './dice.js'
import { rollMultiple } from './dice.js'

/** 舰炮伤害掷骰 */
export function rollGunDamage(
  rng: DiceRng, equipmentType: 'dual_cannon' | 'triple_cannon'
): number {
  const count = equipmentType === 'dual_cannon' ? 2 : 3
  return rollMultiple(rng, 6, count).reduce((a, b) => a + b, 0)
}

/** 鱼雷伤害：每颗 1D10 */
export function rollTorpedoDamage(rng: DiceRng, count: number): number[] {
  return rollMultiple(rng, 10, count)
}

/** 轰炸机伤害: 16 - nfa * D12 (最小0) */
export function rollBomberDamage(rng: DiceRng, nfa: number): number {
  const d12 = rng(12)
  return Math.max(0, 16 - nfa * d12)
}

/** 鱼雷机伤害: 2D10 - nfa * D6 (最小0) */
export function rollTorpedoBomberDamage(rng: DiceRng, nfa: number): number {
  const d6 = rng(6)
  const d10a = rng(10)
  const d10b = rng(10)
  return Math.max(0, d10a + d10b - nfa * d6)
}
```

- [ ] **Step 4: Implement airSuperiority.ts**

```typescript
// server/logic/rules/airSuperiority.ts
import type { ServerCombatState } from '../../data/CombatState.js'
import { findShip } from '../../data/CombatState.js'

const FIGHTER_AS = 2
const AA_GUN_AS = 3

/** 计算非我方空优 (敌方空优 - 我方空优, 不为负数) */
export function calculateAirSuperiority(
  state: ServerCombatState, shipId: string, teamId: string
): number {
  const ship = findShip(state, shipId)
  if (!ship) return 0

  // 我方空优 = 我方战斗机*2 + 我方防空炮*3
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

  // 防空炮：为所在舰船提供空优
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
```

- [ ] **Step 5: Run tests**

Run: `npx vitest run`
Expected: All tests pass

- [ ] **Step 6: Commit**

```bash
git add server/logic/rules/ server/__tests__/logic/
git commit -m "feat: logic layer — hit resolution, damage, air superiority rules"
```

---

### Task 7: Shared Protocol — ClientIntent 类型

**Files:**
- Modify: `shared/protocol.ts`

- [ ] **Step 1: Add IntentType and ClientIntent to shared/protocol.ts**

Append to `shared/protocol.ts`:

```typescript
// ==================== 客户端意图 (完全服务器权威) ====================

export type IntentType =
  | 'spawn'            // 选择出生点
  | 'endTurn'          // 结束回合
  | 'playCard'         // 打出卡牌 { cardId }
  | 'freeMove'         // 自由行动：跑动
  | 'freeCommand'      // 自由行动：指挥当前舱段
  | 'freePass'         // 自由行动：传递
  | 'targetSelection'  // 确认目标

export interface ClientIntent {
  type: IntentType
  payload: {
    shipId?: string
    compIndex?: number
    compartmentId?: string
    fromCompId?: string
    toCompId?: string
    sourceCompId?: string
    targetCompId?: string
    targetShipId?: string
    commandId?: string
    cardId?: string
    cardIds?: string[]
  }
}
```

- [ ] **Step 2: Add winner field to BattleStateSnapshot**

In `shared/protocol.ts`, update `BattleStateSnapshot`:

```typescript
export interface BattleStateSnapshot {
  ships: BattleStateShip[]
  playerPositions: Record<number, { shipId: string; compIndex: number }>
  fighterTokens: { id: string; shipId: string; ownerTeamId: string; sourceCompartmentId: string; sourcePlayerId: string; remainingTurns: number }[]
  torpedoSalvoes: { id: string; sourceCompartmentId: string; targetCompartmentId: string; torpedoCount: number; remainingTurns: number }[]
  activeEffects: { id: string; effectType: string; sourceCompartmentId: string; affectedCompartmentIds: string[]; remainingTurns: number }[]
  torpedoLoaded: Record<string, boolean>
  currentTurnSlot: number
  roundNumber: number
  winner?: string | null         // 新增：战斗结束时的获胜队伍
  phase?: 'spawn' | 'battle'     // 新增：当前阶段
}
```

- [ ] **Step 3: Verify type compiles**

Run: `npx tsc --noEmit`
Expected: No new errors

- [ ] **Step 4: Commit**

```bash
git add shared/protocol.ts
git commit -m "feat: shared protocol — ClientIntent + BattleStateSnapshot winner/phase"
```

---

### Task 8: 逻辑层 — spawn handler

**Files:**
- Create: `server/logic/handlers/spawnHandler.ts`

- [ ] **Step 1: Implement spawnHandler**

```typescript
// server/logic/handlers/spawnHandler.ts
import type { ServerRoom } from '../../state.js'
import type { ClientIntent } from '../../../shared/protocol.js'
import type { ServerCombatState } from '../../data/CombatState.js'
import { movePlayer } from '../../data/CombatState.js'

export interface SpawnResult {
  newState: ServerCombatState
  logs: { message: string; type: string }[]
  spawnComplete: boolean
}

export function handleSpawn(
  state: ServerCombatState,
  room: ServerRoom,
  slotIndex: number,
  intent: ClientIntent
): SpawnResult {
  const logs: { message: string; type: string }[] = []

  // 1. 权限检查
  const currentSpawnSlot = room.spawnOrder[room.spawnIndex]
  if (currentSpawnSlot !== slotIndex) {
    return { newState: state, logs: [{ message: '还没轮到你选出生点', type: 'error' }], spawnComplete: false }
  }

  // 如果已出生，跳过
  if (room.spawns.has(slotIndex)) {
    return { newState: state, logs, spawnComplete: false }
  }

  const { shipId, compartmentId } = intent.payload
  const compMatch = compartmentId?.match(/_comp_(\d+)$/)
  const compIndex = compMatch ? parseInt(compMatch[1]) : 0
  const finalShipId = shipId || ''

  // 2. 规则验证：舱段必须属于该玩家的队伍
  const slot = room.state.slots[slotIndex]
  if (!slot) {
    return { newState: state, logs: [{ message: '无效槽位', type: 'error' }], spawnComplete: false }
  }

  // 验证 shipId 属于该队伍
  if (!finalShipId.startsWith(slot.teamId)) {
    return { newState: state, logs: [{ message: '不能出生在敌方舰船', type: 'error' }], spawnComplete: false }
  }

  // 3. 执行：更新 spawns map 和数据层玩家位置
  room.spawns.set(slotIndex, { shipId: finalShipId, compIndex })
  room.spawnIndex++

  const newState = movePlayer(state, slotIndex, finalShipId, compIndex)
  const playerName = slot.playerName || '?'
  logs.push({
    message: `${playerName} 选择出生点 — ${finalShipId} 舱段${compIndex + 1}`,
    type: 'system',
  })

  // 检查是否所有人都已出生
  const occupiedSlots = room.state.slots.filter(s => s.playerName).map(s => s.index)
  const allSpawned = occupiedSlots.every(idx => room.spawns.has(idx))

  return { newState, logs, spawnComplete: allSpawned }
}
```

- [ ] **Step 2: Commit**

```bash
git add server/logic/handlers/spawnHandler.ts
git commit -m "feat: logic layer — spawn handler"
```

---

### Task 9: 逻辑层 — endTurn handler

**Files:**
- Create: `server/logic/handlers/endTurnHandler.ts`

- [ ] **Step 1: Implement endTurnHandler**

```typescript
// server/logic/handlers/endTurnHandler.ts
import type { ServerRoom } from '../../state.js'
import type { ServerCombatState } from '../../data/CombatState.js'
import {
  tickEffects, tickTorpedoes, tickFighters, removeFightersByPlayer,
  resetPerTurn, applyDamage, handleDestruction, findShipByComp,
  isShipSunk, isTeamDefeated, type DestructionResult,
} from '../../data/CombatState.js'
import type { DiceRng } from '../rules/dice.js'

export interface EndTurnResult {
  newState: ServerCombatState
  logs: { message: string; type: string }[]
  nextSlot: number
  nextRound: number
  winner?: string
}

export function handleEndTurn(
  state: ServerCombatState,
  room: ServerRoom,
  slotIndex: number,
  rng: DiceRng
): EndTurnResult {
  const logs: { message: string; type: string }[] = []

  // 1. 权限检查
  if (room.currentTurnSlot !== slotIndex) {
    return { newState: state, logs, nextSlot: room.currentTurnSlot, nextRound: room.roundNumber }
  }

  // 2. tick effects / torpedoes / fighters
  let s = tickEffects(state)
  s = tickFighters(s)
  const torpResult = tickTorpedoes(s)
  s = torpResult.state

  // 结算鱼雷伤害
  for (const t of torpResult.resolved) {
    for (let i = 0; i < t.torpedoCount; i++) {
      const dmg = rng(10) // 1D10
      const dmgResult = applyDamage(s, t.targetCompartmentId, dmg)
      s = dmgResult.state
      const ship = findShipByComp(s, t.targetCompartmentId)
      const shipName = ship?.name ?? '?'
      const comp = ship?.compartments.find(c => c.compId === t.targetCompartmentId)
      logs.push({
        message: `鱼雷 → ${shipName} 第${(comp?.position ?? 0) + 1}舱段 ${dmg}伤害${dmgResult.destroyed ? ' — 击毁!' : ''}`,
        type: dmgResult.destroyed ? 'destroy' : 'damage',
      })
      if (dmgResult.destroyed) {
        const dest = handleDestruction(s, t.targetCompartmentId)
        s = dest.state
        logs.push(...dest.logs)
      }
    }
  }

  // 3. 移除上一个回合的玩家战斗机
  s = removeFightersByPlayer(s, slotIndex)

  // 4. 重置每回合计数器
  s = resetPerTurn(s)

  // 5. 计算下一个回合槽位
  const turnOrder = room.lastBattleInit?.turnOrder || []
  const curIdx = turnOrder.indexOf(room.currentTurnSlot)
  let nextIdx = (curIdx + 1) % turnOrder.length
  let safety = 0
  while (safety < turnOrder.length) {
    const checkSlot = turnOrder[nextIdx]
    const slot = room.state.slots[checkSlot]
    if (slot && slot.playerName && slot.socketId) break
    nextIdx = (nextIdx + 1) % turnOrder.length
    safety++
  }

  const nextRound = nextIdx <= curIdx ? room.roundNumber + 1 : room.roundNumber

  // 6. 检查胜利条件
  const aliveTeams = new Set(
    state.ships.filter(sh => !isShipSunk(s, sh.shipId)).map(sh => sh.teamId)
  )
  let winner: string | undefined
  if (aliveTeams.size <= 1) {
    winner = aliveTeams.values().next().value
    if (!winner) winner = undefined
  }

  const nextSlotPlayer = room.state.slots[turnOrder[nextIdx]]
  const playerName = nextSlotPlayer?.playerName || '?'

  // 先输出回合结束玩家的日志
  const endPlayer = room.state.slots[slotIndex]
  if (endPlayer?.playerName) {
    logs.unshift({ message: `${endPlayer.playerName} 结束回合`, type: 'system' })
  }

  logs.push({ message: `--- ${playerName} 的回合 (第${nextRound}轮) ---`, type: 'system' })

  return { newState: s, logs, nextSlot: turnOrder[nextIdx], nextRound, winner }
}
```

- [ ] **Step 2: Commit**

```bash
git add server/logic/handlers/endTurnHandler.ts
git commit -m "feat: logic layer — endTurn handler"
```

---

### Task 10: 逻辑层 — freeMove + freeCommand handlers

**Files:**
- Create: `server/logic/handlers/freeMoveHandler.ts`
- Create: `server/logic/handlers/freeCommandHandler.ts`

- [ ] **Step 1: Implement freeMoveHandler**

```typescript
// server/logic/handlers/freeMoveHandler.ts
import type { ServerRoom } from '../../state.js'
import type { ClientIntent } from '../../../shared/protocol.js'
import type { ServerCombatState } from '../../data/CombatState.js'
import { movePlayer, findShip, getCompartmentByPosition } from '../../data/CombatState.js'

const FREE_MOVE_RANGE = 2

export function handleFreeMove(
  state: ServerCombatState,
  room: ServerRoom,
  slotIndex: number,
  intent: ClientIntent
): { newState: ServerCombatState; logs: { message: string; type: string }[] } {
  const logs: { message: string; type: string }[] = []

  // 1. 权限
  if (room.currentTurnSlot !== slotIndex) {
    return { newState: state, logs }
  }

  const { toCompId } = intent.payload
  if (!toCompId) {
    logs.push({ message: '缺少目标舱段', type: 'error' })
    return { newState: state, logs }
  }

  const pos = state.playerPositions[slotIndex]
  if (!pos) {
    logs.push({ message: '玩家没有位置', type: 'error' })
    return { newState: state, logs }
  }

  const ship = findShip(state, pos.shipId)
  if (!ship) {
    logs.push({ message: '舰船不存在', type: 'error' })
    return { newState: state, logs }
  }

  const fromComp = getCompartmentByPosition(ship, pos.compIndex)
  const toComp = ship.compartments.find(c => c.compId === toCompId)
  if (!fromComp || !toComp) {
    logs.push({ message: '无效移动目标', type: 'error' })
    return { newState: state, logs }
  }

  const distance = Math.abs(toComp.position - fromComp.position)
  if (distance > FREE_MOVE_RANGE || distance === 0) {
    logs.push({ message: `跑动最多${FREE_MOVE_RANGE}格`, type: 'error' })
    return { newState: state, logs }
  }

  const newState = movePlayer(state, slotIndex, pos.shipId, toComp.position)
  const playerName = room.state.slots[slotIndex]?.playerName || '?'
  logs.push({ message: `${playerName} 跑动到舱段${toComp.position + 1}`, type: 'system' })

  return { newState, logs }
}
```

- [ ] **Step 2: Implement freeCommandHandler**

```typescript
// server/logic/handlers/freeCommandHandler.ts
import type { ServerRoom } from '../../state.js'
import type { ClientIntent } from '../../../shared/protocol.js'
import type { ServerCombatState } from '../../data/CombatState.js'
import { findShip, getCompartmentByPosition, getCommandsUsed } from '../../data/CombatState.js'
import { getEquipment } from '../../../src/game/equipment/registry.js'

export interface FreeCommandResult {
  newState: ServerCombatState
  logs: { message: string; type: string }[]
  /** 中继/发令装备 info：需要进一步 targetSelection 时使用 */
  relayTarget?: {
    sourceCompId: string
    relayedCommandId: string
    scope: string
  }
}

export function handleFreeCommand(
  state: ServerCombatState,
  room: ServerRoom,
  slotIndex: number,
  intent: ClientIntent
): FreeCommandResult {
  const logs: { message: string; type: string }[] = []

  if (room.currentTurnSlot !== slotIndex) {
    return { newState: state, logs }
  }

  const pos = state.playerPositions[slotIndex]
  if (!pos) {
    logs.push({ message: '玩家没有位置', type: 'error' })
    return { newState: state, logs }
  }

  const ship = findShip(state, pos.shipId)
  if (!ship) {
    logs.push({ message: '舰船不存在', type: 'error' })
    return { newState: state, logs }
  }

  let comp = getCompartmentByPosition(ship, pos.compIndex)
  if (!comp) {
    logs.push({ message: '无效舱段', type: 'error' })
    return { newState: state, logs }
  }

  // 多舱段：从属重定向到主舱段
  if (comp.multiCompRootId && !comp.equipmentType) {
    const master = ship.compartments.find(c => c.compId === comp!.multiCompRootId)
    if (master && master.equipmentType && !master.isDestroyed) comp = master
  }

  if (!comp.equipmentType || comp.isDestroyed) {
    logs.push({ message: '当前舱段没有可指挥的军备', type: 'error' })
    return { newState: state, logs }
  }

  const eqDef = getEquipment(comp.equipmentType)

  // 检查指挥次数
  if (eqDef.commandsPerTurn > 0) {
    const used = getCommandsUsed(state, comp.compId)
    if (used >= eqDef.commandsPerTurn) {
      logs.push({ message: `本回合已指挥 ${used}/${eqDef.commandsPerTurn} 次`, type: 'error' })
      return { newState: state, logs }
    }
  }

  // 如果是中继类装备，返回 relayTarget
  if (['command_room', 'command_center', 'integrated_command'].includes(comp.equipmentType)) {
    return {
      newState: state,
      logs,
      relayTarget: {
        sourceCompId: comp.compId,
        relayedCommandId: eqDef.commands[0]?.id || '',
        scope: eqDef.commands[0]?.targeting.scope || 'own-compartment',
      },
    }
  }

  // 非中继装备：返回当前命令信息，等待客户端 targetSelection
  return {
    newState: state,
    logs: [{ message: `选择 ${eqDef.name} 的目标`, type: 'system' }],
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add server/logic/handlers/freeMoveHandler.ts server/logic/handlers/freeCommandHandler.ts
git commit -m "feat: logic layer — freeMove + freeCommand handlers"
```

---

### Task 11: 逻辑层 — commandHandler (targetSelection 核心)

**Files:**
- Create: `server/logic/handlers/commandHandler.ts`

This is the largest handler — it processes `targetSelection` intents for all equipment types.

- [ ] **Step 1: Implement commandHandler with cannon shooting**

```typescript
// server/logic/handlers/commandHandler.ts
import type { ServerRoom } from '../../state.js'
import type { ClientIntent } from '../../../shared/protocol.js'
import type { ServerCombatState } from '../../data/CombatState.js'
import {
  applyDamage, handleDestruction, useCommand, useSortie,
  markAmmoDepotUsed, setTorpedoLoaded, addTorpedoSalvo,
  addFighterToken, addEffect, healCompartment, findShipByComp,
  getAdjacentComps, isCompartmentSmoked, isTorpedoLoaded,
  getCommandsUsed, canUseAmmoDepot, findCompartment, findShip,
  getRandomLivingCompartment, isShipSunk, isTeamDefeated,
  getCompartmentByPosition, type DestructionResult,
} from '../../data/CombatState.js'
import { getEquipment } from '../../../src/game/equipment/registry.js'
import type { DiceRng } from '../rules/dice.js'
import { rollOne, rollMultiple } from '../rules/dice.js'
import { resolveNavalGunHit, resolveBlindfireHit } from '../rules/hitResolution.js'
import { rollGunDamage, rollBomberDamage, rollTorpedoBomberDamage } from '../rules/damageRoll.js'
import { calculateAirSuperiority } from '../rules/airSuperiority.js'
import type { ServerCompartment, ServerShip } from '../../combatState.js'

export interface CommandResult {
  newState: ServerCombatState
  logs: { message: string; type: string }[]
  winner?: string
}

export function handleCommand(
  state: ServerCombatState,
  room: ServerRoom,
  slotIndex: number,
  intent: ClientIntent,
  rng: DiceRng
): CommandResult {
  const logs: { message: string; type: string }[] = []

  // 1. 权限
  if (room.currentTurnSlot !== slotIndex) {
    return { newState: state, logs }
  }

  const { sourceCompId, targetCompId, targetShipId, commandId } = intent.payload
  if (!sourceCompId || !commandId) {
    return { newState: state, logs: [{ message: '缺少参数', type: 'error' }] }
  }

  const sourceComp = findCompartment(state, sourceCompId)
  if (!sourceComp || !sourceComp.equipmentType || sourceComp.isDestroyed) {
    return { newState: state, logs: [{ message: '源军备无效', type: 'error' }] }
  }

  const eqType = sourceComp.equipmentType
  const eqDef = getEquipment(eqType)
  const playerName = room.state.slots[slotIndex]?.playerName || '?'

  let s = state

  switch (eqType) {
    // ===== 舰炮 =====
    case 'dual_cannon':
    case 'triple_cannon': {
      const isBlind = commandId.includes('blindfire')

      if (isBlind) {
        // 盲射
        if (!targetShipId) {
          logs.push({ message: '盲射需要选择目标舰船', type: 'error' })
          return { newState: s, logs }
        }
        const targetShip = findShip(s, targetShipId)
        if (!targetShip) {
          logs.push({ message: '目标舰船不存在', type: 'error' })
          return { newState: s, logs }
        }
        const attacks = eqType === 'dual_cannon' ? 2 : 1
        let totalDmg = 0
        for (let a = 0; a < attacks; a++) {
          const d8 = rollOne(rng, 8)
          if (!resolveBlindfireHit(d8)) {
            logs.push({ message: `[盲射#${a + 1} D8=${d8}] ${eqDef.name} 未命中!`, type: 'info' })
            continue
          }
          const hitComp = getRandomLivingCompartment(s, targetShipId)
          if (!hitComp) continue
          const dmg = rollGunDamage(rng, eqType as 'dual_cannon' | 'triple_cannon')
          totalDmg += dmg
          const dmgResult = applyDamage(s, hitComp.compId, dmg)
          s = dmgResult.state
          const hitShipName = findShipByComp(s, hitComp.compId)?.name ?? '?'
          logs.push({
            message: `[盲射#${a + 1} D8=${d8}] ${eqDef.name} 命中 → ${hitShipName} 第${hitComp.position + 1}舱段 ${dmg}伤害${dmgResult.destroyed ? ' — 击毁!' : ''}`,
            type: dmgResult.destroyed ? 'destroy' : 'damage',
          })
          if (dmgResult.destroyed) {
            const dest = handleDestruction(s, hitComp.compId)
            s = dest.state; logs.push(...dest.logs)
          }
        }
        if (totalDmg === 0 && attacks > 1) {
          logs.push({ message: `${eqDef.name} 盲射: 全部未命中!`, type: 'info' })
        }
      } else {
        // 瞄准射击
        if (!targetCompId) {
          logs.push({ message: '射击需要选择目标舱段', type: 'error' })
          return { newState: s, logs }
        }
        if (isCompartmentSmoked(s, targetCompId)) {
          logs.push({ message: '目标舱段被烟幕覆盖', type: 'error' })
          return { newState: s, logs }
        }
        const targetShip = findShipByComp(s, targetCompId)
        const hasAB = targetShip?.compartments.some(
          c => c.equipmentType === 'afterburner' && !c.isDestroyed
        ) ?? false

        const d8 = rollOne(rng, 8)
        const adjacentComp = (compId: string, offset: number): string | null => {
          const ship = findShipByComp(s, compId)
          if (!ship) return null
          const comp = ship.compartments.find(c => c.compId === compId)
          if (!comp) return null
          const adj = ship.compartments.find(c => c.position === comp.position + offset)
          return adj?.compId ?? null
        }

        const hitCompId = resolveNavalGunHit(d8, targetCompId, hasAB, adjacentComp)
        if (!hitCompId) {
          logs.push({ message: `[射击 D8=${d8}] ${eqDef.name} 未命中!${hasAB ? ' (目标有加力引擎)' : ''}`, type: 'info' })
          s = useCommand(s, sourceCompId)
          break
        }

        const dmg = rollGunDamage(rng, eqType as 'dual_cannon' | 'triple_cannon')
        logs.push({ message: `[射击 D8=${d8}] ${hasAB ? '加力引擎判定 ' : ''}${dmg}伤害`, type: 'system' })
        const dmgResult = applyDamage(s, hitCompId, dmg)
        s = dmgResult.state
        const hitComp = findCompartment(s, hitCompId)
        const hitShipName = findShipByComp(s, hitCompId)?.name ?? '?'
        logs.push({
          message: `${eqDef.name} → ${hitShipName} 第${(hitComp?.position ?? 0) + 1}舱段 ${dmg}伤害${dmgResult.destroyed ? ' — 击毁!' : ''}`,
          type: dmgResult.destroyed ? 'destroy' : 'damage',
        })
        if (dmgResult.destroyed) {
          const dest = handleDestruction(s, hitCompId)
          s = dest.state; logs.push(...dest.logs)
        }
      }
      s = useCommand(s, sourceCompId)
      break
    }

    // ===== 鱼雷 =====
    case 'quad_torpedo': {
      if (commandId === 'quad_torpedo_load') {
        // 装填
        if (isTorpedoLoaded(s, sourceCompId)) {
          logs.push({ message: '鱼雷已装填', type: 'error' })
          return { newState: s, logs }
        }
        s = setTorpedoLoaded(s, sourceCompId, true)
        s = useCommand(s, sourceCompId)
        logs.push({ message: `${playerName} 装填鱼雷`, type: 'system' })
      } else if (commandId === 'quad_torpedo_fire') {
        if (!isTorpedoLoaded(s, sourceCompId)) {
          logs.push({ message: '鱼雷未装填', type: 'error' })
          return { newState: s, logs }
        }
        if (!targetCompId) {
          logs.push({ message: '鱼雷需要选择目标舱段', type: 'error' })
          return { newState: s, logs }
        }
        const fullRound = room.state.slots.filter(sl => sl.playerName).length
        const salvoId = `torp_srv_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
        s = addTorpedoSalvo(s, {
          id: salvoId,
          sourceCompartmentId: sourceCompId,
          targetCompartmentId: targetCompId,
          torpedoCount: 4,
          remainingTurns: fullRound,
        })
        s = setTorpedoLoaded(s, sourceCompId, false)
        s = useCommand(s, sourceCompId)
        logs.push({ message: `鱼雷发射! 4颗, ${fullRound}全回合后到达`, type: 'system' })
      }
      break
    }

    default:
      logs.push({ message: `${eqDef.name}: 效果执行`, type: 'info' })
      s = useCommand(s, sourceCompId)
  }

  // 弹药库返还效果
  if (eqDef.category === 'combat') {
    const sourceShip = findShipByComp(s, sourceCompId)
    if (sourceShip) {
      const adj = getAdjacentComps(s, sourceCompId, 1)
      const ammoDepot = adj.find(c => c.equipmentType === 'ammo_depot' && !c.isDestroyed)
      if (ammoDepot && canUseAmmoDepot(s, ammoDepot.compId)) {
        s = markAmmoDepotUsed(s, ammoDepot.compId)
        logs.push({ message: '弹药库效果: 一回合一次，返还一张指挥牌', type: 'effect' })
      }
    }
  }

  // 检查胜利条件
  const aliveTeams = new Set(
    s.ships.filter(sh => !isShipSunk(s, sh.shipId)).map(sh => sh.teamId)
  )
  let winner: string | undefined
  if (aliveTeams.size <= 1 && aliveTeams.size > 0) {
    winner = [...aliveTeams][0]
  }

  return { newState: s, logs, winner }
}
```

Wait — this handler is already 150+ lines and I haven't covered hangar/smoke/repair/depth charge/command relay. These need to be included for completeness but would make this task too long. Let me split the handler into two tasks.

- [ ] **Step 2: Commit**

```bash
git add server/logic/handlers/commandHandler.ts
git commit -m "feat: logic layer — commandHandler (naval guns + torpedoes)"
```

---

### Task 12: 逻辑层 — commandHandler 续 (hangar, smoke, repair, depth charge, relay)

**Files:**
- Modify: `server/logic/handlers/commandHandler.ts`

- [ ] **Step 1: Add hangar/smoke/repair/depth charge/command relay cases**

Add these cases to the `switch (eqType)` block in `handleCommand`, after the `quad_torpedo` case and before `default`:

```typescript
    // ===== 机库 (战斗机/轰炸机/鱼雷机) =====
    case 'small_hangar':
    case 'large_hangar': {
      if (!targetShipId && !targetCompId) {
        logs.push({ message: '飞机需要选择目标', type: 'error' })
        return { newState: s, logs }
      }
      const aircraftTargetShipId = targetShipId || (targetCompId ? findShipByComp(s, targetCompId)?.shipId : null)
      if (!aircraftTargetShipId) {
        logs.push({ message: '目标舰船不存在', type: 'error' })
        return { newState: s, logs }
      }

      if (commandId.includes('fighter')) {
        const fullRound = room.state.slots.filter(sl => sl.playerName).length
        const tokenId = `fighter_srv_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
        s = addFighterToken(s, {
          id: tokenId,
          shipId: aircraftTargetShipId,
          ownerTeamId: room.state.slots[slotIndex]?.teamId || '',
          sourceCompartmentId: sourceCompId,
          sourcePlayerId: String(slotIndex),
          remainingTurns: fullRound,
        })
        s = useCommand(s, sourceCompId)
        s = useSortie(s, sourceCompId)
        const targetShipName = findShip(s, aircraftTargetShipId)?.name ?? aircraftTargetShipId
        logs.push({ message: `战斗机起飞 → ${targetShipName}, 空优+2`, type: 'effect' })
      } else if (commandId.includes('bomber')) {
        const nfa = calculateAirSuperiority(s, aircraftTargetShipId, room.state.slots[slotIndex]?.teamId || '')
        const dmg = rollBomberDamage(rng, nfa)
        const hitComp = getRandomLivingCompartment(s, aircraftTargetShipId)
        if (hitComp) {
          const dmgResult = applyDamage(s, hitComp.compId, dmg)
          s = dmgResult.state
          const targetShipName = findShipByComp(s, hitComp.compId)?.name ?? aircraftTargetShipId
          logs.push({ message: `轰炸机 → ${targetShipName} 第${hitComp.position + 1}舱段 ${dmg}伤害 (NFA=${nfa})${dmgResult.destroyed ? ' — 击毁!' : ''}`, type: dmgResult.destroyed ? 'destroy' : 'damage' })
          if (dmgResult.destroyed) {
            const dest = handleDestruction(s, hitComp.compId)
            s = dest.state; logs.push(...dest.logs)
          }
        }
        s = useCommand(s, sourceCompId)
        s = useSortie(s, sourceCompId)
      } else if (commandId.includes('torpedo')) {
        const nfa = calculateAirSuperiority(s, aircraftTargetShipId, room.state.slots[slotIndex]?.teamId || '')
        const dmg = rollTorpedoBomberDamage(rng, nfa)
        const hitComp = getRandomLivingCompartment(s, aircraftTargetShipId)
        if (hitComp) {
          const dmgResult = applyDamage(s, hitComp.compId, dmg)
          s = dmgResult.state
          const targetShipName = findShipByComp(s, hitComp.compId)?.name ?? aircraftTargetShipId
          logs.push({ message: `鱼雷机 → ${targetShipName} 第${hitComp.position + 1}舱段 ${dmg}伤害 (NFA=${nfa})${dmgResult.destroyed ? ' — 击毁!' : ''}`, type: dmgResult.destroyed ? 'destroy' : 'damage' })
          if (dmgResult.destroyed) {
            const dest = handleDestruction(s, hitComp.compId)
            s = dest.state; logs.push(...dest.logs)
          }
        }
        s = useCommand(s, sourceCompId)
        s = useSortie(s, sourceCompId)
      }
      break
    }

    // ===== 烟幕发生器 =====
    case 'smoke_generator': {
      const adj = getAdjacentComps(s, sourceCompId, 2)
      const affected = [sourceCompId, ...adj.map(c => c.compId)]
      const isShort = commandId === 'smoke_short'
      const alivePlayerCount = room.state.slots.filter(sl => sl.playerName).length
      const turns = isShort ? Math.ceil(alivePlayerCount / 2) : alivePlayerCount
      s = addEffect(s, {
        id: `effect_srv_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        effectType: isShort ? 'smoke_short' : 'smoke_long',
        sourceCompartmentId: sourceCompId,
        affectedCompartmentIds: affected,
        remainingTurns: turns,
      })
      s = useCommand(s, sourceCompId)
      logs.push({ message: `烟幕 (${isShort ? '半' : '全'}回合): ${turns}回合`, type: 'effect' })
      break
    }

    // ===== 损管模块 =====
    case 'damage_control': {
      if (commandId === 'damage_control_repair') {
        s = healCompartment(s, sourceCompId, 2)
        const adj = getAdjacentComps(s, sourceCompId, 2)
        for (const ac of adj) {
          s = healCompartment(s, ac.compId, 2)
        }
        s = useCommand(s, sourceCompId)
        logs.push({ message: '综合修复 HP+2 (本舱段及二相邻)', type: 'effect' })
      } else if (commandId === 'damage_control_quick_repair') {
        if (targetCompId) {
          s = healCompartment(s, targetCompId, 8)
          s = useCommand(s, sourceCompId)
          logs.push({ message: '快速抢修 HP+8', type: 'effect' })
        } else {
          logs.push({ message: '快速抢修需要选择目标舱段', type: 'error' })
        }
      }
      break
    }

    // ===== 深水炸弹 =====
    case 'depth_charge': {
      if (!targetShipId) {
        logs.push({ message: '深水炸弹需要选择目标舰船', type: 'error' })
        return { newState: s, logs }
      }
      const torps = s.torpedoSalvoes.filter(t => {
        const ts = findShipByComp(s, t.targetCompartmentId)
        return ts?.shipId === targetShipId
      })
      if (torps.length === 0) {
        const tsName = findShip(s, targetShipId)?.name ?? targetShipId
        logs.push({ message: `深水炸弹: ${tsName} 没有被鱼雷瞄准`, type: 'info' })
        s = useCommand(s, sourceCompId)
        break
      }
      let totalNegated = 0
      let totalCount = 0
      for (const t of torps) {
        const originalCount = t.torpedoCount
        for (let i = 0; i < originalCount; i++) {
          totalCount++
          if (Math.random() < 0.5) {
            t.torpedoCount--
            totalNegated++
          }
        }
      }
      s.torpedoSalvoes = s.torpedoSalvoes.filter(t => t.torpedoCount > 0)
      s = useCommand(s, sourceCompId)
      const tsName = findShip(s, targetShipId)?.name ?? targetShipId
      logs.push({ message: `深水炸弹 → ${tsName}: ${totalNegated}/${totalCount}颗鱼雷被拦截`, type: 'effect' })
      break
    }

    // ===== 指挥中继 (command_room / command_center / integrated_command) =====
    case 'command_room':
    case 'command_center':
    case 'integrated_command': {
      if (!targetCompId) {
        logs.push({ message: '发令需要选择目标舱段', type: 'error' })
        return { newState: s, logs }
      }
      const tgtComp = findCompartment(s, targetCompId)
      if (!tgtComp || !tgtComp.equipmentType) {
        logs.push({ message: '中继目标无效', type: 'error' })
        return { newState: s, logs }
      }
      // 不能中继到另一个指挥中继装备
      if (['command_room', 'command_center', 'integrated_command'].includes(tgtComp.equipmentType)) {
        logs.push({ message: '不能对指挥类军备发动发令', type: 'error' })
        return { newState: s, logs }
      }
      const tgtEq = getEquipment(tgtComp.equipmentType)
      if (tgtEq.commands.length === 0) {
        logs.push({ message: '目标军备没有可执行的指挥', type: 'error' })
        return { newState: s, logs }
      }
      // 找到合适的中继目标并递归执行
      const relayedCmd = tgtEq.commands[0]
      let relayTarget: string | null = null

      if (relayedCmd.targeting.scope === 'enemy-compartment' || relayedCmd.targeting.scope === 'enemy-ship') {
        const pos = state.playerPositions[slotIndex]
        const myTeam = room.state.slots[slotIndex]?.teamId
        const enemyShip = s.ships.find(sh => sh.teamId !== myTeam && sh.compartments.some(c => !c.isDestroyed))
        if (enemyShip) {
          const living = enemyShip.compartments.filter(c => !c.isDestroyed && !isCompartmentSmoked(s, c.compId))
          relayTarget = living.length > 0 ? living[0].compId : enemyShip.shipId
        }
      } else if (relayedCmd.targeting.scope === 'own-ship' || relayedCmd.targeting.scope === 'own-compartment') {
        const pos = state.playerPositions[slotIndex]
        if (pos) {
          const ownShip = findShip(s, pos.shipId)
          if (ownShip) {
            const living = ownShip.compartments.filter(c => !c.isDestroyed)
            relayTarget = living.length > 0 ? living[0].compId : ownShip.shipId
          }
        }
      } else {
        relayTarget = targetCompId
      }

      if (!relayTarget) {
        logs.push({ message: '中继目标无效 — 未消耗资源', type: 'error' })
        return { newState: s, logs }
      }

      // 递归调用 handleCommand 来执行中继的目标命令
      const relayIntent: ClientIntent = {
        type: 'targetSelection',
        payload: {
          sourceCompId: tgtComp.compId,
          commandId: relayedCmd.id,
          targetCompId: relayTarget,
        },
      }
      const relayResult = handleCommand(s, room, slotIndex, relayIntent, rng)
      s = relayResult.newState
      logs.push({ message: `${playerName} 发令 → ${tgtEq.name}`, type: 'system' })
      logs.push(...relayResult.logs)
      s = useCommand(s, sourceCompId)
      break
    }
```

- [ ] **Step 2: Commit**

```bash
git add server/logic/handlers/commandHandler.ts
git commit -m "feat: logic layer — commandHandler (hangar, smoke, repair, depth charge, relay)"
```

---

### Task 13: 逻辑层 — intentRouter 入口

**Files:**
- Create: `server/logic/intentRouter.ts`

- [ ] **Step 1: Implement intentRouter**

```typescript
// server/logic/intentRouter.ts
import type { ServerRoom } from '../state.js'
import type { ClientIntent } from '../../shared/protocol.js'
import type { ServerCombatState } from '../data/CombatState.js'
import type { DiceRng } from './rules/dice.js'
import { handleSpawn } from './handlers/spawnHandler.js'
import { handleEndTurn } from './handlers/endTurnHandler.js'
import { handleFreeMove } from './handlers/freeMoveHandler.js'
import { handleFreeCommand } from './handlers/freeCommandHandler.js'
import { handleCommand } from './handlers/commandHandler.js'

export interface IntentResult {
  newState: ServerCombatState
  logs: { message: string; type: string }[]
  /** 回合切换信息 (endTurn / spawn完成) */
  turnChange?: { nextSlot: number; newRound: number }
  /** 战斗结束 */
  winner?: string
  /** 私密数据 (仅发送给操作者) */
  privatePayload?: any
}

export function handleIntent(
  state: ServerCombatState,
  room: ServerRoom,
  slotIndex: number,
  intent: ClientIntent,
  rng: DiceRng
): IntentResult {
  let s = state
  const allLogs: { message: string; type: string }[] = []

  switch (intent.type) {
    case 'spawn': {
      const result = handleSpawn(s, room, slotIndex, intent)
      s = result.newState
      allLogs.push(...result.logs)
      if (result.spawnComplete) {
        const turnOrder = room.lastBattleInit?.turnOrder || []
        const nextSlot = turnOrder[0] ?? 0
        return { newState: s, logs: allLogs, turnChange: { nextSlot, newRound: 1 } }
      }
      return { newState: s, logs: allLogs }
    }

    case 'endTurn': {
      const result = handleEndTurn(s, room, slotIndex, rng)
      return {
        newState: result.newState,
        logs: [...allLogs, ...result.logs],
        turnChange: { nextSlot: result.nextSlot, newRound: result.nextRound },
        winner: result.winner,
      }
    }

    case 'freeMove': {
      const result = handleFreeMove(s, room, slotIndex, intent)
      return { newState: result.newState, logs: [...allLogs, ...result.logs] }
    }

    case 'freeCommand': {
      const result = handleFreeCommand(s, room, slotIndex, intent)
      // 中继装备需要 targetSelection: relayTarget 被传递
      return { newState: result.newState, logs: [...allLogs, ...result.logs] }
    }

    case 'targetSelection': {
      const result = handleCommand(s, room, slotIndex, intent, rng)
      return {
        newState: result.newState,
        logs: [...allLogs, ...result.logs],
        winner: result.winner,
      }
    }

    default:
      return { newState: s, logs: [{ message: `未知意图: ${intent.type}`, type: 'error' }] }
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add server/logic/intentRouter.ts
git commit -m "feat: logic layer — intentRouter entry point"
```

---

### Task 14: 显示层 — IDisplayLayer + FullSnapshotDisplay

**Files:**
- Create: `server/display/types.ts`
- Create: `server/display/snapshotBuilder.ts`
- Create: `server/display/FullSnapshotDisplay.ts`

- [ ] **Step 1: Create display interface**

Write `server/display/types.ts`:

```typescript
// server/display/types.ts
import type { Server } from 'socket.io'
import type { ServerCombatState } from '../data/CombatState.js'
import type { ServerRoom } from '../state.js'

export interface IDisplayLayer {
  /** 操作完成后调用：全量推送战斗状态到所有客户端 */
  pushFullState(roomCode: string, combatState: ServerCombatState, room: ServerRoom): void

  /** 增量推送一条战斗日志 */
  pushLog(roomCode: string, log: { message: string; type: string }): void

  /** 批量推送日志 */
  pushLogs(roomCode: string, logs: { message: string; type: string }[]): void

  /** 私密推送：只发给特定 socket */
  pushPrivate(socketId: string, event: string, payload: any): void

  /** 事件推送（回合切换、战斗结束等） */
  pushEvent(roomCode: string, event: string, payload: any): void
}

export interface DisplayDeps {
  io: Server
}
```

- [ ] **Step 2: Create snapshot builder**

Write `server/display/snapshotBuilder.ts`:

```typescript
// server/display/snapshotBuilder.ts
import type { BattleStateSnapshot } from '../../shared/protocol.js'
import type { ServerCombatState } from '../data/CombatState.js'
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
    phase: room.state.phase === 'battle' ? 'battle' : 'spawn',
  }
}
```

- [ ] **Step 3: Create FullSnapshotDisplay**

Write `server/display/FullSnapshotDisplay.ts`:

```typescript
// server/display/FullSnapshotDisplay.ts
import type { IDisplayLayer, DisplayDeps } from './types.js'
import type { ServerCombatState } from '../data/CombatState.js'
import type { ServerRoom } from '../state.js'
import { buildSnapshot } from './snapshotBuilder.js'

export class FullSnapshotDisplay implements IDisplayLayer {
  private io: DisplayDeps['io']

  constructor(deps: DisplayDeps) {
    this.io = deps.io
  }

  pushFullState(roomCode: string, combatState: ServerCombatState, room: ServerRoom): void {
    const snapshot = buildSnapshot(combatState, room)
    this.io.to(roomCode).emit('battle:state', snapshot)
  }

  pushLog(roomCode: string, log: { message: string; type: string }): void {
    const entry = { ...log, timestamp: Date.now() }
    room.battleLog.push(entry)
    this.io.to(roomCode).emit('battle:log', entry)
  }

  pushLogs(roomCode: string, logs: { message: string; type: string }[]): void {
    for (const log of logs) {
      this.pushLog(roomCode, log)
    }
  }

  pushPrivate(socketId: string, event: string, payload: any): void {
    this.io.to(socketId).emit(event, payload)
  }

  pushEvent(roomCode: string, event: string, payload: any): void {
    this.io.to(roomCode).emit(event, payload)
  }
}
```

- [ ] **Step 4: Commit**

```bash
git add server/display/
git commit -m "feat: display layer — IDisplayLayer + FullSnapshotDisplay + snapshotBuilder"
```

---

### Task 15: 重构 server/index.ts — 使用三层架构

**Files:**
- Modify: `server/index.ts`
- Modify: `server/state.ts`

- [ ] **Step 1: Add winner field to ServerRoom**

In `server/state.ts`, add to `ServerRoom` interface:

```typescript
  winner: string | null
```

In `newRoom` function, add:
```typescript
    winner: null,
```

- [ ] **Step 2: Rewrite server/index.ts battle intent handler**

In `server/index.ts`:
1. Import new layers at top
2. Replace the `battle:action` handler with a `battle:intent` handler
3. Replace the `battle:spawn` handler to use logic layer
4. Replace the `battle:endTurn` handler to use logic layer

Add imports at top:
```typescript
import { handleIntent } from './logic/intentRouter.js'
import { createRng } from './logic/rules/dice.js'
import { FullSnapshotDisplay } from './display/FullSnapshotDisplay.js'
```

After `const socketSlotMap = ...`, create the display instance:
```typescript
const display = new FullSnapshotDisplay({ io })
```

Replace the `battle:spawn` handler body:
```typescript
socket.on('battle:spawn', ({ compartmentId, shipId }) => {
    const slot = getMySlot(socket.id)
    if (!slot) return
    const room = getRoom(slot.code)
    if (!room || room.state.phase !== 'battle') return
    if (!room.combatState) return

    const rng = createRng()
    const result = handleIntent(room.combatState, room, slot.slotIndex, {
      type: 'spawn',
      payload: { compartmentId, shipId },
    }, rng)

    room.combatState = result.newState

    // 显示层推送
    display.pushFullState(slot.code, room.combatState, room)
    display.pushLogs(slot.code, result.logs)

    if (result.turnChange) {
      room.currentTurnSlot = result.turnChange.nextSlot
      room.roundNumber = result.turnChange.newRound
      display.pushEvent(slot.code, 'battle:turn', {
        playerSlotIndex: result.turnChange.nextSlot,
        roundNumber: result.turnChange.newRound,
      })
    }
  })
```

Replace the `battle:endTurn` handler body:
```typescript
socket.on('battle:endTurn', () => {
    const slot = getMySlot(socket.id)
    if (!slot) return
    const room = getRoom(slot.code)
    if (!room || room.state.phase !== 'battle') return
    if (!room.combatState) return

    const rng = createRng()
    const result = handleIntent(room.combatState, room, slot.slotIndex, {
      type: 'endTurn',
      payload: {},
    }, rng)

    room.combatState = result.newState
    room.currentTurnSlot = result.turnChange?.nextSlot ?? room.currentTurnSlot
    room.roundNumber = result.turnChange?.newRound ?? room.roundNumber
    if (result.winner) room.winner = result.winner

    display.pushFullState(slot.code, room.combatState, room)
    display.pushLogs(slot.code, result.logs)
    display.pushEvent(slot.code, 'battle:turn', {
      playerSlotIndex: room.currentTurnSlot,
      roundNumber: room.roundNumber,
    })
    if (result.winner) {
      display.pushEvent(slot.code, 'battle:end', { winner: result.winner })
    }
  })
```

Add new `battle:intent` handler (replaces old `battle:action`):
```typescript
socket.on('battle:intent', (intent: ClientIntent) => {
    const slot = getMySlot(socket.id)
    if (!slot) return
    const room = getRoom(slot.code)
    if (!room || room.state.phase !== 'battle') return
    if (!room.combatState) return

    const rng = createRng()
    const result = handleIntent(room.combatState, room, slot.slotIndex, intent, rng)

    room.combatState = result.newState
    if (result.winner) room.winner = result.winner

    display.pushFullState(slot.code, room.combatState, room)
    display.pushLogs(slot.code, result.logs)

    if (result.winner) {
      display.pushEvent(slot.code, 'battle:end', { winner: result.winner })
    }
  })
```

- [ ] **Step 3: Remove old handlers**

Delete the old bodies for:
- `battle:spawn` (the inline logic, keep the handler wrapper from Step 2)
- `battle:endTurn` (the inline logic)
- `battle:action` (the old handler — replace entirely with `battle:intent`)

Remove the `getBattleStateSnapshot` helper at the bottom (moved to `snapshotBuilder.ts`).

- [ ] **Step 4: Commit**

```bash
git add server/index.ts server/state.ts
git commit -m "refactor: server/index.ts — use three-layer architecture"
```

---

### Task 16: Fix checkAllReady — validate designs exist (Bug #1)

**Files:**
- Modify: `server/index.ts`

- [ ] **Step 1: Add design validation in checkAllReady**

In the `checkAllReady` function, before setting `room.state.phase = 'battle'`, add:

```typescript
  // 验证每个队伍都有非空设计
  for (const tid of occArr) {
    const ds = room.designs.get(tid)
    if (!ds || ds.ships.length === 0) {
      console.log(`[checkAllReady] team ${tid} has no designs, aborting`)
      room.readyTeams.delete(tid)
      room.state.readyTeams = [...room.readyTeams]
      for (const s of room.state.slots) {
        if (s.teamId === tid) s.isReady = false
      }
      io.to(code).emit('room:state', room.state)
      // 通知该队伍设计无效
      for (const s of room.state.slots) {
        if (s.teamId === tid && s.socketId) {
          io.to(s.socketId).emit('error', { message: '设计未完成：请先设计舰船再准备' })
        }
      }
      return
    }
  }
```

- [ ] **Step 2: Commit**

```bash
git add server/index.ts
git commit -m "fix: checkAllReady validates designs exist (bug #1)"
```

---

### Task 17: 客户端 — MultiplayerClient 更新

**Files:**
- Modify: `src/modes/multiplayer/MultiplayerClient.ts`

- [ ] **Step 1: Add sendIntent and onBattleEnd**

In `MultiplayerClient`, add:

```typescript
  // 新增 — 发送意图
  sendIntent(intent: import('@shared/protocol').ClientIntent): void {
    this.socket?.emit('battle:intent', intent)
  }
```

Remove the `sendAction` method and `sendBattleLog` method.

Remove the `onBattleAction` listener method.

Add `onBattleEnd` listener:
```typescript
  onBattleEnd(cb: (d: { winner: string }) => void): () => void {
    return this.on('battle:end', cb)
  }
```

- [ ] **Step 2: Commit**

```bash
git add src/modes/multiplayer/MultiplayerClient.ts
git commit -m "refactor: MultiplayerClient — sendIntent replaces sendAction"
```

---

### Task 18: 客户端 — BattleView 简化 (去掉骰子/重放)

**Files:**
- Modify: `src/views/BattleView.vue`

- [ ] **Step 1: Remove dice / replay / pendingResults code**

Delete from `BattleView.vue`:
1. `pendingResults` array declaration and `flushPendingResults` function
2. `handleRemoteAction` function
3. `replayResults` function
4. `replayingRemote` variable
5. `markPreCommandLog` and `preCommandLogLen` variables
6. All `multiplayerClient.sendAction(...)` calls
7. All `multiplayerClient.sendBattleLog(...)` calls
8. All `pendingResults.push(...)` calls
9. The `onBattleAction` listener registration

- [ ] **Step 2: Replace all dice/random calls with intent sends in MP mode**

In all command execution functions, replace multiplayer sendAction calls with sendIntent. For example:

In `resolveMove`:
```typescript
// Replace:
// if (isMP.value) {
//   multiplayerClient.discardCards(uiStore.selectedCardIds)
//   pendingResults.push({ op: 'move', toCompIdx: targetComp.position })
// }

// With:
if (isMP.value) {
  multiplayerClient.discardCards(uiStore.selectedCardIds)
  multiplayerClient.sendIntent({
    type: 'freeMove',
    payload: { toCompId: compartmentId },
  })
}
```

In `executeTargetedCommand`, replace all local dice rolling with:
```typescript
if (isMP.value) {
  multiplayerClient.discardCards(uiStore.selectedCardIds)
  multiplayerClient.sendIntent({
    type: 'targetSelection',
    payload: { sourceCompId: comp.id, targetCompId: targetId, commandId: cmdId },
  })
  return  // Don't execute locally
}
```

- [ ] **Step 3: Keep combatStore.log and combatStore state operations disabled in MP mode**

When `isMP.value`, the local combatStore/log operations that would normally run during command execution should be skipped — they're called via `applyBattleStateSnapshot` instead.

- [ ] **Step 4: Add onBattleEnd listener**

```typescript
mpCleanups.push(multiplayerClient.onBattleEnd(({ winner }) => {
  combatStore.log(`战斗结束! 胜者: ${winner}`, 'system')
  router.push('/results')
}))
```

- [ ] **Step 5: Update applyBattleStateSnapshot to clear state first**

```typescript
function applyBattleStateSnapshot(s: BattleStateSnapshot): void {
  // Clear all combat state first
  combatStore.fighterTokens.length = 0
  combatStore.pendingTorpedoes.length = 0
  combatStore.activeEffects.length = 0
  // ...rest same as before...

  // Also restore turn info
  if (s.currentTurnSlot !== undefined) currentTurnSlot.value = s.currentTurnSlot
  if (s.roundNumber !== undefined) mpRoundNumber.value = s.roundNumber

  // Check win
  if (s.winner) {
    combatStore.log(`战斗结束! 胜者: ${s.winner}`, 'system')
    router.push('/results')
    return
  }

  // Check spawn phase
  if (s.phase === 'spawn') {
    const alreadySpawned = s.playerPositions[mySlotIndex.value]
    if (!alreadySpawned && isMyTurnToSpawn.value) {
      const myP = getPlayerBySlot(mySlotIndex.value)
      if (myP && !myP.currentShipId) {
        spawnPlayerName.value = myP.name
        showSpawnDialog.value = true
      }
    }
  }
}
```

- [ ] **Step 6: Remove redundant turn ticks from client handleEndTurn**

In the MP branch of `handleEndTurn`, remove the local `tickEffects()`, `tickFighterTurns()`, `resetPerTurnCounters()` calls — these are now done server-side.

- [ ] **Step 7: Commit**

```bash
git add src/views/BattleView.vue
git commit -m "refactor: BattleView — remove dice/replay, use sendIntent"
```

---

### Task 19: 客户端 — DesignView 简化

**Files:**
- Modify: `src/views/DesignView.vue`

- [ ] **Step 1: Simplify loadBattleAndGo**

```typescript
function loadBattleAndGo(payload: any): void {
  if (gameStore.phase === 'battle') return

  // Initialize ships
  for (const [teamId, designs] of Object.entries(payload.ships)) {
    if (shipStore.ships.filter(s => s.ownerTeamId === teamId).length === 0) {
      const shipDesigns = (designs as any[]).map(d => ({
        name: d.name,
        compartmentCount: d.compartments.length,
        slots: d.compartments
          .filter((c: any) => c.equipmentType != null)
          .map((c: any) => ({
            compartmentIndex: c.compartmentIndex,
            equipmentType: c.equipmentType!,
          })),
      }))
      shipStore.finalizeDesign('', teamId, shipDesigns as any, teamId)
    }
  }

  // Initialize teams and players if not done
  if (gameStore.players.length === 0) {
    gameStore.initTeams(payload.teams.map((t: any) => ({ id: t.id, name: t.name || t.id, color: t.color })))
    gameStore.initPlayers(payload.players.map((p: any) => ({ name: p.name, teamId: p.teamId })))
  }

  gameStore.startBattlePhase()
  router.push('/battle')
}
```

- [ ] **Step 2: Remove battleInitReceived guard**

Delete `battleInitReceived` variable and the `if (battleInitReceived) return` check. The `gameStore.phase === 'battle'` guard is sufficient.

- [ ] **Step 3: Commit**

```bash
git add src/views/DesignView.vue
git commit -m "refactor: DesignView — simplified battle:init handling"
```

---

### Task 20: 清理 dead code

**Files:**
- Modify: `server/combatLogic.ts`

- [ ] **Step 1: Strip combatLogic.ts to just the re-exported functions**

The file currently exports `applyCombatResults`, `tickEffectsState`, `tickTorpedoesState`, `tickFightersState`, `removeFightersByPlayerState`, `resetPerTurnState`. These are now in `server/data/CombatState.ts`.

Replace the entire file content with a deprecation re-export:

```typescript
// server/combatLogic.ts — DEPRECATED
// All functions moved to server/data/CombatState.ts and server/logic/
// This file kept temporarily for backward compat; will be removed in next cleanup.

// Re-export from data layer
export {
  applyDamage as applyCombatResults_legacy,
} from './data/CombatState.js'
```

Remove `applyCombatResults` export from `combatLogic.ts`.

- [ ] **Step 2: Verify no imports from combatLogic that break**

Run: `grep -r "combatLogic" server/`
Expected: Only `server/index.ts` should import from it, and we already stopped using those imports in Task 15.

If `server/index.ts` still imports from `combatLogic.ts`, remove those imports.

- [ ] **Step 3: Verify compile**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add server/combatLogic.ts
git commit -m "refactor: deprecate server/combatLogic.ts — moved to data layer"
```

---

### Task 21: 端到端验证

**Files:**
- No file changes. Verification only.

- [ ] **Step 1: Start server**

Run: `npm run dev:server`
Expected: "Server running on port 3001"

- [ ] **Step 2: Start client**

Run: `npm run dev`
Expected: Vite dev server starts on localhost:5173

- [ ] **Step 3: Manual test flow**

Open two browser windows:
1. Window A: Create room → note room code
2. Window B: Join room with room code
3. Both players join slots (different teams)
4. Host clicks "开始游戏"
5. Both players design ships → click "准备"
6. Verify: battle starts, both see spawn dialog
7. Both select spawn points
8. Verify: turn order works, player A draws cards, can move/command
9. Player A attacks → verify: damage appears on both windows
10. Player A ends turn → verify: turn switches to player B
11. Player B's turn → verify: can act
12. Kill all enemy ships → verify: battle end screen appears

- [ ] **Step 4: Test edge cases**

- Cancel ready → verify other player sees status update
- Refresh page during battle → verify reconnect restores state
- Player disconnects → verify game continues for remaining players

- [ ] **Step 5: Run all unit tests**

Run: `npm test`
Expected: All tests pass

- [ ] **Step 6: Commit any fixes found during verification**

---

## Bug Fixes Mapping

| # | Bug | Fixed In |
|---|-----|----------|
| 1 | checkAllReady doesn't validate designs | Task 16 |
| 2 | Cancel ready notification | Already correct (io.to(code) broadcast) |
| 3 | DesignView + BattleView dual init | Task 19 |
| 4 | Client-side dice rolling | Tasks 17, 18 |
| 5 | Card draw count not validated | Server now manages all draws (existing handlers) |
| 6 | Turn end doesn't check hand limit | Task 9 (endTurn handler) |
| 7 | Spawn doesn't validate compartment ownership | Task 8 |
| 8 | mpSpawnIdx not restored from server | Task 18 Step 5 |
| 9 | applyBattleStateSnapshot doesn't clear old | Task 18 Step 5 |
| 10 | replayingRemote flag inadequate | Task 18 (entire mechanism removed) |
| 11 | Dual state maintenance | Tasks 17, 18 (MP client is read-only) |
| 12 | ID inconsistency | Task 15 (uses deterministic IDs from buildCombatState) |
| 13 | Reconnect incomplete | Task 18 Step 5 (battle:request restores full state) |
