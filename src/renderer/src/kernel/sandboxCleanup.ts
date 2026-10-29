/** Tear down every sandbox resource even if one third-party unsubscribe callback throws. */
export function cleanupSandboxResources(resources: {
  deactivate: () => void
  removeMessageListener: () => void
  requests: Map<number, AbortController>
  busUnsubs: Map<string, () => void>
}): void {
  resources.deactivate()
  try { resources.removeMessageListener() } catch { /* continue best-effort cleanup */ }
  for (const controller of resources.requests.values()) {
    try { controller.abort() } catch { /* continue best-effort cleanup */ }
  }
  resources.requests.clear()
  for (const unsubscribe of resources.busUnsubs.values()) {
    try { unsubscribe() } catch { /* one bad listener must not retain the others */ }
  }
  resources.busUnsubs.clear()
}
