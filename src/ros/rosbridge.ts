type Listener = (message: unknown) => void

export interface ActionResult {
  id: string
  action: string
  status: number
  ok: boolean
  values: unknown
}

interface Incoming {
  op?: string
  topic?: string
  msg?: unknown
  id?: string
  action?: string
  values?: unknown
  status?: number
  result?: boolean
  level?: string
  service?: string
}

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
  private goals = new Map<string, (result: ActionResult) => void>()
  private services = new Map<string, (values: unknown, ok: boolean) => void>()

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
          this.dispatch(JSON.parse(String(event.data)) as Incoming)
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

  sendActionGoal(
    action: string,
    actionType: string,
    args: unknown,
    timeoutMs = 60000,
  ): { id: string; result: Promise<ActionResult> } {
    const id = `goal-${this.sequence + 1}`
    this.sequence += 1
    const result = new Promise<ActionResult>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        if (!this.goals.has(id)) return
        this.goals.delete(id)
        reject(new Error('动作没有在时限内返回'))
      }, timeoutMs)
      this.goals.set(id, (result) => {
        window.clearTimeout(timer)
        resolve(result)
      })
      try {
        this.send({
          op: 'send_action_goal',
          id,
          action,
          action_type: actionType,
          args,
          feedback: false,
        })
      } catch (error) {
        window.clearTimeout(timer)
        this.goals.delete(id)
        reject(error)
      }
    })
    return { id, result }
  }

  cancelActionGoal(action: string, id: string) {
    if (!this.connected) return
    this.send({ op: 'cancel_action_goal', id, action })
  }

  callService(service: string, type: string, args: unknown): Promise<unknown> {
    const id = `srv-${this.sequence + 1}`
    this.sequence += 1
    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => {
        if (!this.services.has(id)) return
        this.services.delete(id)
        reject(new Error('服务没有返回'))
      }, 4000)
      this.services.set(id, (values, ok) => {
        window.clearTimeout(timer)
        if (!ok) reject(new Error(typeof values === 'string' ? values : '服务调用失败'))
        else resolve(values)
      })
      try {
        this.send({ op: 'call_service', id, service, type, args })
      } catch (error) {
        window.clearTimeout(timer)
        this.services.delete(id)
        reject(error)
      }
    })
  }

  close() {
    const pending = this.pending
    this.pending = null
    this.socket?.close()
    this.socket = null
    this.goals.clear()
    this.services.clear()
    pending?.reject(new Error('rosbridge 已关闭'))
  }

  private dispatch(data: Incoming) {
    if (data.op === 'publish' && data.topic) {
      this.listeners.get(data.topic)?.forEach((listener) => listener(data.msg))
      return
    }
    if (data.op === 'action_result' && data.id) {
      const finish = this.goals.get(data.id)
      if (!finish) return
      this.goals.delete(data.id)
      finish({
        id: data.id,
        action: data.action ?? '',
        status: data.status ?? 0,
        ok: data.result === true,
        values: data.values,
      })
      return
    }
    if (data.op === 'service_response' && data.id) {
      const finish = this.services.get(data.id)
      if (!finish) return
      this.services.delete(data.id)
      finish(data.values, data.result !== false)
      return
    }
    if (data.op === 'status' && data.id && data.level === 'error') {
      const goal = this.goals.get(data.id)
      if (goal) {
        this.goals.delete(data.id)
        goal({
          id: data.id,
          action: '',
          status: 6,
          ok: false,
          values: typeof data.msg === 'string' ? data.msg : 'rosbridge 拒绝了这个目标',
        })
        return
      }
      const service = this.services.get(data.id)
      if (service) {
        this.services.delete(data.id)
        service(typeof data.msg === 'string' ? data.msg : '服务调用失败', false)
      }
    }
  }

  private send(payload: unknown) {
    if (!this.connected || !this.socket) throw new Error('rosbridge 未连接')
    this.socket.send(JSON.stringify(payload))
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
