export function formatNum(value: number, digits = 0) {
  return value.toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
}

export function formatPct(value: number) {
  const abs = Math.abs(value)
  const digits = abs >= 1 ? 2 : 1
  return `${abs.toFixed(digits)}%`
}

export function formatSigned(value: number, digits = 2) {
  const body = formatNum(Math.abs(value), digits)
  if (value > 0.005) return `+${body}`
  if (value < -0.005) return `-${body}`
  return formatNum(0, digits)
}

export function formatClock(ts = Date.now()) {
  return new Date(ts).toLocaleTimeString('zh-CN', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

export function jointRatio(angle: number, min: number, max: number) {
  const ratio = (angle - min) / (max - min)
  return Math.min(0.98, Math.max(0.02, ratio))
}
