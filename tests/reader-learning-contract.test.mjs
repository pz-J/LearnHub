import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const aiPanel = await readFile(new URL('../src/renderer/src/components/sidebar/AiPanel.tsx', import.meta.url), 'utf8')
const reader = await readFile(new URL('../src/renderer/src/components/reader/ReaderView.tsx', import.meta.url), 'utf8')
const quickSearch = await readFile(new URL('../src/renderer/src/components/layout/QuickSearch.tsx', import.meta.url), 'utf8')
const notesStore = await readFile(new URL('../src/renderer/src/stores/notes.ts', import.meta.url), 'utf8')
const notesView = await readFile(new URL('../src/renderer/src/components/views/NotesView.tsx', import.meta.url), 'utf8')
const uiStore = await readFile(new URL('../src/renderer/src/stores/ui.ts', import.meta.url), 'utf8')

test('AI explanations retain paper, page, and normalized source rectangles', () => {
  assert.match(reader, /eventBus\.emit\('ai:explain', \{ text, paperId, page, rects: sel\.rects \}\)/)
  assert.match(aiPanel, /setExplainContext\(\{ text: p\.text, paperId: p\.paperId, page: p\.page, rects: p\.rects \}\)/)
})

test('AI panel prevents overlapping requests and restores existing explanation after failed writes', () => {
  assert.match(aiPanel, /if \(busyRef\.current\) return[\s\S]*?busyRef\.current = true/)
  assert.match(aiPanel, /await store\.updateHighlight\(paperNow\.id, existing\.id, \{ aiExplain: answer \}\)[\s\S]*?await store\.updateHighlight\(paperNow\.id, existing\.id, \{ aiExplain: existing\.aiExplain \}\)\.catch\(\(\) => undefined\)/)
})

test('saved explanations can be recovered as paper-linked research notes with source provenance and duplicate protection', () => {
  assert.match(aiPanel, /saveResearchNote/)
  assert.match(aiPanel, /researchSourceKey\(sourcePaper\.id, explainContext\.page, explainContext\.text\)/)
  assert.match(aiPanel, /findResearchNote\(Object\.values\(notes\.notes\), key\)/)
  assert.match(aiPanel, /buildResearchNoteBody\(\{ key, paperTitle: sourcePaper\.title, page: explainContext\.page, quote: explainContext\.text, explanation \}\)/)
})

test('global search returns source-backed results and requests a reliable highlight jump after the PDF is ready', () => {
  assert.match(quickSearch, /searchResearch\(q, paperList, Object\.values\(notes\), 24\)/)
  assert.match(quickSearch, /openPaperAtHighlight\(result\.paperId, result\.highlightId\)/)
  assert.match(reader, /numPages > 0 && requestedHighlight\?\.paperId === paperId/)
  assert.match(reader, /consumeRequestedHighlight\(\)/)
})

test('research notes can return to the exact source page even when the original highlight was removed', () => {
  assert.match(notesView, /openPaperAtPage\(sourcePaper\.id, source\.page\)/)
  assert.match(uiStore, /openPaperAtPage: \(paperId: string, page: number\) => void/)
  assert.match(reader, /loadedPaperIdRef\.current !== paperId \|\| numPages <= 0/)
})

test('note writes are serialized and only published to the store after the disk write succeeds', () => {
  assert.match(notesStore, /serializeByKey\(nid, async \(\) =>/)
  assert.match(notesStore, /await lh\.dataWrite\(`\$\{DIR\}\/\$\{nid\}`, toMarkdown\(next\)\)\s+set\(\{ notes:/)
})
