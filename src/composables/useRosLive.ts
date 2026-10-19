// 连接 rosbridge、订阅话题、发送和取消动作

import { onMounted, onUnmounted, reactive } from 'vue'
import { formatClock } from '../format'
import {
  endEffectorPose,
  poseToFrame,
  liveJoints,
  logFromRosout,
  planSummary,
  rememberTf,
  runStateFromStatus,
  type TfEdge,
} from '../ros/parse'
import {
  ARM_GROUP,
  BASE_FRAME,
  PLANNING_FRAME,
  cancelAccepted,
  describeGoal,
  FOLLOW_ACTION,
  jointTargetError,
  MOVE_ACTION,
  poseGoal,
  poseTargetError,
  READY_DEGREES,
  trajectoryGoal,
} from '../ros/goals'
import { RosBridgeClient } from '../ros/rosbridge'
import type { ConsoleState, LogLevel, Pose, RunState } from '../types'
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
  client.onDisconnect(() => {
    if (preferSim || state.linkMode !== 'ros') return
    activeGoal = null
    command.busy = false
    state.connected = false
    state.runState = 'fault'
    state.taskPhase = '中断'
    state.plannerStatus = '通信中断'
    state.plannerOk = false
    state.faultMessage = '与 rosbridge 的通信中断，无法确认机械臂是否还在运动'
    command.note = state.faultMessage
    pushLog('error', '通信中断', url || 'ws://127.0.0.1:9090')
    schedule()
  })
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
  let motionTicket = 0
  let activeGoal: { id: string; action: string } | null = null

  const command = reactive({
    open: false,
    busy: false,
    note: '关节角直接交给控制器；末端位姿交给 MoveIt 规划后再执行。',
    joints: [...READY_DEGREES],
    pose: { x: -118, y: 762, z: 376, rx: 180, ry: 0, rz: 0 } as Pose,
  })

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
    state.pins.base.count = 0
    state.pins.base.note = '连接后暂无'
    state.pins.shoulder.count = 0
    state.pins.shoulder.note = '连接后暂无'
    state.pins.elbow.count = 0
    state.pins.elbow.note = '连接后暂无'
    state.pins.errors.count = 0
    state.pins.errors.note = '连接后暂无错误'
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
    refreshLimitPins()
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

  function refreshLimitPins() {
    const pins = [
      { key: 'base' as const, index: 0 },
      { key: 'shoulder' as const, index: 1 },
      { key: 'elbow' as const, index: 2 },
    ]
    pins.forEach((pin) => {
      const spec = JOINTS[pin.index]
      const angle = state.joints[pin.index]?.angle
      const target = state.pins[pin.key]
      if (!Number.isFinite(angle)) {
        target.count = 0
        target.note = '尚未收到关节角'
        return
      }
      const span = spec.max - spec.min
      const remaining = Math.min(angle - spec.min, spec.max - angle)
      const margin = span > 0 ? remaining / span : 1
      if (margin < 0.12) {
        target.count = 1
        target.note = `${spec.id} ${angle.toFixed(1)}°，距软限位还剩 ${(margin * 100).toFixed(0)}%`
        return
      }
      target.count = 0
      target.note = `${spec.id} ${angle.toFixed(1)}°，在软限位内`
    })
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

  function fillCommand() {
    command.joints = state.joints.map((joint) => Number(joint.angle.toFixed(2)))
    command.pose = {
      x: Number(state.target.x.toFixed(1)),
      y: Number(state.target.y.toFixed(1)),
      z: Number(state.target.z.toFixed(1)),
      rx: Number(state.target.rx.toFixed(1)),
      ry: Number(state.target.ry.toFixed(1)),
      rz: Number(state.target.rz.toFixed(1)),
    }
  }

  function openCommand() {
    if (state.linkMode !== 'ros') return
    fillCommand()
    command.open = true
    command.note = '关节角直接交给控制器；末端位姿交给 MoveIt 规划后再执行。'
  }

  function setJointTarget(index: number, value: number) {
    command.joints[index] = value
  }

  function setPoseTarget(key: keyof Pose, value: number) {
    command.pose[key] = value
  }

  async function sendJointTarget(degrees = command.joints, title = '指定关节') {
    const problem = jointTargetError(degrees)
    if (problem) {
      command.note = problem
      state.faultMessage = problem
      pushLog('warn', '目标未下发', problem)
      return
    }
    if (state.linkMode !== 'ros' || !client.connected) {
      command.note = '先连上 rosbridge，才能把关节目标发给控制器'
      state.faultMessage = command.note
      pushLog('error', '目标未下发', command.note)
      return
    }
    const current = state.joints.map((joint) => joint.angle)
    if (current.some((angle) => !Number.isFinite(angle))) {
      command.note = '还没有收到 /joint_states，不能从未知姿态出发'
      state.faultMessage = command.note
      pushLog('error', '目标未下发', command.note)
      return
    }
    const goal = trajectoryGoal(current, degrees)
    command.joints = degrees.map((value) => Number(value.toFixed(2)))
    state.taskName = title
    state.taskPhase = '下发'
    state.plannerName = 'FollowJointTrajectory'
    state.plannerStatus = '执行中'
    state.plannerOk = true
    state.faultMessage = null
    command.note = `${title}已发给关节控制器，约 ${goal.seconds.toFixed(1)} s`
    pushLog('info', `下发${title}`, `panda_arm_controller · ${goal.seconds.toFixed(1)} s`)
    await runGoal(FOLLOW_ACTION, 'control_msgs/action/FollowJointTrajectory', goal.args, 20000)
  }

  function sendReady() {
    void sendJointTarget(READY_DEGREES, '初始姿态')
  }

  async function sendPose() {
    const problem = poseTargetError(command.pose)
    if (problem) {
      command.note = problem
      state.faultMessage = problem
      pushLog('warn', '位姿未下发', problem)
      return
    }
    if (state.linkMode !== 'ros' || !client.connected) {
      command.note = '先连上 rosbridge，才能把末端目标交给 MoveIt'
      state.faultMessage = command.note
      pushLog('error', '位姿未下发', command.note)
      return
    }
    const planningPose = poseToFrame(tf, command.pose, BASE_FRAME, PLANNING_FRAME)
    if (!planningPose) {
      command.note = `还没有收到 ${PLANNING_FRAME} → ${BASE_FRAME}，MoveIt 要求目标写在 ${PLANNING_FRAME}`
      state.faultMessage = command.note
      pushLog('error', '位姿未下发', command.note)
      return
    }
    state.taskName = '末端位姿'
    state.taskPhase = '规划'
    state.plannerName = 'MoveIt'
    state.plannerStatus = '规划中'
    state.plannerOk = true
    state.faultMessage = null
    command.note = `正在让 ${ARM_GROUP} 按 ${PLANNING_FRAME} 规划 panda_hand，规划成功后才会执行`
    pushLog(
      'info',
      '请求 MoveIt 规划',
      `${BASE_FRAME} 目标已变换到 ${PLANNING_FRAME}：${planningPose.x.toFixed(0)}, ${planningPose.y.toFixed(0)}, ${planningPose.z.toFixed(0)} mm`,
    )
    await runGoal(MOVE_ACTION, 'moveit_msgs/action/MoveGroup', poseGoal(planningPose), 60000)
  }

  async function runGoal(action: string, actionType: string, args: unknown, timeoutMs: number) {
    const ticket = ++motionTicket
    command.busy = true
    try {
      const pending = client.sendActionGoal(action, actionType, args, timeoutMs)
      activeGoal = { id: pending.id, action }
      const result = await pending.result
      if (ticket !== motionTicket) return
      activeGoal = null
      const failure = describeGoal(result.status, result.values)
      if (failure) {
        command.note = failure
        state.plannerStatus = '失败'
        state.plannerOk = false
        state.faultMessage = failure
        pushLog('error', '动作失败', failure)
        return
      }
      command.note = '动作已完成'
      state.plannerStatus = '已完成'
      state.plannerOk = true
      state.taskPhase = '完成'
      state.taskProgress = 100
      pushLog('ok', '动作已完成', state.taskName)
    } catch (error) {
      if (ticket !== motionTicket) return
      const message = error instanceof Error ? error.message : '动作失败'
      command.note = message
      state.plannerStatus = '失败'
      state.plannerOk = false
      state.faultMessage = message
      state.taskPhase = '故障'
      pushLog('error', '动作失败', message)
    } finally {
      if (ticket === motionTicket) {
        command.busy = false
        activeGoal = null
      }
    }
  }

  async function cancelMotion() {
    motionTicket += 1
    const current = activeGoal
    activeGoal = null
    command.busy = false
    if (state.linkMode !== 'ros' || !client.connected) {
      command.note = '未连接 rosbridge，不能取消控制器上的目标'
      state.faultMessage = command.note
      pushLog('error', '停止失败', command.note)
      return
    }
    let bridgeCancel = false
    if (current) {
      try {
        client.cancelActionGoal(current.action, current.id)
        bridgeCancel = true
      } catch {
        bridgeCancel = false
      }
    }
    const cancelAll = {
      goal_info: {
        goal_id: { uuid: Array.from({ length: 16 }, () => 0) },
        stamp: { sec: 0, nanosec: 0 },
      },
    }
    const results = await Promise.allSettled([
      client.callService(`${FOLLOW_ACTION}/_action/cancel_goal`, 'action_msgs/srv/CancelGoal', cancelAll),
      client.callService(`${MOVE_ACTION}/_action/cancel_goal`, 'action_msgs/srv/CancelGoal', cancelAll),
    ])
    const accepted = results.some(
      (result) => result.status === 'fulfilled' && cancelAccepted(result.value) === true,
    )
    const answered = results.some((result) => result.status === 'fulfilled')
    if (!accepted && !answered && !bridgeCancel) {
      command.note = '停止失败：关节控制器和 MoveIt 都没有接受取消'
      state.faultMessage = command.note
      state.plannerStatus = '停止失败'
      state.plannerOk = false
      state.taskPhase = '故障'
      pushLog('error', '停止失败', command.note)
      return
    }
    state.faultMessage = null
    state.taskPhase = '停止'
    state.plannerStatus = accepted ? '正在取消' : '已请求取消'
    state.plannerOk = true
    command.note = accepted
      ? '控制器已接受取消，等待关节停稳'
      : '已向关节控制器和 MoveIt 发送取消'
    pushLog('warn', '已请求停止', command.note)
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
      state.pins.base = { count: 3, note: '基座振动超过 0.8 mm/s' }
      state.pins.shoulder = { count: 2, note: 'J2 电流较基线偏高 6%' }
      state.pins.elbow = { count: 13, note: '本班次肘部温度告警 13 次' }
      state.pins.errors = { count: 6, note: '腕部跟随误差，已自动复位 6 次' }
      state.faultMessage = null
      state.latencyMs = 18
      command.open = false
      command.busy = false
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

  return {
    url: url ?? 'ws://127.0.0.1:9090',
    toggleLink,
    command,
    openCommand,
    fillCommand,
    setJointTarget,
    setPoseTarget,
    sendJointTarget,
    sendReady,
    sendPose,
    cancelMotion,
  }
}

function mergeRun(move: RunState | null, follow: RunState | null): RunState | null {
  const list = [move, follow].filter((item): item is RunState => item !== null)
  if (list.length === 0) return null
  if (list.includes('running')) return 'running'
  if (list.includes('fault')) return 'fault'
  if (list.includes('paused')) return 'paused'
  return 'idle'
}
