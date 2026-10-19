<script setup lang="ts">
// 底部执行记录，可只看错误、确认告警
import { computed, ref } from 'vue'
import type { ConsoleState } from '../types'

const props = defineProps<{
  state: ConsoleState
}>()

const emit = defineEmits<{ ack: [] }>()

const filter = ref<'all' | 'error'>('all')

const shown = computed(() => {
  if (filter.value === 'all') return props.state.logs
  return props.state.logs.filter((item) => item.level === 'error')
})

const levelText: Record<string, string> = {
  info: '信息',
  ok: '正常',
  warn: '警告',
  error: '错误',
}
</script>

<template>
  <section class="log card" aria-label="任务执行记录">
    <header class="log-head">
      <h2>任务执行记录</h2>
      <div class="log-tools">
        <div class="seg" role="tablist">
          <button type="button" :class="{ on: filter === 'all' }" @click="filter = 'all'">全部</button>
          <button type="button" :class="{ on: filter === 'error' }" @click="filter = 'error'">错误</button>
        </div>
        <button type="button" class="ghost" @click="emit('ack')">确认告警</button>
      </div>
    </header>
    <div v-if="shown.length === 0" class="empty">当前没有错误记录</div>
    <div v-else class="log-list" role="log">
      <TransitionGroup name="row">
        <article v-for="item in shown" :key="item.id" class="log-row" :class="item.level">
          <time>{{ item.time }}</time>
          <span class="level">{{ levelText[item.level] }}</span>
          <p :title="`${item.title} ${item.detail}`">
            <strong>{{ item.title }}</strong>
            <span>{{ item.detail }}</span>
          </p>
        </article>
      </TransitionGroup>
    </div>
  </section>
</template>
