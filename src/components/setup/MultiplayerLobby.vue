<script setup lang="ts">
import { ref, watch, onUnmounted } from 'vue'
import { multiplayerClient } from '@/modes/multiplayer/MultiplayerClient'
import type { RoomState, SlotState } from '@shared/protocol'
import { ElMessage } from 'element-plus'

const emit = defineEmits<{
  'start-design': [room: RoomState]
  'back': []
}>()

const room = ref<RoomState | null>(null)
const playerName = ref(localStorage.getItem('mp_playerName') || '')
const roomCodeInput = ref('')
const serverUrl = ref(localStorage.getItem('mp_serverUrl') || 'http://localhost:3001')
const connected = ref(false)

function initConnection(): void {
  multiplayerClient.disconnect()
  multiplayerClient.connect(serverUrl.value)
  localStorage.setItem('mp_serverUrl', serverUrl.value)

  multiplayerClient.onRoomUpdate((r) => {
    room.value = r
  })
  multiplayerClient.onRoomError((err) => {
    ElMessage.error(err.message)
  })
  connected.value = true
}

function createRoom(): void {
  if (!playerName.value.trim()) { ElMessage.warning('请输入玩家名'); return }
  localStorage.setItem('mp_playerName', playerName.value)
  multiplayerClient.createRoom(playerName.value.trim())
}

function joinRoom(): void {
  if (!playerName.value.trim()) { ElMessage.warning('请输入玩家名'); return }
  if (!roomCodeInput.value.trim()) { ElMessage.warning('请输入房间码'); return }
  localStorage.setItem('mp_playerName', playerName.value)
  multiplayerClient.joinRoom(roomCodeInput.value.trim().toUpperCase(), playerName.value.trim())
}

function leaveRoom(): void {
  multiplayerClient.leaveRoom()
  room.value = null
}

function joinSlot(slotIndex: number): void {
  multiplayerClient.joinSlot(slotIndex)
}

function leaveSlot(): void {
  multiplayerClient.leaveSlot()
}

function startDesign(): void {
  if (!room.value) return
  emit('start-design', room.value)
}

function copyRoomCode(): void {
  if (room.value) {
    navigator.clipboard.writeText(room.value.code)
    ElMessage.success('房间码已复制')
  }
}

function isSelfReady(): boolean {
  return !!room.value?.players.find((p: { socketId: string; isReady: boolean }) => p.socketId === multiplayerClient.id)?.isReady
}

function hasSelfSlot(): boolean {
  return (room.value?.players.find((p: { socketId: string; slotIndex: number | null }) => p.socketId === multiplayerClient.id)?.slotIndex ?? null) != null
}

function getTeamColor(teamId: string): string {
  const teamColors = ['#409EFF', '#F56C6C', '#67C23A', '#E6A23C', '#9060EB', '#20B2AA']
  const idx = parseInt(teamId.replace('team_', '')) || 0
  return teamColors[idx % teamColors.length]
}

onUnmounted(() => {
  // 不在这里断开，保持连接
})

initConnection()
</script>

<template>
  <div class="mp-lobby">
    <!-- 连接设置 -->
    <div v-if="!connected" class="lobby-section">
      <p>正在连接服务器...</p>
    </div>

    <!-- 未加入房间 -->
    <div v-if="!room?.code" class="lobby-section">
      <h3>多人模式</h3>
      <el-input v-model="serverUrl" placeholder="服务器地址" size="small" style="margin-bottom:8px" @change="initConnection" />
      <el-input v-model="playerName" placeholder="你的玩家名" size="small" style="margin-bottom:12px" />

      <div class="room-actions">
        <el-button type="primary" @click="createRoom">创建房间</el-button>
        <el-divider direction="vertical" />
        <el-input v-model="roomCodeInput" placeholder="房间码" size="small" style="width:100px" />
        <el-button @click="joinRoom">加入房间</el-button>
      </div>
      <el-button text size="small" @click="emit('back')" style="margin-top:12px">返回</el-button>
    </div>

    <!-- 已加入房间 -->
    <div v-else class="lobby-section">
      <h3>房间: {{ room.code }}</h3>
      <el-button size="small" text @click="copyRoomCode">复制房间码</el-button>
      <p class="room-info">
        玩家: {{ room.players.length }}人 | 阶段: {{ room.phase === 'lobby' ? '等待中' : room.phase === 'design' ? '设计舰船' : '战斗中' }}
      </p>

      <!-- 槽位列表 -->
      <div v-if="room.phase === 'lobby' || room.phase === 'design'" class="slot-list">
        <h4>玩家槽位</h4>
        <div v-for="slot in room.slots" :key="slot.index" class="slot-item" :style="{ borderColor: getTeamColor(slot.teamId) }">
          <div class="slot-info">
            <span class="slot-team" :style="{ color: getTeamColor(slot.teamId) }">
              {{ slot.teamId }} · 槽位{{ slot.index + 1 }}
            </span>
            <span v-if="slot.playerName" class="slot-player">
              {{ slot.playerName }}
              <el-tag v-if="slot.isReady" type="success" size="small" effect="plain">已准备</el-tag>
            </span>
            <span v-else class="slot-empty">空</span>
          </div>
          <div class="slot-actions">
            <template v-if="!slot.playerName">
              <el-button size="small" type="primary" @click="joinSlot(slot.index)">点击加入</el-button>
            </template>
            <template v-else-if="slot.socketId === multiplayerClient.id">
              <el-button size="small" type="danger" @click="leaveSlot">点击退出</el-button>
            </template>
            <template v-else>
              <el-tag size="small" type="info">已占用</el-tag>
            </template>
          </div>
        </div>
      </div>

      <!-- 已在设计阶段，已加入槽位则显示准备按钮 -->
      <div v-if="room.phase === 'design'" style="margin-top:12px">
        <template v-if="isSelfReady()">
          <el-tag type="success" size="large">已准备就绪</el-tag>
          <el-button size="small" type="warning" @click="multiplayerClient.cancelReady()" style="margin-left:8px">取消准备</el-button>
        </template>
        <template v-else-if="hasSelfSlot()">
          <el-button size="small" type="success" @click="multiplayerClient.setReady()">准备就绪</el-button>
        </template>
      </div>

      <el-button text size="small" type="danger" @click="leaveRoom" style="margin-top:12px">离开房间</el-button>
    </div>
  </div>
</template>

<style scoped>
.mp-lobby { max-width: 600px; margin: 0 auto; }
.lobby-section { background: rgba(13,33,55,0.8); border: 1px solid #1a3355; border-radius: 8px; padding: 20px; margin-bottom: 16px; }
.lobby-section h3 { color: #409eff; margin-bottom: 12px; }
.room-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.room-info { color: #6a8aaa; font-size: 13px; margin: 8px 0; }
.slot-list { display: flex; flex-direction: column; gap: 8px; margin-top: 12px; }
.slot-item { display: flex; align-items: center; justify-content: space-between; padding: 10px 14px; background: rgba(20,40,70,0.5); border-left: 4px solid #409eff; border-radius: 6px; }
.slot-info { display: flex; flex-direction: column; gap: 2px; }
.slot-team { font-size: 13px; font-weight: bold; }
.slot-player { font-size: 14px; color: #d0e0f0; display: flex; align-items: center; gap: 6px; }
.slot-empty { color: #4a6a8a; font-size: 14px; }
.slot-actions { flex-shrink: 0; }
</style>
