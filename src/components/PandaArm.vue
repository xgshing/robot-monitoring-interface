<script setup lang="ts">
// 用 Three.js 按七个关节角摆出 Panda 网格
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import * as THREE from 'three'
import { ColladaLoader } from 'three/examples/jsm/loaders/ColladaLoader.js'

const props = defineProps<{
  angles: number[]
}>()

const emit = defineEmits<{ ready: [value: boolean] }>()

const host = ref<HTMLDivElement | null>(null)
const DEG = Math.PI / 180
const FINGER = 0.02

const MESHES = ['link0', 'link1', 'link2', 'link3', 'link4', 'link5', 'link6', 'link7', 'hand', 'finger'] as const

let renderer: THREE.WebGLRenderer | null = null
let scene: THREE.Scene | null = null
let camera: THREE.PerspectiveCamera | null = null
let robot: THREE.Object3D | null = null
let frame = 0
const spins: THREE.Object3D[] = []
const viewOffset = new THREE.Vector3(0.85, 0.42, 0.72).normalize()
const frameBox = new THREE.Box3()
const frameSphere = new THREE.Sphere()
const frameCenter = new THREE.Vector3()

function pose(x: number, y: number, z: number, roll: number, pitch: number, yaw: number) {
  const group = new THREE.Group()
  group.position.set(x, y, z)
  group.rotation.set(roll, pitch, yaw, 'ZYX')
  return group
}

function spin() {
  const group = new THREE.Group()
  spins.push(group)
  return group
}

function applyAngles() {
  props.angles.forEach((angle, index) => {
    const joint = spins[index]
    if (joint) joint.rotation.z = (angle || 0) * DEG
  })
}

function frameRobot() {
  if (!camera || !robot) return
  robot.updateWorldMatrix(true, true)
  frameBox.setFromObject(robot)
  if (frameBox.isEmpty()) return
  frameBox.getBoundingSphere(frameSphere)
  const radius = Math.max(frameSphere.radius, 0.08)
  const vertical = (camera.fov * Math.PI) / 180
  const horizontal = 2 * Math.atan(Math.tan(vertical / 2) * Math.max(camera.aspect, 0.25))
  const half = Math.min(vertical, horizontal) / 2
  const distance = (radius / Math.tan(half)) * 1.24
  frameCenter.copy(frameSphere.center)
  camera.position.copy(frameCenter).addScaledVector(viewOffset, distance)
  camera.near = Math.max(0.01, distance * 0.02)
  camera.far = distance + radius * 8
  camera.lookAt(frameCenter)
  camera.updateProjectionMatrix()
}

function draw() {
  if (!renderer || !scene || !camera) return
  applyAngles()
  try {
    frameRobot()
  } catch {
    // 取景失败时保留上一帧相机，避免退回示意图
  }
  renderer.render(scene, camera)
}

function shellMaterial(map?: THREE.Texture) {
  return new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: map ?? null,
    roughness: 0.64,
    metalness: 0.05,
  })
}

function gazeboAlbedo(source: THREE.Texture) {
  const image = source.image as CanvasImageSource & { width?: number; height?: number }
  const sourceWidth = image.width || 1024
  const sourceHeight = image.height || 1024
  const scale = Math.min(1, 512 / Math.max(sourceWidth, sourceHeight))
  const width = Math.max(1, Math.round(sourceWidth * scale))
  const height = Math.max(1, Math.round(sourceHeight * scale))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) return source
  context.drawImage(image, 0, 0, width, height)
  const frame = context.getImageData(0, 0, width, height)
  const pixels = frame.data
  for (let index = 0; index < pixels.length; index += 4) {
    const red = pixels[index]
    const green = pixels[index + 1]
    const blue = pixels[index + 2]
    const luminance = 0.299 * red + 0.587 * green + 0.114 * blue
    const cool = blue > red + 12 && blue > green
    if (luminance > 96 && !cool) {
      const value = Math.min(244, Math.max(214, Math.round(228 + (luminance - 150) * 0.05)))
      pixels[index] = value
      pixels[index + 1] = value
      pixels[index + 2] = Math.max(0, value - 1)
    } else if (red > blue + 10 && red >= green - 4) {
      const value = Math.round(luminance)
      pixels[index] = value
      pixels[index + 1] = value
      pixels[index + 2] = value
    }
  }
  context.putImageData(frame, 0, 0)
  const next = new THREE.CanvasTexture(canvas)
  next.colorSpace = THREE.SRGBColorSpace
  next.flipY = false
  next.anisotropy = 8
  next.needsUpdate = true
  source.dispose()
  return next
}

