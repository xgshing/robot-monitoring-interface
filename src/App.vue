<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import ChartColumn from './components/ChartColumn.vue'
import EventLog from './components/EventLog.vue'
import JointColumn from './components/JointColumn.vue'
import RobotStage from './components/RobotStage.vue'
import SidePanel from './components/SidePanel.vue'
import WindowChrome from './components/WindowChrome.vue'
import { useRobotSimulation } from './composables/useSimulation'
import { formatNum, formatPct } from './format'

const { state, toggleLink, toggleRun, acknowledge, selectJoint, snapshot } = useRobotSimulation()
const ready = ref(false)

onMounted(() => {
  window.setTimeout(() => {
    ready.value = true
  }, 520)
})

const kpis = computed(() => [
  {
    label: '紧急告警',
    value: formatNum(Math.round(state.emergencies)),
    delta: state.emergencyDelta,
    upIsBad: true,
    dot: 'red',
  },
  {
    label: '健康评分',
    value: formatNum(Math.round(state.health)),
    delta: state.healthDelta,
    upIsBad: false,
    dot: 'cyan',
  },
  {
    label: '平均转速',
    value: formatNum(Math.round(state.avgRpm)),
    delta: state.speedDelta,
    upIsBad: false,
    dot: 'green',
  },
])

const runTone = computed(() => {
  if (!state.connected || state.runState === 'idle') return 'idle'
  if (state.runState === 'fault') return 'bad'
  if (state.runState === 'paused') return 'warn'
  return 'ok'
})

const runLabel = computed(() => {
  if (!state.connected) return '待机'
  if (state.runState === 'fault') return '故障'
  if (state.runState === 'paused') return '已暂停'
  return '执行中'
})

function tone(delta: number, upIsBad: boolean) {
  const rising = delta >= 0
  if (upIsBad) return rising ? 'bad' : 'good'
  return rising ? 'good' : 'bad'
}
</script>

<template>
  <div class="space">
    <div class="stars" aria-hidden="true"></div>
    <div class="window">
      <WindowChrome :clock="state.clock" :connected="state.connected" />
      <main class="console">
        <section class="welcome">
          <div>
            <h1>欢迎回来</h1>
            <p>回到工位控制台</p>
          </div>
          <div class="status-row">
            <button
              type="button"
              class="status-pill"
              :class="state.connected ? 'ok' : 'bad'"
              title="连接或断开控制器"
              @click="toggleLink"
            >
              <i></i>
              <span>{{ state.connected ? '已连接' : '未连接' }}</span>
              <em>{{ state.connected ? `${state.latencyMs} ms` : '—' }}</em>
            </button>
            <button
              type="button"
              class="status-pill"
              :class="runTone"
              title="暂停、继续或确认故障"
              @click="toggleRun"
            >
              <i></i>
              <span>{{ runLabel }}</span>
            </button>
          </div>
        </section>

        <section class="kpis" aria-label="班次指标">
          <article v-for="card in kpis" :key="card.label" class="kpi">
            <p class="kpi-label"><i class="dot" :class="card.dot"></i>{{ card.label }}</p>
            <p class="kpi-value">{{ card.value }}</p>
            <p class="delta" :class="tone(card.delta, card.upIsBad)">
              <i class="arrow" :class="card.delta >= 0 ? 'up' : 'down'"></i>
              <span>{{ formatPct(card.delta) }}</span>
              <span class="hint">较上个班次</span>
            </p>
          </article>
        </section>

        <JointColumn :state="state" @select="selectJoint" />
        <RobotStage :state="state" @ack="acknowledge" />
        <SidePanel :state="state" @link="toggleLink" @run="toggleRun" @snapshot="snapshot" />
        <ChartColumn :state="state" @select="selectJoint" />
        <EventLog :state="state" @ack="acknowledge" />
      </main>
      <div v-if="!ready" class="boot" role="status">
        <div class="boot-mark"></div>
        <p>正在同步 TX2-140 控制器</p>
      </div>
    </div>
  </div>
</template>
