import { listRows, saveRows } from '@/data/local-store'
import { allBatches, saveBatches } from '@/data/sampling-store'

export { allBatches }
import type {
  BatchStatus,
  ImportLineResult,
  ImportResult,
  PipeVerdict,
  ReportConclusion,
  ReportKind,
  SampleBatch,
  SampleItem,
  SampleReport,
  SampleSubject,
  SubmissionTrace,
} from '@/data/sampling-types'
import { DUPLICATE_POLICY } from '@/data/sampling-types'
import type { ActionResult } from '@/data/types'

// 抽检对象取自排水管段台账：导入与回写都只认 drainpipe 这一份。
const PIPE_MODULE = 'drainpipe'
const PIPE_CODE_FIELD = '管段编号'
const PIPE_NAME_FIELD = '起点井号'
const PIPE_END_FIELD = '终点井号'
// 台账里必须齐备的字段：缺任一项，导入该行挡回。
const LEDGER_REQUIRED_FIELDS = [PIPE_CODE_FIELD, PIPE_NAME_FIELD, PIPE_END_FIELD, '管径', '管材']
// 导入文件必须给出的列。
const IMPORT_REQUIRED_COLUMNS = [PIPE_CODE_FIELD]

// 回写到管段台账上的扩展字段：不挤占既有「管段状态」工作流字段。
const FIELD_VERDICT = '抽检评定'
const FIELD_BATCH = '抽检批次'
const FIELD_REPORT_DATE = '最近报告时间'
const FIELD_ABNORMAL = '抽检异常'

function now(): string {
  return new Date().toISOString()
}

function nextId(items: { id: number }[]): number {
  return items.reduce((max, item) => Math.max(max, item.id), 0) + 1
}

function nextSeq(subject: SampleSubject): number {
  return subject.traces.reduce((max, trace) => Math.max(max, trace.seq), 0) + 1
}

function nextBatchNo(batches: SampleBatch[]): string {
  const year = new Date().getFullYear()
  return `SP-${year}-${String(batches.length + 1).padStart(4, '0')}`
}

function nextReportNo(subject: SampleSubject, kind: ReportKind): string {
  const prefix = kind === '初检' ? 'INIT' : 'REV'
  return `${prefix}-${subject.pipeCode}-${subject.traces.length + 1}`
}

export function getBatch(batchId: number): SampleBatch | undefined {
  return allBatches().find((batch) => batch.id === batchId)
}

function mustGetOpenBatch(batchId: number): { batch?: SampleBatch; error?: string } {
  const batch = getBatch(batchId)
  if (!batch) {
    return { error: `没有找到编号为 ${batchId} 的抽检批次` }
  }
  if (batch.status === '已办结') {
    return { batch, error: `批次 ${batch.batchNo} 已办结，办结后不允许再改动判定` }
  }
  return { batch }
}

export function createBatch(name: string): SampleBatch {
  const batches = allBatches()
  const batch: SampleBatch = {
    id: nextId(batches),
    batchNo: nextBatchNo(batches),
    name: name.trim() || '未命名抽检批次',
    createdAt: now(),
    closedAt: null,
    status: '待检测',
    subjects: [],
  }
  saveBatches([...batches, batch])
  return batch
}

/** 取管段台账，供导入页做下拉选择与字段核对。 */
export function pipeLedger() {
  return listRows(PIPE_MODULE).map((row) => ({
    id: Number(row.id),
    pipeCode: String(row[PIPE_CODE_FIELD] ?? ''),
    startManhole: String(row[PIPE_NAME_FIELD] ?? ''),
    endManhole: String(row[PIPE_END_FIELD] ?? ''),
    diameter: String(row['管径'] ?? ''),
    material: String(row['管材'] ?? ''),
  }))
}

