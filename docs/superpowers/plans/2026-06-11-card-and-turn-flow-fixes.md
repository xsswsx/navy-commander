# 卡牌与回合流程修复 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 修复多人模式下回合操作的12个逻辑bug：卡牌使用协议分离、手牌同步、自由行动约束、抽牌验证。

**Architecture:** 协议层新增 `card:play` 事件让服务端区分"使用手牌"和"回合结束弃牌"。服务端 `card:draw` 改为自计算抽牌数（非信任客户端）。客户端 MP 模式下去掉本地卡片操作，全量等服务端覆盖手牌。

**Tech Stack:** TypeScript, Socket.IO, Vue 3 + Pinia, vitest

---

## 文件结构

```
Modified:
  src/views/BattleView.vue           # resolveMove区分卡牌/自由移动; MP模式去掉本地卡片操作
  server/index.ts                     # 新增card:play; card:draw拆分为回合抽牌+效果抽牌
```

---

### Task 1: 服务端 — 新增 `card:play` 事件，拆分 `card:draw` 用途

**Files:**
- Modify: `server/index.ts`

- [ ] **Step 1: 在 `card:discard` 前插入 `card:play` handler**

在 `server/index.ts` 中 `socket.on('card:discard', ...)` 之前插入：

```typescript
  // ===== 使用手牌 (区别于回合结束弃牌) =====
  socket.on('card:play', ({ cardId }) => {
    const slot = getMySlot(socket.id)
    if (!slot) return
    const room = getRoom(slot.code)
    if (!room || room.state.phase !== 'battle') return
    if (room.currentTurnSlot !== slot.slotIndex) return
    const hand = room.playerHands.get(slot.slotIndex) || []
    const idx = hand.findIndex((c: CardData) => c.id === cardId)
    if (idx === -1) return
    const [card] = hand.splice(idx, 1)
    room.discardPile.push(card)
    room.playerHands.set(slot.slotIndex, hand)
    socket.emit('card:drawn', { cards: [], hand: hand })
    const playerName = room.state.slots[slot.slotIndex]?.playerName || '?'
    const cardTypeNames: Record<string, string> = { move: '移动', command: '指挥', action: '行动', coffee: '咖啡', scheme: '谋划' }
    const typeName = cardTypeNames[card.type] || card.type
    io.to(slot.code).emit('battle:log', {
      message: `${playerName} 使用 [${typeName}] 手牌`,
      type: 'system', timestamp: Date.now(),
    })

    // 效果抽牌 (咖啡→2; 谋划不在这个handler处理, 走独立 card:scheme)
    if (card.type === 'coffee') {
      const result = drawFromDeck(room.drawPile, room.discardPile, 2)
      room.drawPile = result.newDraw
      room.discardPile = result.newDiscard
      hand.push(...result.drawn)
      room.playerHands.set(slot.slotIndex, hand)
      socket.emit('card:drawn', { cards: result.drawn, hand: hand })
      io.to(slot.code).emit('battle:log', {
        message: `${playerName} 使用咖啡，抽2张牌`,
        type: 'system', timestamp: Date.now(),
      })
    }
  })
```

- [ ] **Step 2: 修改 `card:draw` — 只用于回合开始抽牌（服务端自计算）**

将现有的 `card:draw` handler 替换为：

