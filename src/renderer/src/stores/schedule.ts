import { create } from 'zustand'
import { lh, uid } from '@/lib/ipc'
import { eventBus } from '@/kernel/eventBus'
import type { Course, Schedule } from '@/types'
import { DEFAULT_PERIODS } from '@/types'

const FILE = 'schedule.json'

interface ScheduleState {
  schedule: Schedule
  loaded: boolean
  load: () => Promise<void>
  save: (patch: Partial<Schedule>) => Promise<void>
  setSemesterStart: (d: string) => Promise<void>
  setPeriods: (p: Schedule['periods']) => Promise<void>
  addCourses: (courses: Course[]) => Promise<{ added: number; merged: number }>
  removeCourse: (id: string) => Promise<void>
}

export const useSchedule = create<ScheduleState>((set, get) => ({
  schedule: { semesterStart: '', periods: DEFAULT_PERIODS, courses: [], updatedAt: 0 },
  loaded: false,
  load: async () => {
    const data = (await lh.dataRead(FILE)) as Partial<Schedule> | null
    set({
      schedule: {
        semesterStart: data?.semesterStart ?? '',
        periods: data?.periods?.length ? data.periods : DEFAULT_PERIODS,
        courses: data?.courses ?? [],
        updatedAt: data?.updatedAt ?? 0
      },
      loaded: true
    })
  },
  save: async (patch) => {
    const next = { ...get().schedule, ...patch, updatedAt: Date.now() }
    set({ schedule: next })
    await lh.dataWrite(FILE, next)
    eventBus.emit('data:schedule-updated')
  },
  setSemesterStart: async (d) => get().save({ semesterStart: d }),
  setPeriods: async (p) => get().save({ periods: p }),
  addCourses: async (courses) => {
    const existing = get().schedule.courses
    const key = (c: Course) => `${c.name}|${c.day}|${c.startPeriod}`
    const existKeys = new Set(existing.map(key))
    const add: Course[] = []
    let merged = 0
    for (const c of courses) {
      if (existKeys.has(key(c))) {
        merged++
        continue
      }
      existKeys.add(key(c))
      add.push(c)
    }
    if (add.length) await get().save({ courses: [...existing, ...add] })
    return { added: add.length, merged }
  },
  removeCourse: async (id) => {
    await get().save({ courses: get().schedule.courses.filter((c) => c.id !== id) })
  }
}))

export function newCourse(partial: Partial<Course>): Course {
  return {
    id: uid('c_'),
    name: partial.name ?? '未命名课程',
    teacher: partial.teacher,
    room: partial.room,
    day: partial.day ?? 1,
    startPeriod: partial.startPeriod ?? 1,
    endPeriod: partial.endPeriod ?? 2,
    weeksText: partial.weeksText,
    color: partial.color ?? '#5b8cff'
  }
}
