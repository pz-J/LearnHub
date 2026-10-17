import { secureHandle } from './ipcSecurity'
import { sha256 } from './store'
import { githubPutFailure, isSyncPathAllowed } from './securityValidation'

const API = 'https://api.github.com'

function headers(pat: string): Record<string, string> {
  return {
    Authorization: `Bearer ${pat}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'LearnHub-App',
    'Content-Type': 'application/json'
  }
}

async function gh<T = unknown>(pat: string, url: string, init?: RequestInit): Promise<{ status: number; data: T }> {
  const res = await fetch(API + url, { headers: headers(pat), ...init })
  const text = await res.text()
  let data: unknown = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = text
  }
  return { status: res.status, data: data as T }
}

function extractUpdatedAt(content: string): number {
  try {
    const j = JSON.parse(content)
    if (j && typeof j.updatedAt === 'number') return j.updatedAt
  } catch {
    /* 非 JSON */
  }
  const m = content.match(/^updatedAt:\s*(.+)$/m)
  if (m) {
    const t = Date.parse(m[1].trim())
    if (!isNaN(t)) return t
  }
  return 0
}

interface SyncFile {
  path: string
  content: string
}
interface SyncReq {
  pat: string
  owner: string
  repo: string
  branch?: string
  files: SyncFile[]
  state: Record<string, { remoteSha: string; localHash: string }>
}
export interface SyncReport {
  ok: boolean
  error?: string
  repoCreated?: boolean
  branch: string
  actions: { path: string; action: string }[]
  pulled: { path: string; content: string }[]
  state: Record<string, { remoteSha: string; localHash: string }>
}

export function registerGithubIpc(): void {
  secureHandle('gh:getUser', async (_e, pat: string) => {
    if (typeof pat !== 'string' || !pat.trim() || pat.length > 500) return { ok: false, error: 'GitHub PAT 格式无效' }
    const { status, data } = await gh<{ login?: string; message?: string }>(pat, '/user')
    if (status === 200 && data?.login) return { ok: true, login: data.login }
    return { ok: false, error: data?.message || `HTTP ${status}` }
  })

  secureHandle('gh:sync', async (_e, req: SyncReq): Promise<SyncReport> => {
    validateSyncReq(req)
    const { pat, owner, repo, files } = req
    let branch = req.branch || 'main'
    const report: SyncReport = { ok: true, branch, actions: [], pulled: [], state: {} }

    try {
      // 1. 确认仓库存在，否则创建私有仓库
      let r = await gh<{ default_branch?: string; message?: string }>(pat, `/repos/${owner}/${repo}`)
      let repoCreated = false
      if (r.status === 404) {
        const cr = await gh<{ full_name?: string; message?: string }>(pat, '/user/repos', {
          method: 'POST',
          body: JSON.stringify({ name: repo, private: true, auto_init: true })
        })
        if (cr.status >= 300) {
          return { ...report, ok: false, error: `创建仓库失败: ${cr.status} ${JSON.stringify(cr.data)}` }
        }
        repoCreated = true
        r = await gh<{ default_branch?: string }>(pat, `/repos/${owner}/${repo}`)
      } else if (r.status !== 200) {
        return { ...report, ok: false, error: `访问仓库失败: ${r.status} ${r.data?.message || ''}` }
      }
      if (r.data?.default_branch) branch = r.data.default_branch
      report.branch = branch
      report.repoCreated = repoCreated

      for (const f of files) {
        const localHash = sha256(f.content)
        const st = req.state[f.path]
        const gr = await gh<{ sha?: string; content?: string; message?: string; encoding?: string }>(
          pat,
          `/repos/${owner}/${repo}/contents/${encodePath(f.path)}?ref=${encodeURIComponent(branch)}`
        )
        const newState = { remoteSha: '', localHash }
        if (gr.status === 404) {
          // 远端无此文件 → 推送
          await putFile(pat, owner, repo, branch, f.path, f.content, undefined)
          report.actions.push({ path: f.path, action: 'pushed' })
        } else if (gr.status !== 200 || !gr.data.sha) {
          report.actions.push({ path: f.path, action: 'error:' + (gr.data?.message || gr.status) })
          continue
        } else {
          const remoteSha = gr.data.sha
          const remoteContent =
            gr.data.encoding === 'base64' && gr.data.content
              ? Buffer.from(gr.data.content, 'base64').toString('utf-8')
              : ''
          const remoteHash = sha256(remoteContent)
          const remoteChanged = !st || st.remoteSha !== remoteSha
          const localChanged = !st || st.localHash !== localHash

          if (!remoteChanged && !localChanged) {
            report.actions.push({ path: f.path, action: 'skipped' })
          } else if (!remoteChanged && localChanged) {
            await putFile(pat, owner, repo, branch, f.path, f.content, remoteSha)
            report.actions.push({ path: f.path, action: 'pushed' })
          } else if (remoteChanged && !localChanged) {
            report.pulled.push({ path: f.path, content: remoteContent })
            newState.localHash = remoteHash
            report.actions.push({ path: f.path, action: 'pulled' })
          } else {
            // 双方都有修改 → 按 updatedAt 时间戳裁决
            const lu = extractUpdatedAt(f.content)
            const ru = extractUpdatedAt(remoteContent)
            if (lu >= ru) {
              await putFile(pat, owner, repo, branch, f.path, f.content, remoteSha)
              report.actions.push({ path: f.path, action: 'conflict-local-wins' })
            } else {
              report.pulled.push({ path: f.path, content: remoteContent })
              newState.localHash = remoteHash
              report.actions.push({ path: f.path, action: 'conflict-remote-wins' })
            }
          }
          if (report.pulled.length && report.pulled[report.pulled.length - 1].path === f.path) {
            // pulled: 记录远端 sha
            newState.remoteSha = remoteSha
            report.state[f.path] = newState
            continue
          }
        }
        // pushed / skipped：读取推送后的 sha
        if (report.actions[report.actions.length - 1]?.action === 'pushed') {
          const pr = await gh<{ sha?: string }>(
            pat,
            `/repos/${owner}/${repo}/contents/${encodePath(f.path)}?ref=${encodeURIComponent(branch)}`
          )
          newState.remoteSha = pr.data?.sha ?? ''
        } else {
          newState.remoteSha = gr.data?.sha ?? ''
        }
        report.state[f.path] = newState
      }
      return report
    } catch (err) {
      return { ...report, ok: false, error: String((err as Error).message || err) }
    }
  })
}

function validateSyncReq(value: unknown): asserts value is SyncReq {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('同步请求格式错误')
  const req = value as Record<string, unknown>
  if (typeof req.pat !== 'string' || !req.pat.trim() || req.pat.length > 500) throw new Error('GitHub PAT 格式无效')
  if (typeof req.owner !== 'string' || !/^[a-zA-Z0-9-]{1,39}$/.test(req.owner)) throw new Error('GitHub 用户名格式无效')
  if (typeof req.repo !== 'string' || !/^[a-zA-Z0-9._-]{1,100}$/.test(req.repo) || req.repo === '.' || req.repo === '..') throw new Error('GitHub 仓库名格式无效')
  if (req.branch !== undefined && (typeof req.branch !== 'string' || !req.branch || req.branch.length > 200 || /[\x00-\x20~^:?*\\[]/.test(req.branch) || req.branch.includes('..') || req.branch.endsWith('.lock'))) {
    throw new Error('GitHub 分支名格式无效')
  }
  if (!Array.isArray(req.files) || req.files.length > 1000) throw new Error('同步文件列表无效或超过 1000 个文件')
  let total = 0
  for (const item of req.files) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('同步文件条目格式错误')
    const file = item as Record<string, unknown>
    if (typeof file.path !== 'string' || !isSyncPathAllowed(file.path)) throw new Error(`不允许同步此路径: ${String(file.path)}`)
    if (typeof file.content !== 'string') throw new Error(`同步文件内容格式错误: ${file.path}`)
    const size = Buffer.byteLength(file.content, 'utf8')
    if (size > 10 * 1024 * 1024) throw new Error(`同步文件过大: ${file.path}`)
    total += size
    if (total > 25 * 1024 * 1024) throw new Error('单次同步数据总量超过 25 MB')
  }
  if (!req.state || typeof req.state !== 'object' || Array.isArray(req.state) || Object.keys(req.state).length > 1000) throw new Error('同步状态格式错误')
  for (const [filePath, state] of Object.entries(req.state as Record<string, unknown>)) {
    if (!isSyncPathAllowed(filePath) || !state || typeof state !== 'object' || Array.isArray(state)) throw new Error(`同步状态条目无效: ${filePath}`)
    const item = state as Record<string, unknown>
    if (typeof item.remoteSha !== 'string' || item.remoteSha.length > 200 || typeof item.localHash !== 'string' || item.localHash.length > 200) throw new Error(`同步状态字段无效: ${filePath}`)
  }
}

function encodePath(p: string): string {
  return p
    .split('/')
    .map((s) => encodeURIComponent(s))
    .join('/')
}

async function putFile(
  pat: string,
  owner: string,
  repo: string,
  branch: string,
  path: string,
  content: string,
  sha?: string
): Promise<void> {
  const body: Record<string, unknown> = {
    message: `LearnHub sync: update ${path}`,
    content: Buffer.from(content, 'utf-8').toString('base64'),
    branch
  }
  if (sha) body.sha = sha
  const result = await gh<{ message?: string }>(pat, `/repos/${owner}/${repo}/contents/${encodePath(path)}`, {
    method: 'PUT',
    body: JSON.stringify(body)
  })
  const failure = githubPutFailure(result.status, path, result.data?.message)
  if (failure) throw new Error(failure)
}
