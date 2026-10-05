<template>
  <section class="page" data-module="sampling">
    <header class="page-head">
      <div>
        <h2>抽检管理</h2>
        <p class="page-desc">
          抽检批次下挂管段台账对象；判定不合格自动进复检，复检未出结果不允许办结；
          重复报送按最新覆盖并保留历史版本，最终结论以最近一次检测报告为准；办结后不合格管段进入待评定清单。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">新建抽检批次</button>
        <button class="btn ghost" type="button" @click="resetAll">重置示例数据</button>
      </div>
    </header>

    <div class="tab-bar">
      <button
        v-for="tab in tabs"
        :key="tab.key"
        class="tab-item"
        :class="{ active: activeTab === tab.key }"
        type="button"
        @click="activeTab = tab.key"
      >
        {{ tab.label }}<span v-if="tab.badge" class="tab-badge">{{ tab.badge }}</span>
      </button>
    </div>

    <template v-if="activeTab === 'batch'">
      <div class="stat-row">
        <article v-for="card in cards" :key="card.label" class="stat-card">
          <span class="stat-label">{{ card.label }}</span>
          <strong class="stat-value">{{ card.value }}</strong>
        </article>
      </div>

      <table class="data-table">
        <thead>
          <tr>
            <th>批次编号</th><th>批次名称</th><th>负责人</th><th>建立时间</th>
            <th>抽检对象</th><th>已判定</th><th>待复检</th><th>合格 / 不合格</th>
            <th>状态</th><th>整体结论</th><th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="batch in batches" :key="batch.id">
            <td>{{ batch.batchNo }}</td>
            <td>{{ batch.name }}</td>
            <td>{{ batch.inspector }}</td>
            <td>{{ batch.createdAt }}</td>
            <td>{{ progressOf(batch).total }}</td>
            <td>{{ progressOf(batch).judged }}</td>
            <td>
              <span v-if="progressOf(batch).pendingRein" class="tag tag-warn">
                {{ progressOf(batch).pendingRein }} 待复检
              </span>
              <span v-else>—</span>
            </td>
            <td>{{ progressOf(batch).passed }} / {{ progressOf(batch).failed }}</td>
            <td>
              <span class="tag" :class="batch.status === '已办结' ? 'tag-done' : 'tag-run'">{{ batch.status }}</span>
            </td>
            <td>{{ batch.conclusion || '—' }}</td>
            <td class="row-actions">
              <RouterLink class="link" :to="`/sampling/${batch.id}`">进入批次</RouterLink>
            </td>
          </tr>
          <tr v-if="!batches.length">
            <td colspan="11" class="empty-state">暂无抽检批次，点击右上角新建</td>
          </tr>
        </tbody>
      </table>
    </template>

    <template v-else>
      <p class="page-desc" style="margin: 8px 0 12px">
        批次办结后，最终不合格的管段自动进入本清单；同一管段已有待评定记录时，后办结批次不再重复插入（只保留先到的）。
      </p>
      <table class="data-table">
        <thead>
          <tr>
            <th>管段编号</th><th>管段</th><th>来源批次</th><th>依据报告</th>
            <th>最终结论</th><th>同步时间</th><th>状态</th><th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="entry in assessment" :key="entry.id">
            <td>{{ entry.pipeId }}</td>
            <td>{{ entry.pipeName }}</td>
            <td>{{ entry.batchNo }}</td>
            <td>{{ entry.reportNo }}</td>
            <td><span class="tag tag-fail">{{ entry.finalVerdict }}</span></td>
            <td>{{ entry.syncedAt }}</td>
            <td>
              <span class="tag" :class="entry.status === '待评定' ? 'tag-warn' : 'tag-done'">{{ entry.status }}</span>
            </td>
            <td class="row-actions">
              <button v-if="entry.status === '待评定'" class="link" type="button" @click="resolveEntry(entry.id)">
                完成评定
              </button>
              <span v-else>—</span>
            </td>
          </tr>
          <tr v-if="!assessment.length">
            <td colspan="8" class="empty-state">暂无待评定管段，办结存在不合格对象的批次后会同步到这里</td>
          </tr>
        </tbody>
      </table>
    </template>

    <div v-if="showCreate" class="modal-mask" @click.self="showCreate = false">
      <div class="modal">
        <h3>新建抽检批次</h3>
        <label class="form-item">
          <span>批次名称</span>
          <input v-model="form.name" placeholder="如：四季度第二批管网抽检" />
        </label>
        <label class="form-item">
          <span>抽检负责人</span>
          <input v-model="form.inspector" placeholder="负责人姓名" />
        </label>
        <p v-if="formError" class="error-text">{{ formError }}</p>
        <div class="modal-actions">
          <button class="btn" type="button" @click="showCreate = false">取消</button>
          <button class="btn primary" type="button" @click="submitCreate">创建</button>
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
import { RouterLink } from 'vue-router'

import {
  batchProgress,
  createBatch,
  listAssessment,
  listBatches,
  resolveAssessment,
  resetSamplingModule,
} from '@/api/sampling-service'
import type { AssessmentEntry, SampleBatch } from '@/data/sampling-types'

const batches = ref<SampleBatch[]>([])
const assessment = ref<AssessmentEntry[]>([])
const activeTab = ref<'batch' | 'assessment'>('batch')
const showCreate = ref(false)
const form = reactive({ name: '', inspector: '' })
const formError = ref('')
const message = ref('')
const messageOk = ref(true)

const tabs = computed(() => [
  { key: 'batch' as const, label: '抽检批次', badge: 0 },
  { key: 'assessment' as const, label: '管段待评定清单', badge: assessment.value.filter((a) => a.status === '待评定').length },
])

const cards = computed(() => [
  { label: '批次总数', value: batches.value.length },
  { label: '抽检中批次', value: batches.value.filter((b) => b.status === '抽检中').length },
  { label: '已办结批次', value: batches.value.filter((b) => b.status === '已办结').length },
  { label: '待评定管段', value: assessment.value.filter((a) => a.status === '待评定').length },
])

function progressOf(batch: SampleBatch) {
  return batchProgress(batch)
}

function openCreate() {
  form.name = ''
  form.inspector = ''
  formError.value = ''
  showCreate.value = true
}

function submitCreate() {
  const result = createBatch({ name: form.name, inspector: form.inspector })
  if (!result.ok) {
    formError.value = result.message
    return
  }
  showCreate.value = false
  message.value = `批次 ${result.data?.batchNo} 已创建，请进入批次导入抽检对象`
  messageOk.value = true
  reload()
}

function resolveEntry(id: number) {
  const result = resolveAssessment(id)
  message.value = result.message
  messageOk.value = result.ok
  reload()
}

function resetAll() {
  resetSamplingModule()
  message.value = '抽检模块已恢复为示例数据'
  messageOk.value = true
  reload()
}

function reload() {
  batches.value = listBatches()
  assessment.value = listAssessment()
}

onMounted(reload)
</script>
