<script setup lang="ts">
// 「控制」面板：下发关节、回就绪、规划执行、停止
import type { Pose } from '../types'
import { JOINTS } from '../types'

defineProps<{
  busy: boolean
  note: string
  joints: number[]
  pose: Pose
}>()

const emit = defineEmits<{
  close: []
  fill: []
  'set-joint': [index: number, value: number]
  'set-pose': [key: keyof Pose, value: number]
  joints: []
  ready: []
  pose: []
  stop: []
}>()

const poseFields: Array<{ key: keyof Pose; label: string; step: number }> = [
  { key: 'x', label: 'X', step: 1 },
  { key: 'y', label: 'Y', step: 1 },
  { key: 'z', label: 'Z', step: 1 },
  { key: 'rx', label: 'Rx', step: 0.5 },
  { key: 'ry', label: 'Ry', step: 0.5 },
  { key: 'rz', label: 'Rz', step: 0.5 },
]

function onNumber(event: Event, apply: (value: number) => void) {
  const value = Number((event.target as HTMLInputElement).value)
  if (Number.isFinite(value)) apply(value)
}
</script>

<template>
  <form class="command-dock" @submit.prevent>
    <header class="command-head">
      <div>
        <p class="eyebrow">控制 · panda_arm</p>
        <strong>下发到 Gazebo</strong>
      </div>
      <button type="button" class="text-btn" @click="emit('close')">关闭</button>
    </header>

    <div>
      <p class="eyebrow">关节目标 · °</p>
      <div class="target-grid">
        <label v-for="(spec, index) in JOINTS" :key="spec.id">
          <span>{{ spec.id }}</span>
          <input
            type="number"
            :step="0.5"
            :min="spec.min"
            :max="spec.max"
            :value="joints[index]"
            :disabled="busy"
            @change="onNumber($event, (value) => emit('set-joint', index, value))"
          />
        </label>
      </div>
    </div>

    <div>
      <p class="eyebrow">末端目标 · mm / °，相对 panda_link0</p>
      <div class="target-grid pose-grid">
        <label v-for="field in poseFields" :key="field.key">
          <span>{{ field.label }}</span>
          <input
            type="number"
            :step="field.step"
            :value="pose[field.key]"
            :disabled="busy"
            @change="onNumber($event, (value) => emit('set-pose', field.key, value))"
          />
        </label>
      </div>
    </div>

    <div class="command-actions">
      <button type="button" :disabled="busy" @click="emit('fill')">填入当前</button>
      <button type="button" :disabled="busy" @click="emit('joints')">指定关节</button>
      <button type="button" :disabled="busy" @click="emit('ready')">初始姿态</button>
      <button type="button" :disabled="busy" @click="emit('pose')">规划执行</button>
      <button type="button" class="stop" @click="emit('stop')">停止</button>
    </div>
    <p class="command-note">{{ note }}</p>
  </form>
</template>
