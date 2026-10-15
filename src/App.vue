<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import ChartColumn from './components/ChartColumn.vue'
import EventLog from './components/EventLog.vue'
import JointColumn from './components/JointColumn.vue'
import RobotStage from './components/RobotStage.vue'
import SidePanel from './components/SidePanel.vue'
import WindowChrome from './components/WindowChrome.vue'
import { useRosLive } from './composables/useRosLive'
import { useRobotSimulation } from './composables/useSimulation'
import { formatNum, formatPct } from './format'

const { state, toggleRun, acknowledge, selectJoint, snapshot, pushLog } = useRobotSimulation()
const bridge = useRosLive(state, pushLog)
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
  if (!state.connected || state.runState === 'idle') return '待机'
  if (state.runState === 'fault') return '故障'
  if (state.runState === 'paused') return '已暂停'
  return '执行中'
})

const linkLabel = computed(() => {
  if (state.linkMode === 'ros') return state.connected ? '已连接' : '连接中'
  return '模拟'
})

const linkTone = computed(() => (state.linkMode === 'ros' && state.connected ? 'ok' : 'idle'))

const subtitle = computed(() =>
  state.linkMode === 'ros' ? '已接入 Gazebo / MoveIt' : '模拟数据 · 等待 rosbridge',
)

function onToggleRun() {
  if (state.linkMode === 'ros') {
    bridge.cancelMotion()
    return
  }
  toggleRun()
}

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
      <WindowChrome
        :clock="state.clock"
        :connected="state.linkMode === 'ros' && state.connected"
        :model="state.robotName"
        :url="state.linkMode === 'ros' ? bridge.url : 'sim://franka-panda'"
      />
      <main class="console">
        <section class="welcome">
          <div>
            <h1>欢迎回来</h1>
            <p>{{ subtitle }}</p>
          </div>
          <div class="status-row">
            <button
              type="button"
              class="status-pill"
              :class="linkTone"
              title="连接 rosbridge，或切回模拟数据"
              @click="bridge.toggleLink"
            >
              <i></i>
              <span>{{ linkLabel }}</span>
              <em>{{ state.linkMode === 'ros' ? `${state.latencyMs} ms` : '—' }}</em>
            </button>
            <button
              type="button"
              class="status-pill"
              :class="runTone"
              :title="state.linkMode === 'ros' ? '停止当前动作' : '暂停或继续模拟任务'"
              @click="onToggleRun"
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
        <RobotStage
          :state="state"
          :command-open="bridge.command.open"
          :command-busy="bridge.command.busy"
          :command-note="bridge.command.note"
          :command-joints="bridge.command.joints"
          :command-pose="bridge.command.pose"
          @ack="acknowledge"
          @command="bridge.openCommand()"
          @close-command="bridge.command.open = false"
          @fill="bridge.fillCommand()"
          @set-joint="bridge.setJointTarget"
          @set-pose="bridge.setPoseTarget"
          @joints="bridge.sendJointTarget()"
          @ready="bridge.sendReady()"
          @pose="bridge.sendPose()"
          @stop="bridge.cancelMotion()"
        />
        <SidePanel :state="state" @link="bridge.toggleLink" @run="onToggleRun" @snapshot="snapshot" />
        <ChartColumn :state="state" @select="selectJoint" />
        <EventLog :state="state" @ack="acknowledge" />
      </main>
      <div v-if="!ready" class="boot" role="status">
        <div class="boot-mark"></div>
        <p>正在同步 Franka Panda</p>
      </div>
    </div>
  </div>
</template>
