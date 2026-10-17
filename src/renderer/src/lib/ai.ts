import { lh, uid } from '@/lib/ipc'
import { useSettings } from '@/stores/settings'

interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

interface ChatOpts {
  messages: ChatMessage[]
  temperature?: number
  model?: string
  onChunk?: (delta: string) => void
  signal?: AbortSignal
}

const listeners = new Map<string, { onChunk?: (d: string) => void; resolve: (t: string) => void; reject: (e: Error) => void; buf: string }>()
let bound = false

function bind(): void {
  if (bound) return
  bound = true
  lh.onAiChunk(({ id, delta }) => {
    const l = listeners.get(id)
    if (l) {
      l.buf += delta
      l.onChunk?.(delta)
    }
  })
  lh.onAiDone(({ id }) => {
    const l = listeners.get(id)
    if (l) {
      listeners.delete(id)
      l.resolve(l.buf)
    }
  })
  lh.onAiError(({ id, message }) => {
    const l = listeners.get(id)
    if (l) {
      listeners.delete(id)
      l.reject(new Error(message))
    }
  })
}

/** 发起流式对话，返回 {id, done}。失败 reject Error。 */
export function aiChat(opts: ChatOpts): { id: string; done: Promise<string> } {
  bind()
  const { ai } = useSettings.getState().settings
  if (!ai.apiKey) {
    const id = 'nokey'
    return { id, done: Promise.reject(new Error('尚未配置 AI API Key，请到「设置」填写')) }
  }
  const id = uid('aichat_')
  let done: (t: string) => void = () => {}
  let fail: (e: Error) => void = () => {}
  const promise = new Promise<string>((res, rej) => {
    done = res
    fail = rej
  })
  listeners.set(id, { onChunk: opts.onChunk, resolve: done, reject: fail, buf: '' })
  const abort = () => {
    if (!listeners.has(id)) return
    listeners.delete(id)
    void lh.aiAbort(id)
    const error = new Error('AI 请求已取消')
    error.name = 'AbortError'
    fail(error)
  }
  if (opts.signal?.aborted) {
    abort()
    return { id, done: promise }
  }
  opts.signal?.addEventListener('abort', abort, { once: true })
  void promise.finally(() => opts.signal?.removeEventListener('abort', abort)).catch(() => {})
  void lh.aiChat({
    id,
    baseURL: ai.baseURL,
    apiKey: ai.apiKey,
    body: {
      model: opts.model || ai.model,
      messages: opts.messages,
      temperature: opts.temperature ?? 0.4
    }
  })
  return { id, done: promise }
}

export function aiAbort(id: string): void {
  void lh.aiAbort(id)
}

/** 便捷：一次性问答 */
export function aiAsk(prompt: string, system?: string, onChunk?: (d: string) => void): Promise<string> {
  const messages: ChatMessage[] = []
  if (system) messages.push({ role: 'system', content: system })
  messages.push({ role: 'user', content: prompt })
  return aiChat({ messages, onChunk }).done
}

export type { ChatMessage }
