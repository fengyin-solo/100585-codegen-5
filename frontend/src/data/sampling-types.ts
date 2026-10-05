/** 抽检模块的领域类型。抽检对象取自既有排水管段台账（drainpipe）。 */

/** 单个检测项的结果；对象结论由检测项汇总而来：全部合格才合格，有不合格即不合格。 */
export type SampleItemResult = '合格' | '不合格'

export type SampleItem = {
  name: string
  result: SampleItemResult
  remark: string
}

/** 初检/复检统一用检测报告表达。结论冲突时以「最近一次检测报告」为准。 */
export type ReportKind = '初检' | '复检'
export type ReportConclusion = '合格' | '不合格'

export type SampleReport = {
  /** 报告编号，同时作为痕迹留档的主键 */
  id: number
  kind: ReportKind
  conclusion: ReportConclusion
  items: SampleItem[]
  reportNo: string
  inspector: string
  /** ISO 时间串；判定结论以该时间最近的报告为准 */
  reportedAt: string
}

/** 重复报送处理策略：需求文本自相矛盾，先到为准（正文重复两遍）与最新覆盖各出现一次。
 *  这里显式落为「先到为准」，但每次报送都留痕；需要改回「覆盖留痕」只需切换此常量。 */
export type DuplicatePolicy = '先到为准' | '最新覆盖'
export const DUPLICATE_POLICY: DuplicatePolicy = '先到为准'

/** 报送痕迹：无论当次判定是否生效，都留一条，被覆盖/被拒收的前一版同样可查。 */
export type SubmissionTrace = {
  /** 痕迹序号，单调递增 */
  seq: number
  reportId: number
  kind: ReportKind
  conclusion: ReportConclusion
  reportNo: string
  inspector: string
  submittedAt: string
  /** accepted=本次报送生效；rejected=重复报送，按策略未生效 */
  outcome: 'accepted' | 'rejected'
  /** 未生效/被替换原因，例如「同批次同对象已有先到判定，按先到为准拒收」 */
  reason: string
}

/** 抽检批次下挂的抽检对象（一个对象在同一批次里只有一条生效判定）。 */
export type SampleSubject = {
  id: number
  /** 取自排水管段台账的管段编号 */
  pipeCode: string
  pipeName: string
  startManhole: string
  endManhole: string
  /** 生效中的初检报告；重复报送按策略处理，对象始终只挂一条生效判定 */
  initial: SampleReport | null
  /** 初检不合格自动生成的复检单，复检报告回来后回填 */
  review: SampleReport | null
  /** 复检是否已出结果：复检单存在但报告未回，就是「复检待出结果」 */
  reviewRequired: boolean
  reviewReport: SampleReport | null
  /** 历次报送痕迹（含被拒收/被覆盖的版本） */
  traces: SubmissionTrace[]
  /** 「最新覆盖」策略下被替换下来的前一版报告，原样归档，不删不改 */
  pastReports: SampleReport[]
}

export type BatchStatus = '待检测' | '检测中' | '待办结' | '已办结'

/** 抽检批次办结后回写到管段台账的评定结论 */
export type PipeVerdict = '抽检合格' | '抽检不合格'

export type SampleBatch = {
  id: number
  batchNo: string
  name: string
  createdAt: string
  closedAt: string | null
  status: BatchStatus
  subjects: SampleSubject[]
}

/** 导入抽检对象时逐行返回的结果：缺字段挡回并说明缺什么。 */
export type ImportLineResult = {
  line: number
  pipeCode: string
  ok: boolean
  message: string
}

export type ImportResult = {
  accepted: number
  results: ImportLineResult[]
}
