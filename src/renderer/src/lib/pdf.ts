import * as pdfjsLib from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { lh } from '@/lib/ipc'

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl

export interface PageText {
  page: number
  text: string
}

/** 提取带坐标的原始文本项（课表格网解析用） */
export async function extractPdfItems(
  paperId: string
): Promise<{ page: number; items: { str: string; x: number; y: number; w: number; h: number }[] }[]> {
  const buf = (await lh.pdfRead(paperId)) as ArrayBuffer
  const doc = await pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise
  const out: { page: number; items: { str: string; x: number; y: number; w: number; h: number }[] }[] = []
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i)
    const tc = await page.getTextContent()
    const items: { str: string; x: number; y: number; w: number; h: number }[] = []
    for (const item of tc.items as { str?: string; transform?: number[]; width?: number; height?: number }[]) {
      if (!item.str?.trim() || !item.transform) continue
      items.push({
        str: item.str,
        x: item.transform[4],
        y: item.transform[5],
        w: item.width ?? 0,
        h: item.height ?? 10
      })
    }
    out.push({ page: i, items })
  }
  await doc.destroy()
  return out
}

/** 读取已导入论文的 PDF 并提取每页文本（用于课表导入/摘要） */
export async function extractPdfPages(paperId: string): Promise<PageText[]> {
  const buf = (await lh.pdfRead(paperId)) as ArrayBuffer
  const doc = await pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise
  const pages: PageText[] = []
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i)
    const tc = await page.getTextContent()
    // 按 y 坐标聚合成行
    const rows = new Map<number, string[]>()
    for (const item of tc.items as { str?: string; transform?: number[] }[]) {
      if (!item.str || !item.transform) continue
      const y = Math.round(item.transform[5])
      if (!rows.has(y)) rows.set(y, [])
      rows.get(y)!.push(item.str)
    }
    const text = [...rows.entries()]
      .sort((a, b) => b[0] - a[0])
      .map(([, strs]) => strs.join(' '))
      .join('\n')
    pages.push({ page: i, text })
  }
  await doc.destroy()
  return pages
}

export { pdfjsLib }
