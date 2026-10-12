type Listener = (message: unknown) => void

interface SubscribeOptions {
  topic: string
  type: string
  throttleRate?: number
  durability?: 'volatile' | 'transient_local'
}

export class RosBridgeClient {
  private socket: WebSocket | null = null
  private listeners = new Map<string, Set<Listener>>()
  private subscriptions: SubscribeOptions[] = []
  private sequence = 0
  private pending: { reject: (error: Error) => void } | null = null

  get connected() {
    return this.socket?.readyState === WebSocket.OPEN
  }

  connect(url: string): Promise<void> {
    this.close()
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(url)
      this.socket = socket
      this.pending = { reject }
      socket.onopen = () => {
        if (this.socket !== socket) return
        this.pending = null
        this.subscriptions.forEach((item) => this.sendSubscribe(item))
        resolve()
      }
      socket.onerror = () => {
        if (this.socket !== socket) return
        this.pending = null
        reject(new Error('rosbridge 连接失败'))
      }
      socket.onclose = () => {
        if (this.socket === socket) this.socket = null
      }
      socket.onmessage = (event) => {
        try {
          const data = JSON.parse(String(event.data)) as { op?: string; topic?: string; msg?: unknown }
          if (data.op !== 'publish' || !data.topic) return
          this.listeners.get(data.topic)?.forEach((listener) => listener(data.msg))
        } catch {
          // rosbridge 偶发空帧，丢掉即可
        }
      }
    })
  }

  subscribe(options: SubscribeOptions, listener: Listener) {
    const set = this.listeners.get(options.topic) ?? new Set()
    set.add(listener)
    this.listeners.set(options.topic, set)
    if (!this.subscriptions.some((item) => item.topic === options.topic)) {
      this.subscriptions.push(options)
      if (this.connected) this.sendSubscribe(options)
    }
    return () => set.delete(listener)
  }

  close() {
    const pending = this.pending
    this.pending = null
    this.socket?.close()
    this.socket = null
    pending?.reject(new Error('rosbridge 已关闭'))
  }

  private sendSubscribe(options: SubscribeOptions) {
    this.sequence += 1
    this.socket?.send(
      JSON.stringify({
        op: 'subscribe',
        id: `sub-${this.sequence}`,
        topic: options.topic,
        type: options.type,
        throttle_rate: options.throttleRate ?? 0,
        queue_length: 1,
        qos: options.durability
          ? { reliability: 'reliable', durability: options.durability, history: 'keep_last', depth: 5 }
          : undefined,
      }),
    )
  }
}
