import { listRows } from '@/data/local-store'
import {
  resetSampling,
  samplingState,
  saveSamplingState,
} from '@/data/sampling-store'
import type {
  AssessmentEntry,
  ImportResult,
  ImportRowResult,
  JudgeVersion,
  Reinspection,
  SampleBatch,
  SampleObject,
  ServiceResult,
  Verdict,
} from '@/data/sampling-types'

/**
 * 同一抽检对象重复提交判定的处理口径（需求里两处要求冲突，集中成一个开关）：
 * - 'overwrite'（默认）：按最新报送覆盖当前判定，前一版标记 superseded 留痕；
 * - 'first-only'：只保留先到的那条判定，后续报送仅登记为留痕，不改当前判定。
 * 无论哪种口径，每次报送都会进 events/历史，痕迹都不删。
 * 另：管段「待评定清单」的去重固定按先到为准（见 syncAssessment）。
 */
export const DUPLICATE_POLICY: 'overwrite' | 'first-only' = 'overwrite'

/** 管段台账导入抽检时必须齐的字段：缺一个就挡回并逐行说明缺什么。 */
export const PIPE_REQUIRED_FIELDS = ['管段编号', '起点井号', '终点井号', '管径', '管材'] as const

function now(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function mutate(mutator: (draft: ReturnType<typeof samplingState>) => void) {
  const draft = clone(samplingState())
  mutator(draft)
  saveSamplingState(draft)
  return draft
}

function findBatch(state: ReturnType<typeof samplingState>, id: number): SampleBatch | undefined {
  return state.batches.find((b) => b.id === id)
}

function findObject(batch: SampleBatch, objectId: number): SampleObject | undefined {
  return batch.objects.find((o) => o.id === objectId)
}

// ---------------------------------------------------------------------------
// 只读视图与派生判定
// ---------------------------------------------------------------------------

export function listBatches(): SampleBatch[] {
  return clone(samplingState().batches).sort((a, b) => b.id - a.id)
}

export function getBatch(id: number): SampleBatch | undefined {
  const batch = findBatch(samplingState(), id)
  return batch ? clone(batch) : undefined
}

export function listAssessment(): AssessmentEntry[] {
  return clone(samplingState().assessment).sort((a, b) => b.id - a.id)
}

/** 当前生效的初检判定：overwrite 取最新未覆盖版本；first-only 恒取第一条。 */
export function currentJudge(object: SampleObject): JudgeVersion | undefined {
  const list = [...object.judges].sort((a, b) => a.id - b.id)
  if (list.length === 0) return undefined
  if (DUPLICATE_POLICY === 'first-only') return list[0]
  return list.filter((v) => !v.superseded).slice(-1)[0] ?? list[0]
}

export function completedReinspection(object: SampleObject): (Reinspection & { status: Verdict }) | undefined {
  return [...object.reinspections]
    .filter((r): r is Reinspection & { status: Verdict } => r.status !== 'pending')
    .sort((a, b) => b.id - a.id)[0]
}

/** 是否还有「没出结果」的复检（自动产生、尚未填报）。 */
export function hasPendingReinspection(object: SampleObject): boolean {
  return object.reinspections.some((r) => r.status === 'pending')
}

/**
 * 对象的最终结论：初检合格判定与复检结果对不上时，以最近一次检测报告的结论为准。
 * 初检报告与复检报告都可能被更新的报告推翻，故按报送时间比较，都没有则为空（尚未判定）。
 */
export function finalVerdict(object: SampleObject): Verdict | '' {
  const judge = currentJudge(object)
  const rein = completedReinspection(object)
  if (!judge && !rein) return ''
  if (!rein) return judge!.verdict
  if (!judge) return rein.status
  return judge.reportOrder > rein.reportOrder ? judge.verdict : rein.status
}

export type ObjectProgress = {
  total: number
  judged: number
  pendingRein: number
  passed: number
  failed: number
}

export function batchProgress(batch: SampleBatch): ObjectProgress {
  const progress: ObjectProgress = { total: batch.objects.length, judged: 0, pendingRein: 0, passed: 0, failed: 0 }
  for (const object of batch.objects) {
    if (currentJudge(object)) progress.judged += 1
    if (hasPendingReinspection(object)) progress.pendingRein += 1
    const verdict = finalVerdict(object)
    if (verdict === '合格') progress.passed += 1
    if (verdict === '不合格') progress.failed += 1
  }
  return progress
}

/** 办结闸门：复检没出结果（或还有对象未判定）时不允许整体判通过。返回拦截原因。 */
export function closeBlockers(batch: SampleBatch): string[] {
  const blockers: string[] = []
  for (const object of batch.objects) {
    const name = `${object.pipeId} ${object.pipeName}`
    if (!currentJudge(object)) blockers.push(`${name} 还没有合格判定`)
    if (hasPendingReinspection(object)) blockers.push(`${name} 的复检还没出结果`)
  }
  return blockers
}

// ---------------------------------------------------------------------------
// 批次
// ---------------------------------------------------------------------------

export function createBatch(input: { name: string; inspector: string }): ServiceResult<SampleBatch> {
  const name = input.name.trim()
  const inspector = input.inspector.trim()
  if (!name) return { ok: false, message: '批次名称不能为空' }
  if (!inspector) return { ok: false, message: '抽检负责人不能为空' }

  const state = mutate((draft) => {
    draft.seq.batch += 1
    const id = draft.seq.batch
    const batch: SampleBatch = {
      id,
      batchNo: `CJ-${new Date().getFullYear()}${String(new Date().getMonth() + 1).padStart(2, '0')}-${String(id).padStart(3, '0')}`,
      name,
      inspector,
      createdAt: now(),
      status: '抽检中',
      closedAt: '',
      conclusion: '',
      objects: [],
    }
    draft.batches.push(batch)
  })
  return { ok: true, message: '抽检批次已创建', data: clone(findBatch(state, state.seq.batch)!) }
}

// ---------------------------------------------------------------------------
// 从管段台账导入抽检对象（缺字段挡回，同批次同管段不重复挂）
// ---------------------------------------------------------------------------

type LedgerRow = ReturnType<typeof listRows>[number]

function text(row: LedgerRow, field: string): string {
  return String(row[field] ?? '').trim()
}

/** 台账预检：返回每一行是否可导入、缺哪些字段（页面导入弹窗据此勾选与说明）。 */
export function previewLedger(batchId: number): {
  batch: SampleBatch | undefined
  rows: (ImportRowResult & { material: string })[]
} {
  const batch = getBatch(batchId)
  const existing = new Set((batch?.objects ?? []).map((o) => o.pipeId))
  const rows = listRows('drainpipe').map((row) => {
    const pipeId = text(row, '管段编号')
    const missing = PIPE_REQUIRED_FIELDS.filter((field) => text(row, field) === '')
    const skipped = pipeId !== '' && existing.has(pipeId)
    let reason = ''
    if (missing.length > 0) reason = `缺少必填字段：${missing.join('、')}`
    else if (skipped) reason = '该管段已挂入本批次，重复导入将跳过'
    return {
      pipeId: pipeId || `（第 ${Number(row.id) + 1} 行）`,
      ok: missing.length === 0,
      missing: [...missing],
      skipped,
      reason,
      material: text(row, '管材'),
    }
  })
  return { batch, rows }
}

/**
 * 导入：把勾选的管段挂到批次下。
 * 缺字段的台账行一律挡回（逐行说明缺什么），合格行里同批次重复的跳过。
 */
export function importPipes(batchId: number, pipeIds: string[]): ServiceResult<ImportResult> {
  const batch = findBatch(samplingState(), batchId)
  if (!batch) return { ok: false, message: '没有找到该抽检批次' }
  if (batch.status === '已办结') return { ok: false, message: '批次已办结，不能再导入抽检对象' }

  const wanted = new Set(pipeIds.map((s) => s.trim()).filter(Boolean))
  const result: ImportResult = { accepted: 0, rejected: 0, skipped: 0, rows: [] }
  const acceptedRows: LedgerRow[] = []

  for (const row of listRows('drainpipe')) {
    const pipeId = text(row, '管段编号')
    if (!wanted.has(pipeId)) continue
    const missing = PIPE_REQUIRED_FIELDS.filter((field) => text(row, field) === '')
    if (missing.length > 0) {
      result.rejected += 1
      result.rows.push({ pipeId, ok: false, missing: [...missing], skipped: false, reason: `缺少必填字段：${missing.join('、')}` })
      continue
    }
    if (batch.objects.some((o) => o.pipeId === pipeId)) {
      result.skipped += 1
      result.rows.push({ pipeId, ok: true, missing: [], skipped: true, reason: '本批次已存在该抽检对象，已跳过' })
      continue
    }
    result.accepted += 1
    acceptedRows.push(row)
  }

  if (acceptedRows.length > 0) {
    mutate((draft) => {
      const target = findBatch(draft, batchId)!
      for (const row of acceptedRows) {
        draft.seq.object += 1
        target.objects.push({
          id: draft.seq.object,
          pipeId: text(row, '管段编号'),
          pipeName: text(row, '管段编号'),
          startManhole: text(row, '起点井号'),
          endManhole: text(row, '终点井号'),
          diameter: text(row, '管径'),
          material: text(row, '管材'),
          importedAt: now(),
          judges: [],
          reinspections: [],
          events: [{ at: now(), text: `从排水管段台账导入（${text(row, '起点井号')} → ${text(row, '终点井号')}）` }],
        })
      }
    })
  }

  const message =
    result.rejected > 0
      ? `导入完成：${result.accepted} 条挂入，${result.rejected} 条因缺字段挡回，${result.skipped} 条重复跳过`
      : `导入完成：${result.accepted} 条挂入，${result.skipped} 条重复跳过`
  return { ok: result.accepted > 0 || result.skipped > 0, message, data: result }
}

// ---------------------------------------------------------------------------
// 初检判定报送（覆盖留痕 / 先到留痕）+ 自动进复检
// ---------------------------------------------------------------------------

export function submitJudge(
  batchId: number,
  objectId: number,
  input: { reportNo: string; items: string[]; verdict: Verdict; reporter: string },
): ServiceResult {
  const reportNo = input.reportNo.trim()
  const reporter = input.reporter.trim()
  const items = input.items.map((s) => s.trim()).filter(Boolean)
  if (!reportNo) return { ok: false, message: '检测报告编号不能为空' }
  if (items.length === 0) return { ok: false, message: '至少要填一个检测项' }
  if (!reporter) return { ok: false, message: '检测人不能为空' }

  const batch = findBatch(samplingState(), batchId)
  if (!batch) return { ok: false, message: '没有找到该抽检批次' }
  if (batch.status === '已办结') return { ok: false, message: '批次已办结，判定不能再变更' }
  const object = batch && findObject(batch, objectId)
  if (!object) return { ok: false, message: '没有找到该抽检对象' }

  const previous = currentJudge(object)
  // 同一份检测报告重复报送：连留痕版本都不再新增，先到的那条原样保留。
  if (previous && previous.reportNo === reportNo) {
    return { ok: false, message: `检测报告 ${reportNo} 已报送过判定，重复报送不再受理` }
  }

  let effective = true
  if (previous && DUPLICATE_POLICY === 'first-only') effective = false

  mutate((draft) => {
    const target = findObject(findBatch(draft, batchId)!, objectId)!
    draft.seq.judge += 1
    draft.seq.report += 1
    const version: JudgeVersion = {
      id: draft.seq.judge,
      reportOrder: draft.seq.report,
      reportNo,
      items,
      verdict: input.verdict,
      reporter,
      submittedAt: now(),
      superseded: false,
      traceNote: '',
    }
    if (previous && DUPLICATE_POLICY === 'overwrite') {
      for (const old of target.judges) old.superseded = old.id === previous.id
      version.traceNote = `覆盖 ${previous.reportNo} 的判定，前一版已留痕`
    }
    if (previous && DUPLICATE_POLICY === 'first-only') {
      version.superseded = true
      version.traceNote = `先到的 ${previous.reportNo} 判定保留，本次报送仅留痕`
    }
    target.judges.push(version)
    target.events.push({
      at: version.submittedAt,
      text: effective
        ? `检测报告 ${reportNo} 判定：${input.verdict}（检测项：${items.join('、')}）`
        : `收到检测报告 ${reportNo}（${input.verdict}），按先到口径仅留痕，当前判定仍以 ${previous!.reportNo} 为准`,
    })
    reconcileReinspection(target, version, effective)
  })

  return {
    ok: true,
    message: effective
      ? `判定已记为「${input.verdict}」${input.verdict === '不合格' ? '，该对象已自动进入复检' : ''}`
      : `已留痕，当前判定仍以先到的 ${previous!.reportNo} 为准`,
  }
}

/**
 * 判定变更后自动维护复检任务：
 * - 当前生效的最新报告判定不合格，且已有复检结论比它更早（或还没有复检）→ 自动产生一条待复检；
 * - 覆盖为合格时，把尚未出结果的自动复检撤掉；已出结果的复检保留（仍可被更晚的初检报告推翻）。
 */
function reconcileReinspection(object: SampleObject, version: JudgeVersion, effective: boolean) {
  if (!effective) return
  const rein = completedReinspection(object)
  if (version.verdict === '不合格') {
    if (!rein || version.reportOrder > rein.reportOrder) {
      if (!hasPendingReinspection(object)) {
        object.reinspections.push({
          id: -1,
          reportOrder: 0,
          sourceVersionId: version.id,
          status: 'pending',
          reportNo: '',
          items: [],
          inspector: '',
          submittedAt: '',
        })
        object.events.push({ at: version.submittedAt, text: '最新检测报告判定不合格，已自动进入复检（等待复检结果）' })
      }
    }
  } else {
    const pendings = object.reinspections.filter((r) => r.status === 'pending')
    for (const pending of pendings) {
      object.reinspections.splice(object.reinspections.indexOf(pending), 1)
    }
    if (pendings.length > 0) {
      object.events.push({ at: version.submittedAt, text: '最新报告改判合格，在途复检任务已撤销（历史留痕保留）' })
    }
  }
}

// ---------------------------------------------------------------------------
// 复检结果填报
// ---------------------------------------------------------------------------

export function submitReinspection(
  batchId: number,
  objectId: number,
  input: { reportNo: string; items: string[]; verdict: Verdict; inspector: string },
): ServiceResult {
  const reportNo = input.reportNo.trim()
  const inspector = input.inspector.trim()
  const items = input.items.map((s) => s.trim()).filter(Boolean)
  if (!reportNo) return { ok: false, message: '复检报告编号不能为空' }
  if (items.length === 0) return { ok: false, message: '至少要填一个检测项' }
  if (!inspector) return { ok: false, message: '复检人不能为空' }

  const batch = findBatch(samplingState(), batchId)
  if (!batch) return { ok: false, message: '没有找到该抽检批次' }
  if (batch.status === '已办结') return { ok: false, message: '批次已办结，复检结果不能再补报' }
  const object = batch && findObject(batch, objectId)
  if (!object) return { ok: false, message: '没有找到该抽检对象' }
  const pending = object.reinspections.find((r) => r.status === 'pending')
  if (!pending) return { ok: false, message: '该对象当前没有等待结果的复检任务' }

  const judge = currentJudge(object)
  const conflict = judge && judge.verdict !== input.verdict

  mutate((draft) => {
    const target = findObject(findBatch(draft, batchId)!, objectId)!
    draft.seq.reinspection += 1
    draft.seq.report += 1
    const rein = target.reinspections.find((r) => r.status === 'pending')!
    Object.assign(rein, {
      id: draft.seq.reinspection,
      reportOrder: draft.seq.report,
      status: input.verdict,
      reportNo,
      items,
      inspector,
      submittedAt: now(),
    })
    target.events.push({
      at: rein.submittedAt,
      text: conflict
        ? `复检报告 ${reportNo} 结论：${input.verdict}，与初检「${judge!.verdict}」不一致，以最近一次检测报告结论为准`
        : `复检报告 ${reportNo} 结论：${input.verdict}`,
    })
  })

  return {
    ok: true,
    message: conflict
      ? `复检结论「${input.verdict}」与初检不一致，最终以复检报告 ${reportNo} 为准`
      : `复检结果已记为「${input.verdict}」`,
  }
}

// ---------------------------------------------------------------------------
// 批次办结 + 同步管段待评定清单
// ---------------------------------------------------------------------------

export function closeBatch(batchId: number): ServiceResult<SampleBatch> {
  const batch = findBatch(samplingState(), batchId)
  if (!batch) return { ok: false, message: '没有找到该抽检批次' }
  if (batch.status === '已办结') return { ok: false, message: '该批次已办结' }

  const blockers = closeBlockers(batch)
  if (blockers.length > 0) {
    return { ok: false, message: `暂不能办结：${blockers.join('；')}` }
  }

  const allPass = batch.objects.every((o) => finalVerdict(o) === '合格')
  const state = mutate((draft) => {
    const target = findBatch(draft, batchId)!
    const stamp = now()
    target.status = '已办结'
    target.closedAt = stamp
    target.conclusion = allPass ? '整体通过' : '整体不通过'
    for (const object of target.objects) {
      const verdict = finalVerdict(object)
      object.events.push({
        at: stamp,
        text:
          verdict === '不合格'
            ? `批次办结（${target.conclusion}）：最终结论不合格，同步管段待评定清单`
            : `批次办结（${target.conclusion}）：最终结论合格`,
      })
    }
    syncAssessment(draft, target, stamp)
  })

  return { ok: true, message: allPass ? '批次已办结：整体通过' : '批次已办结：整体不通过，不合格管段已同步待评定清单', data: clone(findBatch(state, batchId)!) }
}

/**
 * 办结结果反映到管段待评定清单。
 * 只放最终不合格的管段；同一管段已有「待评定」条目时，只保留先到的那一条，后办结批次不再重复插入。
 */
function syncAssessment(state: ReturnType<typeof samplingState>, batch: SampleBatch, stamp: string) {
  for (const object of batch.objects) {
    if (finalVerdict(object) !== '不合格') continue
    const firstInQueue = state.assessment.some((a) => a.pipeId === object.pipeId && a.status === '待评定')
    if (firstInQueue) {
      object.events.push({
        at: stamp,
        text: `管段 ${object.pipeId} 已有先到的待评定记录，本次结论不再重复进入清单（只保留先到的那一条）`,
      })
      continue
    }
    const rein = completedReinspection(object)
    const judge = currentJudge(object)
    state.seq.assessment += 1
    state.assessment.push({
      id: state.seq.assessment,
      pipeId: object.pipeId,
      pipeName: object.pipeName,
      batchNo: batch.batchNo,
      finalVerdict: '不合格',
      reportNo: rein?.reportNo || judge?.reportNo || '',
      syncedAt: stamp,
      status: '待评定',
    })
  }
}

/** 管段侧对待评定条目做处理：先到的那条走完流程后，后续批次的结论才能再进来。 */
export function resolveAssessment(entryId: number): ServiceResult {
  const entry = samplingState().assessment.find((a) => a.id === entryId)
  if (!entry) return { ok: false, message: '没有找到该待评定记录' }
  if (entry.status === '已处理') return { ok: false, message: '该记录已处理' }
  mutate((draft) => {
    const target = draft.assessment.find((a) => a.id === entryId)!
    target.status = '已处理'
  })
  return { ok: true, message: `${entry.pipeId} 已完成评定并移出待办` }
}

// ---------------------------------------------------------------------------
// 导出与重置
// ---------------------------------------------------------------------------

export function exportBatch(batchId: number): { filename: string; content: string } | undefined {
  const batch = getBatch(batchId)
  if (!batch) return undefined
  const header = ['管段编号', '起终点', '管径', '管材', '最新报告', '初检判定', '复检结论', '最终结论']
  const lines = [header.join(',')]
  for (const object of batch.objects) {
    const rein = completedReinspection(object)
    const judge = currentJudge(object)
    lines.push(
      [
        object.pipeId,
        `${object.startManhole}→${object.endManhole}`,
        object.diameter,
        object.material,
        rein?.reportNo ?? judge?.reportNo ?? '',
        judge ? `${judge.verdict}(${judge.reportNo})` : '',
        rein ? `${rein.status}(${rein.reportNo})` : '',
        finalVerdict(object) || '未判定',
      ].join(','),
    )
  }
  // 文件头加 UTF-8 BOM，Excel 直接打开不乱码。
  return { filename: `${batch.batchNo}-抽检结果.csv`, content: `\uFEFF${lines.join('\n')}` }
}

export function resetSamplingModule(): SampleBatch[] {
  resetSampling()
  return listBatches()
}