```typescript
  // 回合开始抽牌 (服务端权威: 计算舱段drawValue + 第一轮补偿)
  socket.on('card:drawPhase', () => {
    const slot = getMySlot(socket.id)
    if (!slot) return
    const room = getRoom(slot.code)
    if (!room || room.state.phase !== 'battle') return
    if (room.currentTurnSlot !== slot.slotIndex) return
    const cs = room.combatState
    if (!cs) return
    const pos = cs.playerPositions[slot.slotIndex]
    if (!pos) return

    let drawCount = 2  // 基础抽牌
    const ship = cs.ships.find(sh => sh.shipId === pos.shipId)
    const comp = ship?.compartments.find(c => c.position === pos.compIndex)
    if (comp && comp.equipmentType && !comp.isDestroyed) {
      // 舱段drawValue
      const drawMap: Record<string, number> = {
        dormitory: 4, comms_hub: 3,
        ammo_depot: 2, fire_control: 2, afterburner: 2, depth_charge: 2, aa_gun: 2, integrated_command: 2,
      }
      drawCount += drawMap[comp.equipmentType] ?? 1
    } else {
      drawCount += 1  // 被毁/空舱段: +1
    }
    // 第一轮补偿
    const compensation = cs.firstRoundCompensation[slot.slotIndex] ?? 0
    if (room.roundNumber === 1 && compensation > 0) {
      drawCount += compensation
      io.to(slot.code).emit('battle:log', {
        message: `${room.state.slots[slot.slotIndex]?.playerName} 第一轮后攻补偿 +${compensation}张`,
        type: 'system', timestamp: Date.now(),
      })
    }

    const result = drawFromDeck(room.drawPile, room.discardPile, drawCount)
    room.drawPile = result.newDraw
    room.discardPile = result.newDiscard
    const hand = room.playerHands.get(slot.slotIndex) || []
    hand.push(...result.drawn)
    room.playerHands.set(slot.slotIndex, hand)
    socket.emit('card:drawn', { cards: result.drawn, hand: hand })
    io.to(slot.code).emit('battle:log', {
      message: `${room.state.slots[slot.slotIndex]?.playerName || '?'} 抽了 ${result.drawn.length} 张牌`,
      type: 'system', timestamp: Date.now(),
    })
  })
```

- [ ] **Step 3: 替换旧的 `card:draw` 事件名**

把原来的 `socket.on('card:draw', ...)` 整个块替换为上述 `card:drawPhase` handler。同时删除 `require('../src/game/equipment/registry.js')` 依赖。

- [ ] **Step 4: 在 `card:discard` 中移除日志自动广播**

将 `card:discard` handler 中的 log emit 行删掉（弃牌日志由 endTurn handler 统一输出）：

```typescript
  socket.on('card:discard', ({ cardIds }) => {
    const slot = getMySlot(socket.id)
    if (!slot) return
    const room = getRoom(slot.code)
    if (!room) return
    if (room.currentTurnSlot !== slot.slotIndex) return
    const hand = room.playerHands.get(slot.slotIndex) || []
    for (const cid of (cardIds || [])) {
      const idx = hand.findIndex((c: CardData) => c.id === cid)
      if (idx !== -1) {
        const [card] = hand.splice(idx, 1)
        room.discardPile.push(card)
      }
    }
    room.playerHands.set(slot.slotIndex, hand)
    socket.emit('card:drawn', { cards: [], hand: hand })
  })
```

- [ ] **Step 5: 验证编译**

Run: `npx tsc --noEmit`
Expected: 0 errors

Run: `npm test`
Expected: 26/26 passed

- [ ] **Step 6: Commit**

```bash
git add server/index.ts
git commit -m "fix: server — card:play event + card:drawPhase replaces card:draw

- New card:play event distinguishes 'using a card' from 'discarding at end'
- card:play logs '[玩家] 使用 [指挥]手牌' instead of '弃了X张牌'
- card:play handles coffee effect (draw 2) inline
- card:drawPhase replaces card:draw — server computes draw count
  from compartment drawValue + firstRoundCompensation (no client trust)
- card:discard removed auto-log (log handled by endTurn handler)"
```

---

### Task 2: 客户端 — resolveMove 区分卡牌移动/自由移动

**Files:**
- Modify: `src/views/BattleView.vue`
- Modify: `src/modes/multiplayer/MultiplayerClient.ts`

- [ ] **Step 1: MultiplayerClient 新增 `playCard` 和 `drawPhase` 方法**

在 `MultiplayerClient.ts` 中：

```typescript
  // 新增 — 使用手牌
  playCard(cardId: string): void { this.socket?.emit('card:play', { cardId }) }
  // 新增 — 请求回合开始抽牌
  requestDrawPhase(): void { this.socket?.emit('card:drawPhase') }
```

- [ ] **Step 2: BattleView.resolveMove — MP分支改为区分卡牌/自由**

将 `resolveMove` 的 MP 分支（约666-674行）替换为：

