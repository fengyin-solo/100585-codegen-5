import type { SamplingState } from './sampling-types'

// 抽检模块独立持久化：和既有「模块清单」一样放在 localStorage，刷新后还在。
const STORAGE_KEY = 'drainage-pump:sampling'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

export function samplingSeed(): SamplingState {
  return clone(SEED)
}

function readStorage(): SamplingState {
  const fallback = samplingSeed()
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
  try {
    return JSON.parse(raw) as SamplingState
  } catch {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
}

let cache: SamplingState | null = null

export function samplingState(): SamplingState {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

export function saveSamplingState(state: SamplingState): void {
  cache = state
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  }
}

export function resetSampling(): SamplingState {
  const fresh = samplingSeed()
  saveSamplingState(fresh)
  return fresh
}

export function samplingStorageKey(): string {
  return STORAGE_KEY
}

// 示例数据：一个正在抽检的批次（覆盖初检合格 / 初检不合格待复检 / 复检已完成三种情形），
// 一个已办结批次，办结时把最终不合格的 DRAI-0001 同步进了管段待评定清单。
const SEED: SamplingState = {
  batches: [
    {
      id: 1,
      batchNo: 'CJ-202609-001',
      name: '三季度第一批管网抽检',
      inspector: '张质检',
      createdAt: '2026-09-20 09:12',
      status: '抽检中',
      closedAt: '',
      conclusion: '',
      objects: [
        {
          id: 1,
          pipeId: 'DRAI-0002',
          pipeName: '滨河路干管 2#~3#',
          startManhole: 'J-201',
          endManhole: 'J-203',
          diameter: 'DN800',
          material: '钢筋混凝土',
          importedAt: '2026-09-20 09:20',
          judges: [
            {
              id: 1,
              reportOrder: 1,
              reportNo: 'JC-260920-02',
              items: ['外观', '淤积', '错口'],
              verdict: '合格',
              reporter: '李检测',
              submittedAt: '2026-09-22 15:40',
              superseded: false,
              traceNote: '',
            },
          ],
          reinspections: [],
          events: [{ at: '2026-09-22 15:40', text: '检测报告 JC-260920-02 判定：合格' }],
        },
        {
          id: 2,
          pipeId: 'DRAI-0003',
          pipeName: '工业大道支管 7#~8#',
          startManhole: 'J-118',
          endManhole: 'J-119',
          diameter: 'DN500',
          material: 'HDPE',
          importedAt: '2026-09-20 09:21',
          judges: [
            {
              id: 2,
              reportOrder: 2,
              reportNo: 'JC-260921-03',
              items: ['外观', '淤积', '破损'],
              verdict: '不合格',
              reporter: '李检测',
              submittedAt: '2026-09-23 10:05',
              superseded: false,
              traceNote: '',
            },
          ],
          reinspections: [
            {
              id: 1,
              reportOrder: 0,
              sourceVersionId: 2,
              status: 'pending',
              reportNo: '',
              items: [],
              inspector: '',
              submittedAt: '',
            },
          ],
          events: [
            { at: '2026-09-23 10:05', text: '检测报告 JC-260921-03 判定：不合格' },
            { at: '2026-09-23 10:05', text: '初检不合格，已自动进入复检（待复检结果）' },
          ],
        },
        {
          id: 3,
          pipeId: 'DRAI-0001',
          pipeName: '人民路主干 1#~2#',
          startManhole: 'J-101',
          endManhole: 'J-102',
          diameter: 'DN1000',
          material: '钢筋混凝土',
          importedAt: '2026-09-20 09:22',
          judges: [
            {
              id: 3,
              reportOrder: 3,
              reportNo: 'JC-260920-01',
              items: ['外观', '淤积'],
              verdict: '合格',
              reporter: '王检测',
              submittedAt: '2026-09-21 14:00',
              superseded: true,
              traceNote: '已被 JC-260925-01 覆盖，前一版留痕',
            },
            {
              id: 4,
              reportOrder: 4,
              reportNo: 'JC-260925-01',
              items: ['外观', '淤积', '接口渗漏'],
              verdict: '不合格',
              reporter: '王检测',
              submittedAt: '2026-09-25 16:30',
              superseded: false,
              traceNote: '',
            },
          ],
          reinspections: [
            {
              id: 2,
              reportOrder: 5,
              sourceVersionId: 4,
              status: '不合格',
              reportNo: 'FJ-260928-01',
              items: ['外观', '淤积', '接口渗漏'],
              inspector: '赵复检',
              submittedAt: '2026-09-28 11:00',
            },
          ],
          events: [
            { at: '2026-09-21 14:00', text: '检测报告 JC-260920-01 判定：合格' },
            { at: '2026-09-25 16:30', text: '检测报告 JC-260925-01 判定：不合格，覆盖上一版判定（上一版已留痕）' },
            { at: '2026-09-25 16:30', text: '初检不合格，已自动进入复检' },
            { at: '2026-09-28 11:00', text: '复检报告 FJ-260928-01 结论：不合格（以最近一次检测报告结论为准）' },
          ],
        },
      ],
    },
    {
      id: 2,
      batchNo: 'CJ-202608-002',
      name: '二季度复查批次',
      inspector: '周质检',
      createdAt: '2026-08-11 08:40',
      status: '已办结',
      closedAt: '2026-08-30 17:20',
      conclusion: '整体不通过',
      objects: [
        {
          id: 4,
          pipeId: 'DRAI-0001',
          pipeName: '人民路主干 1#~2#',
          startManhole: 'J-101',
          endManhole: 'J-102',
          diameter: 'DN1000',
          material: '钢筋混凝土',
          importedAt: '2026-08-11 09:00',
          judges: [
            {
              id: 5,
              reportOrder: 7,
              reportNo: 'JC-260815-01',
              items: ['外观', '接口渗漏'],
              verdict: '不合格',
              reporter: '王检测',
              submittedAt: '2026-08-15 10:00',
              superseded: false,
              traceNote: '',
            },
          ],
          reinspections: [
            {
              id: 3,
              reportOrder: 8,
              sourceVersionId: 5,
              status: '不合格',
              reportNo: 'FJ-260826-01',
              items: ['外观', '接口渗漏'],
              inspector: '赵复检',
              submittedAt: '2026-08-26 15:00',
            },
          ],
          events: [
            { at: '2026-08-15 10:00', text: '检测报告 JC-260815-01 判定：不合格' },
            { at: '2026-08-15 10:00', text: '初检不合格，已自动进入复检' },
            { at: '2026-08-26 15:00', text: '复检报告 FJ-260826-01 结论：不合格' },
            { at: '2026-08-30 17:20', text: '批次办结，最终结论：不合格，已同步管段待评定清单' },
          ],
        },
      ],
    },
  ],
  assessment: [
    {
      id: 1,
      pipeId: 'DRAI-0001',
      pipeName: '人民路主干 1#~2#',
      batchNo: 'CJ-202608-002',
      finalVerdict: '不合格',
      reportNo: 'FJ-260826-01',
      syncedAt: '2026-08-30 17:20',
      status: '待评定',
    },
  ],
  seq: { batch: 2, object: 4, judge: 5, reinspection: 3, assessment: 1, report: 8 },
}
