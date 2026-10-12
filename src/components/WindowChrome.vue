<script setup lang="ts">
defineProps<{
  clock: string
  connected: boolean
}>()
</script>

<template>
  <header class="chrome">
    <div class="lights" aria-hidden="true">
      <i class="r"></i>
      <i class="y"></i>
      <i class="g"></i>
    </div>
    <div class="url">
      <svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true">
        <rect x="6" y="10" width="12" height="9" rx="2" fill="none" stroke="currentColor" stroke-width="1.8" />
        <path d="M8.5 10V7.8a3.5 3.5 0 0 1 7 0V10" fill="none" stroke="currentColor" stroke-width="1.8" />
      </svg>
      <span>https://cell.local/monitor/tx2-140</span>
    </div>
    <div class="model">
      <time class="clock">{{ clock }}</time>
      <span class="model-name">
        <i :class="connected ? 'ok' : 'bad'"></i>
        Staubli TX2-140
      </span>
    </div>
  </header>
</template>