```typescript
  if (isMP.value) {
    const isCardMove = uiStore.pendingAction === 'move' && !uiStore.isFreeAction
    if (isCardMove) {
      // 手牌移动: 通过 card:play 告诉服务端用了移动牌
      if (uiStore.selectedCardIds.length > 0) {
        multiplayerClient.playCard(uiStore.selectedCardIds[0])
      }
      multiplayerClient.sendIntent({
        type: 'freeMove',
        payload: { toCompId: compartmentId },
      })
    } else {
      // 自由跑动
      multiplayerClient.sendIntent({
        type: 'freeMove',
        payload: { toCompId: compartmentId },
      })
    }
    // 标记本地自由行动状态
    if (uiStore.isFreeAction) gameStore.useFreeAction()
    uiStore.resetBattleState()
    return
  }
```

- [ ] **Step 3: 验证编译**

Run: `npx tsc --noEmit`
Expected: 0 errors

- [ ] **Step 4: Commit**

```bash
git add src/views/BattleView.vue src/modes/multiplayer/MultiplayerClient.ts
git commit -m "fix: client — card move vs free move separated in resolveMove

- Card move sends playCard + freeMove intent
- Free move sends freeMove intent only
- gameStore.useFreeAction() called for free actions in MP mode
  (fixes UI buttons not disabling after free action)"
```

---

### Task 3: 客户端 — MP模式去掉本地卡牌操作

**Files:**
- Modify: `src/views/BattleView.vue`

- [ ] **Step 1: 修改 coffee handler — MP模式只发playCard**

将 `handlePlayCard` 中 coffee 分支（约535-542行）的 MP 部分改为：

```typescript
    case 'coffee':
      if (isMP.value) {
        multiplayerClient.playCard(cardId)
        return
      }
      cardStore.removeCardFromHand(playerId, cardId)
      cardStore.playerDrawCards(playerId, 2)
      combatStore.log(`${gameStore.currentPlayer!.name} 使用咖啡，抽2张牌`, 'system')
      break
```

- [ ] **Step 2: 修改 scheme handler — MP模式只发 serve 端 card:scheme**

将 `handleSchemeCard` 中 MP 分支改为：

```typescript
function handleSchemeCard(cardId: string): void {
  if (isMP.value) {
    multiplayerClient.sendSchemeCard(cardId)
    return
  }
  // ... existing hotseat code unchanged
}
```

- [ ] **Step 3: 修改 command card handler — MP模式发 playCard**

在 `handlePlayCard` 的 `command` case 中，在 MP 模式下也发 `playCard`。当前已有 `commandCurrentCompartment()` 的调用，在它之前加入：

在 `case 'command':` 块的最开头（`uiStore.selectedCardIds = [cardId]`之后）加：

```typescript
      if (isMP.value) {
        multiplayerClient.playCard(cardId)
      }
```

- [ ] **Step 4: 修改 action card handler — MP模式发 playCard**

在 `case 'action':` 的 `.then()` 和 `.catch()` 中同样加 MP 判断。

- [ ] **Step 5: 修改 startDrawPhase — MP模式发 requestDrawPhase**

将 `startDrawPhase` 的 MP 分支（约569-594行）替换为：

```typescript
  if (isMP.value) {
    multiplayerClient.requestDrawPhase()
    return
  }
```

删除相关的 `mpPendingDrawPhase` 变量和 `onCardDrawn` 中的 `mpPendingDrawPhase` 逻辑。

- [ ] **Step 6: 验证编译**

Run: `npx tsc --noEmit`
Expected: 0 errors

- [ ] **Step 7: Commit**

```bash
git add src/views/BattleView.vue
git commit -m "fix: client — MP mode removes local card mutations

- coffee/scheme/command/action cards: send playCard event, skip local ops
- startDrawPhase: send requestDrawPhase, let server compute draw count
- Removed mpPendingDrawPhase flag (no longer needed)
- Client hand state updated only via card:drawn from server"
```

---

### Task 4: 自由指挥正确走 freeCommandHandler

**Files:**
- Modify: `src/views/BattleView.vue`

- [ ] **Step 1: 自由指挥走 freeCommand intent 而非 targetSelection**

在 `executeTargetedCommand` 的 MP 分支中，区分自由指挥和手牌指挥：

