<script setup lang="ts">
import { ref } from 'vue'
import { formatNum } from '../format'
import type { ConsoleState } from '../types'

defineProps<{
  state: ConsoleState
}>()

const emit = defineEmits<{
  link: []
  run: []
  snapshot: []
}>()

const gridOn = ref(false)
</script>

<template>
  <aside class="side">
    <div class="camera">
      <svg viewBox="0 0 320 180" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
        <defs>
          <linearGradient id="cam-bg" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#243044" />
            <stop offset="100%" stop-color="#101820" />
          </linearGradient>
          <linearGradient id="cam-arm" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stop-color="#ffe08a" />
            <stop offset="100%" stop-color="#e0a322" />
          </linearGradient>
        </defs>
        <rect width="320" height="180" fill="url(#cam-bg)" />
        <g fill="rgba(255,255,255,0.18)">
          <circle cx="48" cy="36" r="10" />
          <circle cx="250" cy="28" r="6" />
          <circle cx="280" cy="70" r="16" />
        </g>
        <path d="M0 128h320v52H0z" fill="#1a2430" />
        <path d="M18 128h80l-14 34H4z" fill="#2a3544" />
        <path d="M210 132h90l10 30h-84z" fill="#2c3848" />
        <g fill="url(#cam-arm)">
          <rect x="78" y="78" width="46" height="16" rx="8" transform="rotate(-28 78 78)" />
          <rect x="112" y="58" width="40" height="12" rx="6" transform="rotate(18 112 58)" />
          <circle cx="86" cy="108" r="12" />
          <rect x="78" y="108" width="16" height="24" rx="6" />
        </g>
        <g fill="url(#cam-arm)">
          <rect x="188" y="84" width="52" height="14" rx="7" transform="rotate(24 188 84)" />
          <rect x="214" y="62" width="36" height="11" rx="5" transform="rotate(-16 214 62)" />
          <circle cx="196" cy="112" r="11" />
          <rect x="188" y="112" width="16" height="22" rx="6" />
        </g>
        <g fill="#d7dee8">
          <rect x="24" y="146" width="70" height="8" rx="2" />
          <rect x="214" y="150" width="78" height="8" rx="2" />
        </g>
      </svg>
      <span class="camera-tag">CAMERA 02</span>
      <i class="rec" aria-hidden="true"></i>
      <div v-if="gridOn" class="cam-grid"></div>
    </div>

    <div class="cam-actions">
      <button type="button" :class="{ bad: !state.connected }" title="连接或断开控制器" @click="emit('link')">
        <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
          <path d="M12 3v7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
          <path d="M7 6.5a7 7 0 1 0 10 0" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
        </svg>
      </button>
      <button type="button" :class="{ ok: state.runState === 'running' }" title="暂停或继续任务" @click="emit('run')">
        <svg v-if="state.runState === 'running'" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
          <path d="M7 6h3.2v12H7zM13.8 6H17v12h-3.2z" fill="currentColor" />
        </svg>
        <svg v-else viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
          <path d="M8 6l10 6-10 6V6z" fill="currentColor" />
        </svg>
      </button>
      <button type="button" title="抓取当前画面" @click="emit('snapshot')">
        <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
          <circle cx="12" cy="12" r="3.2" fill="none" stroke="currentColor" stroke-width="1.6" />
          <circle cx="12" cy="12" r="7" fill="none" stroke="currentColor" stroke-width="1.6" />
        </svg>
      </button>
      <button type="button" :class="{ ok: gridOn }" title="叠加相机网格" @click="gridOn = !gridOn">
        <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
          <path d="M5 5h14v14H5zM5 10h14M5 15h14M10 5v14M15 5v14" fill="none" stroke="currentColor" stroke-width="1.4" />
        </svg>
      </button>
    </div>

    <div class="telemetry">
      <div>
        <p class="tele-label">主轴转速</p>
        <p class="tele-value">{{ formatNum(Math.round(state.spindleRpm)) }} <small>rpm</small></p>
      </div>
      <div class="temps">
        <p class="temp-row"><span>柜内温度</span><b>{{ formatNum(state.cabinetTemp, 2) }}°C</b></p>
        <p class="temp-row"><span>驱动温度</span><b>{{ formatNum(state.driveTemp, 2) }}°C</b></p>
      </div>
    </div>

    <div class="led-card" aria-label="伺服与 IO 状态">
      <i v-for="(led, index) in state.leds" :key="index" class="led" :class="led"></i>
    </div>
  </aside>
</template>
