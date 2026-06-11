# 多人联机模式重构设计

> **目标：** 将多人联机模式从"客户端计算/服务端转发"重构为"完全服务器权威"的三层架构（数据层→逻辑层→显示层），修复所有已知流程断裂和状态不同步问题。

> **模式：** 完全服务器权威 — 服务端执行所有游戏逻辑（骰子、伤害、命中判定、token tick），客户端变成只读渲染终端，只发送意图不计算结果。

---

## 1. 整体架构

```
客户端 (Browser)                    服务端 (Node.js)
┌──────────────┐   intent ──────→  ┌──────────────────────────┐
│ BattleView   │                    │ index.ts (薄 Handler)     │
│ - 只渲染     │                    │  → 解析 socket 事件       │
│ - 只发送意图 │                    │  → 委托逻辑层             │
│ - 不掷骰子   │  ←─ snapshot ───  │  → 调用显示层推送         │
└──────────────┘   ←─ battle:log   └──────┬──────┬───────────┘
                                           │      │
                              委托          │      │ 全量读取
                              ┌────────────▼─┐  ┌─▼──────────┐
                              │ 逻辑层        │  │ 显示层      │
                              │ intent 处理   │  │ snapshot    │
                              │ 规则执行      │  │ builder     │
                              │ 骰子          │  │ log 广播    │
                              │ 权限检查      │  └────────────┘
                              └──────┬───────┘
                                     │ 读写
                              ┌──────▼───────┐
                              │ 数据层        │
                              │ 纯函数 mutation│
                              │ 无副作用/无IO │
                              └──────────────┘
```

### 层隔离规则

- **数据层不掷骰子**：骰子在逻辑层掷，数据层的 `applyDamage` 接收已计算好的伤害值
- **数据层不做权限检查**：权限在逻辑层验证后才调用数据层
- **逻辑层不碰 socket**：逻辑层返回 `IntentResult`，由 `index.ts` 调用显示层推送
- **显示层不碰规则**：只读数据层构建 snapshot，不做任何游戏逻辑判断

---

## 2. 数据层

**文件：`server/data/CombatState.ts`**

保持现有 `ServerCombatState` 类型不变（定义在 `server/combatState.ts`）。数据层是新文件，提供纯函数 mutation 和查询。

### 类型（复用现有）

```typescript
// server/combatState.ts — 保持不变
interface ServerCombatState {
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
```

### 纯函数签名

```
// ===== Mutation 函数 (每个返回新 state) =====

applyDamage(state, compId, damage) → { state, destroyed: boolean }
  // 对舱段施加伤害，血量归零时标记 isDestroyed=true
  // 不处理殉爆链 — 殉爆由逻辑层在得到 destroyed=true 后单独调用 handleDestruction

healCompartment(state, compId, amount) → state
  // 维修血量，不超过 maxHp（损管可超过上限？规则 0.2.1 说允许 — 调用方逻辑层处理此规则）

movePlayer(state, slotIndex, shipId, compIndex) → state
  // 玩家移动

addTorpedoSalvo(state, salvo) → state
tickTorpedoes(state) → { state, resolved[] }
  // -1 回合，移除过期的，返回已到期的

addFighterToken(state, token) → state
tickFighters(state) → state
removeFightersByPlayer(state, slotIndex) → state

addEffect(state, effect) → state
tickEffects(state) → state

setTorpedoLoaded(state, compId, loaded) → state
useCommand(state, compId) → state
useSortie(state, compId) → state
resetPerTurn(state) → state
markAmmoDepotUsed(state, compId) → state

handleDestruction(state, compId) → { state, logs }
  // 调用方传入已标记 isDestroyed 的舱段
  // 处理殉爆（弹药库→殉爆8、鱼雷装填→殉爆5）链式反应
  // 检查舰船沉没 → 船沉日志

// ===== 查询函数 =====

findCompartment(state, compId) → ServerCompartment | null
findShip(state, shipId) → ServerShip | null
findShipByComp(state, compId) → ServerShip | null
getAdjacentComps(state, compId, distance) → ServerCompartment[]
getAirSuperiority(state, shipId, teamId) → number
isCompartmentSmoked(state, compId) → boolean
isShipSunk(state, shipId) → boolean
isTeamDefeated(state, teamId) → boolean
```

### 原则

- 所有函数是同步纯函数，`(state, ...params) → { state, ...outputs }`
- 每次调用浅拷贝需要修改的对象路径（不可变模式的轻量版）
- 零副作用、零 IO
- 完全可单元测试，不依赖任何运行时环境

