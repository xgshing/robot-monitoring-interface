// 生成模拟关节、任务和日志，供未连接时使用

import { onMounted, onUnmounted, reactive } from 'vue'
import { formatClock } from '../format'
import type { ConsoleState, JointReading, LedTone, LogLevel, PhaseKind, Pose } from '../types'
import { JOINTS } from '../types'

const HOME = [0, -22, 46, 2, 28, 0, 0]
const HOME_POSE: Pose = { x: 468, y: 12, z: 612, rx: 180, ry: 0, rz: 90 }
const BASE_EMERGENCY = 894 / 1.003
const BASE_HEALTH = 944 / 1.7209
const BASE_SPEED = 1843 / 1.1104
const HISTORY = 48

const BASE_LEDS: LedTone[] = [
  'ok', 'ok', 'warn', 'ok', 'ok', 'off',
  'ok', 'error', 'ok', 'ok', 'warn', 'ok',
  'warn', 'ok', 'ok', 'ok', 'off', 'ok',
  'ok', 'ok', 'error', 'ok', 'ok', 'ok',
]

interface Step {
  phase: string
  kind: PhaseKind
  ms: number
  task: string
  to: number[]
  pose: Pose
  level: LogLevel
  title: string
  detail: string
  planner: string
  ok: boolean
  waypoints: number
  planMs: number
}

const CYCLE: Step[] = [
  {
    phase: '规划',
    kind: 'plan',
    ms: 2000,
    task: '托盘 A3 → 工位 B2',
    to: [6, -16, 42, 4, 26, 4, 0],
    pose: { x: 510, y: 36, z: 470, rx: 180, ry: 1, rz: 94 },
    level: 'ok',
    title: '路径规划完成',
    detail: 'RRT-Connect 生成路点，碰撞检测通过',
    planner: '无碰撞',
    ok: true,
    waypoints: 36,
    planMs: 1680,
  },
  {
    phase: '接近',
    kind: 'move',
    ms: 3600,
    task: '托盘 A3 → 工位 B2',
    to: [36, 22, 68, 10, 46, 16, 0],
    pose: { x: 636.5, y: 162.4, z: 228, rx: 178.5, ry: 4.2, rz: 112 },
    level: 'info',
    title: '接近抓取点',
    detail: '托盘 A3 · 末端速度限制 250 mm/s',
    planner: '跟踪中',
    ok: true,
    waypoints: 36,
    planMs: 1680,
  },
  {
    phase: '抓取',
    kind: 'grip',
    ms: 1600,
    task: '托盘 A3 → 工位 B2',
    to: [37, 28, 74, 8, 52, 16, 0],
    pose: { x: 640.2, y: 166.1, z: 214.6, rx: 179.2, ry: 2.6, rz: 113.4 },
    level: 'ok',
    title: '夹爪闭合',
    detail: '真空建立 78 kPa，工件已吸合',
    planner: '无碰撞',
    ok: true,
    waypoints: 36,
    planMs: 1680,
  },
  {
    phase: '搬运',
    kind: 'move',
    ms: 4000,
    task: '托盘 A3 → 工位 B2',
    to: [-42, 8, 52, -14, 36, -18, 0],
    pose: { x: 318, y: -246.5, z: 360, rx: 180, ry: -2.4, rz: 64 },
    level: 'info',
    title: '搬运至工位 B2',
    detail: '抬升 180 mm 后横移，避开围栏',
    planner: '跟踪中',
    ok: true,
    waypoints: 36,
    planMs: 1680,
  },
  {
    phase: '放置',
    kind: 'grip',
    ms: 1700,
    task: '托盘 A3 → 工位 B2',
    to: [-48, 26, 70, -12, 50, -16, 0],
    pose: { x: 286.4, y: -268.2, z: 226.8, rx: 179.4, ry: 1.1, rz: 58.6 },
    level: 'ok',
    title: '工件已放下',
    detail: '破真空完成，夹爪张开',
    planner: '无碰撞',
    ok: true,
    waypoints: 36,
    planMs: 1680,
  },
  {
    phase: '回退',
    kind: 'move',
    ms: 3200,
    task: '托盘 A3 → 工位 B2',
    to: [0, -22, 46, 2, 28, 0, 0],
    pose: { x: 468, y: 12, z: 612, rx: 180, ry: 0, rz: 90 },
    level: 'info',
    title: '返回待机位',
    detail: '七轴回到循环起点',
    planner: '无碰撞',
    ok: true,
    waypoints: 28,
    planMs: 980,
  },
  {
    phase: '待机',
    kind: 'idle',
    ms: 1400,
    task: '托盘 A3 → 工位 B2',
    to: [0, -22, 46, 2, 28, 0, 0],
    pose: { x: 468, y: 12, z: 612, rx: 180, ry: 0, rz: 90 },
    level: 'ok',
    title: '循环完成',
    detail: '节拍正常，等待下一次规划',
    planner: '待命',
    ok: true,
    waypoints: 0,
    planMs: 0,
  },
]