/** 解析导入文本（CSV：首行表头，至少含「管段编号」列）。不合法的整批挡回。 */
export function parseImportText(text: string): { codes?: string[]; error?: string } {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
  if (lines.length < 2) {
    return { error: '导入内容为空：首行须为表头，其后每行一条管段编号' }
  }
  const headers = lines[0].split(',').map((cell) => cell.trim())
  const codeIndex = headers.indexOf(PIPE_CODE_FIELD)
  if (codeIndex < 0) {
    return { error: `导入缺少必填列「${PIPE_CODE_FIELD}」，表头应为：${IMPORT_REQUIRED_COLUMNS.join('、')}` }
  }
  const codes = lines
    .slice(1)
    .map((line) => (line.split(',')[codeIndex] ?? '').trim())
    .filter((code) => code.length > 0)
  if (codes.length === 0) {
    return { error: '导入文件里没有可导入的数据行（管段编号均为空）' }
  }
  return { codes }
}

/**
 * 导入抽检对象：对象取自既有管段台账。
 * 缺字段（导入行缺编号 / 台账查无此管段 / 台账该行必填字段不齐 / 同批次重复）逐行挡回，说明原因。
 */
export function importSubjects(batchId: number, pipeCodes: string[]): ImportResult {
  const guard = mustGetOpenBatch(batchId)
  if (guard.error || !guard.batch) {
    return { accepted: 0, results: [{ line: 0, pipeCode: '', ok: false, message: guard.error ?? '批次不可用' }] }
  }
  const batch = guard.batch
  const ledger = pipeLedger()
  const existing = new Set(batch.subjects.map((subject) => subject.pipeCode))
  const seenInFile = new Set<string>()
  const results: ImportLineResult[] = []
  const added: SampleSubject[] = []

  pipeCodes.forEach((code, index) => {
    const line = index + 2
    if (!code) {
      results.push({ line, pipeCode: code, ok: false, message: '缺少必填字段：管段编号' })
      return
    }
    if (seenInFile.has(code)) {
      results.push({ line, pipeCode: code, ok: false, message: `管段 ${code} 在本次导入文件里重复出现，已挡回` })
      return
    }
    seenInFile.add(code)
    if (existing.has(code)) {
      results.push({ line, pipeCode: code, ok: false, message: `管段 ${code} 已在批次 ${batch.batchNo} 中，同一对象不重复挂接` })
      return
    }
    const ledgerRow = listRows(PIPE_MODULE).find((row) => String(row[PIPE_CODE_FIELD] ?? '') === code)
    if (!ledgerRow) {
      results.push({ line, pipeCode: code, ok: false, message: `台账查无管段编号「${code}」，抽检对象只能取自既有排水管段台账` })
      return
    }
    const missing = LEDGER_REQUIRED_FIELDS.filter((field) => String(ledgerRow[field] ?? '').trim() === '')
    if (missing.length > 0) {
      results.push({ line, pipeCode: code, ok: false, message: `管段 ${code} 台账缺字段：${missing.join('、')}，补齐后再导入` })
      return
    }
    const subject: SampleSubject = {
      id: nextId([...batch.subjects, ...added]),
      pipeCode: code,
      pipeName: String(ledgerRow[PIPE_NAME_FIELD]),
      startManhole: String(ledgerRow[PIPE_NAME_FIELD]),
      endManhole: String(ledgerRow[PIPE_END_FIELD]),
      initial: null,
      review: null,
      reviewRequired: false,
      reviewReport: null,
      traces: [],
      pastReports: [],
    }
    added.push(subject)
    existing.add(code)
    results.push({ line, pipeCode: code, ok: true, message: `管段 ${code} 已导入批次` })
  })

  if (added.length > 0) {
    persistBatch({ ...batch, subjects: [...batch.subjects, ...added], status: deriveStatus({ ...batch, subjects: [...batch.subjects, ...added] }) })
  }
  return { accepted: added.length, results }
}

function deriveStatus(batch: SampleBatch): BatchStatus {
  if (batch.status === '已办结') {
    return '已办结'
  }
  const judged = batch.subjects.filter((subject) => subject.initial).length
  if (judged === 0) {
    return '待检测'
  }
  const pendingReview = batch.subjects.some((subject) => subject.reviewRequired && !subject.reviewReport)
  return pendingReview ? '检测中' : '待办结'
}

