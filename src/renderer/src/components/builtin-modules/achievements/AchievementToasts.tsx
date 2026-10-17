import { useEffect } from 'react'
import { ACHIEVEMENT_DEFS, useAchievements } from '@/stores/achievements'
import { usePapers } from '@/stores/papers'
import { useTodos } from '@/stores/todos'
import { useFocus } from '@/stores/misc'
import { useMindmaps } from '@/stores/mindmaps'
import { useNotes } from '@/stores/notes'
import { useTower } from '@/stores/tower'
import { useUi } from '@/stores/ui'

/** 全局成就达成提醒：订阅各指标源，某成就从「进行中」变为「可领取」时立即弹 toast。
 *  启动时把当前已达成的作为基线不提示，避免历史成就刷屏。
 *  独立成文件：App 静态引入本组件，避免把整个成就大楼 UI 拖进主包破坏懒加载。 */
export function AchievementToasts() {
  useEffect(() => {
    const claimableIds = () => {
      const s = useAchievements.getState()
      const progress = s.progress()
      return new Set(ACHIEVEMENT_DEFS.filter((d) => !s.claimedIds.includes(d.id) && (progress[d.metric] ?? 0) >= d.target).map((d) => d.id))
    }
    let last: Set<string> | null = null
    // 各指标源 store 异步加载完成也会触发订阅回调；延迟武装，
    // 首次触发时以当前状态为基线，避免把启动加载出的历史达标当成「新达成」误报
    const arm = window.setTimeout(() => {
      last = claimableIds()
    }, 1500)
    const check = () => {
      if (!last) return
      const cur = claimableIds()
      const newly = [...cur].filter((id) => !last!.has(id))
      if (newly.length) {
        const def = ACHIEVEMENT_DEFS.find((d) => d.id === newly[0])
        if (def)
          useUi.getState().toast(`成就达成：${def.title}，点击前往领取积木`, 'ok', () =>
            useUi.getState().navigate('mod:core.achievements:achievements')
          )
      }
      last = cur
    }
    const subs = [
      usePapers.subscribe(check),
      useTodos.subscribe(check),
      useFocus.subscribe(check),
      useMindmaps.subscribe(check),
      useNotes.subscribe(check),
      useTower.subscribe(check) // 搭建指标（楼高/连击）也纳入成就提醒
    ]
    return () => {
      window.clearTimeout(arm)
      subs.forEach((unsub) => unsub())
    }
  }, [])
  return null
}
