<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import * as echarts from 'echarts'
import { formatNum } from '../format'
import type { ConsoleState } from '../types'
import { JOINTS } from '../types'

const props = defineProps<{
  state: ConsoleState
}>()

const emit = defineEmits<{ select: [index: number] }>()

const angleHost = ref<HTMLDivElement | null>(null)
const speedHost = ref<HTMLDivElement | null>(null)
let angleChart: echarts.ECharts | null = null
let speedChart: echarts.ECharts | null = null
let observer: ResizeObserver | null = null

const parts = computed(() => {
  const phases = props.state.phases
  const sum = phases.plan + phases.move + phases.grip + phases.idle || 1
  return [
    { key: 'plan', label: '规划', color: '#f0a3c4', pct: (phases.plan / sum) * 100 },
    { key: 'move', label: '运动', color: '#3ecf8e', pct: (phases.move / sum) * 100 },
    { key: 'grip', label: '抓取', color: '#f5b942', pct: (phases.grip / sum) * 100 },
    { key: 'idle', label: '空闲', color: '#7d8da3', pct: (phases.idle / sum) * 100 },
  ]
})

const donutStyle = computed(() => ({
  background: `conic-gradient(#3ecf8e ${props.state.utilization * 100}%, rgba(255,255,255,0.08) 0)`,
}))

const axis = {
  axisLine: { show: false },
  axisTick: { show: false },
  axisLabel: {
    color: '#6d7f96',
    fontSize: 10,
    fontFamily: 'Outfit, sans-serif',
    hideOverlap: true,
  },
  splitLine: { show: false },
}

function renderAngles() {
  if (!angleChart) return
  const selected = props.state.selectedJoint
  angleChart.setOption({
    animation: false,
    backgroundColor: 'transparent',
    grid: { left: 8, right: 8, top: 14, bottom: 22 },
    tooltip: {
      trigger: 'axis',
      confine: true,
      backgroundColor: 'rgba(10, 16, 28, 0.94)',
      borderColor: 'rgba(255,255,255,0.08)',
      textStyle: { color: '#e8eef7', fontSize: 12 },
      formatter: (params: unknown) => {
        const list = (Array.isArray(params) ? params : [params]) as Array<{
          seriesName?: string
          color?: string
          value?: number
          axisValue?: string
        }>
        const head = list[0]?.axisValue ?? ''
        const body = list
          .map((item) => `${item.seriesName} ${Number(item.value).toFixed(2)}°`)
          .join('<br/>')
        return `${head}<br/>${body}`
      },
    },
    xAxis: {
      type: 'category',
      data: props.state.timeLabels,
      ...axis,
      axisLabel: { ...axis.axisLabel, interval: 11 },
    },
    yAxis: {
      type: 'value',
      scale: true,
      axisLabel: { show: false },
      axisLine: { show: false },
      axisTick: { show: false },
      splitLine: { lineStyle: { color: 'rgba(148,163,184,0.08)' } },
    },
    series: JOINTS.map((joint, index) => {
      const active = selected === index
      return {
        name: joint.id,
        type: 'line',
        smooth: true,
        symbol: 'none',
        data: props.state.angleHistory[index],
        z: active ? 3 : 1,
        lineStyle: {
          width: active ? 2.2 : 1.05,
          color: joint.color,
          opacity: active ? 1 : 0.38,
          shadowBlur: active ? 10 : 0,
          shadowColor: joint.color,
        },
      }
    }),
  })
}

function renderSpeed() {
  if (!speedChart) return
  speedChart.setOption({
    animation: false,
    backgroundColor: 'transparent',
    grid: { left: 8, right: 8, top: 12, bottom: 22 },
    tooltip: {
      trigger: 'axis',
      confine: true,
      backgroundColor: 'rgba(10, 16, 28, 0.94)',
      borderColor: 'rgba(255,255,255,0.08)',
      textStyle: { color: '#e8eef7', fontSize: 12 },
      formatter: (params: unknown) => {
        const list = (Array.isArray(params) ? params : [params]) as Array<{
          value?: number
          axisValue?: string
        }>
        const item = list[0]
        return `${item?.axisValue ?? ''}<br/>转速 ${formatNum(Number(item?.value ?? 0))} rpm`
      },
    },
    xAxis: {
      type: 'category',
      data: props.state.timeLabels,
      ...axis,
      axisLabel: { ...axis.axisLabel, interval: 11 },
    },
    yAxis: {
      type: 'value',
      scale: true,
      axisLabel: { show: false },
      axisLine: { show: false },
      axisTick: { show: false },
      splitLine: { lineStyle: { color: 'rgba(148,163,184,0.08)' } },
    },
    series: [
      {
        name: '转速',
        type: 'line',
        smooth: true,
        symbol: 'none',
        data: props.state.speedHistory,
        lineStyle: { width: 1.7, color: '#3ecf8e' },
        areaStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: 'rgba(62, 207, 142, 0.42)' },
            { offset: 1, color: 'rgba(62, 207, 142, 0.02)' },
          ]),
        },
      },
    ],
  })
}

function render() {
  renderAngles()
  renderSpeed()
}

onMounted(() => {
  if (angleHost.value) angleChart = echarts.init(angleHost.value, undefined, { renderer: 'canvas' })
  if (speedHost.value) speedChart = echarts.init(speedHost.value, undefined, { renderer: 'canvas' })
  render()
  observer = new ResizeObserver(() => {
    angleChart?.resize()
    speedChart?.resize()
  })
  if (angleHost.value) observer.observe(angleHost.value)
  if (speedHost.value) observer.observe(speedHost.value)
})

watch(
  () => [props.state.revision, props.state.selectedJoint] as const,
  () => render(),
)

onBeforeUnmount(() => {
  observer?.disconnect()
  angleChart?.dispose()
  speedChart?.dispose()
})
</script>

<template>
  <section class="charts" aria-label="趋势">
    <article class="card chart-card">
      <header class="card-head">
        <h2>关节角度 <small>°</small></h2>
        <div class="jchips">
          <button
            v-for="(joint, index) in JOINTS"
            :key="joint.id"
            type="button"
            class="jchip"
            :class="{ on: state.selectedJoint === index }"
            :style="{ '--c': joint.color }"
            @click="emit('select', index)"
          >
            {{ joint.id }}
          </button>
        </div>
      </header>
      <div ref="angleHost" class="chart-host"></div>
    </article>

    <article class="card chart-card speed-card">
      <header class="card-head">
        <h2>转速 <small>rpm</small></h2>
      </header>
      <div ref="speedHost" class="chart-host"></div>
    </article>

    <article class="card time-card">
      <div class="donut" :style="donutStyle">
        <div class="donut-hole">
          <em>平均产能</em>
          <strong>{{ formatNum(state.throughput) }}</strong>
          <span>件/日</span>
        </div>
      </div>
      <div class="time-copy">
        <h2>时间分布</h2>
        <div class="stack" aria-hidden="true">
          <i v-for="part in parts" :key="part.key" :style="{ width: `${part.pct}%`, background: part.color }"></i>
        </div>
        <ul class="legend">
          <li v-for="part in parts" :key="part.key">
            <i :style="{ background: part.color }"></i>
            {{ part.label }}
          </li>
        </ul>
      </div>
    </article>
  </section>
</template>
