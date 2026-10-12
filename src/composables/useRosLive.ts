import { onMounted, onUnmounted } from 'vue'
import { formatClock } from '../format'
import {
  endEffectorPose,
  liveJoints,
  logFromRosout,
  planSummary,
  rememberTf,
  runStateFromStatus,
  type TfEdge,
} from '../ros/parse'
import { RosBridgeClient } from '../ros/rosbridge'
import type { ConsoleState, LogLevel, RunState } from '../types'
import { JOINTS } from '../types'

const HISTORY = 48
const SAMPLE_MS = 400
const RETRY_MS = 3000

const MOVE_STATUS = '/move_action/_action/status'
const FOLLOW_STATUS = '/panda_arm_controller/follow_joint_trajectory/_action/status'

export function bridgeUrl() {
  const query = new URLSearchParams(window.location.search).get('ros')
  if (query === 'off' || query === '0') return null
  if (query) return query
  return import.meta.env.VITE_ROSBRIDGE_URL || 'ws://127.0.0.1:9090'
}

export function useRosLive(
  state: ConsoleState,
  pushLog: (level: LogLevel, title: string, detail: string) => void,
) {
  const client = new RosBridgeClient()
  const tf = new Map<string, TfEdge>()
  const seenLogs = new Map<string, number>()
  const url = bridgeUrl()
  let attempt = 0
  let preferSim = false
  let loggedOffline = false
  let primed = false
  let lastJointAt = 0
  let lastPlanKey = ''
  let runStarted = 0
  let moveState: RunState | null = null
  let followState: RunState | null = null
  let health0 = state.health
  let rpm0 = state.avgRpm
  let emerg0 = Math.max(1, state.emergencies)
  let prevAngles = state.joints.map((joint) => joint.angle)
  let retryTimer = 0
  let sampleTimer = 0

  function subscribeAll() {
    client.subscribe(
      { topic: '/joint_states', type: 'sensor_msgs/msg/JointState', throttleRate: 80 },
      onJoints,
    )
    client.subscribe(
      {
        topic: '/display_planned_path',
        type: 'moveit_msgs/msg/DisplayTrajectory',
        durability: 'volatile',
      },
      onPlan,
    )
    client.subscribe({ topic: MOVE_STATUS, type: 'action_msgs/msg/GoalStatusArray' }, (message) =>
      onStatus('move', message),
    )
    client.subscribe({ topic: FOLLOW_STATUS, type: 'action_msgs/msg/GoalStatusArray' }, (message) =>
      onStatus('follow', message),
    )
    client.subscribe(
      { topic: '/rosout', type: 'rcl_interfaces/msg/Log', throttleRate: 200 },
      onRosout,
    )
    client.subscribe({ topic: '/tf', type: 'tf2_msgs/msg/TFMessage', throttleRate: 100 }, onTf)
    client.subscribe(
      { topic: '/tf_static', type: 'tf2_msgs/msg/TFMessage', durability: 'transient_local' },
      onTf,
    )
  }

  function resetHistory() {
    state.timeLabels.splice(0)
    state.angleHistory.forEach((series) => series.splice(0))
    state.speedHistory.splice(0)
    state.revision += 1
    prevAngles = state.joints.map((joint) => joint.angle)
  }

  function enterRos() {
    resetHistory()
    state.linkMode = 'ros'
    state.connected = true
    state.robotName = 'Franka Panda'
    state.plannerName = 'MoveIt'
    state.taskName = '等待 MoveIt 规划'
    state.taskPhase = '空闲'
    state.taskProgress = 0
    state.gripping = false
    state.runState = 'idle'
    state.waypoints = 0
    state.planMs = 0
    state.plannerStatus = '等待规划'
    state.plannerOk = true
    state.faultMessage = null
    primed = false
    lastJointAt = 0
    lastPlanKey = ''
    moveState = null
    followState = null
    loggedOffline = false
    pushLog('ok', '已接入 Gazebo / MoveIt', url ?? '')
  }

  function onJoints(message: unknown) {
    if (state.linkMode !== 'ros') return
    const live = liveJoints(message, JOINTS)
    if (live.angles.every((angle) => Number.isNaN(angle))) return
    const now = performance.now()
    if (lastJointAt > 0) state.latencyMs = Math.max(1, Math.min(999, Math.round(now - lastJointAt)))
    lastJointAt = now
    let rpmSum = 0
    let rpmCount = 0
    state.joints.forEach((joint, index) => {
      if (!Number.isFinite(live.angles[index])) return
      joint.angle = live.angles[index]
      joint.velocity = live.velocities[index]
      joint.rpm = live.rpms[index]
      joint.temperature += (36.2 + index * 0.3 + joint.rpm * 0.02 - joint.temperature) * 0.2
      rpmSum += joint.rpm
      rpmCount += 1
    })
    if (rpmCount > 0) state.avgRpm = rpmSum / rpmCount
    let penalty = state.runState === 'fault' ? 70 : 0
    state.joints.forEach((joint, index) => {
      const spec = JOINTS[index]
      const mid = (spec.max + spec.min) / 2
      const reach = Math.abs(joint.angle - mid) / ((spec.max - spec.min) / 2)
      if (reach > 0.92) penalty += 12
    })
    const targetHealth = 968 - penalty
    state.health += (targetHealth - state.health) * 0.2
    if (!primed) {
      primed = true
      rpm0 = state.avgRpm
      health0 = state.health
      emerg0 = Math.max(1, state.emergencies)
    }
    refreshDeltas()
  }

  function onPlan(message: unknown) {
    if (state.linkMode !== 'ros') return
    const summary = planSummary(message)
    if (summary.waypoints <= 0) return
    state.waypoints = summary.waypoints
    state.planMs = summary.planMs
    state.plannerName = 'MoveIt'
    state.plannerStatus = '已规划'
    state.plannerOk = true
    state.taskName = 'MoveIt 轨迹'
    if (state.runState !== 'running') {
      state.taskPhase = '已规划'
      state.taskProgress = 100
    }
    const key = `${summary.waypoints}:${summary.planMs}`
    if (key === lastPlanKey) return
    lastPlanKey = key
    pushLog('ok', '收到规划轨迹', `${summary.waypoints} 个路点，时长 ${(summary.planMs / 1000).toFixed(2)} s`)
  }

  function onStatus(source: 'move' | 'follow', message: unknown) {
    if (state.linkMode !== 'ros') return
    const next = runStateFromStatus(message)
    if (!next) return
    if (source === 'move') moveState = next
    else followState = next
    const merged = mergeRun(moveState, followState)
    if (!merged || merged === state.runState) {
      if (merged === 'running') updateProgress()
      return
    }
    const previous = state.runState
    state.runState = merged
    if (merged === 'running') {
      runStarted = performance.now()
      state.taskPhase = '执行'
      state.faultMessage = null
      if (previous !== 'running') pushLog('info', '轨迹执行中', state.taskName)
    } else if (merged === 'fault') {
      state.faultMessage = '动作被中止'
      state.plannerStatus = '中止'
      state.plannerOk = false
      state.taskPhase = '故障'
      state.emergencies += 1
      state.pins.errors.count += 1
      state.pins.errors.note = '动作目标 aborted'
      pushLog('error', '动作中止', 'MoveIt 或关节轨迹控制器报告 aborted')
    } else if (merged === 'paused') {
      state.taskPhase = '已取消'
      state.plannerStatus = '已取消'
      pushLog('warn', '动作已取消', '目标状态为 canceled')
    } else {
      state.taskPhase = state.waypoints ? '完成' : '空闲'
      state.taskProgress = state.waypoints ? 100 : 0
      state.plannerStatus = state.waypoints ? '已完成' : '等待规划'
      state.plannerOk = true
      if (previous === 'running') pushLog('ok', '轨迹执行完成', state.taskName)
    }
    refreshDeltas()
  }

  function onRosout(message: unknown) {
    if (state.linkMode !== 'ros') return
    const entry = logFromRosout(message)
    if (!entry) return
    const key = `${entry.title}:${entry.detail}`
    const now = Date.now()
    const seen = seenLogs.get(key) ?? 0
    if (now - seen < 8000) return
    seenLogs.set(key, now)
    if (seenLogs.size > 40) {
      const oldest = [...seenLogs.entries()].sort((a, b) => a[1] - b[1])[0]
      if (oldest) seenLogs.delete(oldest[0])
    }
    if (entry.level === 'error') {
      state.emergencies += 1
      state.faultMessage = entry.detail
      state.pins.errors.count += 1
      state.pins.errors.note = entry.detail
    }
    pushLog(entry.level, entry.title, entry.detail)
    refreshDeltas()
  }

  function onTf(message: unknown) {
    if (state.linkMode !== 'ros') return
    rememberTf(tf, message)
    const pose = endEffectorPose(tf)
    if (!pose) return
    state.target = pose
  }

  function updateProgress() {
    if (state.planMs <= 0 || runStarted <= 0) return
    const elapsed = performance.now() - runStarted
    state.taskProgress = Math.min(99, Math.round((elapsed / state.planMs) * 100))
  }

  function refreshDeltas() {
    state.emergencyDelta = (state.emergencies / emerg0 - 1) * 100
    state.healthDelta = health0 === 0 ? 0 : (state.health / health0 - 1) * 100
    state.speedDelta = rpm0 === 0 ? (state.avgRpm === 0 ? 0 : 100) : (state.avgRpm / rpm0 - 1) * 100
  }

  function sample() {
    if (state.linkMode !== 'ros') return
    state.joints.forEach((joint, index) => {
      joint.delta = joint.angle - (prevAngles[index] ?? joint.angle)
      prevAngles[index] = joint.angle
    })
    if (state.runState === 'running') {
      state.phases.move += SAMPLE_MS / 1000
      updateProgress()
    } else if (state.runState === 'paused') {
      state.phases.idle += SAMPLE_MS / 1000
    } else {
      state.phases.idle += SAMPLE_MS / 1000
    }
    const phaseSum = state.phases.plan + state.phases.move + state.phases.grip + state.phases.idle
    state.utilization = phaseSum > 0 ? (state.phases.move + state.phases.grip) / phaseSum : 0
    state.timeLabels.push(formatClock())
    state.joints.forEach((joint, index) => {
      state.angleHistory[index].push(Number(joint.angle.toFixed(2)))
    })
    state.speedHistory.push(Math.round(state.avgRpm))
    if (state.timeLabels.length > HISTORY) {
      state.timeLabels.shift()
      state.angleHistory.forEach((series) => series.shift())
      state.speedHistory.shift()
    }
    state.revision += 1
    refreshDeltas()
  }

  function schedule() {
    window.clearTimeout(retryTimer)
    retryTimer = window.setTimeout(() => {
      void connect()
    }, RETRY_MS)
  }

  async function connect() {
    if (!url || preferSim) return
    const id = ++attempt
    try {
      await client.connect(url)
      if (id !== attempt || preferSim) return
      enterRos()
    } catch {
      if (id !== attempt || preferSim) return
      if (!loggedOffline) {
        loggedOffline = true
        pushLog('warn', 'rosbridge 未就绪', `保持模拟数据，正在重试 ${url}`)
      }
      schedule()
    }
  }

  function toggleLink() {
    if (state.linkMode === 'ros') {
      preferSim = true
      attempt += 1
      window.clearTimeout(retryTimer)
      client.close()
      state.linkMode = 'sim'
      state.connected = true
      state.robotName = 'Franka Panda'
      state.runState = 'running'
      state.faultMessage = null
      state.latencyMs = 18
      resetHistory()
      pushLog('info', '已切回模拟数据', 'rosbridge 已断开，关节继续由模拟循环驱动')
      return
    }
    preferSim = false
    loggedOffline = false
    window.clearTimeout(retryTimer)
    void connect()
  }

  subscribeAll()

  onMounted(() => {
    sampleTimer = window.setInterval(sample, SAMPLE_MS)
    if (url) void connect()
  })

  onUnmounted(() => {
    attempt += 1
    preferSim = true
    window.clearTimeout(retryTimer)
    window.clearInterval(sampleTimer)
    client.close()
  })

  return { url: url ?? 'ws://127.0.0.1:9090', toggleLink }
}

function mergeRun(move: RunState | null, follow: RunState | null): RunState | null {
  const list = [move, follow].filter((item): item is RunState => item !== null)
  if (list.length === 0) return null
  if (list.includes('running')) return 'running'
  if (list.includes('fault')) return 'fault'
  if (list.includes('paused')) return 'paused'
  return 'idle'
}
