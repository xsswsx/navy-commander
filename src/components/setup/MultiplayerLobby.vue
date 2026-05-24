<script setup lang="ts">
import { ref, reactive, watch } from 'vue'
import { multiplayerClient } from '@/modes/multiplayer/MultiplayerClient'
import type { RoomState } from '@shared/protocol'
import { TEAM_COLORS } from '@/game/constants'
import { ElMessage } from 'element-plus'

const emit = defineEmits<{ 'start-design': [room: RoomState]; 'back': [] }>()

const room = ref<RoomState | null>(null)
const playerId = ref(localStorage.getItem('mp_playerId') || '')
const roomCodeInput = ref('')

// 房间配置 (复用热座风格的参数)
const teamCount = ref(2)
const totalCompartments = ref(10)
const teams = reactive<{ name: string; color: string }[]>([])
const slotNames = reactive<Record<number, string[]>>({})

function initTeams(): void {
  teams.length = 0
  for (let i = 0; i < teamCount.value; i++) {
    teams.push({ name: `队伍${i + 1}`, color: TEAM_COLORS[i % TEAM_COLORS.length] })
    if (!slotNames[i]) slotNames[i] = []
    if (slotNames[i].length === 0) slotNames[i].push(`玩家${i + 1}`)
  }
}
initTeams()

// 监听房间阶段变化 — 所有客户端收到 phase='design' 时自动进入设计
watch(() => room.value?.phase, (phase) => {
  if (phase === 'design' && room.value) {
    emit('start-design', room.value)
  }
})

function addSlot(ti: number): void {
  if (!slotNames[ti]) slotNames[ti] = []
  const total = Object.values(slotNames).reduce((s, a) => s + a.length, 0)
  slotNames[ti].push(`玩家${total + 1}`)
}

function removeSlot(ti: number, si: number): void { slotNames[ti].splice(si, 1) }

function initConnection(): void {
  multiplayerClient.disconnect()
  multiplayerClient.connect()
  multiplayerClient.onRoomState((r) => { room.value = r })
  multiplayerClient.onError((e) => ElMessage.error(e.message))
}

function createRoom(): void {
  if (!playerId.value.trim()) { ElMessage.warning('请输入玩家ID'); return }
  localStorage.setItem('mp_playerId', playerId.value)
  multiplayerClient.createRoom({
    hostName: playerId.value.trim(),
    teamCount: teamCount.value,
    totalCompartments: totalCompartments.value,
    teams: teams.map(t => ({ name: t.name, color: t.color })),
    slotNames: Object.values(slotNames),
  })
}

function joinRoom(): void {
  if (!playerId.value.trim()) { ElMessage.warning('请输入玩家ID'); return }
  if (!roomCodeInput.value.trim()) { ElMessage.warning('请输入房间码'); return }
  localStorage.setItem('mp_playerId', playerId.value)
  multiplayerClient.joinRoom(roomCodeInput.value.trim().toUpperCase(), playerId.value.trim())
}

function leaveRoom(): void { multiplayerClient.leaveSlot(); room.value = null }

function joinSlot(idx: number): void { multiplayerClient.joinSlot(idx) }
function leaveSlot(): void { multiplayerClient.leaveSlot() }
function startGame(): void { multiplayerClient.startGame() }

function copyCode(): void {
  if (room.value) { navigator.clipboard.writeText(room.value.code); ElMessage.success('已复制') }
}

function getTeamColor(teamId: string): string {
  const idx = teams.findIndex(t => t.name === teamId)
  return idx >= 0 ? teams[idx].color : '#888'
}

function isMySlot(slot: any): boolean { return slot.socketId === multiplayerClient.id }

initConnection()
</script>

