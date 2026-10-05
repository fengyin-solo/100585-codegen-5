<template>
  <section class="page" data-module="sampling">
    <header class="page-head">
      <div>
        <h2>管网抽检评定</h2>
        <p class="page-desc">
          抽检批次下挂多个抽检对象（取自排水管段台账），逐项检测、合格判定；不合格自动进复检，复检结果未齐批次不得办结。
          同批次同对象只有一条生效判定，重复报送按「{{ duplicatePolicy }}」处理并全程留痕；结论冲突以最近一次检测报告为准，办结后同步更新管段待评定清单。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreateBatch">新建抽检批次</button>
      </div>
    </header>

    <div class="tab-bar">
      <button
        v-for="tab in tabs"
        :key="tab.key"
        class="tab-btn"
        :class="{ active: activeTab === tab.key }"
        type="button"
        @click="switchTab(tab.key)"
      >
        {{ tab.label }}
      </button>
    </div>

    <!-- 批次总览 -->
    <template v-if="activeTab === 'batches'">
      <div class="stat-row">
        <article class="stat-card">
          <span class="stat-label">抽检批次</span>
          <strong class="stat-value">{{ batches.length }}</strong>
        </article>
        <article class="stat-card">
          <span class="stat-label">检测中/待办结</span>
          <strong class="stat-value">{{ openBatches }}</strong>
        </article>
        <article class="stat-card">
          <span class="stat-label">待出复检结论</span>
          <strong class="stat-value">{{ totalPendingReview }}</strong>
        </article>
        <article class="stat-card">
          <span class="stat-label">已办结</span>
          <strong class="stat-value">{{ closedBatches }}</strong>
        </article>
      </div>

      <table class="data-table">
        <thead>
          <tr>
            <th>批次编号</th>
            <th>批次名称</th>
            <th>建立时间</th>
            <th>抽检对象</th>
            <th>待判定</th>
            <th>复检待出结果</th>
            <th>状态</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="batch in batches" :key="batch.id">
            <td>{{ batch.batchNo }}</td>
            <td>{{ batch.name }}</td>
            <td>{{ formatTime(batch.createdAt) }}</td>
            <td>{{ batch.subjects.length }}</td>
            <td>{{ batch.subjects.filter((s) => !s.initial).length }}</td>
            <td>
              <span :class="{ 'error-text': pendingReviewCount(batch) > 0 }">{{ pendingReviewCount(batch) }}</span>
            </td>
            <td><span class="badge" :class="statusBadge(batch.status)">{{ batch.status }}</span></td>
            <td class="row-actions">
              <button class="link" type="button" @click="openBatch(batch.id)">打开批次</button>
            </td>
          </tr>
          <tr v-if="!batches.length">
            <td colspan="8" class="empty-state">还没有抽检批次，点击右上角新建</td>
          </tr>
        </tbody>
      </table>
    </template>

    <!-- 管段待评定清单 -->
    <template v-else>
      <p class="status-legend">
        <span class="legend-item">待评定：{{ pendingRows.filter((r) => r.pending).length }}</span>
        <span class="legend-item">抽检合格：{{ pendingRows.filter((r) => r.verdict === '抽检合格').length }}</span>
        <span class="legend-item">抽检不合格：{{ pendingRows.filter((r) => r.verdict === '抽检不合格').length }}</span>
      </p>
      <p class="page-desc">清单随批次办结实时更新：已办结批次按各管段最近一次检测报告结论回写，未覆盖的管段仍列为待评定。</p>
      <table class="data-table">
        <thead>
          <tr>
            <th>管段编号</th>
            <th>起点井号</th>
            <th>终点井号</th>
            <th>评定结论</th>
            <th>来源批次</th>
            <th>最近报告时间</th>
            <th>待评定状态</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in pendingRows" :key="row.pipeCode">
            <td>{{ row.pipeCode }}</td>
            <td>{{ row.startManhole }}</td>
            <td>{{ row.endManhole }}</td>
            <td>
              <span v-if="row.verdict" class="badge" :class="row.verdict === '抽检合格' ? 'ok' : 'fail'">{{ row.verdict }}</span>
              <span v-else>—</span>
            </td>
            <td>{{ row.batchNo || '—' }}</td>
            <td>{{ row.latestReportAt ? formatTime(row.latestReportAt) : '—' }}</td>
            <td>
              <span v-if="row.pending" class="badge pending">待评定</span>
              <span v-else class="badge ok">已评定</span>
            </td>
          </tr>
          <tr v-if="!pendingRows.length">
            <td colspan="7" class="empty-state">排水管段台账为空，无法形成待评定清单</td>
          </tr>
        </tbody>
      </table>
    </template>

    <!-- 批次详情抽屉 -->
    <div v-if="currentBatch" class="modal-mask" @click.self="closeBatchDetail">
      <div class="modal wide">
        <div class="modal-head">
          <div>
            <strong>{{ currentBatch.name }}（{{ currentBatch.batchNo }}）</strong>
            <span class="badge" :class="statusBadge(currentBatch.status)" style="margin-left: 8px">{{ currentBatch.status }}</span>
          </div>
          <button class="btn ghost" type="button" @click="closeBatchDetail">关闭</button>
        </div>

        <div class="stat-row">
          <article class="stat-card">
            <span class="stat-label">抽检对象</span>
            <strong class="stat-value">{{ currentBatch.subjects.length }}</strong>
          </article>
          <article class="stat-card">
            <span class="stat-label">已判定</span>
            <strong class="stat-value">{{ currentBatch.subjects.filter((s) => s.initial).length }}</strong>
          </article>
          <article class="stat-card">
            <span class="stat-label">待出复检结果</span>
            <strong class="stat-value" :class="{ 'error-text': closeCheck.pendingReview > 0 }">{{ closeCheck.pendingReview }}</strong>
          </article>
          <article class="stat-card">
            <span class="stat-label">未判定</span>
            <strong class="stat-value" :class="{ 'error-text': closeCheck.unjudged > 0 }">{{ closeCheck.unjudged }}</strong>
          </article>
        </div>

        <div v-if="currentBatch.status !== '已办结'" class="import-box">
          <h4>从排水管段台账导入抽检对象</h4>
          <p class="page-desc">
            粘贴 CSV（首行须含「管段编号」列），或选择文件导入；缺字段、台账查无、同批次重复的行会被挡回并逐行说明。
          </p>
          <div class="filter-bar">
            <label class="filter-item">
              <span>导入文本</span>
              <textarea v-model="importText" rows="3" placeholder="管段编号&#10;DRAI-0001&#10;DRAI-0002"></textarea>
            </label>
            <span>
              <input ref="fileInput" type="file" accept=".csv,text/csv" @change="onFileChange" />
            </span>
          </div>
          <div class="row-actions">
            <button class="btn primary" type="button" @click="doImport">导入选中管段</button>
            <button class="btn" type="button" @click="fillExample">填入示例（含缺字段/重复演示）</button>
          </div>
          <ul v-if="importResults.length" class="import-result">
            <li v-for="line in importResults" :key="line.line" :class="line.ok ? 'ok-text' : 'error-text'">
              第{{ line.line }}行 · {{ line.pipeCode || '（空）' }}：{{ line.message }}
            </li>
          </ul>
        </div>

        <table class="data-table">
          <thead>
            <tr>
              <th>管段编号</th>
              <th>起点/终点井</th>
              <th>检测项</th>
              <th>初检判定</th>
              <th>复检状态/结论</th>
              <th>生效结论</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="subject in currentBatch.subjects" :key="subject.id">
              <td>{{ subject.pipeCode }}</td>
              <td>{{ subject.startManhole }} / {{ subject.endManhole }}</td>
              <td>{{ subject.initial ? subject.initial.items.map((i) => `${i.name}:${i.result}`).join('；') : '—' }}</td>
              <td>
                <span v-if="subject.initial" class="badge" :class="subject.initial.conclusion === '合格' ? 'ok' : 'fail'">
                  {{ subject.initial.conclusion }}
                </span>
                <span v-else class="badge pending">待检测</span>
              </td>
              <td>
                <span v-if="subject.reviewReport" class="badge" :class="subject.reviewReport.conclusion === '合格' ? 'ok' : 'fail'">
                  复检{{ subject.reviewReport.conclusion }}
                </span>
                <span v-else-if="subject.reviewRequired" class="badge fail">复检待出结果</span>
                <span v-else>—</span>
              </td>
              <td>
                <span v-if="effectiveOf(subject)" class="badge" :class="effectiveOf(subject) === '合格' ? 'ok' : 'fail'">
                  {{ effectiveOf(subject) }}
                </span>
                <span v-else class="badge pending">待定</span>
              </td>
              <td class="row-actions">
                <button
                  v-if="currentBatch.status !== '已办结'"
                  class="link"
                  type="button"
                  @click="openReport(subject, '初检')"
                >
                  {{ subject.initial ? '重复报送初检' : '报送初检判定' }}
                </button>
                <button
                  v-if="subject.reviewRequired && !subject.reviewReport && currentBatch.status !== '已办结'"
                  class="link"
                  type="button"
                  @click="openReport(subject, '复检')"
                >
                  填报复检结果
                </button>
                <button
                  v-if="subject.reviewReport && currentBatch.status !== '已办结'"
                  class="link"
                  type="button"
                  @click="openReport(subject, '复检')"
                >
                  重复报送复检
                </button>
                <button class="link" type="button" @click="openTraces(subject)">报送痕迹（{{ subject.traces.length }}）</button>
              </td>
            </tr>
            <tr v-if="!currentBatch.subjects.length">
              <td colspan="7" class="empty-state">先从管段台账导入抽检对象</td>
            </tr>
          </tbody>
        </table>

        <footer class="page-foot">
          <span v-if="!closeCheck.canClose && currentBatch.status !== '已办结'" class="error-text">
            {{ closeCheck.blockers.join('；') }}
          </span>
          <span v-else-if="currentBatch.status === '已办结'">批次已办结并冻结，管段待评定清单已更新（办结时间：{{ formatTime(currentBatch.closedAt) }}）</span>
          <button
            v-if="currentBatch.status !== '已办结'"
            class="btn primary"
            type="button"
            :disabled="!closeCheck.canClose"
            @click="doClose"
          >
            办结批次并同步管段待评定清单
          </button>
        </footer>
      </div>
    </div>

    <!-- 报送判定弹窗 -->
    <div v-if="reportTarget" class="modal-mask" @click.self="reportTarget = null">
      <div class="modal">
        <div class="modal-head">
          <strong>{{ reportKind }}报送 · {{ reportTarget.pipeCode }}</strong>
          <button class="btn ghost" type="button" @click="reportTarget = null">取消</button>
        </div>
        <p class="page-desc">
          对象结论由检测项自动汇总：全部合格才判合格，有一项不合格即不合格并自动开复检单。
          报告时间用于「最近一次报告优先」，默认取当前时间。
        </p>
        <div class="form-grid">
          <label class="filter-item">
            <span>检测人</span>
            <input v-model="reportForm.inspector" placeholder="检测人" />
          </label>
          <label class="filter-item">
            <span>报告编号</span>
            <input v-model="reportForm.reportNo" placeholder="留空自动生成" />
          </label>
          <label class="filter-item">
            <span>报告时间</span>
            <input v-model="reportForm.reportedAt" type="datetime-local" />
          </label>
        </div>
        <table class="data-table">
          <thead>
            <tr><th>检测项</th><th>判定</th><th>备注</th><th></th></tr>
          </thead>
          <tbody>
            <tr v-for="(item, index) in reportForm.items" :key="index">
              <td><input v-model="item.name" placeholder="如：管身结构、错口量" /></td>
              <td>
                <select v-model="item.result">
                  <option value="合格">合格</option>
                  <option value="不合格">不合格</option>
                </select>
              </td>
              <td><input v-model="item.remark" placeholder="备注" /></td>
              <td><button class="link error-text" type="button" @click="reportForm.items.splice(index, 1)">删除</button></td>
            </tr>
          </tbody>
        </table>
        <div class="row-actions" style="margin: 8px 0">
          <button class="btn" type="button" @click="addItem">添加检测项</button>
          <button class="btn primary" type="button" @click="submitReport">提交{{ reportKind }}报告</button>
        </div>
        <p v-if="reportMessage" :class="reportOk ? 'ok-text' : 'error-text'">{{ reportMessage }}</p>
      </div>
    </div>

    <!-- 痕迹弹窗 -->
    <div v-if="traceTarget" class="modal-mask" @click.self="traceTarget = null">
      <div class="modal wide">
        <div class="modal-head">
          <strong>报送痕迹 · {{ traceTarget.pipeCode }}（含被拒收/被覆盖版本，不删改）</strong>
          <button class="btn ghost" type="button" @click="traceTarget = null">关闭</button>
        </div>
        <table class="data-table">
          <thead>
            <tr><th>序号</th><th>类别</th><th>报告编号</th><th>结论</th><th>检测人</th><th>报送时间</th><th>处理结果</th><th>说明</th></tr>
          </thead>
          <tbody>
            <tr v-for="trace in traceTarget.traces" :key="trace.seq">
              <td>{{ trace.seq }}</td>
              <td>{{ trace.kind }}</td>
              <td>{{ trace.reportNo }}</td>
              <td :class="trace.conclusion === '合格' ? 'ok-text' : 'error-text'">{{ trace.conclusion }}</td>
              <td>{{ trace.inspector }}</td>
              <td>{{ formatTime(trace.submittedAt) }}</td>
              <td>
                <span class="badge" :class="trace.outcome === 'accepted' ? 'ok' : 'fail'">
                  {{ trace.outcome === 'accepted' ? '生效' : '未生效' }}
                </span>
              </td>
              <td>{{ trace.reason }}</td>
            </tr>
            <tr v-if="!traceTarget.traces.length">
              <td colspan="8" class="empty-state">暂无报送记录</td>
            </tr>
          </tbody>
        </table>
        <div v-if="traceTarget.pastReports.length">
          <h4>被覆盖归档的前一版报告</h4>
          <ul class="import-result">
            <li v-for="old in traceTarget.pastReports" :key="old.id" class="ok-text">
              {{ old.kind }} · {{ old.reportNo }} · {{ old.conclusion }} · {{ formatTime(old.reportedAt) }}
            </li>
          </ul>
        </div>
      </div>
    </div>

    <!-- 新建批次弹窗 -->
    <div v-if="creatingBatch" class="modal-mask" @click.self="creatingBatch = false">
      <div class="modal">
        <div class="modal-head">
          <strong>新建抽检批次</strong>
          <button class="btn ghost" type="button" @click="creatingBatch = false">取消</button>
        </div>
        <label class="filter-item">
          <span>批次名称</span>
          <input v-model="newBatchName" placeholder="如：2026年第四季度管网抽检" />
        </label>
        <div class="row-actions" style="margin-top: 10px">
          <button class="btn primary" type="button" @click="doCreateBatch">创建</button>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  checkCloseable,
  closeBatch,
  createBatch,
  effectiveConclusion,
  importSubjects,
  parseImportText,
  pendingReviewCount,
  pipePendingList,
  submitInitial,
  submitReview,
} from '@/api/sampling-service'
import { allBatches } from '@/data/sampling-store'
import { DUPLICATE_POLICY } from '@/data/sampling-types'
import type {
  ImportLineResult,
  ReportKind,
  SampleBatch,
  SampleItem,
  SampleSubject,
} from '@/data/sampling-types'

