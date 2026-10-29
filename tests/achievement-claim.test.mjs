import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const achievements = await readFile(new URL('../src/renderer/src/stores/achievements.ts', import.meta.url), 'utf8')
const tower = await readFile(new URL('../src/renderer/src/stores/tower.ts', import.meta.url), 'utf8')
const achievementsView = await readFile(new URL('../src/renderer/src/components/builtin-modules/achievements/AchievementsModule.tsx', import.meta.url), 'utf8')

test('achievement claims are guarded against duplicate concurrent calls and require real progress', () => {
  assert.match(achievements, /const key = `achievement:\$\{defId\}`[\s\S]*?claimsInFlight\.has\(key\)/)
  assert.match(achievements, /get\(\)\.progress\(\)\[def\.metric\] < def\.target/)
  assert.match(achievements, /claimsInFlight\.has\(key\)/)
})

test('review achievements use persisted review history instead of clicks or elapsed time', () => {
  assert.match(achievements, /'cards-reviewed': useFlashcards\.getState\(\)\.items\.filter\(\(card\) => !!card\.lastReview\)\.length/)
  assert.match(achievements, /至少复习过 5 张不同的闪卡/)
  assert.match(achievements, /至少复习过 20 张不同的闪卡/)
})

test('mark progress excludes auto-generated duplicate overlays and requires a real source mark', () => {
  assert.match(achievements, /\(p\.highlights \?\? \[\]\)\.filter\(\(h\) => !h\.isAuto && !!h\.text\?\.trim\(\) && h\.page >= 1\)\.length/)
})

test('custom task mutations publish state only after persistence succeeds', () => {
  assert.match(achievements, /addCustomTask:[\s\S]*?await persist\(next\)\s+set\(next\)/)
  assert.match(achievements, /toggleCustomTask:[\s\S]*?await persist\(next\)\s+set\(next\)/)
  assert.match(achievements, /removeCustomTask:[\s\S]*?await persist\(next\)\s+set\(next\)/)
})

test('achievement view subscribes to flashcard changes so review progress updates immediately', () => {
  assert.match(achievementsView, /useFlashcards\(\(s\) => s\.items\)/)
  assert.match(achievementsView, /useMemo\(\(\) => useAchievements\.getState\(\)\.progress\(\), \[papers, flashcards, todos/)
})

test('claim persistence is rolled back when the tower reward cannot be saved', () => {
  assert.match(achievements, /commitRewardClaim\(/)
  assert.match(achievements, /import \{ commitRewardClaim \} from '@\/lib\/rewardTransaction'/)
  assert.match(tower, /await persist\(next\)[\s\S]*?get\(\)\.inventory\.filter\(\(entry\) => entry\.id !== item\.id\)[\s\S]*?throw error/)
})

test('module task registration is serialized and persists before publishing', () => {
  assert.match(achievements, /addModuleTask:[\s\S]*?registerModuleTaskOnce\(/)
  assert.doesNotMatch(achievements, /addModuleTask:[\s\S]*?void persist\(next\)/)
  assert.match(achievements, /await serializeByKey\('achievements', async \(\) =>/)
})