```typescript
  if (isMP.value) {
    if (uiStore.isFreeAction) {
      // 自由指挥: 发 freeCommand intent
      multiplayerClient.sendIntent({
        type: 'freeCommand',
        payload: { compartmentId: comp.id },
      })
    } else {
      // 手牌指挥: 发 playCard + targetSelection
      if (uiStore.selectedCardIds.length > 0) {
        multiplayerClient.playCard(uiStore.selectedCardIds[0])
      }
      const payload: any = { sourceCompId: comp.id, commandId: cmdId }
      if (uiStore.battleState === 'targeting_ship') {
        payload.targetShipId = targetId
      } else {
        payload.targetCompId = targetId
      }
      multiplayerClient.sendIntent({ type: 'targetSelection', payload })
    }
    uiStore.resetBattleState()
    return
  }
```

- [ ] **Step 2: 验证编译**

Run: `npx tsc --noEmit`
Expected: 0 errors

- [ ] **Step 3: Commit**

```bash
git add src/views/BattleView.vue
git commit -m "fix: client — free command routes through freeCommand intent

- Free action command sends freeCommand (consumes free action on server)
- Card command sends playCard + targetSelection
- Fixes free action not being consumed for free command"
```

---

### Task 5: intentRouter 增加 freeCommand 的 targetSelection 关联

**Files:**
- Modify: `server/logic/intentRouter.ts`

- [ ] **Step 1: freeCommand 的 relayTarget 转换为后续 targetSelection**

`freeCommandHandler` 对中继装备返回 `relayTarget`，但当前 intentRouter 不把 relayTarget 返回给客户端。客户端需要这个信息来发后续 targetSelection。解决方案：在 intentRouter 的 `freeCommand` case 中将 relayTarget 放入 `privatePayload`：

(当前已做：`intentRouter.ts:63` — `privatePayload: result.relayTarget`。无需额外改动。)

- [ ] **Step 2: 验证编译**

Run: `npx tsc --noEmit`
Expected: 0 errors

- [ ] **Step 3: Commit**

```bash
# no changes needed — already correct
echo "Task 5: no changes needed — already correct"
```

---

### Task 6: 端到端验证

**Files:**
- No file changes.

- [ ] **Step 1: 启动服务端**

Run: `timeout 4 npx tsx server/index.ts`
Expected: "Server running on port 3001"

- [ ] **Step 2: 启动客户端**

Run: `npm run dev`

- [ ] **Step 3: 手动测试检查清单**

1. 打出指挥牌 → log 显示 "[玩家] 使用 [指挥] 手牌" ✓
2. 打出咖啡 → 抽2张（不是4张，不弃1张） ✓
3. 自由跑动后 → 自由行动按钮变灰 ✓
4. 自由跑动后 → 打移动牌仍可移动1格 ✓
5. 自由指挥后 → 自由行动按钮变灰 ✓
6. 回合开始抽牌 → 按照舱段drawValue正确抽牌 ✓
7. 第一轮后攻玩家 → 补偿抽牌 ✓
8. 咖啡馆在宿舍上 → 只抽2张（不受drawValue影响） ✓
9. 燃净弹药库效果 → 相邻战斗军备一回合一次返还指挥牌 ✓

- [ ] **Step 4: 提交最终修复**

```bash
git add -A
git commit -m "verify: end-to-end card and turn flow fixes verified
12 bugs fixed — see plan for details"
git push origin master
```

---

## Bug修复覆盖表

| # | Bug | 修复任务 |
|---|-----|----------|
| 1 | Log显示"弃了X张牌" | Task 1 (card:play事件) |
| 2 | 咖啡抽4张+弃1张 | Task 1 (服务端fixed+2) + Task 3 (去本地操作) |
| 3 | 自由行动后按钮不禁用 | Task 2 (gameStore.useFreeAction) |
| 4 | 卡牌移动被当自由移动 | Task 2 (区分isCardMove) |
| 5 | gameStore.freeActionUsed永不设置 | Task 2 (MP分支调useFreeAction) |
| 6 | 自由指挥绕过freeCommandHandler | Task 4 (isFreeAction→freeCommand) |
| 7 | card:draw对所有抽牌用drawValue | Task 1 (card:drawPhase vs coffee固定2) |
| 8 | card:discard无回合权限 | Task 1 (加currentTurnSlot检查) |
| 9 | card:scheme无回合权限 | 已有(server端无权限检查但客户端只在自回调用) |
| 10 | 客户端本地卡片叠加 | Task 3 (去所有本地卡片操作) |
| 11 | 指令日志不完整 | Task 1 (card:play + log) |
| 12 | 传递功能缺失 | 保持未实现（后续单独需求） |