const duplicatePolicy = DUPLICATE_POLICY

const tabs = [
  { key: 'batches', label: '抽检批次' },
  { key: 'pending', label: '管段待评定清单' },
] as const
const activeTab = ref<(typeof tabs)[number]['key']>('batches')

const batches = ref<SampleBatch[]>([])
const pendingRows = ref<ReturnType<typeof pipePendingList>>([])
const currentBatchId = ref<number | null>(null)
const currentBatch = ref<SampleBatch | null>(null)

const creatingBatch = ref(false)
const newBatchName = ref('')

const importText = ref('')
const importResults = ref<ImportLineResult[]>([])
const fileInput = ref<HTMLInputElement | null>(null)

const reportTarget = ref<SampleSubject | null>(null)
const reportKind = ref<ReportKind>('初检')
const reportForm = ref<{ inspector: string; reportNo: string; reportedAt: string; items: SampleItem[] }>({
  inspector: '',
  reportNo: '',
  reportedAt: '',
  items: [],
})
const reportMessage = ref('')
const reportOk = ref(false)

const traceTarget = ref<SampleSubject | null>(null)

const openBatches = computed(() => batches.value.filter((b) => b.status !== '已办结').length)
const closedBatches = computed(() => batches.value.filter((b) => b.status === '已办结').length)
const totalPendingReview = computed(() => batches.value.reduce((sum, batch) => sum + pendingReviewCount(batch), 0))
const closeCheck = computed(() =>
  currentBatch.value ? checkCloseable(currentBatch.value) : { canClose: false, unjudged: 0, pendingReview: 0, blockers: [] },
)

