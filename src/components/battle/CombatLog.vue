<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue'
import { useCombatStore } from '@/stores/combat'

const combatStore = useCombatStore()
const logPanel = ref<HTMLElement | null>(null)
const collapsed = ref(false)

const recentLogs = computed(() => {
  return [...combatStore.combatLog].slice(-40).reverse()
})

watch(() => combatStore.combatLog.length, async () => {
  await nextTick()
  if (logPanel.value) {
    logPanel.value.scrollTop = logPanel.value.scrollHeight
  }
})
</script>

<template>
  <aside class="combat-log" :class="{ collapsed }">
    <div class="log-header" @click="collapsed = !collapsed">
      <span>战斗记录</span>
      <el-button size="small" text>{{ collapsed ? '展开' : '收起' }}</el-button>
    </div>

    <div v-if="!collapsed" ref="logPanel" class="log-body">
      <div
        v-for="entry in recentLogs"
        :key="entry.id"
        class="log-entry"
        :class="`log-${entry.type}`"
      >
        <span class="log-time">{{ new Date(entry.timestamp).toLocaleTimeString() }}</span>
        {{ entry.message }}
      </div>
      <div v-if="combatStore.combatLog.length === 0" class="log-empty">
        暂无记录
      </div>
    </div>
  </aside>
</template>

<style scoped>
.combat-log {
  width: 240px;
  flex-shrink: 0;
  background: rgba(13, 33, 55, 0.9);
  border-left: 2px solid #1a3355;
  display: flex;
  flex-direction: column;
  transition: width 0.3s;
}

.combat-log.collapsed {
  width: 40px;
}

.log-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 10px;
  cursor: pointer;
  font-size: 13px;
  font-weight: bold;
  color: #a0b8d0;
  border-bottom: 1px solid #1a3355;
  flex-shrink: 0;
}

.log-body {
  flex: 1;
  overflow-y: auto;
  padding: 8px 10px;
}

.log-entry {
  font-size: 11px;
  line-height: 1.8;
  font-family: monospace;
  padding: 2px 0;
  border-bottom: 1px solid rgba(26, 51, 85, 0.4);
}

.log-time {
  color: #4a6a8a;
  margin-right: 4px;
}

.log-entry.log-info { color: #a0b8d0; }
.log-entry.log-damage { color: #f56c6c; }
.log-entry.log-destroy { color: #e6a23c; }
.log-entry.log-effect { color: #67c23a; }
.log-entry.log-system { color: #409eff; }

.log-empty {
  color: #4a6a8a;
  font-size: 12px;
  text-align: center;
  padding: 20px 0;
}
</style>
