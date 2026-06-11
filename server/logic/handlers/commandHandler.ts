// server/logic/handlers/commandHandler.ts
import type { ServerRoom } from '../../state.js'
import type { ClientIntent } from '../../../shared/protocol.js'
import type { ServerCombatState } from '../../data/CombatState.js'
import {
  applyDamage, handleDestruction, useCommand, useSortie,
  markAmmoDepotUsed, setTorpedoLoaded, addTorpedoSalvo,
  addFighterToken, addEffect, healCompartment, findShipByComp,
  getAdjacentComps, isCompartmentSmoked, isTorpedoLoaded,
  canUseAmmoDepot, findCompartment, findShip,
  getLivingCompartments, getLivingCompartmentByIndex, isShipSunk,
} from '../../data/CombatState.js'
import { getEquipment } from '../../../src/game/equipment/registry.js'
import type { DiceRng } from '../rules/dice.js'
import { rollOne } from '../rules/dice.js'
import { resolveNavalGunHit, resolveBlindfireHit } from '../rules/hitResolution.js'
import { rollGunDamage, rollBomberDamage, rollTorpedoBomberDamage } from '../rules/damageRoll.js'
import { calculateAirSuperiority } from '../rules/airSuperiority.js'

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
  const eqDef = getEquipment(eqType as any)
  const playerName = room.state.slots[slotIndex]?.playerName || '?'

  let s = state

  switch (eqType) {
    // ===== 舰炮 =====
    case 'dual_cannon':
    case 'triple_cannon': {
      const isBlind = commandId.includes('blindfire')

      if (isBlind) {
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
          const living = getLivingCompartments(s, targetShipId)
          if (living.length === 0) continue
          const hitComp = living[rng(living.length) - 1]
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
          id: salvoId, sourceCompartmentId: sourceCompId,
          targetCompartmentId: targetCompId, torpedoCount: 4, remainingTurns: fullRound,
        })
        s = setTorpedoLoaded(s, sourceCompId, false)
        s = useCommand(s, sourceCompId)
        logs.push({ message: `鱼雷发射! 4颗, ${fullRound}全回合后到达`, type: 'system' })
      }
      break
    }

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
          id: tokenId, shipId: aircraftTargetShipId,
          ownerTeamId: room.state.slots[slotIndex]?.teamId || '',
          sourceCompartmentId: sourceCompId, sourcePlayerId: String(slotIndex),
          remainingTurns: fullRound,
        })
        s = useCommand(s, sourceCompId)
        s = useSortie(s, sourceCompId)
        const targetShipName = findShip(s, aircraftTargetShipId)?.name ?? aircraftTargetShipId
        logs.push({ message: `战斗机起飞 → ${targetShipName}, 空优+2`, type: 'effect' })
      } else if (commandId.includes('bomber') && !commandId.includes('torpedo')) {
        const nfa = calculateAirSuperiority(s, aircraftTargetShipId, room.state.slots[slotIndex]?.teamId || '')
        const dmg = rollBomberDamage(rng, nfa)
        const bombingLiving = getLivingCompartments(s, aircraftTargetShipId)
        if (bombingLiving.length > 0) {
          const hitComp = bombingLiving[rng(bombingLiving.length) - 1]
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
        const torpLiving = getLivingCompartments(s, aircraftTargetShipId)
        if (torpLiving.length > 0) {
          const hitComp = torpLiving[rng(torpLiving.length) - 1]
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
        sourceCompartmentId: sourceCompId, affectedCompartmentIds: affected, remainingTurns: turns,
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
      let totalNegated = 0, totalCount = 0
      for (const t of torps) {
        const originalCount = t.torpedoCount
        for (let i = 0; i < originalCount; i++) {
          totalCount++
          if (rng(2) === 1) { t.torpedoCount--; totalNegated++ }
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
      if (['command_room', 'command_center', 'integrated_command'].includes(tgtComp.equipmentType)) {
        logs.push({ message: '不能对指挥类军备发动发令', type: 'error' })
        return { newState: s, logs }
      }
      const tgtEq = getEquipment(tgtComp.equipmentType as any)
      if (tgtEq.commands.length === 0) {
        logs.push({ message: '目标军备没有可执行的指挥', type: 'error' })
        return { newState: s, logs }
      }
      const relayedCmd = tgtEq.commands[0]
      let relayTarget: string | null = null

      if (relayedCmd.targeting.scope === 'enemy-compartment' || relayedCmd.targeting.scope === 'enemy-ship') {
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

      const relayIntent: ClientIntent = {
        type: 'targetSelection',
        payload: { sourceCompId: tgtComp.compId, commandId: relayedCmd.id, targetCompId: relayTarget },
      }
      const relayResult = handleCommand(s, room, slotIndex, relayIntent, rng)
      s = relayResult.newState
      logs.push({ message: `${playerName} 发令 → ${tgtEq.name}`, type: 'system' })
      logs.push(...relayResult.logs)
      s = useCommand(s, sourceCompId)
      break
    }
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