<template>
  <div class="mp-lobby">
    <!-- 未加入房间: 配置 + 创建/加入 -->
    <div v-if="!room?.code" class="lobby-panel">
      <h3>多人模式</h3>
      <el-input v-model="playerId" placeholder="你的玩家ID" size="small" style="margin-bottom:10px" />

      <div class="config-section">
        <h4>房间配置 (仅创建者需要)</h4>
        <div class="config-row">
          <span>队伍数:</span><el-input-number v-model="teamCount" :min="2" :max="6" size="small" @change="initTeams" />
          <span style="margin-left:12px">舱段数:</span><el-input-number v-model="totalCompartments" :min="2" :max="30" size="small" />
        </div>
        <div v-for="(team, ti) in teams" :key="ti" class="team-row" :style="{ borderColor: team.color }">
          <el-input v-model="teams[ti].name" size="small" style="width:100px" />
          <el-color-picker v-model="teams[ti].color" size="small" />
          <span v-for="(sn, si) in slotNames[ti]" :key="si" class="slot-tag">
            {{ sn }}<el-button size="small" circle @click="removeSlot(ti, si)" style="margin-left:2px">-</el-button>
          </span>
          <el-button size="small" text @click="addSlot(ti)">+</el-button>
        </div>
      </div>

      <div class="actions">
        <el-button type="primary" @click="createRoom">创建房间</el-button>
        <el-divider direction="vertical" />
        <el-input v-model="roomCodeInput" placeholder="房间码" size="small" style="width:100px" />
        <el-button @click="joinRoom">加入房间</el-button>
      </div>
      <el-button text size="small" @click="emit('back')" style="margin-top:12px">返回</el-button>
    </div>

    <!-- 已加入房间 -->
    <div v-else class="lobby-panel">
      <h3>房间 {{ room.code }} <el-button size="small" text @click="copyCode">复制</el-button></h3>
      <p class="info">{{ room.slots.length }}个位置 · {{ new Set(room.slots.map(s=>s.teamId)).size }}队 · 舱段{{ room.totalCompartments }}</p>

      <div class="slot-list">
        <div v-for="slot in room.slots" :key="slot.index" class="slot-item" :style="{ borderColor: getTeamColor(slot.teamId) }">
          <span class="slot-label" :style="{ color: getTeamColor(slot.teamId) }">{{ slot.teamId }} #{{ slot.index + 1 }}</span>
          <span v-if="slot.playerName" class="slot-name">{{ slot.playerName }} <el-tag v-if="slot.isReady" type="success" size="small">已准备</el-tag></span>
          <span v-else class="slot-empty">空位</span>
          <template v-if="!slot.playerName">
            <el-button size="small" type="primary" @click="joinSlot(slot.index)">加入位置</el-button>
          </template>
          <template v-else-if="isMySlot(slot)">
            <el-button size="small" type="danger" @click="leaveSlot">离开位置</el-button>
          </template>
          <template v-else>
            <el-tag size="small" type="info">已占用</el-tag>
          </template>
        </div>
      </div>

      <div style="margin-top:12px">
        <el-button v-if="room.hostSocketId === multiplayerClient.id && room.phase === 'lobby'" type="success" @click="startGame">开始游戏</el-button>
        <el-button text size="small" type="danger" @click="leaveRoom">离开房间</el-button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.mp-lobby { max-width: 620px; margin: 0 auto; }
.lobby-panel { background: rgba(13,33,55,0.85); border: 1px solid #1a3355; border-radius: 8px; padding: 20px; }
.lobby-panel h3 { color: #409eff; margin-bottom: 10px; }
.config-section { margin: 8px 0; }
.config-section h4 { color: #a0b8d0; font-size: 12px; }
.config-row { display: flex; align-items: center; gap: 8px; margin: 6px 0; color: #a0b8d0; font-size: 13px; }
.team-row { display: flex; align-items: center; gap: 6px; padding: 4px 8px; margin: 4px 0; border-left: 3px solid #409eff; }
.slot-tag { font-size: 11px; color: #a0b8d0; display: flex; align-items: center; }
.actions { display: flex; align-items: center; gap: 8px; margin-top: 10px; }
.info { color: #6a8aaa; font-size: 13px; }
.slot-list { display: flex; flex-direction: column; gap: 6px; margin-top: 10px; }
.slot-item { display: flex; align-items: center; gap: 10px; padding: 8px 12px; border-left: 4px solid; background: rgba(20,40,70,0.5); border-radius: 4px; }
.slot-label { font-weight: bold; font-size: 13px; min-width: 80px; }
.slot-name { color: #d0e0f0; font-size: 13px; display: flex; align-items: center; gap: 4px; }
.slot-empty { color: #4a6a8a; font-size: 13px; flex: 1; }
</style>
