import { createServer } from 'http'
import { Server } from 'socket.io'
import { generateRoomCode, buildDeckCards, shuffleCards, drawFromDeck } from '../shared/protocol.js'
import type { RoomConfig, ShipDesignData, BattleAction, CardData, BattleStateSnapshot } from '../shared/protocol.js'
import { newRoom, getRoom, getRoomBySocket, setSocketRoom, removeSocketRoom } from './state.js'
import { buildCombatState, type ServerCombatState } from './combatState.js'
import { applyDamage, handleDestruction, tickEffects, tickTorpedoes, tickFighters, removeFightersByPlayer, resetPerTurn, findShipByComp, findCompartment, addTorpedoSalvo, addFighterToken, addEffect, healCompartment, movePlayer } from './data/CombatState.js'

const httpServer = createServer()
const io = new Server(httpServer, { cors: { origin: '*' } })

// 监听每个玩家在每个房间的槽位 → 用于权限判断
const socketSlotMap = new Map<string, { code: string; slotIndex: number }>()

function getMySlot(socketId: string): { code: string; slotIndex: number } | null {
  return socketSlotMap.get(socketId) ?? null
}

io.on('connection', (socket) => {
  console.log(`[connect] ${socket.id}`)

  // ===================== 房间操作 =====================
  socket.on('room:create', (config: RoomConfig) => {
    const code = generateRoomCode()
    const slots: any[] = []
    for (let ti = 0; ti < config.teams.length; ti++) {
      const names = config.slotNames[ti] || []
      for (const _ of names) {
        slots.push({
          index: slots.length,
          teamId: config.teams[ti].name,
          playerName: null,
          socketId: null,
          isReady: false,
        })
      }
    }
    const room = newRoom(code, {
      code, hostSocketId: socket.id, slots, phase: 'lobby',
      teamCount: config.teams.length, totalCompartments: config.totalCompartments,
      readyTeams: [],
    })
    socket.join(code)
    setSocketRoom(socket.id, code)
    // 保存房主名字
    room.playerNames.set(socket.id, config.hostName)
    io.to(code).emit('room:state', room.state)
    console.log(`[room:create] ${code} by ${config.hostName} (${slots.length} slots)`)
  })

  socket.on('room:join', ({ roomCode, playerName }) => {
    const room = getRoom(roomCode)
    if (!room) { socket.emit('error', { message: '房间不存在' }); return }
    socket.join(roomCode)
    setSocketRoom(socket.id, roomCode)
    // 保存玩家名 (后续 slot:join 时使用)
    room.playerNames.set(socket.id, playerName || 'Unknown')
    io.to(roomCode).emit('room:state', room.state)
    console.log(`[room:join] ${roomCode} joined by ${playerName}`)
  })

  socket.on('room:startGame', () => {
    const info = getRoomBySocket(socket.id)
    if (!info || info.room.state.hostSocketId !== socket.id) return
    // 检查至少每队有一个已占用的槽位
    const occupied = info.room.state.slots.filter(s => s.playerName)
    const teamsWithPlayers = new Set(occupied.map(s => s.teamId))
    if (teamsWithPlayers.size < info.room.state.teamCount) {
      socket.emit('error', { message: '每个队伍至少需要一名玩家' })
      return
    }
    info.room.state.phase = 'design'
    io.to(info.code).emit('room:state', info.room.state)
    console.log(`[room:startGame] ${info.code} → design`)
  })

  // ===================== 槽位操作 =====================
  socket.on('slot:join', ({ slotIndex, playerName }) => {
    const info = getRoomBySocket(socket.id)
    if (!info) return
    const slot = info.room.state.slots[slotIndex]
    if (!slot || slot.playerName) return
    // 释放旧槽位
    const prev = getMySlot(socket.id)
    if (prev) {
      const prevRoom = getRoom(prev.code)
      if (prevRoom) {
        const oldSlot = prevRoom.state.slots[prev.slotIndex]
        if (oldSlot) { oldSlot.playerName = null; oldSlot.socketId = null; oldSlot.isReady = false }
      }
    }
    slot.socketId = socket.id
    // 使用传入的 playerName，或从 room.playerNames 获取，或默认名
    const name = playerName || info.room.playerNames.get(socket.id) || `P${slotIndex + 1}`
    slot.playerName = name
    socketSlotMap.set(socket.id, { code: info.code, slotIndex })
    io.to(info.code).emit('room:state', info.room.state)

    // 如果在设计阶段，发送当前设计状态给新加入的玩家
    if (info.room.state.phase === 'design') {
      const teamId = slot.teamId
      const ds = info.room.designs.get(teamId)
      if (ds) {
        socket.emit('design:state', {
          teamId,
          ships: ds.ships,
          readySlots: [...ds.readySlots],
          isTeamReady: info.room.readyTeams.has(teamId),
        })
      }
    }
    console.log(`[slot:join] ${info.code} slot ${slotIndex} ← ${name}`)
  })

  socket.on('slot:leave', () => {
    const prev = getMySlot(socket.id)
    if (!prev) return
    const room = getRoom(prev.code)
    if (room) {
      const slot = room.state.slots[prev.slotIndex]
      if (slot) {
        const teamId = slot.teamId
        slot.playerName = null; slot.socketId = null; slot.isReady = false
        // 清除设计准备状态
        for (const [, ds] of room.designs) ds.readySlots.delete(prev.slotIndex)
        // 检查该队伍是否还有人占用槽位，没有则清除队伍准备状态
        const teamStillOccupied = room.state.slots.some(s => s.teamId === teamId && s.playerName)
        if (!teamStillOccupied) {
          room.readyTeams.delete(teamId)
          room.state.readyTeams = [...room.readyTeams]
        }
      }
    }
    socketSlotMap.delete(socket.id)
    if (room) io.to(prev.code).emit('room:state', room.state)
  })

  // ===================== 设计阶段 =====================
  // 客户端进入设计页面时请求当前状态
  socket.on('design:requestState', () => {
    const slot = getMySlot(socket.id)
    if (!slot) return
    const room = getRoom(slot.code)
    if (!room || room.state.phase !== 'design') return
    // 发送完整房间状态
    socket.emit('room:state', room.state)
    // 发送本队设计状态
    const teamId = room.state.slots[slot.slotIndex]?.teamId
    if (teamId) broadcastDesignState(io, room, teamId)
  })

  socket.on('design:update', (ships: ShipDesignData[]) => {
    const slot = getMySlot(socket.id)
    if (!slot) return
    const room = getRoom(slot.code)
    if (!room || room.state.phase !== 'design') return
    const teamId = room.state.slots[slot.slotIndex]?.teamId
    if (!teamId) return
    // 队伍已准备则不允许修改
    if (room.readyTeams.has(teamId)) return
    if (!room.designs.has(teamId)) room.designs.set(teamId, { ships: [], readySlots: new Set() })
    room.designs.get(teamId)!.ships = ships
    // 广播给同阵营
    broadcastDesignState(io, room, teamId)
  })

  socket.on('design:ready', () => {
    const slot = getMySlot(socket.id)
    if (!slot) { console.log('[design:ready] no slot for', socket.id); return }
    const room = getRoom(slot.code)
    if (!room || room.state.phase !== 'design') { console.log('[design:ready] bad room/phase'); return }
    const teamId = room.state.slots[slot.slotIndex]?.teamId
    if (!teamId) { console.log('[design:ready] no teamId'); return }
    console.log(`[design:ready] slot=${slot.slotIndex} team=${teamId} readyTeams=[${[...room.readyTeams]}]`)
    // 标记队伍为已准备
    room.readyTeams.add(teamId)
    // 同步更新所有槽位的 isReady
    for (const s of room.state.slots) {
      if (s.teamId === teamId && s.playerName) s.isReady = true
    }
    room.state.readyTeams = [...room.readyTeams]
    io.to(slot.code).emit('room:state', room.state)
    broadcastDesignState(io, room, teamId)
    console.log(`[design:ready] after add, readyTeams=[${[...room.readyTeams]}] checking allReady...`)
    checkAllReady(io, room, slot.code)
  })

  socket.on('design:cancel', () => {
    const slot = getMySlot(socket.id)
    if (!slot) return
    const room = getRoom(slot.code)
    if (!room || room.state.phase !== 'design') return
    const teamId = room.state.slots[slot.slotIndex]?.teamId
    if (!teamId) return
    // 取消队伍准备
    room.readyTeams.delete(teamId)
    for (const s of room.state.slots) {
      if (s.teamId === teamId) s.isReady = false
    }
    if (room.designs.has(teamId)) room.designs.get(teamId)!.readySlots.delete(slot.slotIndex)
    room.state.readyTeams = [...room.readyTeams]
    io.to(slot.code).emit('room:state', room.state)
    broadcastDesignState(io, room, teamId)
  })

  // ===================== 战斗阶段 =====================

  socket.on('battle:request', () => {
    const slot = getMySlot(socket.id)
    if (!slot) return
    const room = getRoom(slot.code)
    if (!room || !room.lastBattleInit) return
    // 发送完整的 battle init + 当前状态
    socket.emit('battle:init', {
      ...room.lastBattleInit,
      currentTurnSlot: room.currentTurnSlot,
      roundNumber: room.roundNumber,
      spawns: [...room.spawns.entries()].map(([k, v]) => ({ slotIndex: k, shipId: v.shipId, compIndex: v.compIndex })),
      battleLog: room.battleLog.slice(-100),
      drawPile: room.drawPile,
      discardPile: room.discardPile,
      playerHands: Object.fromEntries(room.playerHands),
    })
  })

  // 出生阶段
  socket.on('battle:spawn', ({ compartmentId, shipId }) => {
    const slot = getMySlot(socket.id)
    if (!slot) return
    const room = getRoom(slot.code)
    if (!room || room.state.phase !== 'battle') return
    // 按顺序选择出生点
    const currentSpawnSlot = room.spawnOrder[room.spawnIndex]
    if (currentSpawnSlot !== undefined && slot.slotIndex !== currentSpawnSlot) {
      socket.emit('error', { message: '还没轮到你选出生点' })
      return
    }
    // 防止重复选择
    if (room.spawns.has(slot.slotIndex)) return
    // 计算舱段索引: 从 deterministic compId 提取 position
    const compMatch = compartmentId.match(/_comp_(\d+)$/)
    const compIndex = compMatch ? parseInt(compMatch[1]) : 0
    room.spawns.set(slot.slotIndex, { shipId: shipId || '', compIndex })
    room.spawnIndex++

    // 更新服务端数据层
    if (room.combatState) {
      room.combatState.playerPositions[slot.slotIndex] = { shipId: shipId || '', compIndex }
    }

    const logMsg = `${room.state.slots[slot.slotIndex]?.playerName || '?'} 选择出生点`
    room.battleLog.push({ message: logMsg, type: 'system', timestamp: Date.now() })
    io.to(slot.code).emit('battle:action', {
      type: 'selectSpawn', compartmentId,
      senderSlotIndex: slot.slotIndex,
      logMessage: logMsg, logType: 'system',
    })
    io.to(slot.code).emit('battle:log', { message: logMsg, type: 'system', timestamp: Date.now() })

    // 检查所有人是否都已选择
    const occ = occupiedSlots(room)
    const allSpawned = occ.every(idx => room.spawns.has(idx))
    if (allSpawned) {
      const turnOrder = room.lastBattleInit?.turnOrder || occ
      room.currentTurnSlot = turnOrder[0]
      const payload = { playerSlotIndex: turnOrder[0], roundNumber: room.roundNumber }

      // 显示层: 推送全量状态快照
      const spawnSnapshot = getBattleStateSnapshot(room)
      io.to(slot.code).emit('battle:state', spawnSnapshot)

      console.log(`[battle:spawn] all spawned → turn slot ${turnOrder[0]}`)
      io.to(slot.code).emit('battle:turn', payload)
    } else {
      // 每次出生也推送状态更新
      const spawnSnapshot = getBattleStateSnapshot(room)
      io.to(slot.code).emit('battle:state', spawnSnapshot)
    }
  })

  socket.on('battle:endTurn', () => {
    const slot = getMySlot(socket.id)
    if (!slot) return
    const room = getRoom(slot.code)
    if (!room || room.state.phase !== 'battle') return
    if (room.currentTurnSlot !== slot.slotIndex) return
    const turnOrder = room.lastBattleInit?.turnOrder || occupiedSlots(room)
    const curIdx = turnOrder.indexOf(room.currentTurnSlot)
    if (curIdx < 0) return
    // 跳过已断线/出局的槽位
    let nextIdx = (curIdx + 1) % turnOrder.length
    let safety = 0
    while (safety < turnOrder.length) {
      const checkSlot = turnOrder[nextIdx]
      const s = room.state.slots[checkSlot]
      if (s && s.playerName && s.socketId) break  // 活跃玩家
      nextIdx = (nextIdx + 1) % turnOrder.length
      safety++
    }
    // 检测回合数变化 (绕回一圈 → 新回合)
    if (nextIdx <= curIdx) room.roundNumber++

    // ===== 逻辑层: 回合结束结算 =====
    if (room.combatState) {
      const rng = () => Math.floor(Math.random() * 10) + 1
      // 1) tick effects / torpedoes / fighters
      room.combatState = tickEffects(room.combatState)
      room.combatState = tickFighters(room.combatState)
      const torpResult = tickTorpedoes(room.combatState)
      room.combatState = torpResult.state
      // 结算鱼雷伤害
      for (const t of torpResult.resolved) {
        for (let i = 0; i < t.torpedoCount; i++) {
          const dmg = rng(10) // 1D10
          const dmgResult = applyDamage(room.combatState, t.targetCompartmentId, dmg)
          room.combatState = dmgResult.state
          const ship = findShipByComp(room.combatState, t.targetCompartmentId)
          const shipName = ship?.name ?? '?'
          const comp = findCompartment(room.combatState, t.targetCompartmentId)
          const entry = {
            message: `鱼雷 → ${shipName} 第${(comp?.position ?? 0) + 1}舱段 ${dmg}伤害${dmgResult.destroyed ? ' — 击毁!' : ''}`,
            type: dmgResult.destroyed ? 'destroy' : 'damage',
            timestamp: Date.now(),
          }
          room.battleLog.push(entry)
          io.to(slot.code).emit('battle:log', entry)
          if (dmgResult.destroyed) {
            const dest = handleDestruction(room.combatState, t.targetCompartmentId)
            room.combatState = dest.state
            for (const log of dest.logs) {
              const e = { message: log.message, type: log.type, timestamp: Date.now() }
              room.battleLog.push(e)
              io.to(slot.code).emit('battle:log', e)
            }
          }
        }
      }
      // 2) 移除之前回合玩家派出的战斗机
      const prevTurnSlot = room.currentTurnSlot
      room.combatState = removeFightersByPlayer(room.combatState, prevTurnSlot)
      // 3) 重置每回合计数器
      room.combatState = resetPerTurn(room.combatState)
    }

    room.currentTurnSlot = turnOrder[nextIdx]
    const payload = { playerSlotIndex: room.currentTurnSlot, roundNumber: room.roundNumber }
    io.to(slot.code).emit('battle:turn', payload)
    const playerName = room.state.slots[room.currentTurnSlot]?.playerName || '?'
    const logMsg = `--- ${playerName} 的回合 (第${room.roundNumber}轮) ---`
    room.battleLog.push({ message: logMsg, type: 'system', timestamp: Date.now() })
    io.to(slot.code).emit('battle:log', { message: logMsg, type: 'system', timestamp: Date.now() })

    // ===== 显示层: 推送全量状态快照 =====
    const endTurnSnapshot = getBattleStateSnapshot(room)
    io.to(slot.code).emit('battle:state', endTurnSnapshot)

    console.log(`[battle:turn] ${slot.code} → slot ${room.currentTurnSlot} (round ${room.roundNumber})`)
  })

  socket.on('battle:action', (action: BattleAction) => {
    const slot = getMySlot(socket.id)
    if (!slot) return
    const room = getRoom(slot.code)
    if (!room || room.state.phase !== 'battle') return
    // 校验: 只有当前回合槽位可以发送行动 (出生阶段允许 spawn)
    if (action.type !== 'selectSpawn' && room.currentTurnSlot !== slot.slotIndex) return
    action.senderSlotIndex = slot.slotIndex

    // ===== 逻辑层: 应用战斗结果到服务端数据层 =====
    if (action.results && action.results.length > 0 && room.combatState) {
      for (const r of action.results) {
        switch (r.op) {
          case 'damage': {
            for (const d of r.damages || []) {
              const dmgResult = applyDamage(room.combatState, d.compartmentId, d.damage)
              room.combatState = dmgResult.state
              const ship = findShipByComp(room.combatState, d.compartmentId)
              const shipName = ship?.name ?? '?'
              const comp = findCompartment(room.combatState, d.compartmentId)
              const msg = `${r.source || '?'} → ${shipName} 第${(comp?.position ?? 0) + 1}舱段 ${d.damage}伤害${dmgResult.destroyed ? ' — 击毁!' : ''}`
              const type = dmgResult.destroyed ? 'destroy' : 'damage'
              room.battleLog.push({ message: msg, type, timestamp: Date.now() })
              io.to(slot.code).emit('battle:log', { message: msg, type, timestamp: Date.now() })
              if (dmgResult.destroyed) {
                const dest = handleDestruction(room.combatState, d.compartmentId)
                room.combatState = dest.state
                for (const log of dest.logs) {
                  room.battleLog.push({ message: log.message, type: log.type, timestamp: Date.now() })
                  io.to(slot.code).emit('battle:log', { message: log.message, type: log.type, timestamp: Date.now() })
                }
              }
            }
            break
          }
          case 'addTorpedo': {
            if (r.torpSourceCompId && r.torpTargetCompId) {
              const salvoId = `torp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
              room.combatState = addTorpedoSalvo(room.combatState, {
                id: salvoId, sourceCompartmentId: r.torpSourceCompId,
                targetCompartmentId: r.torpTargetCompId, torpedoCount: r.torpCount || 0,
                remainingTurns: r.torpTurns || 0,
              })
              room.battleLog.push({ message: `鱼雷发射! ${r.torpCount || 0}颗, ${r.torpTurns || 0}全回合后到达`, type: 'system', timestamp: Date.now() })
              io.to(slot.code).emit('battle:log', { message: `鱼雷发射! ${r.torpCount || 0}颗, ${r.torpTurns || 0}全回合后到达`, type: 'system', timestamp: Date.now() })
            }
            break
          }
          case 'addFighter': {
            if (r.fighterShipId && r.fighterTeamId && r.fighterCompId) {
              const tokenId = `fighter_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
              room.combatState = addFighterToken(room.combatState, {
                id: tokenId, shipId: r.fighterShipId, ownerTeamId: r.fighterTeamId,
                sourceCompartmentId: r.fighterCompId, sourcePlayerId: String(slot.slotIndex),
                remainingTurns: r.fighterTurns || 0,
              })
              const shipName = room.combatState.ships.find(sh => sh.shipId === r.fighterShipId)?.name ?? r.fighterShipId
              room.battleLog.push({ message: `战斗机起飞 → ${shipName}, 空优+2`, type: 'effect', timestamp: Date.now() })
              io.to(slot.code).emit('battle:log', { message: `战斗机起飞 → ${shipName}, 空优+2`, type: 'effect', timestamp: Date.now() })
            }
            break
          }
          case 'addEffect': {
            if (r.effectType && r.effectSourceCompId) {
              const effectId = `effect_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
              room.combatState = addEffect(room.combatState, {
                id: effectId, effectType: r.effectType === 'smoke_short' ? 'smoke_short' : 'smoke_long',
                sourceCompartmentId: r.effectSourceCompId, affectedCompartmentIds: r.effectAffectedCompIds || [],
                remainingTurns: r.effectTurns || 0,
              })
              const shortLabel = r.effectType === 'smoke_short' ? '半' : '全'
              room.battleLog.push({ message: `烟幕 (${shortLabel}回合): ${r.effectTurns}回合`, type: 'effect', timestamp: Date.now() })
              io.to(slot.code).emit('battle:log', { message: `烟幕 (${shortLabel}回合): ${r.effectTurns}回合`, type: 'effect', timestamp: Date.now() })
            }
            break
          }
          case 'compHeal': {
            if (r.healCompId) {
              room.combatState = healCompartment(room.combatState, r.healCompId, r.healAmount || 0)
              room.battleLog.push({ message: `维修 HP+${r.healAmount}`, type: 'effect', timestamp: Date.now() })
              io.to(slot.code).emit('battle:log', { message: `维修 HP+${r.healAmount}`, type: 'effect', timestamp: Date.now() })
            }
            break
          }
          case 'move': {
            if (r.toCompIdx != null && room.combatState.playerPositions[slot.slotIndex]) {
              room.combatState = movePlayer(room.combatState, slot.slotIndex, room.combatState.playerPositions[slot.slotIndex].shipId, r.toCompIdx)
            }
            break
          }
        }
      }
    }

    // ===== 显示层: 推送全量状态快照到所有客户端 =====
    const snapshot = getBattleStateSnapshot(room)
    io.to(slot.code).emit('battle:state', snapshot)

    // 保留原有 action 转发 (用于客户端 UI 反馈, 如目标选择)
    io.to(slot.code).emit('battle:action', action)
    if (action.logMessage) {
      const entry = { message: action.logMessage, type: action.logType || 'info', timestamp: Date.now() }
      room.battleLog.push(entry)
      io.to(slot.code).emit('battle:log', entry)
    }
  })

  // ===================== 卡牌操作 (服务端管理牌堆) =====================
  socket.on('card:draw', ({ count }) => {
    const slot = getMySlot(socket.id)
    if (!slot) return
    const room = getRoom(slot.code)
    if (!room || room.state.phase !== 'battle') return
    if (room.currentTurnSlot !== slot.slotIndex) return
    const { drawn, newDraw, newDiscard } = drawFromDeck(room.drawPile, room.discardPile, count || 1)
    room.drawPile = newDraw
    room.discardPile = newDiscard
    const hand = room.playerHands.get(slot.slotIndex) || []
    hand.push(...drawn)
    room.playerHands.set(slot.slotIndex, hand)
    // 只发给当前玩家 (手牌隐私)
    socket.emit('card:drawn', { cards: drawn, hand: hand })
    const playerName = room.state.slots[slot.slotIndex]?.playerName || '?'
    io.to(slot.code).emit('battle:log', {
      message: `${playerName} 抽了 ${drawn.length} 张牌`,
      type: 'system', timestamp: Date.now(),
    })
  })

  socket.on('card:discard', ({ cardIds }) => {
    const slot = getMySlot(socket.id)
    if (!slot) return
    const room = getRoom(slot.code)
    if (!room) return
    const hand = room.playerHands.get(slot.slotIndex) || []
    const discarded: CardData[] = []
    for (const cid of (cardIds || [])) {
      const idx = hand.findIndex((c: CardData) => c.id === cid)
      if (idx !== -1) {
        const [card] = hand.splice(idx, 1)
        room.discardPile.push(card)
        discarded.push(card)
      }
    }
    room.playerHands.set(slot.slotIndex, hand)
    socket.emit('card:drawn', { cards: [], hand: hand })
    const playerName = room.state.slots[slot.slotIndex]?.playerName || '?'
    io.to(slot.code).emit('battle:log', {
      message: `${playerName} 弃了 ${discarded.length} 张牌`,
      type: 'system', timestamp: Date.now(),
    })
  })

  socket.on('card:discardDownTo', ({ maxCards }) => {
    const slot = getMySlot(socket.id)
    if (!slot) return
    const room = getRoom(slot.code)
    if (!room) return
    const hand = room.playerHands.get(slot.slotIndex) || []
    if (hand.length > maxCards) {
      const discarded = hand.splice(maxCards)
      room.discardPile.push(...discarded)
    }
    room.playerHands.set(slot.slotIndex, hand)
    socket.emit('card:drawn', { cards: [], hand: hand })
  })

  // 谋划牌: 己方全员抽1张
  socket.on('card:scheme', ({ cardId }) => {
    const slot = getMySlot(socket.id)
    if (!slot) return
    const room = getRoom(slot.code)
    if (!room) return
    // 弃置谋划牌
    const hand = room.playerHands.get(slot.slotIndex) || []
    const idx = hand.findIndex((c: CardData) => c.id === cardId)
    if (idx !== -1) {
      const [card] = hand.splice(idx, 1)
      room.discardPile.push(card)
      room.playerHands.set(slot.slotIndex, hand)
      socket.emit('card:drawn', { cards: [], hand: hand })
    }
    // 寻找同一阵营的存活玩家
    const senderTeam = room.state.slots[slot.slotIndex]?.teamId
    if (!senderTeam) return
    const teamSlots = room.state.slots.filter(s => s.teamId === senderTeam && s.playerName)
    const playerName = room.state.slots[slot.slotIndex]?.playerName || '?'
    for (const s of teamSlots) {
      const { drawn, newDraw, newDiscard } = drawFromDeck(room.drawPile, room.discardPile, 1)
      room.drawPile = newDraw
      room.discardPile = newDiscard
      const th = room.playerHands.get(s.index) || []
      th.push(...drawn)
      room.playerHands.set(s.index, th)
      // 通知该槽位对应客户端
      if (s.socketId) {
        io.to(s.socketId).emit('card:drawn', { cards: drawn, hand: th })
      }
    }
    io.to(slot.code).emit('battle:log', {
      message: `${playerName} 使用谋划，己方全员抽1张牌`,
      type: 'system', timestamp: Date.now(),
    })
  })

  // ===================== 战斗日志 =====================
  socket.on('battle:log', ({ message, type }) => {
    const slot = getMySlot(socket.id)
    if (!slot) return
    const room = getRoom(slot.code)
    if (!room) return
    const entry = { message, type: type || 'info', timestamp: Date.now() }
    room.battleLog.push(entry)
    io.to(slot.code).emit('battle:log', entry)
  })

  // ===================== 断开 =====================
  socket.on('disconnect', () => {
    const prev = getMySlot(socket.id)
    if (prev) {
      const room = getRoom(prev.code)
      if (room) {
        const slot = room.state.slots[prev.slotIndex]
        if (slot) {
          const teamId = slot.teamId
          slot.playerName = null; slot.socketId = null; slot.isReady = false
          // 检查该队伍是否还有人占用槽位
          const teamStillOccupied = room.state.slots.some(s => s.teamId === teamId && s.playerName)
          if (!teamStillOccupied) {
            room.readyTeams.delete(teamId)
            room.state.readyTeams = [...room.readyTeams]
          }
        }
        io.to(prev.code).emit('room:state', room.state)
      }
      socketSlotMap.delete(socket.id)
    }
    removeSocketRoom(socket.id)
    console.log(`[disconnect] ${socket.id}`)
  })
})

// ===================== 辅助函数 =====================

/** 获取有玩家的槽位索引数组 (按 slot.index 排序) */
function occupiedSlots(room: ReturnType<typeof getRoom>): number[] {
  if (!room) return []
  return room.state.slots.filter(s => s.playerName).map(s => s.index).sort((a, b) => a - b)
}

/** 生成全量战斗状态快照 (显示层) */
function getBattleStateSnapshot(room: ReturnType<typeof getRoom>): BattleStateSnapshot {
  const cs = room?.combatState
  return {
    ships: cs?.ships.map(s => ({
      shipId: s.shipId, teamId: s.teamId, name: s.name, ownerPlayerId: s.ownerPlayerId,
      compartments: s.compartments.map(c => ({
        compId: c.compId, position: c.position, equipmentType: c.equipmentType,
        maxHp: c.maxHp, currentHp: c.currentHp, isDestroyed: c.isDestroyed,
        multiCompRootId: c.multiCompRootId, multiCompSlaveIds: c.multiCompSlaveIds,
      })),
    })) || [],
    playerPositions: cs?.playerPositions || {},
    fighterTokens: cs?.fighterTokens.map(t => ({ ...t })) || [],
    torpedoSalvoes: cs?.torpedoSalvoes.map(t => ({ ...t })) || [],
    activeEffects: cs?.activeEffects.map(e => ({ ...e })) || [],
    torpedoLoaded: cs?.torpedoLoaded || {},
    currentTurnSlot: room?.currentTurnSlot ?? 0,
    roundNumber: room?.roundNumber ?? 1,
  }
}

/** 构建出生顺序 (与回合顺序一致) */
function buildSpawnOrder(room: ReturnType<typeof getRoom>): number[] {
  if (!room) return []
  const occ = occupiedSlots(room)
  const order: number[] = []
  const teamIds = [...new Set(room.state.slots.map(s => s.teamId))]
  const teamQueues: Record<string, number[]> = {}
  for (const idx of occ) {
    const t = room.state.slots[idx].teamId
    if (!teamQueues[t]) teamQueues[t] = []
    teamQueues[t].push(idx)
  }
  let added = true
  while (added) {
    added = false
    for (const tid of teamIds) {
      const q = teamQueues[tid]
      if (q && q.length > 0) { order.push(q.shift()!); added = true }
    }
  }
  return order
}

function broadcastDesignState(io: Server, room: ReturnType<typeof getRoom>, teamId: string) {
  if (!room) return
  const ds = room.designs.get(teamId)
  const payload = {
    teamId,
    ships: ds?.ships || [],
    readySlots: ds ? [...ds.readySlots] : [],
    isTeamReady: room.readyTeams.has(teamId),
  }
  // 广播给同阵营所有玩家
  for (const s of room.state.slots) {
    if (s.teamId === teamId && s.socketId) {
      io.to(s.socketId).emit('design:state', payload)
    }
  }
}

function checkAllReady(io: Server, room: ReturnType<typeof getRoom>, code: string) {
  if (!room) { console.log('[checkAllReady] no room'); return }
  // 找出所有有玩家的队伍
  const occupiedTeams = new Set<string>()
  for (const s of room.state.slots) {
    if (s.playerName) occupiedTeams.add(s.teamId)
  }
  const occArr = [...occupiedTeams]
  const readyArr = [...room.readyTeams]
  console.log(`[checkAllReady] room=${code} occupied=[${occArr}] ready=[${readyArr}]`)
  if (occupiedTeams.size === 0) { console.log('[checkAllReady] no occupied teams'); return }
  // 所有队伍都准备就绪?
  const allReady = occArr.every(tid => room.readyTeams.has(tid))
  console.log(`[checkAllReady] allReady=${allReady}`)
  if (!allReady) return

  room.state.phase = 'battle'
  room.state.readyTeams = [...room.readyTeams]

  // 初始化出生顺序 (必须在构建 payload 之前)
  room.spawns = new Map()
  room.spawnIndex = 0
  room.spawnOrder = buildSpawnOrder(room)

  // 构建队伍信息
  const teamIds = [...new Set(room.state.slots.map(s => s.teamId))]
  const players = room.state.slots.filter(s => s.playerName).map(s => ({
    name: s.playerName!,
    teamId: s.teamId,
    slotIndex: s.index,
  }))

  // 交错回合顺序: 每队依次出一人
  const turnOrder: number[] = []
  const teamQueues: Record<string, number[]> = {}
  for (const p of players) {
    if (!teamQueues[p.teamId]) teamQueues[p.teamId] = []
    teamQueues[p.teamId].push(p.slotIndex)
  }
  let added = true
  while (added) {
    added = false
    for (const tid of teamIds) {
      const q = teamQueues[tid]
      if (q && q.length > 0) {
        turnOrder.push(q.shift()!)
        added = true
      }
    }
  }

  // 构建服务端牌堆 (不发初始手牌, 由各玩家回合开始时的 startDrawPhase 负责)
  const deck = shuffleCards(buildDeckCards())
  const playerHands: Record<number, CardData[]> = {}

  let drawPile = [...deck]
  let discardPile: CardData[] = []
  for (const p of players) {
    playerHands[p.slotIndex] = []
  }

  // 收集所有阵营的设计
  const ships: Record<string, any[]> = {}
  for (const [teamId, ds] of room.designs) {
    if (ds.ships.length > 0) ships[teamId] = ds.ships
  }

  const spawnOrder = room.spawnOrder
  const initPayload = {
    ships,
    players,
    teams: teamIds.map((id, i) => ({
      id,
      name: id,
      color: ['#409EFF', '#F56C6C', '#67C23A', '#E6A23C'][i % 4],
    })),
    turnOrder,
    playerHands,
    drawPile,
    discardPile,
    spawnOrder,
  }

  // 保存牌堆状态到 room
  room.drawPile = drawPile
  room.discardPile = discardPile
  for (const [si, hand] of Object.entries(playerHands)) {
    room.playerHands.set(Number(si), hand)
  }
  room.currentTurnSlot = 0
  room.lastBattleInit = initPayload
  room.roundNumber = 1

  // 构建服务端战斗数据层
  const slotPlayerMap = new Map<number, string>()
  for (const p of players) slotPlayerMap.set(p.slotIndex, p.teamId)
  const { state: combatState } = buildCombatState(room.designs as any, slotPlayerMap, room.spawns)
  room.combatState = combatState

  console.log(`[checkAllReady] EMITTING battle:init to room ${code} — ${players.length} players, ${turnOrder.length} slots, spawnOrder=[${room.spawnOrder}]`)
  io.to(code).emit('battle:init', initPayload)
  io.to(code).emit('room:state', room.state)
  console.log(`[checkAllReady] battle:init EMITTED for room ${code}`)
}

const PORT = process.env.PORT || 3001
httpServer.listen(PORT, () => console.log(`Server running on port ${PORT}`))
