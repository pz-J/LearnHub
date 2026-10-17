import type { Capability } from './permissions'

export interface CapabilityDeclaration {
  permissions: string[]
  optionalPermissions?: string[]
}

export function isCapabilityAllowed(
  manifest: CapabilityDeclaration,
  capability: Capability,
  granted: readonly string[]
): boolean {
  if (manifest.permissions.includes(capability)) return true
  return (manifest.optionalPermissions ?? []).includes(capability) && granted.includes(capability)
}

const SUBSCRIBABLE_EVENTS = new Set([
  'focus:done', 'sync:done', 'reader:paper-opened', 'reader:toolbar-click',
  'data:todo-updated', 'data:schedule-updated', 'data:notes-updated', 'data:flashcards-updated'
])

const EMITTABLE_EVENTS = new Set([
  'search:open', 'ai:explain', 'data:todo-updated', 'data:schedule-updated',
  'data:notes-updated', 'data:flashcards-updated'
])

export function canExternalSubscribe(eventName: string): boolean {
  return SUBSCRIBABLE_EVENTS.has(eventName)
}

export function canExternalEmit(eventName: string): boolean {
  return EMITTABLE_EVENTS.has(eventName)
}

export function isAllowedNetworkUrl(rawUrl: string, allowedHosts: readonly string[]): boolean {
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    return false
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) return false
  const host = parsed.hostname.toLowerCase()
  return allowedHosts.some((pattern) => {
    const rule = pattern.toLowerCase()
    if (rule === host) return true
    if (rule.startsWith('*.')) return host.endsWith(rule.slice(1)) || host === rule.slice(2)
    return false
  })
}

export function isAllowedExternalUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl)
    return url.protocol === 'https:' && !url.username && !url.password
  } catch {
    return false
  }
}
