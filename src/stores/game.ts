import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { GameMode, GamePhase, TurnPhase, Player, Team } from '@/game/types'

export const useGameStore = defineStore('game', () => {
  const mode = ref<GameMode>('hotseat')
  const phase = ref<GamePhase>('setup')

  const players = ref<Player[]>([])
  const teams = ref<Team[]>([])

  const totalCompartments = ref(0)

  const turnOrder = ref<string[]>([])
  const currentTurnIndex = ref(0)
  const currentTurnPhase = ref<TurnPhase>('draw')
  const roundNumber = ref(1)
  const freeActionUsed = ref(false)

  const winner = ref<string | null>(null)
  const isStalemate = ref(false)
  const stalemateResult = ref<{ winner: string; reason: string } | null>(null)

  const firstRoundCompensation = ref<Record<string, number>>({})

  const currentPlayerId = computed(() => {
    if (turnOrder.value.length === 0) return null
    return turnOrder.value[currentTurnIndex.value]
  })

  const currentPlayer = computed(() => {
    if (!currentPlayerId.value) return null
    return players.value.find((p) => p.id === currentPlayerId.value) ?? null
  })

  const alivePlayers = computed(() => players.value.filter((p) => p.isAlive))
  const alivePlayerCount = computed(() => alivePlayers.value.length)

  const aliveTeams = computed(() => {
    const teamIds = new Set(alivePlayers.value.map((p) => p.teamId))
    return teams.value.filter((t) => teamIds.has(t.id))
  })

  function setMode(m: GameMode): void {
    mode.value = m
  }

  function initPlayers(
    playerConfigs: { name: string; teamId: string }[]
  ): void {
    players.value = playerConfigs.map((cfg, i) => ({
      id: `player_${i}`,
      name: cfg.name,
      teamId: cfg.teamId,
      isAlive: true,
      currentShipId: null,
      currentCompartmentIndex: null,
      hand: [],
    }))

    // 交错回合顺序: 每队依次出一人
    const teamPlayerQueues: Record<string, string[]> = {}
    for (const t of teams.value) {
      teamPlayerQueues[t.id] = players.value
        .filter((p) => p.teamId === t.id)
        .map((p) => p.id)
    }
    const order: string[] = []
    let added = true
    while (added) {
      added = false
      for (const t of teams.value) {
        const q = teamPlayerQueues[t.id]
        if (q.length > 0) {
          order.push(q.shift()!)
          added = true
        }
      }
    }
    turnOrder.value = order

    // 计算第一轮补偿
    firstRoundCompensation.value = {}
    const seenTeams: string[] = []
    for (const pid of order) {
      const p = players.value.find((pl) => pl.id === pid)
      if (!p) continue
      if (!seenTeams.includes(p.teamId)) {
        seenTeams.push(p.teamId)
      }
      firstRoundCompensation.value[pid] = seenTeams.indexOf(p.teamId)
    }
  }

  function initTeams(teamConfigs: { name: string; color: string }[]): void {
    teams.value = teamConfigs.map((cfg, i) => ({
      id: `team_${i}`,
      name: cfg.name,
      color: cfg.color,
      playerIds: [],
    }))
  }

  function setTotalCompartments(count: number): void {
    totalCompartments.value = count
  }

  function placePlayersOnShips(shipStoreRef: any): void {
    for (const player of players.value) {
      const playerShips = shipStoreRef.ships.filter(
        (s: any) => s.ownerPlayerId === player.id
      )
      if (playerShips.length > 0) {
        const ship = playerShips[0]
        const living = ship.compartments.filter((c: any) => !c.isDestroyed)
        player.currentShipId = ship.id
        player.currentCompartmentIndex = living.length > 0 ? living[0].position : 0
      }
    }
  }

  function startDesignPhase(): void {
    phase.value = 'design'
  }

  function startBattlePhase(): void {
    phase.value = 'battle'
    currentTurnPhase.value = 'draw'
    roundNumber.value = 1
    currentTurnIndex.value = 0
  }

  function getFirstRoundCompensation(playerId: string): number {
    if (roundNumber.value !== 1) return 0
    return firstRoundCompensation.value[playerId] ?? 0
  }

  function advancePhase(): void {
    switch (currentTurnPhase.value) {
      case 'draw':
        currentTurnPhase.value = 'action'
        freeActionUsed.value = false
        break
      case 'action':
        currentTurnPhase.value = 'discard'
        break
      case 'discard':
        nextTurn()
        break
    }
  }

  function nextTurn(): void {
    freeActionUsed.value = false
    currentTurnIndex.value++
    if (currentTurnIndex.value >= turnOrder.value.length) {
      currentTurnIndex.value = 0
      roundNumber.value++
    }
    const startIndex = currentTurnIndex.value
    let skipped = 0
    while (
      currentPlayer.value &&
      !currentPlayer.value.isAlive &&
      skipped < turnOrder.value.length
    ) {
      currentTurnIndex.value++
      if (currentTurnIndex.value >= turnOrder.value.length) {
        currentTurnIndex.value = 0
        roundNumber.value++
      }
      skipped++
      if (currentTurnIndex.value === startIndex) break
    }
    currentTurnPhase.value = 'draw'
    freeActionUsed.value = false
  }

  function useFreeAction(): void {
    freeActionUsed.value = true
  }

  function eliminatePlayer(playerId: string): void {
    const player = players.value.find((p) => p.id === playerId)
    if (player) {
      player.isAlive = false
      player.currentShipId = null
      player.currentCompartmentIndex = null
    }
    checkWinCondition()
  }

  function checkWinCondition(): void {
    const alive = aliveTeams.value
    if (alive.length === 1) {
      winner.value = alive[0].id
      phase.value = 'results'
      return
    }
    if (alive.length === 0) {
      isStalemate.value = true
      resolveStalemate()
    }
  }

  function resolveStalemate(): void {
    phase.value = 'results'
    winner.value = null
  }

  function setWinner(teamId: string): void {
    winner.value = teamId
    phase.value = 'results'
  }

  function resetGame(): void {
    mode.value = 'hotseat'
    phase.value = 'setup'
    players.value = []
    teams.value = []
    totalCompartments.value = 0
    turnOrder.value = []
    currentTurnIndex.value = 0
    currentTurnPhase.value = 'draw'
    roundNumber.value = 1
    freeActionUsed.value = false
    winner.value = null
    isStalemate.value = false
    stalemateResult.value = null
    firstRoundCompensation.value = {}
  }

  return {
    mode,
    phase,
    players,
    teams,
    totalCompartments,
    turnOrder,
    currentTurnIndex,
    currentTurnPhase,
    roundNumber,
    freeActionUsed,
    winner,
    isStalemate,
    stalemateResult,
    firstRoundCompensation,
    currentPlayerId,
    currentPlayer,
    alivePlayers,
    alivePlayerCount,
    aliveTeams,
    setMode,
    initPlayers,
    initTeams,
    setTotalCompartments,
    placePlayersOnShips,
    startDesignPhase,
    startBattlePhase,
    getFirstRoundCompensation,
    advancePhase,
    nextTurn,
    useFreeAction,
    eliminatePlayer,
    checkWinCondition,
    resolveStalemate,
    setWinner,
    resetGame,
  }
})
