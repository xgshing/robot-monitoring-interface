<script setup lang="ts">
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
let frame = 0
const spins: THREE.Object3D[] = []

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

function draw() {
  if (!renderer || !scene || !camera) return
  applyAngles()
  renderer.render(scene, camera)
}

async function loadMesh(name: string, loader: ColladaLoader, textures: Map<string, THREE.Texture>) {
  const collada = await loader.loadAsync(`/panda-model/meshes/visual/${name}.dae`)
  if (!collada) throw new Error(`缺少 ${name}.dae`)
  const wrapper = new THREE.Group()
  wrapper.rotation.x = Math.PI / 2
  wrapper.add(collada.scene)
  const texture = textures.get(name)
  wrapper.updateWorldMatrix(true, true)
  const bounds = new THREE.Box3().setFromObject(wrapper)
  const extent = bounds.getSize(new THREE.Vector3())
  const maxDim = Math.max(extent.x, extent.y, extent.z)
  if (maxDim < 0.02) wrapper.scale.multiplyScalar(100)
  collada.scene.traverse((node) => {
    const mesh = node as THREE.Mesh
    if (!mesh.isMesh) return
    const source = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    mesh.material = source.map((material) => {
      const next = material.clone()
      if (texture && 'map' in next) {
        next.map = texture
        if ('color' in next && next.color instanceof THREE.Color) next.color.set(0xffffff)
      }
      return next
    })
  })
  return wrapper
}

async function boot() {
  const probe = await fetch('/panda-model/meshes/visual/link0.dae', { method: 'HEAD' })
  if (!probe.ok || !host.value) {
    emit('ready', false)
    return
  }
  const loader = new ColladaLoader()
  const textureLoader = new THREE.TextureLoader()
  const textures = new Map<string, THREE.Texture>()
  await Promise.all(
    MESHES.map(async (name) => {
      const file = name === 'finger' ? 'finger_finger_BaseColor.png' : name === 'hand' ? 'hand_hand_BaseColor.png' : `${name}_${name}_BaseColor.png`
      try {
        const texture = await textureLoader.loadAsync(`/panda-model/materials/textures/${file}`)
        texture.colorSpace = THREE.SRGBColorSpace
        texture.flipY = false
        textures.set(name, texture)
      } catch {
        // 贴图缺失时仍显示网格外形
      }
    }),
  )
  const parts = new Map<string, THREE.Group>()
  await Promise.all(
    MESHES.map(async (name) => {
      parts.set(name, await loadMesh(name, loader, textures))
    }),
  )
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
  scene.add(new THREE.HemisphereLight(0xf7f9fc, 0x202838, 1.35))
  const key = new THREE.DirectionalLight(0xffffff, 1.8)
  key.position.set(1.6, 2.4, 1.8)
  scene.add(key)
  const fill = new THREE.DirectionalLight(0xb7c7dc, 0.7)
  fill.position.set(-1.4, 1.2, -1)
  scene.add(fill)

  camera = new THREE.PerspectiveCamera(30, 1, 0.01, 20)
  upright.updateWorldMatrix(true, true)
  const box = new THREE.Box3().setFromObject(upright)
  const center = box.getCenter(new THREE.Vector3())
  const size = box.getSize(new THREE.Vector3())
  const distance = Math.max(size.x, size.y, size.z) * 1.35
  camera.position.copy(center).add(new THREE.Vector3(distance * 0.85, distance * 0.42, distance * 0.72))
  camera.lookAt(center.x, center.y + size.y * 0.02, center.z)

  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
  renderer.setClearColor(0x000000, 0)
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
  host.value.appendChild(renderer.domElement)
  resize()
  emit('ready', true)
  draw()
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
  void boot().catch(() => emit('ready', false))
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