async function loadMesh(name: string, loader: ColladaLoader, textures: Map<string, THREE.Texture>) {
  const collada = await loader.loadAsync(`/panda-model/meshes/visual/${name}.dae`)
  if (!collada) throw new Error(`缺少 ${name}.dae`)
  const wrapper = new THREE.Group()
  wrapper.rotation.x = Math.PI / 2
  wrapper.add(collada.scene)
  wrapper.updateWorldMatrix(true, true)
  const bounds = new THREE.Box3().setFromObject(wrapper)
  const extent = bounds.getSize(new THREE.Vector3())
  const maxDim = Math.max(extent.x, extent.y, extent.z)
  if (maxDim < 0.02) wrapper.scale.multiplyScalar(100)
  const texture = textures.get(name)
  collada.scene.traverse((node) => {
    const mesh = node as THREE.Mesh
    if (!mesh.isMesh) return
    const previous = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    previous.forEach((material) => material.dispose())
    mesh.material = shellMaterial(texture)
  })
  return wrapper
}

function textureFile(name: string) {
  if (name === 'finger') return 'finger_finger_BaseColor.png'
  if (name === 'hand') return 'hand_hand_BaseColor.png'
  return `${name}_${name}_BaseColor.png`
}

async function applyGazeboTextures(parts: Map<string, THREE.Group>) {
  const textureLoader = new THREE.TextureLoader()
  for (const name of MESHES) {
    const part = parts.get(name)
    if (!part) continue
    try {
      const texture = await textureLoader.loadAsync(`/panda-model/materials/textures/${textureFile(name)}`)
      texture.colorSpace = THREE.SRGBColorSpace
      texture.flipY = false
      const albedo = gazeboAlbedo(texture)
      part.traverse((node) => {
        const mesh = node as THREE.Mesh
        if (!mesh.isMesh) return
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
        materials.forEach((material) => {
          if (material instanceof THREE.MeshStandardMaterial) {
            material.map = albedo
            material.needsUpdate = true
          }
        })
      })
    } catch {
      // 贴图缺失时保留浅灰外壳
    }
    await new Promise((resolve) => window.requestAnimationFrame(resolve))
  }
}

