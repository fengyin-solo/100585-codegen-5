<template>
  <section class="page" data-module="sampling-detail">
    <header class="page-head">
      <div>
        <h2>
          <RouterLink class="link" to="/sampling">抽检管理</RouterLink>
          / {{ batch?.batchNo }} {{ batch?.name }}
        </h2>
        <p class="page-desc">
          建立时间 {{ batch?.createdAt }} · 负责人 {{ batch?.inspector }} ·
          <span class="tag" :class="batch?.status === '已办结' ? 'tag-done' : 'tag-run'">{{ batch?.status }}</span>
          <template v-if="batch?.conclusion"> · 整体结论：<strong>{{ batch.conclusion }}</strong>（{{ batch.closedAt }} 办结）</template>
        </p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" :disabled="batch?.status === '已办结'" @click="openImport">从管段台账导入</button>
        <button class="btn" type="button" @click="exportCsv">导出抽检结果</button>
        <button
          class="btn primary"
          type="button"
          :disabled="batch?.status === '已办结'"
          @click="closeBatchNow"
        >
          批次办结
        </button>
      </div>
    </header>

    <div v-if="batch" class="stat-row">
      <article class="stat-card">
        <span class="stat-label">抽检对象</span>
        <strong class="stat-value">{{ progress.total }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">已判定</span>
        <strong class="stat-value">{{ progress.judged }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">复检待结果</span>
        <strong class="stat-value" :class="progress.pendingRein ? 'num-warn' : ''">{{ progress.pendingRein }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">最终合格 / 不合格</span>
        <strong class="stat-value">{{ progress.passed }} / {{ progress.failed }}</strong>
      </article>
    </div>

    <div v-if="blockers.length" class="notice">
      <strong>办结前需处理：</strong>
      <ul>
        <li v-for="(item, i) in blockers" :key="i">{{ item }}</li>
      </ul>
    </div>

    <table class="data-table">
      <thead>
        <tr>
          <th>管段编号</th><th>起终点</th><th>管径 / 管材</th>
          <th>检测项</th><th>当前初检判定</th><th>复检</th><th>最终结论</th>
          <th>操作</th><th>留痕</th>
        </tr>
      </thead>
      <tbody>
        <template v-for="object in batch?.objects ?? []" :key="object.id">
          <tr>
            <td>{{ object.pipeId }}</td>
            <td>{{ object.startManhole }} → {{ object.endManhole }}</td>
            <td>{{ object.diameter }} / {{ object.material }}</td>
            <td>{{ (judgeOf(object)?.items ?? []).join('、') || '—' }}</td>
            <td>
              <template v-if="judgeOf(object)">
                <span class="tag" :class="judgeOf(object)!.verdict === '合格' ? 'tag-pass' : 'tag-fail'">
                  {{ judgeOf(object)!.verdict }}
                </span>
                <div class="sub-text">{{ judgeOf(object)!.reportNo }} · {{ judgeOf(object)!.submittedAt }}</div>
                <div v-if="hasOldJudges(object)" class="sub-text">
                  已覆盖 {{ object.judges.length - 1 }} 版（有留痕）
                </div>
              </template>
              <span v-else class="sub-text">未报送</span>
            </td>
            <td>
              <span v-if="pendingReinOf(object)" class="tag tag-warn">待复检结果</span>
              <template v-else-if="reinOf(object)">
                <span class="tag" :class="reinOf(object)!.status === '合格' ? 'tag-pass' : 'tag-fail'">
                  {{ reinOf(object)!.status }}
                </span>
                <div class="sub-text">{{ reinOf(object)!.reportNo }}</div>
              </template>
              <span v-else>—</span>
            </td>
            <td>
              <span v-if="verdictOf(object)" class="tag" :class="verdictOf(object) === '合格' ? 'tag-pass' : 'tag-fail'">
                {{ verdictOf(object) }}
              </span>
              <span v-else class="sub-text">未判定</span>
            </td>
            <td class="row-actions">
              <button class="link" type="button" :disabled="batch?.status === '已办结'" @click="openJudge(object)">
                {{ judgeOf(object) ? '重新报送判定' : '报送判定' }}
              </button>
              <button
                v-if="pendingReinOf(object)"
                class="link"
                type="button"
                :disabled="batch?.status === '已办结'"
                @click="openRein(object)"
              >
                填报复检结果
              </button>
            </td>
            <td class="row-actions">
              <button class="link" type="button" @click="toggleTrace(object.id)">
                {{ expanded[object.id] ? '收起痕迹' : `查看痕迹(${object.events.length})` }}
              </button>
            </td>
          </tr>
          <tr v-if="expanded[object.id]">
            <td colspan="9" class="trace-cell">
              <div class="trace-block">
                <strong>判定报送版本（覆盖不删痕）</strong>
                <ul>
                  <li v-for="version in [...object.judges].reverse()" :key="version.id">
                    <span class="tag" :class="version.verdict === '合格' ? 'tag-pass' : 'tag-fail'">{{ version.verdict }}</span>
                    {{ version.reportNo }} · {{ version.reporter }} · {{ version.submittedAt }}
                    · 检测项：{{ version.items.join('、') }}
                    <span v-if="version.superseded" class="sub-text">［{{ version.traceNote || '已被后续报送覆盖' }}］</span>
                  </li>
                  <li v-if="!object.judges.length" class="sub-text">暂无报送</li>
                </ul>
              </div>
              <div class="trace-block">
                <strong>复检记录</strong>
                <ul>
                  <li v-for="rein in object.reinspections" :key="rein.id">
                    <span v-if="rein.status === 'pending'" class="tag tag-warn">待复检结果</span>
                    <span v-else class="tag" :class="rein.status === '合格' ? 'tag-pass' : 'tag-fail'">{{ rein.status }}</span>
                    {{ rein.reportNo || '（报告未出）' }}
                    <span v-if="rein.inspector">· {{ rein.inspector }} · {{ rein.submittedAt }} · {{ rein.items.join('、') }}</span>
                  </li>
                  <li v-if="!object.reinspections.length" class="sub-text">无复检（初检不合格会自动产生）</li>
                </ul>
              </div>
              <div class="trace-block">
                <strong>流转痕迹</strong>
                <ul>
                  <li v-for="(event, i) in [...object.events].reverse()" :key="i">{{ event.at }} — {{ event.text }}</li>
                </ul>
              </div>
            </td>
          </tr>
        </template>
        <tr v-if="!batch?.objects.length">
          <td colspan="9" class="empty-state">批次下还没有抽检对象，点「从管段台账导入」挂入管段</td>
        </tr>
      </tbody>
    </table>

    <!-- 导入台账 -->
    <div v-if="showImport" class="modal-mask" @click.self="showImport = false">
      <div class="modal modal-wide">
        <h3>从排水管段台账导入抽检对象</h3>
        <p class="page-desc">
          必填字段：管段编号、起点井号、终点井号、管径、管材。缺字段的台账行会被挡回（见行内说明），不允许勾选。
        </p>
        <table class="data-table import-table">
          <thead>
            <tr><th>选择</th><th>管段编号</th><th>起点井号</th><th>终点井号</th><th>管径</th><th>管材</th><th>校验</th></tr>
          </thead>
          <tbody>
            <tr v-for="row in ledgerRows" :key="row.pipeId" :class="{ 'row-disabled': !row.ok || row.skipped }">
              <td>
                <input
                  type="checkbox"
                  :checked="selectedPipes.has(row.pipeId)"
                  :disabled="!row.ok || row.skipped"
                  @change="toggleSelect(row.pipeId, ($event.target as HTMLInputElement).checked)"
                />
              </td>
              <td>{{ row.pipeId }}</td>
              <td>{{ fieldOf(row.pipeId, '起点井号') }}</td>
              <td>{{ fieldOf(row.pipeId, '终点井号') }}</td>
              <td>{{ fieldOf(row.pipeId, '管径') }}</td>
              <td>{{ fieldOf(row.pipeId, '管材') }}</td>
              <td>
                <span v-if="row.ok && !row.skipped" class="tag tag-pass">可导入</span>
                <span v-else-if="row.skipped" class="tag tag-done">已在批次中</span>
                <span v-else class="tag tag-fail">挡回：{{ row.reason }}</span>
              </td>
            </tr>
          </tbody>
        </table>
        <p v-if="importMessage" class="error-text">{{ importMessage }}</p>
        <div class="modal-actions">
          <button class="btn" type="button" @click="selectAllValid">全选可导入</button>
          <span class="spacer"></span>
          <button class="btn" type="button" @click="showImport = false">取消</button>
          <button class="btn primary" type="button" @click="confirmImport">导入勾选项</button>
        </div>
      </div>
    </div>

    <!-- 报送判定 -->
    <div v-if="judgeForm.object" class="modal-mask" @click.self="judgeForm.object = null">
      <div class="modal">
        <h3>报送合格判定 · {{ judgeForm.object.pipeId }}</h3>
        <p v-if="judgeOf(judgeForm.object)" class="page-desc">
          该对象已有判定（{{ judgeOf(judgeForm.object)!.reportNo }}：{{ judgeOf(judgeForm.object)!.verdict }}）。
          再次报送将按最新报告覆盖当前判定，前一版自动留痕；若最新报告判不合格将重新进入复检。
        </p>
        <label class="form-item">
          <span>检测报告编号</span>
          <input v-model="judgeForm.reportNo" placeholder="如 JC-261005-01" />
        </label>
        <label class="form-item">
          <span>检测项（顿号或逗号分隔）</span>
          <input v-model="judgeForm.itemsText" placeholder="外观、淤积、接口渗漏" />
        </label>
        <label class="form-item">
          <span>合格判定</span>
          <span class="radio-row">
            <label><input type="radio" value="合格" v-model="judgeForm.verdict" /> 合格</label>
            <label><input type="radio" value="不合格" v-model="judgeForm.verdict" /> 不合格（自动进复检）</label>
          </span>
        </label>
        <label class="form-item">
          <span>检测人</span>
          <input v-model="judgeForm.reporter" placeholder="检测人姓名" />
        </label>
        <p v-if="judgeForm.error" class="error-text">{{ judgeForm.error }}</p>
        <div class="modal-actions">
          <button class="btn" type="button" @click="judgeForm.object = null">取消</button>
          <button class="btn primary" type="button" @click="submitJudgeForm">提交判定</button>
        </div>
      </div>
    </div>

    <!-- 填报复检 -->
    <div v-if="reinForm.object" class="modal-mask" @click.self="reinForm.object = null">
      <div class="modal">
        <h3>填报复检结果 · {{ reinForm.object.pipeId }}</h3>
        <p class="page-desc">
          复检结论与初检不一致时，最终结论以最近一次检测报告（复检报告）为准。
        </p>
        <label class="form-item">
          <span>复检报告编号</span>
          <input v-model="reinForm.reportNo" placeholder="如 FJ-261008-01" />
        </label>
        <label class="form-item">
          <span>复检项（顿号或逗号分隔）</span>
          <input v-model="reinForm.itemsText" placeholder="外观、淤积" />
        </label>
        <label class="form-item">
          <span>复检结论</span>
          <span class="radio-row">
            <label><input type="radio" value="合格" v-model="reinForm.verdict" /> 复检合格</label>
            <label><input type="radio" value="不合格" v-model="reinForm.verdict" /> 仍不合格</label>
          </span>
        </label>
        <label class="form-item">
          <span>复检人</span>
          <input v-model="reinForm.inspector" placeholder="复检人姓名" />
        </label>
        <p v-if="reinForm.error" class="error-text">{{ reinForm.error }}</p>
        <div class="modal-actions">
          <button class="btn" type="button" @click="reinForm.object = null">取消</button>
          <button class="btn primary" type="button" @click="submitReinForm">提交复检结果</button>
        </div>
      </div>
    </div>

    <footer class="page-foot">
      <span v-if="message" :class="messageOk ? '' : 'error-text'">{{ message }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { RouterLink, useRoute } from 'vue-router'

import {
  batchProgress,
  closeBatch,
  closeBlockers,
  currentJudge,
  exportBatch,
  finalVerdict,
  completedReinspection,
  getBatch,
  hasPendingReinspection,
  importPipes,
  previewLedger,
  submitJudge as submitJudgeApi,
  submitReinspection,
} from '@/api/sampling-service'
import { listRows } from '@/data/local-store'
import type { ImportRowResult, SampleBatch, SampleObject, Verdict } from '@/data/sampling-types'

const route = useRoute()
const batchId = Number(route.params.id)
const batch = ref<SampleBatch | undefined>(getBatch(batchId))
const message = ref('')
const messageOk = ref(true)
const expanded = reactive<Record<number, boolean>>({})

const progress = computed(() => (batch.value ? batchProgress(batch.value) : { total: 0, judged: 0, pendingRein: 0, passed: 0, failed: 0 }))
const blockers = computed(() => (batch.value ? closeBlockers(batch.value) : []))

const judgeOf = currentJudge
const reinOf = completedReinspection
const pendingReinOf = hasPendingReinspection
const verdictOf = finalVerdict

function hasOldJudges(object: SampleObject): boolean {
  return object.judges.some((v) => v.superseded)
}

function toggleTrace(id: number) {
  expanded[id] = !expanded[id]
}

// ---- 导入 ----
const showImport = ref(false)
const ledgerRows = ref<(ImportRowResult & { material: string })[]>([])
const selectedPipes = reactive(new Set<string>())
const importMessage = ref('')

function openImport() {
  const preview = previewLedger(batchId)
  ledgerRows.value = preview.rows
  selectedPipes.clear()
  importMessage.value = ''
  showImport.value = true
}

function fieldOf(pipeId: string, field: string): string {
  const row = listRows('drainpipe').find((r) => String(r['管段编号'] ?? '').trim() === pipeId)
  return row ? String(row[field] ?? '') : ''
}

function toggleSelect(pipeId: string, checked: boolean) {
  if (checked) selectedPipes.add(pipeId)
  else selectedPipes.delete(pipeId)
}

function selectAllValid() {
  for (const row of ledgerRows.value) {
    if (row.ok && !row.skipped) selectedPipes.add(row.pipeId)
  }
}

function confirmImport() {
  if (selectedPipes.size === 0) {
    importMessage.value = '请先勾选要导入的管段；缺字段的管段需先在排水管网台账补齐'
    return
  }
  const result = importPipes(batchId, [...selectedPipes])
  importMessage.value = result.ok ? '' : result.message
  message.value = result.message
  messageOk.value = result.ok
  showImport.value = false
  reload()
}

// ---- 报送判定 ----
const judgeForm = reactive<{
  object: SampleObject | null
  reportNo: string
  itemsText: string
  verdict: Verdict
  reporter: string
  error: string
}>({ object: null, reportNo: '', itemsText: '', verdict: '合格', reporter: '', error: '' })

function openJudge(object: SampleObject) {
  Object.assign(judgeForm, {
    object,
    reportNo: '',
    itemsText: '',
    verdict: '合格',
    reporter: '',
    error: '',
  })
}

function splitItems(text: string): string[] {
  return text.split(/[、,，\s]+/).map((s) => s.trim()).filter(Boolean)
}

function submitJudgeForm() {
  if (!judgeForm.object) return
  const result = submitJudgeApi(batchId, judgeForm.object.id, {
    reportNo: judgeForm.reportNo,
    items: splitItems(judgeForm.itemsText),
    verdict: judgeForm.verdict,
    reporter: judgeForm.reporter,
  })
  if (!result.ok) {
    judgeForm.error = result.message
    return
  }
  judgeForm.object = null
  message.value = result.message
  messageOk.value = true
  reload()
}

// ---- 复检 ----
const reinForm = reactive<{
  object: SampleObject | null
  reportNo: string
  itemsText: string
  verdict: Verdict
  inspector: string
  error: string
}>({ object: null, reportNo: '', itemsText: '', verdict: '合格', inspector: '', error: '' })

function openRein(object: SampleObject) {
  Object.assign(reinForm, {
    object,
    reportNo: '',
    itemsText: '',
    verdict: '合格',
    inspector: '',
    error: '',
  })
}

function submitReinForm() {
  if (!reinForm.object) return
  const result = submitReinspection(batchId, reinForm.object.id, {
    reportNo: reinForm.reportNo,
    items: splitItems(reinForm.itemsText),
    verdict: reinForm.verdict,
    inspector: reinForm.inspector,
  })
  if (!result.ok) {
    reinForm.error = result.message
    return
  }
  reinForm.object = null
  message.value = result.message
  messageOk.value = true
  reload()
}

function closeBatchNow() {
  const result = closeBatch(batchId)
  message.value = result.message
  messageOk.value = result.ok
  reload()
}

function exportCsv() {
  const file = exportBatch(batchId)
  if (!file) return
  const blob = new Blob([file.content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = file.filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

function reload() {
  batch.value = getBatch(batchId)
}

onMounted(reload)
</script>
