import type { LhApi } from '../../../preload/index'

declare global {
  interface Window {
    lh: LhApi
  }
}

export const lh = window.lh

export function uid(prefix = ''): string {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}
