import type { VectorStorageAdapter } from './vector-storage-definitions.js'

let activeAdapter: VectorStorageAdapter | null = null
let cleanupInterval: ReturnType<typeof setInterval> | null = null

export function getAdapter(): VectorStorageAdapter | null {
  return activeAdapter
}

export function setAdapter(adapter: VectorStorageAdapter): void {
  activeAdapter = adapter
}

export function clearAdapter(): void {
  activeAdapter = null
}

export function getCleanupInterval(): ReturnType<typeof setInterval> | null {
  return cleanupInterval
}

export function setCleanupInterval(interval: ReturnType<typeof setInterval>): void {
  cleanupInterval = interval
}

export function clearCleanupInterval(): void {
  cleanupInterval = null
}