async function boot() {
  if (!host.value) {
    emit('ready', false)
    return
  }
  const loader = new ColladaLoader()
  const parts = new Map<string, THREE.Group>()
  try {
    await Promise.all(
      MESHES.map(async (name) => {
        parts.set(name, await loadMesh(name, loader, new Map()))
      }),
    )
  } catch {
    emit('ready', false)
    return
  }
  const fingerCopy = parts.get('finger')!.clone(true)

  const link0 = new THREE.Group()
  link0.add(parts.get('link0')!)
  const joint1 = pose(0, 0, 0.333, 0, 0, 0)
  const axis1 = spin()
  joint1.add(axis1)
  axis1.add(parts.get('link1')!)
  link0.add(joint1)

  const joint2 = pose(0, 0, 0, -Math.PI / 2, 0, 0)
  const axis2 = spin()
  joint2.add(axis2)
  axis2.add(parts.get('link2')!)
  axis1.add(joint2)

  const joint3 = pose(0, -0.316, 0, Math.PI / 2, 0, 0)
  const axis3 = spin()
  joint3.add(axis3)
  axis3.add(parts.get('link3')!)
  axis2.add(joint3)

  const joint4 = pose(0.0825, 0, 0, Math.PI / 2, 0, 0)
  const axis4 = spin()
  joint4.add(axis4)
  axis4.add(parts.get('link4')!)
  axis3.add(joint4)

  const joint5 = pose(-0.0825, 0.384, 0, -Math.PI / 2, 0, 0)
  const axis5 = spin()
  joint5.add(axis5)
  axis5.add(parts.get('link5')!)
  axis4.add(joint5)

  const joint6 = pose(0, 0, 0, Math.PI / 2, 0, 0)
  const axis6 = spin()
  joint6.add(axis6)
  axis6.add(parts.get('link6')!)
  axis5.add(joint6)

  const joint7 = pose(0.088, 0, 0, Math.PI / 2, 0, 0)
  const axis7 = spin()
  joint7.add(axis7)
  axis7.add(parts.get('link7')!)
  axis6.add(joint7)

  const hand = pose(0, 0, 0.107, 0, 0, -Math.PI / 4)
  hand.add(parts.get('hand')!)
  axis7.add(hand)

  const left = pose(0, 0, 0.0584, 0, 0, 0)
  left.position.y += FINGER
  left.add(parts.get('finger')!)
  hand.add(left)

  const right = pose(0, 0, 0.0584, 0, 0, 0)
  right.position.y -= FINGER
  const rightMesh = new THREE.Group()
  rightMesh.rotation.set(0, 0, Math.PI, 'ZYX')
  rightMesh.add(fingerCopy)
  right.add(rightMesh)
  hand.add(right)

  const upright = new THREE.Group()
  upright.rotation.x = -Math.PI / 2
  upright.add(link0)

  scene = new THREE.Scene()
  scene.add(upright)
  scene.add(new THREE.HemisphereLight(0xffffff, 0xb7bdc4, 0.72))
  const sun = new THREE.DirectionalLight(0xffffff, 2.4)
  sun.position.set(0.6, 3.2, 1.4)
  scene.add(sun)
  const fill = new THREE.DirectionalLight(0xe7ebf0, 0.28)
  fill.position.set(-1.5, 0.6, -1)
  scene.add(fill)

  robot = upright
  camera = new THREE.PerspectiveCamera(30, 1, 0.01, 20)

  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
  renderer.setClearColor(0x000000, 0)
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.08
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
  host.value.appendChild(renderer.domElement)
  resize()
  emit('ready', true)
  draw()
  void applyGazeboTextures(parts)
}

function resize() {
  if (!host.value || !renderer || !camera) return
  const width = host.value.clientWidth
  const height = host.value.clientHeight
  if (width < 2 || height < 2) return
  camera.aspect = width / height
  camera.updateProjectionMatrix()
  renderer.setSize(width, height, false)
  draw()
}

let observer: ResizeObserver | null = null

onMounted(() => {
  void boot().catch(() => {
    if (!renderer) emit('ready', false)
  })
  observer = new ResizeObserver(() => resize())
  if (host.value) observer.observe(host.value)
  frame = window.requestAnimationFrame(function loop() {
    draw()
    frame = window.requestAnimationFrame(loop)
  })
})

watch(
  () => props.angles.map((angle) => angle.toFixed(2)).join(','),
  () => draw(),
)

onBeforeUnmount(() => {
  window.cancelAnimationFrame(frame)
  observer?.disconnect()
  renderer?.dispose()
  scene?.traverse((node) => {
    const mesh = node as THREE.Mesh
    if (!mesh.isMesh) return
    mesh.geometry?.dispose()
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    materials.forEach((material) => material.dispose())
  })
})
</script>

<template>
  <div ref="host" class="panda-view"></div>
</template>