function buildReport(
  subject: SampleSubject,
  kind: ReportKind,
  items: SampleItem[],
  reportNo: string,
  inspector: string,
  reportedAt: string,
): SampleReport {
  const valid: SampleItem[] = items.length > 0
    ? items
    : [{ name: '综合判定', result: '不合格', remark: '未逐项填报，默认不合格' }]
  const conclusion: ReportConclusion = valid.every((item) => item.result === '合格') ? '合格' : '不合格'
  return { id: 0, kind, conclusion, items: valid, reportNo, inspector, reportedAt }
}

function pushTrace(subject: SampleSubject, report: SampleReport, outcome: SubmissionTrace['outcome'], reason: string): void {
  subject.traces.push({
    seq: nextSeq(subject),
    reportId: report.id,
    kind: report.kind,
    conclusion: report.conclusion,
    reportNo: report.reportNo,
    inspector: report.inspector,
    submittedAt: report.reportedAt,
    outcome,
    reason,
  })
}

export type SubmitInput = {
  items: SampleItem[]
  reportNo: string
  inspector: string
  reportedAt: string
}

/**
 * 报送初检判定。
 * 同一对象同一批次只允许一条生效判定：
 * - 先到为准（当前策略）：重复报送拒收，但留痕，生效判定保持先到那条；
 * - 最新覆盖：新判定生效，前一版原样进 pastReports 留档。
 * 判定不合格自动开复检单。
 */
export function submitInitial(batchId: number, subjectId: number, input: SubmitInput): ActionResult {
  const guard = mustGetOpenBatch(batchId)
  if (guard.error || !guard.batch) {
    return { ok: false, message: guard.error ?? '批次不可用' }
  }
  const batch = guard.batch
  const subject = batch.subjects.find((item) => item.id === subjectId)
  if (!subject) {
    return { ok: false, message: '批次里没有这个抽检对象' }
  }
  const reportedAt = input.reportedAt || now()
  const report = buildReport(subject, '初检', input.items, input.reportNo || nextReportNo(subject, '初检'), input.inspector || '未填报', reportedAt)

  if (subject.initial) {
    // 先给当次报告编号落档，再写痕迹；拒收也要能查到这版报了什么。
    report.id = nextId([...allReports(subject)])
    if (DUPLICATE_POLICY === '最新覆盖') {
      subject.pastReports.push({ ...subject.initial })
      subject.initial = report
      syncReview(subject, report)
      pushTrace(subject, report, 'accepted', `重复报送：按最新覆盖生效，前一版报告 ${subject.pastReports[subject.pastReports.length - 1].reportNo} 已留档`)
    } else {
      pushTrace(subject, report, 'rejected', `重复报送：${subject.pipeCode} 在批次 ${batch.batchNo} 已有先到判定（${subject.initial.reportNo}），按先到为准拒收，本条仅留痕`)
    }
    persistBatch({ ...batch, status: deriveStatus(batch) })
    return DUPLICATE_POLICY === '最新覆盖'
      ? { ok: true, message: `已按最新报告覆盖，前一版已留痕；当前判定「${report.conclusion}」` }
      : { ok: false, message: `重复报送被挡回：同批次同对象只保留先到的判定（${subject.initial.reportNo}），本次报送已记入痕迹` }
  }

  report.id = nextId([...allReports(subject)])
  subject.initial = report
  syncReview(subject, report)
  pushTrace(subject, report, 'accepted', '初检判定首次报送，生效')
  persistBatch({ ...batch, status: deriveStatus(batch) })
  return {
    ok: true,
    message: report.conclusion === '不合格'
      ? `判定「不合格」，已自动生成复检单，复检出结果前批次不能判通过`
      : `判定「合格」已记录`,
  }
}

function allReports(subject: SampleSubject): SampleReport[] {
  const current: SampleReport[] = []
  if (subject.initial) current.push(subject.initial)
  if (subject.review) current.push(subject.review)
  if (subject.reviewReport) current.push(subject.reviewReport)
  return [...current, ...subject.pastReports]
}

