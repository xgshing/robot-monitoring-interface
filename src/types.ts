export type RunState = 'running' | 'paused' | 'fault' | 'idle'
export type LogLevel = 'info' | 'ok' | 'warn' | 'error'
export type LedTone = 'ok' | 'warn' | 'error' | 'off'
export type PhaseKind = 'plan' | 'move' | 'grip' | 'idle'

export interface JointSpec {
  id: string
  name: string
  min: number
  max: number
  color: string
}

export const JOINTS: JointSpec[] = [
  { id: 'J1', name: '基座', min: -170, max: 170, color: '#9b8cff' },
  { id: 'J2', name: '肩部', min: -120, max: 120, color: '#5eead4' },
  { id: 'J3', name: '肘部', min: -150, max: 150, color: '#f5b942' },
  { id: 'J4', name: '腕转', min: -180, max: 180, color: '#ff8fb8' },
  { id: 'J5', name: '腕摆', min: -120, max: 120, color: '#7dd3fc' },
  { id: 'J6', name: '法兰', min: -360, max: 360, color: '#c4b5fd' },
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
