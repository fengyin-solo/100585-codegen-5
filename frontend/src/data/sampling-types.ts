/**
 * 抽检模块的领域类型。
 *
 * 需求里有两处口径互相打架，集中在本模块解决：
 * - 「重复报送按最新那次覆盖，但覆盖要留下前一版的痕迹」+「初检与复检对不上时以最近一次检测报告为准」
 *   → 判定默认按最新覆盖（overwrite），每一次报送都作为不可删改的版本留痕。
 * - 「同一个抽检对象被重复提交判定时，只保留先到的那一条」
 *   → 服务层提供 DUPLICATE_POLICY = 'first-only' 的切换开关；
 *     且该口径固定用在「管段待评定清单」的去重上：同一管段已有待评定记录时，后办结的批次不再重复插入。
 */

/** 合格判定 / 复检结论 */
export type Verdict = '合格' | '不合格'

/** 初检判定的报送版本：一次报送一条，永不删除，覆盖只是把旧版本标成 superseded。 */
export type JudgeVersion = {
  id: number
  /** 报告先后序号：初检报告与复检报告共用一个单调序列，用于判定「最近一次检测报告」，避免时间戳同分钟打平。 */
  reportOrder: number
  reportNo: string
  items: string[]
  verdict: Verdict
  reporter: string
  submittedAt: string
  /** 是否被更新的报送覆盖；first-only 口径下第一条永远为 false，后续报送只留痕不生效。 */
  superseded: boolean
  /** 留痕来源：覆盖留痕还是先到留痕。 */
  traceNote: string
}

/** 复检记录：初检不合格的对象自动产生一条 pending 记录。 */
export type Reinspection = {
  id: number
  reportOrder: number
  sourceVersionId: number
  status: 'pending' | '合格' | '不合格'
  reportNo: string
  items: string[]
  inspector: string
  submittedAt: string
}

/** 抽检批次下的抽检对象（取自排水管段台账）。 */
export type SampleObject = {
  id: number
  pipeId: string
  pipeName: string
  startManhole: string
  endManhole: string
  diameter: string
  material: string
  importedAt: string
  judges: JudgeVersion[]
  reinspections: Reinspection[]
  events: { at: string; text: string }[]
}

export type BatchStatus = '抽检中' | '已办结'

/** 抽检批次 */
export type SampleBatch = {
  id: number
  batchNo: string
  name: string
  inspector: string
  createdAt: string
  status: BatchStatus
  /** 办结时间与整体结论；复检没出结果前不允许办结，故不存在「已办结但未定」。 */
  closedAt: string
  conclusion: '' | '整体通过' | '整体不通过'
  objects: SampleObject[]
}

/** 批次办结后，同步到管段台账侧的待评定清单条目（只收最终不合格的管段）。 */
export type AssessmentEntry = {
  id: number
  pipeId: string
  pipeName: string
  batchNo: string
  finalVerdict: Verdict
  reportNo: string
  syncedAt: string
  /** 待评定 / 已处理：同管段已有待评定条目时，后办结批次不再插入（只保留先到的）。 */
  status: '待评定' | '已处理'
}

export type SamplingState = {
  batches: SampleBatch[]
  assessment: AssessmentEntry[]
  seq: { batch: number; object: number; judge: number; reinspection: number; assessment: number; report: number }
}

/** 导入一行管段台账后的校验结果：缺字段整批挡回时要逐行说明缺什么。 */
export type ImportRowResult = {
  pipeId: string
  ok: boolean
  missing: string[]
  /** skipped: 本批次已挂过该管段，不再重复导入。 */
  skipped: boolean
  reason: string
}

export type ImportResult = {
  accepted: number
  rejected: number
  skipped: number
  rows: ImportRowResult[]
}

export type ServiceResult<T = undefined> = { ok: boolean; message: string; data?: T }
