/** Reject asynchronous PDF results once the component is disposed or another paper became active. */
export function isActiveReaderRequest(alive: boolean, requestedPaperId: string, activePaperId: string | null): boolean {
  return alive && requestedPaperId === activePaperId
}
