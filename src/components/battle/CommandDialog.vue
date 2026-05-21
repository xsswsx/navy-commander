<script setup lang="ts">
import type { Compartment } from '@/game/types'
import { getEquipment } from '@/game/equipment/registry'

defineProps<{
  options: { id: string; name: string }[]
  compartment: Compartment
}>()

const emit = defineEmits<{
  select: [optionId: string]
  cancel: []
}>()

function eqName(comp: Compartment): string {
  if (!comp.equipmentType) return '未知'
  return getEquipment(comp.equipmentType).name
}
</script>

<template>
  <el-dialog
    :model-value="true"
    :title="`选择指挥动作 — ${eqName(compartment)}`"
    width="400px"
    :close-on-click-modal="false"
    @close="emit('cancel')"
  >
    <div class="command-options">
      <div
        v-for="opt in options"
        :key="opt.id"
        class="command-option"
        @click="emit('select', opt.id)"
      >
        <span class="cmd-icon">⚡</span>
        <span class="cmd-name">{{ opt.name }}</span>
      </div>
    </div>
    <template #footer>
      <el-button @click="emit('cancel')">取消</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.command-options {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.command-option {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  background: rgba(20, 50, 80, 0.6);
  border: 2px solid #3a5a7f;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.15s;
}

.command-option:hover {
  border-color: #409eff;
  background: rgba(64, 158, 255, 0.15);
}

.cmd-icon {
  font-size: 18px;
}

.cmd-name {
  font-size: 15px;
  font-weight: bold;
  color: #d0e0f0;
}
</style>
