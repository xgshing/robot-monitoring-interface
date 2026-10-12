import type { JointSpec, LogLevel, Pose, RunState } from '../types'

const RAD2DEG = 180 / Math.PI
const EE_FRAMES = ['panda_hand', 'panda_link8', 'panda_grasptarget']
const ROOT_FRAMES = new Set(['base_link', 'panda_link0', 'world'])

export interface Vec3 {
  x: number
  y: number
  z: number
}

export interface Quat {
  x: number
  y: number
  z: number
  w: number
}

export interface TfEdge {
  parent: string
  translation: Vec3
  rotation: Quat
}

interface JointStateMsg {
  name?: string[]
  position?: number[]
  velocity?: number[]
}

interface Stamp {
  sec?: number
  nanosec?: number
}

interface TrajectoryPoint {
  time_from_start?: Stamp
}

interface RobotTrajectory {
  joint_trajectory?: { points?: TrajectoryPoint[] }
  points?: TrajectoryPoint[]
}

interface DisplayTrajectoryMsg {
  trajectory?: RobotTrajectory[]
}

interface GoalStatusMsg {
  status_list?: Array<{ status?: number }>
}

interface LogMsg {
  level?: number
  name?: string
  msg?: string
}

interface TfMsg {
  transforms?: Array<{
    header?: { frame_id?: string }
    child_frame_id?: string
    transform?: { translation?: Vec3; rotation?: Quat }
  }>
}

export interface LiveJoints {
  angles: number[]
  rpms: number[]
  velocities: number[]
}

export function liveJoints(message: unknown, specs: JointSpec[]): LiveJoints {
  const msg = (message ?? {}) as JointStateMsg
  const angles = specs.map(() => Number.NaN)
  const rpms = specs.map(() => 0)
  const velocities = specs.map(() => 0)
  const names = msg.name ?? []
  const position = msg.position ?? []
  const velocity = msg.velocity ?? []
  names.forEach((name, index) => {
    const slot = specs.findIndex((spec) => spec.rosName === name)
    if (slot < 0) return
    const radians = position[index] ?? 0
    const radiansPerSec = velocity[index] ?? 0
    angles[slot] = radians * RAD2DEG
    velocities[slot] = radiansPerSec * RAD2DEG
    rpms[slot] = Math.round((Math.abs(radiansPerSec) * 60) / (2 * Math.PI))
  })
  return { angles, rpms, velocities }
}

export function planSummary(message: unknown): { waypoints: number; planMs: number } {
  const msg = (message ?? {}) as DisplayTrajectoryMsg
  let waypoints = 0
  let planMs = 0
  for (const trajectory of msg.trajectory ?? []) {
    const points = trajectory.joint_trajectory?.points ?? trajectory.points ?? []
    waypoints += points.length
    const last = points[points.length - 1]
    const stamp = last?.time_from_start
    if (stamp) planMs = Math.round(((stamp.sec ?? 0) + (stamp.nanosec ?? 0) / 1e9) * 1000)
  }
  return { waypoints, planMs }
}

export function runStateFromStatus(message: unknown): RunState | null {
  const msg = (message ?? {}) as GoalStatusMsg
  const statuses = (msg.status_list ?? []).map((item) => item.status ?? 0)
  if (statuses.length === 0) return null
  if (statuses.some((status) => status === 1 || status === 2 || status === 3)) return 'running'
  const latest = statuses[statuses.length - 1]
  if (latest === 6) return 'fault'
  if (latest === 5) return 'paused'
  if (latest === 4) return 'idle'
  return null
}

export function logFromRosout(message: unknown): { level: LogLevel; title: string; detail: string } | null {
  const msg = (message ?? {}) as LogMsg
  const level = msg.level ?? 0
  if (level < 30 || !msg.msg) return null
  return {
    level: level >= 40 ? 'error' : 'warn',
    title: msg.name || 'rosout',
    detail: msg.msg,
  }
}

export function rememberTf(tree: Map<string, TfEdge>, message: unknown) {
  const msg = (message ?? {}) as TfMsg
  for (const item of msg.transforms ?? []) {
    const child = item.child_frame_id
    const parent = item.header?.frame_id
    if (!child || !parent || !item.transform?.translation || !item.transform.rotation) continue
    tree.set(child, {
      parent,
      translation: { ...item.transform.translation },
      rotation: { ...item.transform.rotation },
    })
  }
}

export function endEffectorPose(tree: Map<string, TfEdge>): Pose | null {
  const frame = EE_FRAMES.find((name) => tree.has(name))
  if (!frame) return null
  const chain: TfEdge[] = []
  let cursor = frame
  const seen = new Set<string>()
  while (tree.has(cursor) && !seen.has(cursor)) {
    seen.add(cursor)
    const edge = tree.get(cursor)
    if (!edge) break
    chain.push(edge)
    cursor = edge.parent
    if (ROOT_FRAMES.has(cursor)) break
  }
  let translation = { x: 0, y: 0, z: 0 }
  let rotation = { x: 0, y: 0, z: 0, w: 1 }
  for (const edge of chain.reverse()) {
    translation = add(translation, rotate(rotation, edge.translation))
    rotation = multiply(rotation, edge.rotation)
  }
  const rpy = quaternionToRpy(rotation)
  return {
    x: translation.x * 1000,
    y: translation.y * 1000,
    z: translation.z * 1000,
    rx: rpy.rx,
    ry: rpy.ry,
    rz: rpy.rz,
  }
}

function add(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }
}

function rotate(q: Quat, v: Vec3): Vec3 {
  const ix = q.w * v.x + q.y * v.z - q.z * v.y
  const iy = q.w * v.y + q.z * v.x - q.x * v.z
  const iz = q.w * v.z + q.x * v.y - q.y * v.x
  const iw = -q.x * v.x - q.y * v.y - q.z * v.z
  return {
    x: ix * q.w + iw * -q.x + iy * -q.z - iz * -q.y,
    y: iy * q.w + iw * -q.y + iz * -q.x - ix * -q.z,
    z: iz * q.w + iw * -q.z + ix * -q.y - iy * -q.x,
  }
}

function multiply(a: Quat, b: Quat): Quat {
  return {
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
  }
}

function quaternionToRpy(q: Quat): Pick<Pose, 'rx' | 'ry' | 'rz'> {
  const sinp = 2 * (q.w * q.y - q.z * q.x)
  const pitch = Math.abs(sinp) >= 1 ? Math.sign(sinp) * (Math.PI / 2) : Math.asin(sinp)
  const roll = Math.atan2(2 * (q.w * q.x + q.y * q.z), 1 - 2 * (q.x * q.x + q.y * q.y))
  const yaw = Math.atan2(2 * (q.w * q.z + q.x * q.y), 1 - 2 * (q.y * q.y + q.z * q.z))
  return { rx: roll * RAD2DEG, ry: pitch * RAD2DEG, rz: yaw * RAD2DEG }
}