function refresh() {
  batches.value = allBatches()
  pendingRows.value = pipePendingList()
  if (currentBatchId.value !== null) {
    currentBatch.value = allBatches().find((b) => b.id === currentBatchId.value) ?? null
  }
}

function switchTab(key: (typeof tabs)[number]['key']) {
  activeTab.value = key
  refresh()
}

function formatTime(value: string | null): string {
  if (!value) {
    return '—'
  }
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function statusBadge(status: string): string {
  if (status === '已办结') {
    return 'ok'
  }
  if (status === '检测中') {
    return 'fail'
  }
  return 'pending'
}

function effectiveOf(subject: SampleSubject) {
  return effectiveConclusion(subject)
}

function openCreateBatch() {
  newBatchName.value = ''
  creatingBatch.value = true
}

function doCreateBatch() {
  const batch = createBatch(newBatchName.value)
  creatingBatch.value = false
  refresh()
  openBatch(batch.id)
}

function openBatch(id: number) {
  currentBatchId.value = id
  currentBatch.value = allBatches().find((b) => b.id === id) ?? null
  importResults.value = []
}

function closeBatchDetail() {
  currentBatchId.value = null
  currentBatch.value = null
}

function onFileChange(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file) {
    return
  }
  const reader = new FileReader()
  reader.onload = () => {
    importText.value = String(reader.result ?? '')
  }
  reader.readAsText(file, 'utf-8')
}

