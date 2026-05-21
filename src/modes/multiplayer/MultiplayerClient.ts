import { io, Socket } from 'socket.io-client'
import type { RoomState, DesignSyncPayload, BattleAction, SlotState } from '@shared/protocol'

type Callback = (...args: any[]) => void

export class MultiplayerClient {
  private socket: Socket | null = null
  private listeners = new Map<string, Set<Callback>>()
  private _myPlayerId = ''
  private cachedRoom: RoomState | null = null

  get myPlayerId(): string { return this._myPlayerId }
  set myPlayerId(id: string) { this._myPlayerId = id }

  connect(): void {
    if (this.socket?.connected) return
    this.socket = io({ autoConnect: true, reconnection: true })
    this.socket.on('connect', () => console.log('[MP] connected', this.socket?.id))
    this.socket.on('disconnect', () => console.log('[MP] disconnected'))
    this.cachedRoom = null
  }

  disconnect(): void {
    this.socket?.disconnect()
    this.socket = null
    this.listeners.clear()
    this.cachedRoom = null
  }

  get id(): string { return this.socket?.id ?? '' }

  /** 请求当前房间状态 — 服务端返回缓存的 room:update */
  requestRoomState(): void {
    this.socket?.emit('room:state')
  }

  // ===== 房间 =====
  createRoom(playerName: string, totalCompartments: number, slots: { teamId: string; playerName: string }[]): void {
    this.socket?.emit('room:create', { playerName, totalCompartments, slots })
  }

  joinRoom(roomCode: string, playerName: string): void {
    this.socket?.emit('room:join', { roomCode, playerName })
  }

  leaveRoom(): void {
    this.socket?.emit('room:leave')
  }

  startDesign(teamCount: number, totalCompartments: number, teams: { name: string; color: string }[]): void {
    this.socket?.emit('room:startDesign', {
      teamCount,
      totalCompartments,
      teams: teams.map(t => ({ id: t.name, name: t.name, color: t.color })),
    })
  }

  // ===== 槽位 =====
  joinSlot(slotIndex: number): void { this.socket?.emit('slot:join', { slotIndex }) }
  leaveSlot(): void { this.socket?.emit('slot:leave') }
  setReady(): void { this.socket?.emit('slot:ready') }
  cancelReady(): void { this.socket?.emit('slot:cancelReady') }

  // ===== 设计 =====
  sendDesignSync(design: DesignSyncPayload): void {
    this.socket?.emit('design:sync', design)
  }

  // ===== 战斗 =====
  sendBattleAction(action: BattleAction): void {
    this.socket?.emit('battle:action', action)
  }

  // ===== 事件监听 =====
  on(event: string, cb: Callback): void {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set())
    this.listeners.get(event)!.add(cb)
    this.socket?.on(event, cb)
  }

  off(event: string, cb: Callback): void {
    this.listeners.get(event)?.delete(cb)
    this.socket?.off(event, cb)
  }

  onRoomUpdate(cb: (room: RoomState) => void): void {
    this.on('room:update', (r: RoomState) => { this.cachedRoom = r; cb(r) })
    // 已有缓存则立即回调
    if (this.cachedRoom) cb(this.cachedRoom)
  }
  onRoomError(cb: (err: { message: string }) => void): void { this.on('room:error', cb) }
  onDesignSync(cb: (data: DesignSyncPayload & { teamId: string }) => void): void { this.on('design:sync', cb) }
  onAllReady(cb: () => void): void { this.on('design:allReady', cb) }
  onBattleAction(cb: (action: BattleAction) => void): void { this.on('battle:action', cb) }
}

export const multiplayerClient = new MultiplayerClient()
