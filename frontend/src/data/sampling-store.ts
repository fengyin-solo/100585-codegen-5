import type { SampleBatch } from './sampling-types'

// 抽检数据单独存一份，不与既有台账混在同一个 key 里。
const STORAGE_KEY = 'drainage-pump:sampling-batches'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function readStorage(): SampleBatch[] {
  if (typeof window === 'undefined' || !window.localStorage) {
    return []
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    return []
  }
  try {
    return JSON.parse(raw) as SampleBatch[]
  } catch {
    return []
  }
}

let cache: SampleBatch[] | null = null

export function allBatches(): SampleBatch[] {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

export function saveBatches(batches: SampleBatch[]): void {
  cache = clone(batches)
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cache))
  }
}

export function resetBatches(): SampleBatch[] {
  saveBatches([])
  return allBatches()
}

export function storageKey(): string {
  return STORAGE_KEY
}