function fillExample() {
  importText.value = ['管段编号', 'DRAI-0001', 'DRAI-0002', 'NOT-EXIST-99', 'DRAI-0001'].join('\n')
}

function doImport() {
  if (currentBatchId.value === null) {
    return
  }
  const parsed = parseImportText(importText.value)
  if (parsed.error || !parsed.codes) {
    importResults.value = [{ line: 1, pipeCode: '', ok: false, message: parsed.error ?? '导入解析失败' }]
    return
  }
  const result = importSubjects(currentBatchId.value, parsed.codes)
  importResults.value = result.results
  importText.value = ''
  if (fileInput.value) {
    fileInput.value.value = ''
  }
  refresh()
}

function addItem() {
  reportForm.value.items.push({ name: '', result: '合格', remark: '' })
}

function openReport(subject: SampleSubject, kind: ReportKind) {
  reportTarget.value = subject
  reportKind.value = kind
  reportMessage.value = ''
  const previous = kind === '初检' ? subject.initial : subject.reviewReport
  reportForm.value = {
    inspector: previous?.inspector ?? '',
    reportNo: '',
    reportedAt: toLocalInput(new Date()),
    items: previous && previous.items.length
      ? previous.items.map((item) => ({ ...item }))
      : [{ name: '管身结构', result: '合格', remark: '' }, { name: '接口错口', result: '合格', remark: '' }],
  }
}

