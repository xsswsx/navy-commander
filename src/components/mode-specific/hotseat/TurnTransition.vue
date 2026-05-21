<script setup lang="ts">
defineProps<{
  toPlayerName: string
}>()

const emit = defineEmits<{
  confirm: []
}>()
</script>

<template>
  <div class="turn-transition">
    <div class="transition-card">
      <h2>请将设备递给</h2>
      <div class="player-name">{{ toPlayerName }}</div>
      <p class="hint">点按确认后显示手牌</p>
      <el-button type="primary" size="large" @click="emit('confirm')">
        我是 {{ toPlayerName }}，开始回合
      </el-button>
    </div>
  </div>
</template>

<style scoped>
.turn-transition {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  background: rgba(5, 10, 20, 0.95);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.transition-card {
  text-align: center;
}

.transition-card h2 {
  font-size: 24px;
  color: #a0b8d0;
  margin-bottom: 16px;
}

.player-name {
  font-size: 48px;
  font-weight: bold;
  color: #409eff;
  margin-bottom: 16px;
}

.hint {
  color: #5a7a9a;
  margin-bottom: 24px;
}
</style>
