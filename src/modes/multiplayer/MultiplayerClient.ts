import { io, Socket } from 'socket.io-client'
import type { RoomState, ShipDesignData, BattleAction, BattleInitPayload } from '@shared/protocol'

type Cb = (...args: any[]) => void

export class MultiplayerClient {
  private socket: Socket | null = null
  private listeners = new Map<string, Set<Cb>>()

  connect(): void {
    if (this.socket?.connected) return
    this.socket = io({ autoConnect: true, reconnection: true })
    this.socket.on('connect', () => console.log('[MP] connected', this.socket?.id))
  }

  disconnect(): void { this.socket?.disconnect(); this.socket = null; this.listeners.clear() }

  get id(): string { return this.socket?.id ?? '' }

  // ===== 发送 =====
  createRoom(config: any): void { this.socket?.emit('room:create', config) }
  joinRoom(code: string, name: string): void { this.socket?.emit('room:join', { roomCode: code, playerName: name }) }
  startGame(): void { this.socket?.emit('room:startGame') }
  joinSlot(index: number): void { this.socket?.emit('slot:join', { slotIndex: index }) }
  leaveSlot(): void { this.socket?.emit('slot:leave') }
  sendDesignUpdate(ships: ShipDesignData[]): void { this.socket?.emit('design:update', ships) }
  setReady(): void { this.socket?.emit('design:ready') }
  cancelReady(): void { this.socket?.emit('design:cancel') }
  requestBattleInit(): void { this.socket?.emit('battle:request') }
  sendSpawn(compId: string): void { this.socket?.emit('battle:spawn', { compartmentId: compId }) }
  sendEndTurn(): void { this.socket?.emit('battle:endTurn') }
  sendAction(action: BattleAction): void { this.socket?.emit('battle:action', action) }

  // ===== 监听 =====
  private on(event: string, cb: Cb): void {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set())
    this.listeners.get(event)!.add(cb)
    this.socket?.on(event, cb)
  }

  onRoomState(cb: (s: RoomState) => void): void { this.on('room:state', cb) }
  onDesignState(cb: (d: { teamId: string; ships: ShipDesignData[]; readySlots: number[] }) => void): void { this.on('design:state', cb) }
  onBattleInit(cb: (p: BattleInitPayload) => void): void { this.on('battle:init', cb) }
  onBattleAction(cb: (a: BattleAction) => void): void { this.on('battle:action', cb) }
  onBattleTurn(cb: (t: { playerSlotIndex: number }) => void): void { this.on('battle:turn', cb) }
  onBattleLog(cb: (e: { message: string; type: string; timestamp: number }) => void): void { this.on('battle:log', cb) }
  onError(cb: (e: { message: string }) => void): void { this.on('error', cb) }
}

export const multiplayerClient = new MultiplayerClient()
