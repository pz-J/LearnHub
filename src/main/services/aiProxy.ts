import { secureHandle } from './ipcSecurity'
import { BrowserWindow } from 'electron'

interface AiChatReq {
  id: string
  baseURL: string
  apiKey: string
  body: Record<string, unknown>
}

const running = new Map<string, AbortController>()

/**
 * OpenAI 兼容流式代理：主进程转发 chat/completions（SSE），
 * 通过 ai:chunk / ai:done / ai:error 事件推回渲染进程。
 */
export function registerAiIpc(getWin: () => BrowserWindow | null): void {
  secureHandle('ai:chat', async (_e, req: AiChatReq) => {
    const { id, baseURL, apiKey, body } = req
    const win = getWin()
    if (!win || win.isDestroyed()) return
    const ac = new AbortController()
    running.set(id, ac)
    const send = (channel: string, payload: unknown) => {
      if (!win.isDestroyed()) win.webContents.send(channel, payload)
    }
    try {
      const url = baseURL.replace(/\/+$/, '') + '/chat/completions'
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify({ ...(body as object), stream: true }),
        signal: ac.signal
      })
      if (!res.ok || !res.body) {
        const text = await res.text().catch(() => '')
        send('ai:error', { id, message: `HTTP ${res.status}: ${text.slice(0, 400)}` })
        return
      }
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        const lines = buf.split('\n')
        buf = lines.pop() ?? ''
        for (const line of lines) {
          const s = line.trim()
          if (!s.startsWith('data:')) continue
          const data = s.slice(5).trim()
          if (data === '[DONE]') continue
          try {
            const j = JSON.parse(data)
            const delta: string = j.choices?.[0]?.delta?.content ?? j.choices?.[0]?.message?.content ?? ''
            if (delta) send('ai:chunk', { id, delta })
          } catch {
            /* 忽略无法解析的行 */
          }
        }
      }
      send('ai:done', { id })
    } catch (err) {
      const e = err as Error & { name?: string }
      if (e.name === 'AbortError') send('ai:done', { id, aborted: true })
      else send('ai:error', { id, message: String(e.message || e) })
    } finally {
      running.delete(id)
    }
  })

  secureHandle('ai:abort', (_e, id: string) => {
    running.get(id)?.abort()
    running.delete(id)
    return true
  })
}