const cycleMs = CYCLE.reduce((sum, step) => sum + step.ms, 0)

function makeJoints(): JointReading[] {
  return JOINTS.map((spec, index) => ({
    id: spec.id,
    name: spec.name,
    angle: HOME[index],
    delta: 0,
    velocity: 0,
    rpm: 980 + index * 48,
    temperature: 37 + index * 0.32,
  }))
}

function seedLogs(): ConsoleState['logs'] {
  const seeds: Array<{ offset: number; level: LogLevel; title: string; detail: string }> = [
    { offset: -18 * 60_000, level: 'info', title: '班次开始', detail: 'Franka Panda 模拟循环启动，等待 rosbridge' },
    { offset: -16 * 60_000, level: 'ok', title: '关节零点校验通过', detail: '七轴回零完成，偏差小于 0.02°' },
    { offset: -12 * 60_000, level: 'warn', title: '肘部温度告警', detail: 'J3 峰值 46.8°C，已计入本班次' },
    { offset: -9 * 60_000, level: 'warn', title: '基座振动偏高', detail: 'RMS 0.82 mm/s，超过观察阈值 0.70' },
    { offset: -6 * 60_000, level: 'error', title: '腕部跟随误差', detail: 'J5 误差 0.42°，伺服已自动复位' },
    { offset: -2 * 60_000, level: 'ok', title: '进入自动循环', detail: '任务「托盘 A3 → 工位 B2」等待规划' },
  ]
  return seeds
    .map((item, index) => ({
      id: index + 1,
      time: formatClock(Date.now() + item.offset),
      level: item.level,
      title: item.title,
      detail: item.detail,
    }))
    .reverse()
}