/** 初检不合格 → 自动进复检（开复检单）；改判合格时把未完成的复检单收回。 */
function syncReview(subject: SampleSubject, initial: SampleReport): void {
  if (initial.conclusion === '不合格') {
    if (!subject.reviewRequired) {
      subject.reviewRequired = true
      subject.review = {
        id: 0,
        kind: '复检',
        conclusion: '不合格',
        items: [],
        reportNo: `REV-ORDER-${subject.pipeCode}`,
        inspector: '',
        reportedAt: '',
      }
    }
  } else if (!subject.reviewReport) {
    subject.reviewRequired = false
    subject.review = null
  }
}

/** 填报复检结果。复检结果同样防重复报送（先到为准 / 最新覆盖）。 */
export function submitReview(batchId: number, subjectId: number, input: SubmitInput): ActionResult {
  const guard = mustGetOpenBatch(batchId)
  if (guard.error || !guard.batch) {
    return { ok: false, message: guard.error ?? '批次不可用' }
  }
  const batch = guard.batch
  const subject = batch.subjects.find((item) => item.id === subjectId)
  if (!subject) {
    return { ok: false, message: '批次里没有这个抽检对象' }
  }
  if (!subject.reviewRequired || !subject.review) {
    return { ok: false, message: '该对象没有待出结果的复检单，无需报送复检' }
  }
  const report = buildReport(subject, '复检', input.items, input.reportNo || nextReportNo(subject, '复检'), input.inspector || '未填报', input.reportedAt || now())

  if (subject.reviewReport) {
    report.id = nextId([...allReports(subject)])
    if (DUPLICATE_POLICY === '最新覆盖') {
      subject.pastReports.push({ ...subject.reviewReport })
      subject.reviewReport = report
      pushTrace(subject, report, 'accepted', `复检重复报送：按最新覆盖生效，前一版复检报告 ${subject.pastReports[subject.pastReports.length - 1].reportNo} 已留档`)
    } else {
      pushTrace(subject, report, 'rejected', `复检重复报送：已有先到复检结论（${subject.reviewReport.reportNo}），按先到为准拒收，本条仅留痕`)
    }
    persistBatch({ ...batch, status: deriveStatus(batch) })
    return DUPLICATE_POLICY === '最新覆盖'
      ? { ok: true, message: `复检结果已按最新覆盖，前一版已留痕；复检结论「${report.conclusion}」` }
      : { ok: false, message: `复检重复报送被挡回：只保留先到的复检结论（${subject.reviewReport.reportNo}），本次报送已记入痕迹` }
  }

  report.id = nextId([...allReports(subject), ...(subject.review ? [subject.review] : [])])
  subject.reviewReport = report
  subject.review = report
  pushTrace(subject, report, 'accepted', '复检结果首次报送，生效')
  persistBatch({ ...batch, status: deriveStatus(batch) })
  return { ok: true, message: `复检结论「${report.conclusion}」已记录` }
}

/** 生效结论：初检与复检对不上时，以最近一次检测报告的结论为准。 */
export function effectiveConclusion(subject: SampleSubject): ReportConclusion | null {
  const reports = [subject.initial, subject.reviewReport].filter((report): report is SampleReport => Boolean(report))
  if (reports.length === 0) {
    return null
  }
  return reports.reduce((latest, report) => (report.reportedAt >= latest.reportedAt ? report : latest)).conclusion
}

export type CloseCheck = {
  canClose: boolean
  unjudged: number
  pendingReview: number
  blockers: string[]
}

export function checkCloseable(batch: SampleBatch): CloseCheck {
  const unjudged = batch.subjects.filter((subject) => !subject.initial).length
  const pendingReview = batch.subjects.filter((subject) => subject.reviewRequired && !subject.reviewReport).length
  const blockers: string[] = []
  if (batch.subjects.length === 0) {
    blockers.push('批次下还没有抽检对象，不能空批办结')
  }
  if (unjudged > 0) {
    blockers.push(`还有 ${unjudged} 个抽检对象未出合格判定`)
  }
  // 硬性闸口：复检没出结果的批次不允许整体判通过（办结）。
  if (pendingReview > 0) {
    blockers.push(`有 ${pendingReview} 个对象的复检还没出结果，复检结论未齐前不允许整体判通过`)
  }
  return { canClose: blockers.length === 0, unjudged, pendingReview, blockers }
}

