/** Per-paper reading checkpoint. Kept independent of PDF.js so it is easy to test. */
export interface ReaderLocation {
  page: number
  scrollRatio: number
  updatedAt: number
}

export function normalizeReaderLocation(value: unknown, pageCount: number): ReaderLocation | null {
  if (!value || typeof value !== 'object' || !Number.isFinite(pageCount) || pageCount < 1) return null
  const raw = value as Partial<ReaderLocation>
  if (!Number.isFinite(raw.page) || !Number.isFinite(raw.scrollRatio)) return null
  return {
    page: Math.min(pageCount, Math.max(1, Math.floor(raw.page as number))),
    scrollRatio: Math.min(1, Math.max(0, raw.scrollRatio as number)),
    updatedAt: Number.isFinite(raw.updatedAt) ? raw.updatedAt as number : 0
  }
}

export function clampReaderPage(page: number, pageCount: number): number {
  const max = Math.max(1, Math.floor(pageCount || 1))
  return Math.min(max, Math.max(1, Number.isFinite(page) ? Math.floor(page) : 1))
}

/** Resolve a source-page request and retain whether the stored page had to be corrected. */
export function resolveReaderPageRequest(requestedPage: number, pageCount: number): { page: number; clamped: boolean } {
  const page = clampReaderPage(requestedPage, pageCount)
  return { page, clamped: !Number.isFinite(requestedPage) || requestedPage !== page }
}

export interface ReaderHighlightRef {
  id: string
  page: number
}

/** Resolve a deep-link to a persisted highlight without silently trusting stale IDs or page numbers. */
export function resolveReaderHighlight<T extends ReaderHighlightRef>(
  highlights: readonly T[],
  highlightId: string,
  pageCount: number
): { kind: 'missing' } | { kind: 'located'; highlight: T; page: number; pageClamped: boolean } {
  const highlight = highlights.find((item) => item.id === highlightId)
  if (!highlight) return { kind: 'missing' }
  const page = clampReaderPage(highlight.page, pageCount)
  return { kind: 'located', highlight, page, pageClamped: page !== highlight.page }
}

export function readerLocationKey(paperId: string): string {
  return `lh:reader-location:${paperId}`
}

export function legacyReaderPageKey(paperId: string): string {
  return `lh:lastpage:${paperId}`
}
