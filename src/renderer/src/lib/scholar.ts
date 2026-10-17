/** Semantic Scholar 开放学术检索（免费、无需 Key，有公共限流） */
export interface ScholarHit {
  title: string
  authors: string
  year: number | null
  venue: string
  cited: number
  url: string
  abstract: string
}

/** 检索 Semantic Scholar Graph API，返回统一的结果结构 */
export async function searchSemanticScholar(q: string): Promise<ScholarHit[]> {
  const fields = 'title,year,venue,citationCount,abstract,authors,url'
  const r = await fetch(`https://api.semanticscholar.org/graph/v1/paper/search?query=${encodeURIComponent(q)}&limit=8&fields=${fields}`)
  if (r.status === 429) throw new Error('Semantic Scholar 限流中，请稍后再试')
  if (!r.ok) throw new Error('Semantic Scholar 请求失败（' + r.status + '），请检查网络')
  const j = (await r.json()) as {
    data?: {
      title?: string
      year?: number | null
      venue?: string
      citationCount?: number
      abstract?: string | null
      url?: string
      authors?: { name?: string }[]
    }[]
  }
  return (j.data ?? []).map((w) => ({
    title: w.title ?? '（无标题）',
    authors: (w.authors ?? [])
      .slice(0, 3)
      .map((a) => a.name)
      .filter(Boolean)
      .join(', '),
    year: w.year ?? null,
    venue: w.venue ?? '',
    cited: w.citationCount ?? 0,
    url: w.url ?? '',
    abstract: w.abstract ?? ''
  }))
}
