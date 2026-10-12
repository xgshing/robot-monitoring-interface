<script setup lang="ts">
import { computed } from 'vue'
import { formatNum } from '../format'
import type { ConsoleState } from '../types'

const props = defineProps<{
  state: ConsoleState
}>()

const emit = defineEmits<{ ack: [] }>()

const shoulder = computed(() => 26 + props.state.joints[1].angle * 0.55)
const elbow = computed(() => -36 + (props.state.joints[2].angle - 46) * 0.62)
const wrist = computed(() => props.state.joints[4].angle * 0.28)
const yaw = computed(() => props.state.joints[0].angle * 0.06)
</script>

<template>
  <section class="stage">
    <div class="stage-view">
      <svg class="arm-svg" viewBox="0 0 460 500" role="img" aria-label="六轴机械臂姿态">
        <defs>
          <radialGradient id="tx-spot" cx="50%" cy="42%" r="55%">
            <stop offset="0%" stop-color="rgba(126, 160, 214, 0.16)" />
            <stop offset="100%" stop-color="rgba(126, 160, 214, 0)" />
          </radialGradient>
          <radialGradient id="tx-floor" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stop-color="rgba(255,255,255,0.14)" />
            <stop offset="70%" stop-color="rgba(255,255,255,0.03)" />
            <stop offset="100%" stop-color="rgba(255,255,255,0)" />
          </radialGradient>
          <linearGradient id="tx-metal" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stop-color="#e7eef6" />
            <stop offset="38%" stop-color="#aeb8c6" />
            <stop offset="100%" stop-color="#596474" />
          </linearGradient>
          <linearGradient id="tx-metal-2" x1="1" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#f4f7fb" />
            <stop offset="45%" stop-color="#9aa6b6" />
            <stop offset="100%" stop-color="#4e5968" />
          </linearGradient>
          <radialGradient id="tx-cap" cx="32%" cy="30%" r="70%">
            <stop offset="0%" stop-color="#ffffff" />
            <stop offset="42%" stop-color="#c5ceda" />
            <stop offset="100%" stop-color="#5c6776" />
          </radialGradient>
        </defs>

        <ellipse cx="230" cy="250" rx="190" ry="170" fill="url(#tx-spot)" />
        <ellipse cx="188" cy="458" rx="108" ry="18" fill="url(#tx-floor)" />

        <g :transform="`translate(188 430) rotate(${yaw})`">
          <path d="M-78 18h156l-16 28H-62z" fill="url(#tx-metal)" />
          <rect x="-58" y="-8" width="116" height="40" rx="16" fill="url(#tx-metal-2)" />
          <rect x="-34" y="-78" width="68" height="78" rx="18" fill="url(#tx-metal)" />
          <circle cx="22" cy="12" r="4" :fill="state.connected ? '#3ecf8e' : '#ff5d5d'" />

          <g :transform="`translate(0 -78) rotate(${shoulder})`">
            <circle r="30" fill="url(#tx-cap)" />
            <circle r="16" fill="none" stroke="rgba(255,255,255,0.35)" stroke-width="3" />
            <rect x="-18" y="-132" width="36" height="132" rx="18" fill="url(#tx-metal)" />
            <rect x="-18" y="-132" width="9" height="132" rx="8" fill="rgba(255,255,255,0.16)" />

            <g transform="translate(0 -132)">
              <g :transform="`rotate(${elbow})`">
                <circle r="22" fill="url(#tx-cap)" />
                <circle r="11" fill="none" stroke="rgba(255,255,255,0.28)" stroke-width="2" />
                <rect x="-14" y="-112" width="28" height="112" rx="14" fill="url(#tx-metal-2)" />
                <rect x="-14" y="-112" width="7" height="112" rx="6" fill="rgba(255,255,255,0.14)" />

                <g transform="translate(0 -112)">
                  <g :transform="`rotate(${wrist})`">
                    <circle r="15" fill="url(#tx-cap)" />
                    <rect x="-8" y="-36" width="16" height="34" rx="6" fill="url(#tx-metal)" />
                    <g :transform="state.gripping ? 'scale(0.62 1)' : 'scale(1 1)'">
                      <path d="M-8 -34l-16-20h9l9 12z" fill="#d5deea" />
                      <path d="M8 -34l16-20h-9l-9 12z" fill="#8e9bab" />
                    </g>
                  </g>
                </g>
              </g>
            </g>
          </g>
        </g>
      </svg>

      <span class="pin warn pin-shoulder" :title="state.pins.shoulder.note"><i></i>{{ state.pins.shoulder.count }} 警告</span>
      <span class="pin warn pin-elbow" :title="state.pins.elbow.note"><i></i>{{ state.pins.elbow.count }} 警告</span>
      <span class="pin warn pin-base" :title="state.pins.base.note"><i></i>{{ state.pins.base.count }} 警告</span>
      <span class="pin err pin-wrist" :title="state.pins.errors.note"><i></i>{{ state.pins.errors.count }} 错误</span>
      <svg class="warn-mark" viewBox="0 0 20 18" aria-hidden="true">
        <path d="M10 1.2 18.6 16.4H1.4L10 1.2Z" fill="#f5b942" />
        <path d="M10 6.2v5" stroke="#2a2110" stroke-width="1.6" stroke-linecap="round" />
        <circle cx="10" cy="14" r="0.9" fill="#2a2110" />
      </svg>

      <div v-if="state.faultMessage" class="fault-banner" role="alert">
        <strong>错误</strong>
        <span>{{ state.faultMessage }}</span>
        <button type="button" @click="emit('ack')">恢复</button>
      </div>

      <div v-if="!state.connected" class="offline">
        <strong>控制器未连接</strong>
        <p>关节反馈与路径规划已冻结</p>
      </div>
    </div>

    <article class="task-card">
      <div>
        <p class="eyebrow">当前任务</p>
        <h3>{{ state.taskName }}</h3>
        <div class="phase-row">
          <span>{{ state.taskPhase }}</span>
          <b>{{ state.taskProgress }}%</b>
        </div>
        <div
          class="bar"
          :class="{ bad: !state.plannerOk }"
          role="progressbar"
          :aria-valuenow="state.taskProgress"
          aria-valuemin="0"
          aria-valuemax="100"
        >
          <i :style="{ width: `${state.taskProgress}%` }"></i>
        </div>
      </div>
      <div>
        <p class="eyebrow">目标位置 · mm / °</p>
        <dl class="pose">
          <div><dt>X</dt><dd>{{ formatNum(state.target.x, 1) }}</dd></div>
          <div><dt>Y</dt><dd>{{ formatNum(state.target.y, 1) }}</dd></div>
          <div><dt>Z</dt><dd>{{ formatNum(state.target.z, 1) }}</dd></div>
          <div><dt>Rx</dt><dd>{{ formatNum(state.target.rx, 1) }}</dd></div>
          <div><dt>Ry</dt><dd>{{ formatNum(state.target.ry, 1) }}</dd></div>
          <div><dt>Rz</dt><dd>{{ formatNum(state.target.rz, 1) }}</dd></div>
        </dl>
      </div>
      <div>
        <p class="eyebrow">规划结果</p>
        <strong class="plan-status" :class="state.plannerOk ? 'ok' : 'bad'">{{ state.plannerStatus }}</strong>
        <p v-if="state.waypoints" class="plan-meta">
          {{ state.plannerName }} · {{ state.waypoints }} 路点 · {{ (state.planMs / 1000).toFixed(2) }} s
        </p>
        <p v-else class="plan-meta">{{ state.plannerName }} · 等待下发</p>
      </div>
    </article>
  </section>
</template>
