export type RunState = 'running' | 'paused' | 'fault' | 'idle'
export type LinkMode = 'sim' | 'ros'
export type LogLevel = 'info' | 'ok' | 'warn' | 'error'
export type LedTone = 'ok' | 'warn' | 'error' | 'off'
export type PhaseKind = 'plan' | 'move' | 'grip' | 'idle'

export interface JointSpec {
  id: string
  name: string
  rosName: string
  min: number
  max: number
  color: string
}

export const JOINTS: JointSpec[] = [
  { id: 'J1', name: '基座', rosName: 'panda_joint1', min: -166, max: 166, color: '#9b8cff' },
  { id: 'J2', name: '肩部', rosName: 'panda_joint2', min: -101, max: 101, color: '#5eead4' },
  { id: 'J3', name: '肘部', rosName: 'panda_joint3', min: -166, max: 166, color: '#f5b942' },
  { id: 'J4', name: '腕 1', rosName: 'panda_joint4', min: -176, max: -4, color: '#ff8fb8' },
  { id: 'J5', name: '腕 2', rosName: 'panda_joint5', min: -166, max: 166, color: '#7dd3fc' },
  { id: 'J6', name: '腕 3', rosName: 'panda_joint6', min: -1, max: 215, color: '#c4b5fd' },
  { id: 'J7', name: '法兰', rosName: 'panda_joint7', min: -166, max: 166, color: '#86efac' },
]

export interface Pose {
  x: number
  y: number
  z: number
  rx: number
  ry: number
  rz: number
}

export interface JointReading {
  id: string
  name: string
  angle: number
  delta: number
  velocity: number
  rpm: number
  temperature: number
}

export interface LogItem {
  id: number
  time: string
  level: LogLevel
  title: string
  detail: string
}

export interface PinState {
  count: number
  note: string
}

export interface ConsoleState {
  connected: boolean
  linkMode: LinkMode
  robotName: string
  latencyMs: number
  runState: RunState
  clock: string
  emergencies: number
  emergencyDelta: number
  health: number
  healthDelta: number
  avgRpm: number
  speedDelta: number
  joints: JointReading[]
  selectedJoint: number
  taskName: string
  taskPhase: string
  taskProgress: number
  gripping: boolean
  target: Pose
  plannerName: string
  plannerStatus: string
  plannerOk: boolean
  waypoints: number
  planMs: number
  faultMessage: string | null
  pins: {
    base: PinState
    shoulder: PinState
    elbow: PinState
    errors: PinState
  }
  logs: LogItem[]
  timeLabels: string[]
  angleHistory: number[][]
  speedHistory: number[]
  revision: number
  phases: Record<PhaseKind, number>
  utilization: number
  throughput: number
  spindleRpm: number
  cabinetTemp: number
  driveTemp: number
  leds: LedTone[]
}
