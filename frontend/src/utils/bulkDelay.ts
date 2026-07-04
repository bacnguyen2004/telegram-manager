export interface BulkDelayOptions {
  useRandomDelay: boolean
  delaySeconds: number
  delayMinSeconds: number
  delayMaxSeconds: number
}

export function resolveBulkDelayMs(options: BulkDelayOptions): number {
  if (options.useRandomDelay) {
    const min = Math.min(options.delayMinSeconds, options.delayMaxSeconds)
    const max = Math.max(options.delayMinSeconds, options.delayMaxSeconds)
    if (max <= min) return min * 1000
    return (min + Math.random() * (max - min)) * 1000
  }
  return Math.max(0, options.delaySeconds) * 1000
}

export function waitBulkDelay(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve()
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms)
  })
}

export function validateBulkDelay(options: BulkDelayOptions): string | null {
  if (options.useRandomDelay && options.delayMinSeconds > options.delayMaxSeconds) {
    return 'Delay min phải ≤ max'
  }
  return null
}