/**
 * 批次办结：
 * 1. 闸口校验（复检结果未齐不得办结）；
 * 2. 每个对象取「最近一次检测报告」的结论作为最终结论；
 * 3. 回写排水管段台账，更新管段待评定清单；
 * 4. 批次置为已办结，冻结后续改动。
 */
export function closeBatch(batchId: number): ActionResult {
  const guard = mustGetOpenBatch(batchId)
  if (guard.error || !guard.batch) {
    return { ok: false, message: guard.error ?? '批次不可用' }
  }
  const batch = guard.batch
  const check = checkCloseable(batch)
  if (!check.canClose) {
    return { ok: false, message: `批次 ${batch.batchNo} 暂不能办结：${check.blockers.join('；')}` }
  }

  const rows = listRows(PIPE_MODULE)
  batch.subjects.forEach((subject) => {
    const verdict: PipeVerdict = effectiveConclusion(subject) === '合格' ? '抽检合格' : '抽检不合格'
    const latestAt = [subject.initial?.reportedAt, subject.reviewReport?.reportedAt]
      .filter((value): value is string => Boolean(value))
      .sort()
      .pop() ?? ''
    const index = rows.findIndex((row) => String(row[PIPE_CODE_FIELD] ?? '') === subject.pipeCode)
    if (index >= 0) {
      rows[index] = {
        ...rows[index],
        [FIELD_VERDICT]: verdict,
        [FIELD_BATCH]: batch.batchNo,
        [FIELD_REPORT_DATE]: latestAt,
        [FIELD_ABNORMAL]: verdict === '抽检不合格',
      }
    }
  })
  saveRows(PIPE_MODULE, rows)

  persistBatch({ ...batch, status: '已办结', closedAt: now() })
  return { ok: true, message: `批次 ${batch.batchNo} 已办结，${batch.subjects.length} 个管段的待评定清单已同步更新` }
}

/** 管段那边的待评定清单：已被某办结批次抽检的，给出评定；没被覆盖的仍属待评定。 */
export type PipePendingRow = {
  pipeCode: string
  startManhole: string
  endManhole: string
  verdict: PipeVerdict | ''
  batchNo: string
  latestReportAt: string
  abnormal: boolean
  /** 是否仍在「待评定」清单中：没有办结批次给过结论的为待评定 */
  pending: boolean
}

export function pipePendingList(): PipePendingRow[] {
  const closed = allBatches().filter((batch) => batch.status === '已办结')
  const verdictByPipe = new Map<string, { verdict: PipeVerdict; batchNo: string; latestAt: string }>()
  closed.forEach((batch) => {
    batch.subjects.forEach((subject) => {
      const conclusion = effectiveConclusion(subject)
      if (!conclusion) {
        return
      }
      const latestAt = [subject.initial?.reportedAt, subject.reviewReport?.reportedAt]
        .filter((value): value is string => Boolean(value))
        .sort()
        .pop() ?? ''
      const previous = verdictByPipe.get(subject.pipeCode)
      if (!previous || latestAt >= previous.latestAt) {
        verdictByPipe.set(subject.pipeCode, {
          verdict: conclusion === '合格' ? '抽检合格' : '抽检不合格',
          batchNo: batch.batchNo,
          latestAt,
        })
      }
    })
  })
  return pipeLedger().map((pipe) => {
    const hit = verdictByPipe.get(pipe.pipeCode)
    return {
      pipeCode: pipe.pipeCode,
      startManhole: pipe.startManhole,
      endManhole: pipe.endManhole,
      verdict: hit?.verdict ?? '',
      batchNo: hit?.batchNo ?? '',
      latestReportAt: hit?.latestAt ?? '',
      abnormal: hit?.verdict === '抽检不合格',
      pending: !hit,
    }
  })
}

export function pendingReviewCount(batch: SampleBatch): number {
  return batch.subjects.filter((subject) => subject.reviewRequired && !subject.reviewReport).length
}

function persistBatch(next: SampleBatch): void {
  const batches = allBatches().map((item) => (item.id === next.id ? next : item))
  saveBatches(batches)
}