---

## 3. 逻辑层

### 客户端意图协议

在 `shared/protocol.ts` 新增：

```typescript
type IntentType =
  | 'spawn'            // 选择出生点
  | 'endTurn'          // 结束回合
  | 'playCard'         // 打出卡牌 { cardId }
  | 'freeMove'         // 自由行动：跑动 { fromCompId, toCompId }
  | 'freeCommand'      // 自由行动：指挥当前舱段
  | 'freePass'         // 自由行动：传递（暂不实现）
  | 'targetSelection'  // 确认目标 { sourceCompId, targetCompId / targetShipId, commandId }

interface ClientIntent {
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

### 逻辑层入口

**文件：`server/logic/intentRouter.ts`**

```typescript
interface IntentResult {
  newState: ServerCombatState
  logs: { message: string; type: string }[]
  winner?: string                    // 战斗结束时的获胜队伍
  privatePayload?: any               // 只发给操作者的数据（如手牌更新）
}

function handleIntent(
  state: ServerCombatState,
  room: ServerRoom,
  slotIndex: number,
  intent: ClientIntent,
  rng: DiceRng
): IntentResult
```

### 各 handler 的验证步骤（统一模式）

每个 handler 遵循相同的四步验证：

```
1. 权限检查
   - 当前 turn slot === 操作者 slot index（所有操作）
   - spawn 阶段: spawn order 当前槽位 === 操作者槽位（spawn 操作）
   - 自由行动未使用（freeMove/freeCommand/freePass）
   - 操作状态机阶段正确（draw/action 阶段不可混用）

2. 规则验证
   - 目标合法：ship 存在、comp 存在、不是烟雾中
   - 距离合法：移动不超过最大步数、武器射程满足
   - 资源充足：指挥次数未用尽、sortie 次数未用尽、有足够手牌
   - scope 匹配：enemy-compartment / own-ship 等

3. 逻辑执行
   - 查装备注册表得到判定规则
   - 掷骰子（D4/D6/D8/D10/D12）
   - 运用加成（火控计算机±1、加力引擎修改判定表、空优修正）
   - 调用数据层纯函数应用结果
   - 构建人类可读的日志字符串

4. 副作用检查
   - 舱段击毁 → handleDestruction（殉爆链）
   - 舰船沉没 → 船上玩家淘汰
   - 队伍覆灭 → 检查胜利条件
```

### 骰子封装

**文件：`server/logic/dice.ts`**

```typescript
type DiceRng = (sides: number) => number  // 1~sides

function createRng(): DiceRng {
  return (sides) => Math.floor(Math.random() * sides) + 1
}

function rollMultiple(rng: DiceRng, sides: number, count: number): number[] {
  return Array.from({ length: count }, () => rng(sides))
}
```

### 逻辑层目录结构

```
server/logic/
  intentRouter.ts          # 入口，路由到具体 handler
  handlers/
    spawnHandler.ts        # 出生点选择
    endTurnHandler.ts      # 回合结束（tick effects/torps/fighters）
    playCardHandler.ts     # 打出卡牌（移动/指挥/行动/咖啡/谋划）
    freeMoveHandler.ts     # 跑动
    freeCommandHandler.ts  # 自由指挥
    commandHandler.ts      # 指挥命令的目标选择与执行
  rules/
    dice.ts                # 骰子工具
    hitResolution.ts       # 命中判定（D8表、加力引擎修改表）
    damageRoll.ts          # 伤害骰（2D6/3D6/1D10等）
    airSuperiority.ts      # 空优计算
    equipmentRules.ts      # 装备行为查询（从 registry 读取）
```

### 与现有代码的关系

- `server/combatLogic.ts` 中现有的 `applyCombatResults` 函数拆解到数据层和逻辑层
- `tickEffectsState`/`tickTorpedoesState`/`tickFightersState`/`removeFightersByPlayerState`/`resetPerTurnState` 移到数据层作为纯函数
- `applyDestruction` 移到数据层作为 `handleDestruction`

---

## 4. 显示层

### 抽象接口（预留下增量升级通道）

**文件：`server/display/types.ts`**

```typescript
interface IDisplayLayer {
  /** 操作完成后调用：当前实现为全量推送所有客户端 */
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
```

### 当前实现：FullSnapshotDisplay

**文件：`server/display/FullSnapshotDisplay.ts`**

```typescript
class FullSnapshotDisplay implements IDisplayLayer {
  constructor(private io: Server) {}