export function useRobotSimulation() {
  const state = reactive<ConsoleState>({
    connected: true,
    linkMode: 'sim',
    robotName: 'Franka Panda',
    latencyMs: 18,
    runState: 'running',
    clock: formatClock(),
    emergencies: 894,
    emergencyDelta: 0.3,
    health: 944,
    healthDelta: 72.09,
    avgRpm: 1843,
    speedDelta: 11.04,
    joints: makeJoints(),
    selectedJoint: 0,
    taskName: '托盘 A3 → 工位 B2',
    taskPhase: '规划',
    taskProgress: 0,
    gripping: false,
    target: { ...HOME_POSE },
    plannerName: 'RRT-Connect',
    plannerStatus: '无碰撞',
    plannerOk: true,
    waypoints: 36,
    planMs: 1680,
    faultMessage: null,
    pins: {
      base: { count: 3, note: '基座振动超过 0.8 mm/s' },
      shoulder: { count: 2, note: 'J2 电流较基线偏高 6%' },
      elbow: { count: 13, note: '本班次肘部温度告警 13 次' },
      errors: { count: 0, note: '当前没有错误' },
    },
    logs: seedLogs(),
    timeLabels: [],
    angleHistory: JOINTS.map(() => []),
    speedHistory: [],
    revision: 0,
    phases: { plan: 22, move: 96, grip: 34, idle: 28 },
    utilization: 0.72,
    throughput: 1843,
    spindleRpm: 5944,
    cabinetTemp: 38.11,
    driveTemp: 41.02,
    leds: [...BASE_LEDS],
  })

  const trails = state.joints.map((joint) => Array.from({ length: 8 }, () => joint.angle))
  let fromJ = [...HOME]
  let fromP: Pose = { ...HOME_POSE }
  let seg = 0
  let segT = 0
  let cycle = 1
  let seq = state.logs.length
  let now = 0
  let sampleAcc = 0
  let userHold = false
  let inFault = false
  let faultElapsed = 0
  let faultDone = false
  let shoulderWarned = false
  let elbowWarned = false
  let timer = 0

  function pushLog(level: LogLevel, title: string, detail: string) {
    seq += 1
    state.logs.unshift({ id: seq, time: formatClock(), level, title, detail })
    if (state.logs.length > 48) state.logs.splice(48)
  }

  function updateProgress() {
    const done =
      CYCLE.slice(0, seg).reduce((sum, step) => sum + step.ms, 0) + Math.min(segT, CYCLE[seg].ms)
    state.taskProgress = Math.min(100, Math.round((done / cycleMs) * 100))
  }

  function syncPlanner() {
    const step = CYCLE[seg]
    if (!state.connected) {
      state.plannerStatus = '离线'
      state.plannerOk = false
      return
    }
    if (inFault) {
      state.plannerStatus = '受阻'
      state.plannerOk = false
      return
    }
    if (userHold) {
      state.plannerStatus = '已暂停'
      state.plannerOk = true
      return
    }
    state.plannerStatus = step.planner
    state.plannerOk = step.ok
  }

  function enterSegment(index: number) {
    seg = index
    segT = 0
    fromJ = state.joints.map((joint) => joint.angle)
    fromP = { ...state.target }
    const step = CYCLE[index]
    state.taskName = step.task
    state.taskPhase = step.phase
    state.plannerName = 'RRT-Connect'
    state.waypoints = index === 0 ? 32 + (cycle % 7) : step.waypoints
    state.planMs = step.planMs
    state.gripping = step.phase === '抓取' || step.phase === '搬运' || step.phase === '放置'
    updateProgress()
    syncPlanner()
    const detail =
      index === 0 ? `RRT-Connect 生成 ${state.waypoints} 个路点，碰撞检测通过` : step.detail
    pushLog(step.level, step.title, detail)
  }

  function completeSegment() {
    if (seg === CYCLE.length - 1) {
      cycle += 1
      state.throughput += 1
      enterSegment(0)
      return
    }
    enterSegment(seg + 1)
  }

  function triggerFault() {
    faultDone = true
    inFault = true
    faultElapsed = 0
    state.runState = 'fault'
    state.faultMessage = '夹爪真空跌落至 36 kPa，搬运已挂起'
    state.pins.errors = { count: 1, note: state.faultMessage }
    state.emergencies += 1
    syncPlanner()
    pushLog('error', '夹爪真空不足', '压力 36 kPa，低于 55 kPa，任务已挂起')
  }

  function clearFault(manual: boolean) {
    if (!inFault) {
      if (manual) pushLog('info', '操作员确认告警', '当前没有挂起的故障')
      return
    }
    inFault = false
    faultElapsed = 0
    state.faultMessage = null
    state.pins.errors = { count: 0, note: '当前没有错误' }
    if (state.connected) state.runState = userHold ? 'paused' : 'running'
    syncPlanner()
    pushLog(
      'ok',
      manual ? '操作员确认故障' : '故障已恢复',
      manual ? '已手动恢复搬运' : '真空回到 74 kPa，继续执行',
    )
  }

  function maybeEvents() {
    if (!state.connected || userHold || inFault) return
    if (!shoulderWarned && cycle === 1 && seg === 1 && segT > 900) {
      shoulderWarned = true
      state.pins.shoulder.count += 1
      state.pins.shoulder.note = 'J2 接近软限位 78%'
      state.emergencies += 1
      pushLog('warn', 'J2 接近软限位', '肩关节达到行程 78%，速度已限制')
    }
    if (!faultDone && cycle === 1 && seg === 3 && segT > 1400) triggerFault()
    if (!elbowWarned && cycle === 2 && seg === 3 && segT > 700) {
      elbowWarned = true
      state.pins.elbow.count += 1
      state.pins.elbow.note = 'J3 力矩波动 11.4 N·m'
      state.emergencies += 1
      pushLog('warn', 'J3 力矩波动', '肘关节力矩 11.4 N·m，超过阈值 9.0 N·m')
    }
  }

  function applyLerp(step: Step, amount: number) {
    state.joints.forEach((joint, index) => {
      const noise = Math.sin(now / 220 + index * 1.4) * 0.03
      joint.angle = fromJ[index] + (step.to[index] - fromJ[index]) * amount + noise
    })
    const keys: (keyof Pose)[] = ['x', 'y', 'z', 'rx', 'ry', 'rz']
    keys.forEach((key) => {
      state.target[key] = fromP[key] + (step.pose[key] - fromP[key]) * amount
    })
  }

  function advance(dt: number) {
    segT += dt
    const step = CYCLE[seg]
    const amount = Math.min(1, segT / step.ms)
    const eased = amount * amount * (3 - 2 * amount)
    applyLerp(step, eased)
    updateProgress()
    state.gripping = step.phase === '抓取' || step.phase === '搬运' || (step.phase === '放置' && segT < 900)
    maybeEvents()
    if (inFault) return
    if (segT >= step.ms) completeSegment()
  }

  function updateDerived() {
    let motion = 0
    state.joints.forEach((joint, index) => {
      const trail = trails[index]
      trail.push(joint.angle)
      if (trail.length > 8) trail.shift()
      const windowSec = Math.max(0.05, (trail.length - 1) * 0.05)
      joint.delta = joint.angle - trail[0]
      joint.velocity = joint.delta / windowSec
      joint.rpm = Math.round(520 + Math.abs(joint.velocity) * 48 + index * 36)
      joint.temperature = 36.2 + index * 0.38 + Math.abs(joint.velocity) * 0.06
      motion += Math.abs(joint.velocity)
    })
    const moving = state.connected && !userHold && !inFault
    const targetRpm = moving ? 1420 + (motion / state.joints.length) * 24 : 460
    state.avgRpm += (targetRpm - state.avgRpm) * 0.12

    const maxTemp = Math.max(...state.joints.map((joint) => joint.temperature))
    const targetHealth = inFault ? 902 : 948 - Math.max(0, maxTemp - 43) * 4 + Math.sin(now / 2000) * 1.1
    state.health += (targetHealth - state.health) * 0.08
    state.emergencyDelta = (state.emergencies / BASE_EMERGENCY - 1) * 100
    state.healthDelta = (state.health / BASE_HEALTH - 1) * 100
    state.speedDelta = (state.avgRpm / BASE_SPEED - 1) * 100

    const phaseSum = state.phases.plan + state.phases.move + state.phases.grip + state.phases.idle
    state.utilization = phaseSum > 0 ? (state.phases.move + state.phases.grip) / phaseSum : 0

    const heat = inFault ? 1.5 : 0
    state.cabinetTemp = 38.11 + Math.sin(now / 3000) * 0.18 + heat
    state.driveTemp = 41.02 + Math.cos(now / 2800) * 0.16 + heat * 0.5
    const spindleTarget = moving ? 5944 + Math.sin(now / 500) * 80 : 920
    state.spindleRpm += (spindleTarget - state.spindleRpm) * 0.1
    state.leds = BASE_LEDS.map((led, index) => {
      if (!state.connected) return 'off'
      if (inFault && (index === 4 || index === 15 || index === 20)) return 'error'
      return led
    })
  }

  function pushSample() {
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
  }

  function seedHistory() {
    const origin = Date.now()
    for (let point = 0; point < 42; point += 1) {
      const fade = point > 34 ? (42 - point) / 8 : 1
      state.timeLabels.push(formatClock(origin - (42 - point) * 400))
      HOME.forEach((angle, index) => {
        const wave =
          Math.sin((point + index * 3) / 5) * (7 + index * 1.4) + Math.cos(point / 3.1 + index) * 2.2
        state.angleHistory[index].push(Number((angle + wave * fade).toFixed(2)))
      })
      state.speedHistory.push(Math.round(1680 + Math.sin(point / 3) * 160 + Math.cos(point / 2.2) * 70))
    }
  }

  function step(dt: number) {
    now += dt
    state.clock = formatClock()
    if (state.linkMode === 'ros') return
    if (state.connected) {
      state.latencyMs = Math.max(8, Math.round(16 + Math.sin(now / 700) * 6 + Math.random() * 4))
    }
    if (inFault) {
      faultElapsed += dt
      if (faultElapsed >= 3400 && !userHold && state.connected) clearFault(false)
    }
    const moving = state.connected && !userHold && !inFault
    if (moving) advance(dt)
    const phaseKey: PhaseKind = moving ? CYCLE[seg].kind : 'idle'
    state.phases[phaseKey] += dt / 1000
    updateDerived()
    sampleAcc += dt
    if (sampleAcc >= 400) {
      sampleAcc -= 400
      pushSample()
    }
  }

  function toggleLink() {
    state.connected = !state.connected
    if (!state.connected) {
      inFault = false
      state.faultMessage = null
      state.runState = 'idle'
      syncPlanner()
      pushLog('error', '控制器连接断开', '伺服下电，关节反馈与规划已冻结')
      return
    }
    state.runState = userHold ? 'paused' : 'running'
    syncPlanner()
    pushLog('ok', '控制器已连接', `总线恢复，延迟 ${state.latencyMs} ms`)
  }

  function toggleRun() {
    if (!state.connected) return
    if (inFault) {
      userHold = false
      clearFault(true)
      state.runState = 'running'
      return
    }
    userHold = !userHold
    state.runState = userHold ? 'paused' : 'running'
    syncPlanner()
    pushLog('info', userHold ? '任务已暂停' : '任务继续执行', state.taskName)
  }

  function acknowledge() {
    if (state.linkMode === 'ros') {
      state.faultMessage = null
      state.pins.errors = { count: 0, note: '当前没有错误' }
      state.emergencies = 0
      state.emergencyDelta = 0
      if (state.runState === 'fault') state.runState = 'idle'
      pushLog('info', '操作员确认告警', '已清除页面上的故障提示')
      return
    }
    if (inFault) {
      userHold = false
      clearFault(true)
      if (state.connected) state.runState = 'running'
      return
    }
    pushLog('info', '操作员确认告警', '当前没有挂起的故障')
  }

  function selectJoint(index: number) {
    state.selectedJoint = index
  }

  function snapshot() {
    pushLog('info', '已抓取相机画面', 'CAMERA 02 · 存入本班次记录')
  }

  seedHistory()
  enterSegment(0)

  onMounted(() => {
    let last = performance.now()
    timer = window.setInterval(() => {
      const time = performance.now()
      const dt = Math.min(80, time - last)
      last = time
      step(dt)
    }, 50)
  })

  onUnmounted(() => {
    window.clearInterval(timer)
  })

  return { state, toggleLink, toggleRun, acknowledge, selectJoint, snapshot, pushLog }
}
