<script setup lang="ts">
import { ref, reactive, onUnmounted } from 'vue'
import { multiplayerClient } from '@/modes/multiplayer/MultiplayerClient'
import type { RoomState } from '@shared/protocol'
import { TEAM_COLORS } from '@/game/constants'
import { ElMessage } from 'element-plus'

const emit = defineEmits<{
  'start-design': [room: RoomState]
  'back': []
}>()

const room = ref<RoomState | null>(null)
const playerName = ref(localStorage.getItem('mp_playerName') || '')
const roomCodeInput = ref('')
const connected = ref(false)

// 房间创建前的配置
const teamCount = ref(2)
const totalCompartments = ref(10)
const teams = reactive<{ name: string; color: string }[]>([])
const slotNames = reactive<Record<number, string[]>>({})

function initTeams(): void {
  teams.length = 0
  for (let i = 0; i < teamCount.value; i++) {
    teams.push({ name: `队伍${i + 1}`, color: TEAM_COLORS[i % TEAM_COLORS.length] })
    if (!slotNames[i]) slotNames[i] = []
    if (slotNames[i].length === 0) {
      slotNames[i].push(`玩家${i + 1}`)
    }
  }
}

function addSlot(teamIndex: number): void {
  if (!slotNames[teamIndex]) slotNames[teamIndex] = []
  const totalSlots = Object.values(slotNames).reduce((s, arr) => s + arr.length, 0)
  slotNames[teamIndex].push(`玩家${totalSlots + 1}`)
}

function removeSlot(teamIndex: number, slotIndex: number): void {
  slotNames[teamIndex].splice(slotIndex, 1)
}

function initConnection(): void {
  multiplayerClient.disconnect()
  multiplayerClient.connect()
  multiplayerClient.onRoomUpdate((r) => { room.value = r })
  multiplayerClient.onRoomError((err) => { ElMessage.error(err.message) })
  connected.value = true
}

// 创建房间(含槽位配置)
function createRoom(): void {
  if (!playerName.value.trim()) { ElMessage.warning('请输入玩家名'); return }
  localStorage.setItem('mp_playerName', playerName.value)

  const slotList: { teamId: string; playerName: string }[] = []
  for (let ti = 0; ti < teams.length; ti++) {
    const names = slotNames[ti] || []
    for (const name of names) {
      slotList.push({ teamId: teams[ti].name, playerName: name })
    }
  }

  multiplayerClient.createRoom(playerName.value.trim(), slotList)
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
  return !!room.value?.players.find(
    (p: { socketId: string; isReady: boolean }) => p.socketId === multiplayerClient.id
  )?.isReady
}

function hasSelfSlot(): boolean {
  return (room.value?.players.find(
    (p: { socketId: string; slotIndex: number | null }) => p.socketId === multiplayerClient.id
  )?.slotIndex ?? null) != null
}

function getTeamColor(teamId: string): string {
  const idx = teams.findIndex(t => t.name === teamId)
  return idx >= 0 ? teams[idx].color : '#888'
}

onUnmounted(() => {})

initConnection()
initTeams()
</script>

<template>
  <div class="mp-lobby">
    <!-- 未加入房间: 配置 + 创建 -->
    <div v-if="!room?.code" class="lobby-section">
      <h3>多人模式</h3>
      <el-input v-model="playerName" placeholder="你的玩家名" size="small" style="margin-bottom:10px" />

      <!-- 队伍配置(仅房主需要) -->
      <div class="config-section">
        <h4>房间配置</h4>
        <div class="config-row">
          <span>队伍数量：</span>
          <el-input-number v-model="teamCount" :min="2" :max="12" size="small" @change="initTeams" />
          <span style="margin-left:16px">每方舱段数：</span>
          <el-input-number v-model="totalCompartments" :min="2" :max="50" size="small" />
        </div>

        <div v-for="(team, ti) in teams" :key="ti" class="team-config"
             :style="{ borderLeftColor: team.color }">
          <div class="team-header">
            <el-input v-model="team.name" size="small" style="width:120px" />
            <el-color-picker v-model="team.color" size="small" />
            <el-button size="small" @click="addSlot(ti)">添加槽位</el-button>
          </div>
          <div class="slot-configs">
            <div v-for="(sn, si) in slotNames[ti]" :key="si" class="slot-config-item">
              <span class="color-dot" :style="{ background: team.color }"></span>
              <el-input v-model="slotNames[ti][si]" size="small" style="width:100px" placeholder="槽位名" />
              <el-button v-if="(slotNames[ti]?.length || 0) > 1" size="small" type="danger" circle @click="removeSlot(ti, si)">-</el-button>
            </div>
          </div>
        </div>
      </div>

      <div class="room-actions" style="margin-top:12px">
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
      <p class="room-info">玩家: {{ room.players.length }}人</p>

      <!-- 槽位列表 -->
      <div v-if="room.slots && room.slots.length > 0" class="slot-list">
        <h4>玩家槽位</h4>
        <div v-for="slot in room.slots" :key="slot.index" class="slot-item"
             :style="{ borderLeftColor: getTeamColor(slot.teamId) }">
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
      <!-- 没有预设槽位时显示(加入别人的房间,槽位由服务器根据加入者动态分配) -->
      <div v-else-if="room.phase === 'lobby'" class="no-slots">
        <p>等待房主配置槽位，或与房主协调加入</p>
      </div>

      <!-- 准备/开始 -->
      <div v-if="room.phase === 'lobby'" style="margin-top:12px">
        <el-button v-if="hasSelfSlot()" type="success" size="small" @click="startDesign">开始设计</el-button>
      </div>
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
.mp-lobby { max-width: 650px; margin: 0 auto; }
.lobby-section { background: rgba(13,33,55,0.8); border: 1px solid #1a3355; border-radius: 8px; padding: 20px; margin-bottom: 16px; }
.lobby-section h3 { color: #409eff; margin-bottom: 12px; }
.config-section { margin-top: 8px; }
.config-section h4 { color: #a0b8d0; font-size: 13px; margin-bottom: 8px; }
.config-row { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; color: #a0b8d0; font-size: 13px; }
.team-config { background: rgba(20,40,70,0.5); border-left: 4px solid #409eff; border-radius: 4px; padding: 10px; margin-bottom: 8px; }
.team-header { display: flex; align-items: center; gap: 6px; margin-bottom: 6px; }
.slot-configs { display: flex; flex-direction: column; gap: 4px; }
.slot-config-item { display: flex; align-items: center; gap: 6px; }
.color-dot { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }
.room-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.room-info { color: #6a8aaa; font-size: 13px; margin: 8px 0; }
.slot-list { display: flex; flex-direction: column; gap: 8px; margin-top: 12px; }
.slot-item { display: flex; align-items: center; justify-content: space-between; padding: 10px 14px; background: rgba(20,40,70,0.5); border-left: 4px solid #409eff; border-radius: 6px; }
.slot-info { display: flex; flex-direction: column; gap: 2px; }
.slot-team { font-size: 13px; font-weight: bold; }
.slot-player { font-size: 14px; color: #d0e0f0; display: flex; align-items: center; gap: 6px; }
.slot-empty { color: #4a6a8a; font-size: 14px; }
.slot-actions { flex-shrink: 0; }
.no-slots { color: #6a8aaa; font-size: 13px; text-align: center; padding: 12px; }
</style>