  pushFullState(roomCode, combatState, room) {
    this.io.to(roomCode).emit('battle:state', buildSnapshot(combatState, room))
  }

  pushLog(roomCode, log) {
    const entry = { ...log, timestamp: Date.now() }
    // room.battleLog 也在此维护（显示层负责日志存储）
    this.io.to(roomCode).emit('battle:log', entry)
  }

  pushLogs(roomCode, logs) {
    for (const log of logs) this.pushLog(roomCode, log)
  }

  pushPrivate(socketId, event, payload) {
    this.io.to(socketId).emit(event, payload)
  }

  pushEvent(roomCode, event, payload) {
    this.io.to(roomCode).emit(event, payload)
  }
}
```

### 未来升级：DeltaDisplay

切换为增量模式时，只需实现新的 `IDisplayLayer`，替换注入即可：

```typescript
// server/display/DeltaDisplay.ts (未来)
class DeltaDisplay implements IDisplayLayer {
  private lastSnapshots = new Map<string, BattleStateSnapshot>()

  pushFullState(roomCode, combatState, room) {
    const prev = this.lastSnapshots.get(roomCode)
    const current = buildSnapshot(combatState, room)
    const delta = diffSnapshot(prev, current)
    this.lastSnapshots.set(roomCode, current)
    if (delta.nonEmpty) {
      this.io.to(roomCode).emit('battle:delta', delta)
    }
  }
  // pushLog/pushLogs/pushPrivate/pushEvent 不变
}
```

数据层和逻辑层完全不需要修改。diff 计算完全在显示层完成。

### Snapshot 构建

`buildSnapshot(combatState, room) → BattleStateSnapshot` 是纯数据转换，零逻辑判断。现有 `BattleStateSnapshot` 类型（`shared/protocol.ts`）基本不变，新增 `winner` 字段。

### 推送矩阵

| 内容 | 方式 | 接收者 |
|------|------|--------|
| 舱段血量/token/效果/位置 | `battle:state` 全量快照 | 所有客户端 |
| 战斗日志 | `battle:log` 增量 | 所有客户端 |
| 手牌更新 | `card:drawn` 私密 | 操作者 |
| 回合切换 | `battle:turn` | 所有客户端 |
| 战斗结束 | `battle:end` | 所有客户端 |

---

## 5. 客户端改造

### 改造原则

- **热座模式：** Store 行为完全不变，本地全权计算
- **多人模式：** Store 变成服务端状态的只读镜像，所有修改由 `battle:state` snapshot 驱动
- **两种模式共用同一套 Vue 组件**

### MultiplayerClient 改动

**文件：`src/modes/multiplayer/MultiplayerClient.ts`**

```typescript
// 新增 — 替代 sendAction
sendIntent(intent: ClientIntent): void {
  this.socket?.emit('battle:intent', intent)
}

// 保留 — 卡牌操作仍由服务端管理
drawCards(count: number): void { ... }
discardCards(cardIds: string[]): void { ... }
discardDownTo(maxCards: number): void { ... }
sendSchemeCard(cardId: string): void { ... }

// 去掉 — 不再需要
// sendAction(action: BattleAction): void — 删除
// sendBattleLog(...) — 删除（日志由服务端推送）
```

### BattleView.vue 改动

**删除的代码：**

1. `pendingResults` 数组、`flushPendingResults()` 函数
2. `handleRemoteAction()` 函数、`replayResults()` 函数
3. `replayingRemote` 标志
4. `markPreCommandLog` / `preCommandLogLen` / `flushPendingResults` 的所有使用
5. 所有 `multiplayerClient.sendAction(...)` 调用
6. 所有 `multiplayerClient.sendBattleLog(...)` 调用

**新增/修改的代码：**

1. `sendIntent(intent: ClientIntent)` — 从 UI 操作参数构建 ClientIntent 并发送
2. `applyBattleStateSnapshot()` 增强：
   - 同时恢复 `currentTurnSlot`、`roundNumber`、`winner`
   - 服务器标记 winner 时 → `router.push('/results')`
3. `mpCanAct()` 保持不变

**事件监听器改为一进一出：**

| 之前（多条通道更新状态） | 之后（单一通道） |
|---|---|
| `onBattleAction` → handleRemoteAction + replayResults | **删除** |
| `onBattleState` → applyBattleStateSnapshot | **保留并增强**（唯一数据同步通道） |
| `onBattleLog` → combatStore.log | **保留** |
| `onBattleTurn` → 切换回合 | **保留并增强** |
| `onCardDrawn` → 更新手牌 | **保留** |

### onBattleState 行为

```
收到 battle:state →
  1. applyBattleStateSnapshot (舰船血量/token/效果/位置/回合信息)
  2. 如果 snapshot.winner → router.push('/results')
  3. 如果 snapshot.phase === 'spawn' 且轮到我选出生 → 显示出生对话框
```

### onBattleTurn 行为

```
收到 battle:turn →
  1. 更新 currentTurnSlot
  2. 移除该 slotIndex 的战斗机（上一轮派出的）
  3. 如果是我的回合: resetPerTurnCounters + startDrawPhase
  4. 如果不是我的回合: 等待
```

### DesignView.vue 改动

1. 去掉 `loadBattleAndGo` 函数中的牌堆初始化逻辑（服务端统一管理）
2. `onBattleInit` 监听器中：设置 phase + push router，只做路由跳转，不初始化牌堆
3. 去掉重复的 `battleInitReceived` 防护 — 改为由 BattleView 的 `onMounted` 中 `battle:request` 统一处理

### Shared Protocol 更新

**文件：`shared/protocol.ts`**

```typescript
// 新增 ClientIntent 类型（见第3节）

// BattleStateSnapshot 新增字段
interface BattleStateSnapshot {
  // ... 现有字段保持不变
  winner?: string | null         // 新增
  phase?: 'spawn' | 'battle'    // 新增：当前房间阶段
}
```

### CombatStore 保留但限制写入

- `combatStore.log()` — 唯一允许客户端在多人模式下写入的方法
  - 日志来源：`battle:log` 事件 + 本地 UI 提示
- 其他所有 store mutation（`applyDamage`, `addEffect` 等）在多人模式下仅由 `applyBattleStateSnapshot` 调用

---

## 6. 流程修复清单

以下是从诊断中确认的 bug，在设计中被修复：

| # | Bug | 修复方式 |
|---|-----|----------|
| 1 | `checkAllReady` 不验证设计是否存在 | 在 `checkAllReady` 中确保每队都在 `room.designs` 中有非空设计 |
| 2 | 取消准备不通知所有客户端 | `design:cancel` 广播 `room:state` 给全房间，已在现有代码中做（通过 `io.to(code).emit('room:state')`）；确认此路径正常 |
| 3 | DesignView 和 BattleView 双重初始化 | DesignView 只做路由跳转，BattleView 的 `onMounted` 统一通过 `battle:request` 获取状态 |
| 4 | 客户端计算伤害 | 改为完全服务器权威，客户端只发意图 |
| 5 | 卡片抽牌数量不验证 | 服务端根据舱段 drawValue 验证和计数 |
| 6 | 回合结束不检查手牌上限 | 服务端在 endTurn handler 中强制调用 discardDownTo |
| 7 | 出生点不验证归属 | spawn handler 验证舱段属于当前玩家的队伍 |
| 8 | mpSpawnIdx 不从服务器恢复 | 从 `battle:state` snapshot 恢复 `phase` 和 `spawnOrder` 当前位置 |
| 9 | applyBattleStateSnapshot 旧状态未清除 | 覆盖前先完整清空所有战斗状态数组和 map |
| 10 | replayingRemote 标志不彻底 | 删除远程操作重放机制，统一走 snapshot 覆盖 |
| 11 | 双份状态维护 | 多人模式客户端不再本地计算，纯镜像 |
| 12 | ID 不一致 | 统一使用确定性 ID（`teamId_sN_comp_N`）用于多人模式 |
| 13 | 断线重连不完整 | `battle:request` 返回完整 state + phase，客户端根据 phase 恢复 UI 状态 |

---

## 7. 测试策略

### 数据层单测

数据层纯函数可以完全在 Node.js 环境单元测试，无需 socket：

- 每个 mutation 函数：验证输入→输出正确性
- `handleDestruction`：验证殉爆链式反应（弹药库→相邻击毁→再次殉爆）
- 边界情况：血量≤0、已是击毁状态、空舱段、多舱段装备从属舱段被击毁

### 逻辑层单测

用 mock 的 `DiceRng`（返回固定值）验证：

- 命中判定表（D8 各值对应的命中位置）
- 加力引擎修改判定
- 空优修正
- 权限拒绝（非自己回合、无效目标、资源耗尽）

### 集成测试

启动服务端，模拟两个 socket 客户端：

- 完整流程：创建房间→加入→选择槽位→设计→准备→选出生→战斗→回合切换
- 取消准备通知
- 断线重连恢复