function toLocalInput(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function submitReport() {
  if (!reportTarget.value || currentBatchId.value === null) {
    return
  }
  const emptyName = reportForm.value.items.some((item) => !item.name.trim())
  if (emptyName) {
    reportOk.value = false
    reportMessage.value = '每个检测项都要填写名称'
    return
  }
  const input = {
    ...reportForm.value,
    reportedAt: reportForm.value.reportedAt ? new Date(reportForm.value.reportedAt).toISOString() : '',
  }
  const result = reportKind.value === '初检'
    ? submitInitial(currentBatchId.value, reportTarget.value.id, input)
    : submitReview(currentBatchId.value, reportTarget.value.id, input)
  reportOk.value = result.ok
  reportMessage.value = result.message
  refresh()
  if (result.ok) {
    reportTarget.value = currentBatch.value?.subjects.find((s) => s.id === reportTarget.value?.id) ?? null
  }
}

function openTraces(subject: SampleSubject) {
  traceTarget.value = subject
}

function doClose() {
  if (currentBatchId.value === null) {
    return
  }
  const result = closeBatch(currentBatchId.value)
  if (!result.ok) {
    window.alert(result.message)
    return
  }
  refresh()
  pendingRows.value = pipePendingList()
}

onMounted(refresh)
</script>

<style scoped>
.tab-bar { display: flex; gap: 8px; margin: 8px 0 12px; }
.tab-btn { border: 1px solid var(--border); background: #fff; border-radius: 6px; padding: 6px 14px; cursor: pointer; }
.tab-btn.active { background: var(--brand); border-color: var(--brand); color: #fff; }
.badge { border-radius: 999px; padding: 2px 10px; font-size: 12px; }
.badge.ok { background: #e6f6ec; color: #177245; }
.badge.fail { background: #fdecec; color: #b42318; }
.badge.pending { background: #eef2f7; color: var(--muted); }
.ok-text { color: #177245; }
.modal-mask { position: fixed; inset: 0; background: rgba(15, 23, 42, 0.45); display: flex; align-items: flex-start; justify-content: center; padding: 32px 16px; overflow: auto; z-index: 50; }
.modal { background: #fff; border-radius: 10px; padding: 16px 18px; width: 560px; max-width: 100%; }
.modal.wide { width: 960px; }
.modal-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
.import-box { border: 1px dashed var(--border); border-radius: 8px; padding: 10px 12px; margin: 10px 0; }
.import-result { list-style: none; padding-left: 0; font-size: 12px; margin: 8px 0 0; }
.import-result li { padding: 2px 0; }
.form-grid { display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 8px; }
.form-grid .filter-item { flex: 1; min-width: 160px; }
textarea { width: 100%; }
button:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
