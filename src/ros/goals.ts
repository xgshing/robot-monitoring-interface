import type { Pose } from '../types'
import { JOINTS } from '../types'

const DEG2RAD = Math.PI / 180

export const ARM_GROUP = 'panda_arm'
export const EE_LINK = 'panda_hand'
export const BASE_FRAME = 'panda_link0'
export const FOLLOW_ACTION = '/panda_arm_controller/follow_joint_trajectory'
export const MOVE_ACTION = '/move_action'

/** Franka 常用就绪位，单位度。J4 不能为 0。 */
export const READY_DEGREES = [0, -45, 0, -135, 0, 90, 45]

export function describeGoal(status: number, values: unknown): string | null {
  if (status === 4) {
    const code = moveitCode(values)
    if (code !== null && code !== 1) return `MoveIt 错误 ${code}`
    return null
  }
  if (status === 5) return '已取消'
  const text = typeof values === 'string' ? values : errorString(values)
  if (text) return text
  if (status === 6) return '动作中止'
  return `动作状态 ${status}`
}

export function jointTargetError(degrees: number[]): string | null {
  if (degrees.length !== JOINTS.length || degrees.some((value) => !Number.isFinite(value))) {
    return '七个关节目标都要是数字'
  }
  for (let index = 0; index < JOINTS.length; index += 1) {
    const spec = JOINTS[index]
    const value = degrees[index]
    if (value < spec.min || value > spec.max) {
      return `${spec.id} ${value.toFixed(1)}° 超出 ${spec.min}° 到 ${spec.max}°`
    }
  }
  return null
}

export function poseTargetError(pose: Pose): string | null {
  const values = [pose.x, pose.y, pose.z, pose.rx, pose.ry, pose.rz]
  if (values.some((value) => !Number.isFinite(value))) return '位姿六个数都要填'
  const reach = Math.hypot(pose.x, pose.y, pose.z) / 1000
  if (reach > 1.05) return '目标距 panda_link0 超过约 1 m，超出 Panda 可达范围'
  return null
}

export function trajectoryGoal(currentDegrees: number[], targetDegrees: number[]) {
  const current = currentDegrees.map((value) => value * DEG2RAD)
  const target = targetDegrees.map((value) => value * DEG2RAD)
  const maxDelta = target.reduce((max, value, index) => Math.max(max, Math.abs(value - current[index])), 0)
  const seconds = Math.min(8, Math.max(1.2, maxDelta / 0.5 + 0.4))
  const whole = Math.floor(seconds)
  const names = JOINTS.map((joint) => joint.rosName)
  return {
    seconds,
    args: {
      trajectory: {
        header: { stamp: { sec: 0, nanosec: 0 }, frame_id: BASE_FRAME },
        joint_names: names,
        points: [
          point(current, 0, 0),
          point(target, whole, Math.round((seconds - whole) * 1e9)),
        ],
      },
      multi_dof_trajectory: {
        header: { stamp: { sec: 0, nanosec: 0 }, frame_id: '' },
        joint_names: [],
        points: [],
      },
      path_tolerance: [],
      component_path_tolerance: [],
      goal_tolerance: [],
      component_goal_tolerance: [],
      goal_time_tolerance: { sec: 1, nanosec: 0 },
    },
  }
}

export function poseGoal(pose: Pose) {
  const position = { x: pose.x / 1000, y: pose.y / 1000, z: pose.z / 1000 }
  const orientation = rpyToQuaternion(pose.rx, pose.ry, pose.rz)
  const header = { stamp: { sec: 0, nanosec: 0 }, frame_id: BASE_FRAME }
  return {
    request: {
      workspace_parameters: {
        header,
        min_corner: { x: -2, y: -2, z: -2 },
        max_corner: { x: 2, y: 2, z: 2 },
      },
      start_state: {
        joint_state: { header, name: [], position: [], velocity: [], effort: [] },
        is_diff: true,
      },
      goal_constraints: [
        {
          name: 'console',
          joint_constraints: [],
          position_constraints: [
            {
              header,
              link_name: EE_LINK,
              target_point_offset: { x: 0, y: 0, z: 0 },
              constraint_region: {
                primitives: [{ type: 2, dimensions: [0.008] }],
                primitive_poses: [{ position, orientation: { x: 0, y: 0, z: 0, w: 1 } }],
              },
              weight: 1,
            },
          ],
          orientation_constraints: [
            {
              header,
              orientation,
              link_name: EE_LINK,
              absolute_x_axis_tolerance: 0.08,
              absolute_y_axis_tolerance: 0.08,
              absolute_z_axis_tolerance: 0.08,
              parameterization: 0,
              weight: 1,
            },
          ],
          visibility_constraints: [],
        },
      ],
      path_constraints: emptyConstraints(),
      group_name: ARM_GROUP,
      pipeline_id: '',
      planner_id: '',
      num_planning_attempts: 5,
      allowed_planning_time: 5,
      max_velocity_scaling_factor: 0.2,
      max_acceleration_scaling_factor: 0.2,
    },
    planning_options: {
      plan_only: false,
      look_around: false,
      look_around_attempts: 0,
      max_safe_execution_cost: 0,
      replan: true,
      replan_attempts: 1,
      replan_delay: 0.1,
    },
  }
}

export function rpyToQuaternion(rx: number, ry: number, rz: number) {
  const roll = rx * DEG2RAD
  const pitch = ry * DEG2RAD
  const yaw = rz * DEG2RAD
  const cy = Math.cos(yaw / 2)
  const sy = Math.sin(yaw / 2)
  const cp = Math.cos(pitch / 2)
  const sp = Math.sin(pitch / 2)
  const cr = Math.cos(roll / 2)
  const sr = Math.sin(roll / 2)
  return {
    x: sr * cp * cy - cr * sp * sy,
    y: cr * sp * cy + sr * cp * sy,
    z: cr * cp * sy - sr * sp * cy,
    w: cr * cp * cy + sr * sp * sy,
  }
}

function point(positions: number[], sec: number, nanosec: number) {
  return {
    positions,
    velocities: positions.map(() => 0),
    accelerations: [],
    effort: [],
    time_from_start: { sec, nanosec },
  }
}

function emptyConstraints() {
  return {
    name: '',
    joint_constraints: [],
    position_constraints: [],
    orientation_constraints: [],
    visibility_constraints: [],
  }
}

function moveitCode(values: unknown): number | null {
  if (!values || typeof values !== 'object') return null
  const code = (values as { error_code?: { val?: number } }).error_code
  return typeof code?.val === 'number' ? code.val : null
}

function errorString(values: unknown): string {
  if (!values || typeof values !== 'object') return ''
  const text = (values as { error_string?: string }).error_string
  return typeof text === 'string' ? text : ''
}
