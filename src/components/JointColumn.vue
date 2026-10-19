<script setup lang="ts">
// 左侧七个关节的数值
import { formatNum, formatSigned, jointRatio } from '../format'
import type { ConsoleState } from '../types'
import { JOINTS } from '../types'

defineProps<{
  state: ConsoleState
}>()

const emit = defineEmits<{ select: [index: number] }>()

function deltaTone(delta: number) {
  if (delta > 0.05) return 'up'
  if (delta < -0.05) return 'down'
  return 'flat'
}
</script>

<template>
  <section class="joints" :class="{ dim: !state.connected }" aria-label="关节角度">
    <button
      v-for="(joint, index) in state.joints"
      :key="joint.id"
      type="button"
      class="joint"
      :class="{ on: state.selectedJoint === index }"
      :style="{ '--c': JOINTS[index].color }"
      :aria-pressed="state.selectedJoint === index"
      @click="emit('select', index)"
    >
      <p class="joint-name">{{ joint.id }} · {{ joint.name }}</p>
      <p class="joint-angle">{{ formatNum(joint.angle, 3) }}<small>°</small></p>
      <p class="joint-meta">
        <span :class="deltaTone(joint.delta)">Δ {{ formatSigned(joint.delta) }}°</span>
        <span>{{ formatNum(joint.rpm) }} rpm</span>
      </p>
      <span class="track" aria-hidden="true">
        <i :style="{ left: `${jointRatio(joint.angle, JOINTS[index].min, JOINTS[index].max) * 100}%` }"></i>
      </span>
    </button>
  </section>
</template>
