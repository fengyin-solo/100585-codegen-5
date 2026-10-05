// 抽检业务规则冒烟测试：用 localStorage mock 跑真实的 sampling-service 编译产物。
const esbuild = require('esbuild')
const path = require('path')

const storage = {}
global.window = { localStorage: {
  getItem: (k) => (k in storage ? storage[k] : null),
  setItem: (k, v) => { storage[k] = String(v) },
} }

const ROOT = path.resolve(__dirname, '..')
async function load() {
  const result = await esbuild.build({
    entryPoints: [path.resolve(ROOT, 'src/api/sampling-service.ts')],
    bundle: true,
    format: 'cjs',
    platform: 'node',
    write: false,
    alias: { '@': path.resolve(ROOT, 'src') },
  })
  const code = result.outputFiles[0].text
  const module = { exports: {} }
  new Function('module', 'exports', 'require', code)(module, module.exports, require)
  return module.exports
}

let pass = 0
let fail = 0
function assert(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; console.log(`  ✗ ${name} ${extra}`) }
}

async function main() {
  const svc = await load()

  // 1. 建批次 + 导入：正常 / 台账查无 / 文件内重复
  const batch = svc.createBatch('四季度抽检')
  const importRes = svc.importSubjects(batch.id, ['DRAI-0001', 'DRAI-0002', 'NO-SUCH-9', 'DRAI-0001'])
  assert('导入：2 行有效', importRes.accepted === 2, `accepted=${importRes.accepted}`)
  assert('导入：查无管段被挡回并说明', importRes.results.some((r) => !r.ok && r.message.includes('台账查无')))
  assert('导入：文件内重复被挡回', importRes.results.some((r) => !r.ok && r.message.includes('重复出现')))
  const again = svc.importSubjects(batch.id, ['DRAI-0001'])
  assert('导入：同批次重复挂接被挡回', again.results.some((r) => !r.ok && r.message.includes('已在批次')))

  // 2. 缺列整批挡回
  const parsed = svc.parseImportText('编号\nDRAI-0001')
  assert('导入：缺必填列整批挡回', Boolean(parsed.error) && parsed.error.includes('管段编号'))

  // 2b. 台账行本身缺字段也挡回：清掉 DRAI-0001 的「管材」再建一个批次导入
  const entries = JSON.parse(storage['drainage-pump:entries'])
  const pipeRow = entries.drainpipe.find((r) => r['管段编号'] === 'DRAI-0001')
  pipeRow['管材'] = ''
  storage['drainage-pump:entries'] = JSON.stringify(entries)
  const svcFresh = await load()
  const batchMissing = svcFresh.createBatch('台账缺字段批次')
  const missingRes = svcFresh.importSubjects(batchMissing.id, ['DRAI-0001'])
  assert(
    '导入：台账行缺字段被挡回并指出缺什么',
    missingRes.accepted === 0 && !missingRes.results[0].ok && missingRes.results[0].message.includes('管材'),
    missingRes.results[0].message,
  )
  pipeRow['管材'] = '排水管网样例1'
  storage['drainage-pump:entries'] = JSON.stringify(entries)

  let b = svc.getBatch(batch.id)
  const s1 = b.subjects.find((s) => s.pipeCode === 'DRAI-0001')
  const s2 = b.subjects.find((s) => s.pipeCode === 'DRAI-0002')

  // 3. 合格判定 + 重复报送（先到为准，拒收但留痕）
  const day = (h) => `2026-10-05T${h}:00:00.000Z`
  const r1 = svc.submitInitial(batch.id, s1.id, {
    items: [{ name: '管身', result: '合格', remark: '' }], reportNo: 'R1', inspector: '张工', reportedAt: day('01'),
  })
  assert('初检合格报送成功', r1.ok)
  const r1dup = svc.submitInitial(batch.id, s1.id, {
    items: [{ name: '管身', result: '不合格', remark: '后报送的' }], reportNo: 'R1-DUP', inspector: '李工', reportedAt: day('02'),
  })
  assert('重复报送被拒收（先到为准）', !r1dup.ok && r1dup.message.includes('先到'))
  b = svc.getBatch(batch.id)
  const s1b = b.subjects.find((s) => s.id === s1.id)
  assert('生效判定仍是先到那条（合格）', s1b.initial.conclusion === '合格' && s1b.initial.reportNo === 'R1')
  assert('重复报送留下痕迹（含拒收原因）', s1b.traces.length === 2 && s1b.traces[1].outcome === 'rejected')

  // 4. 不合格 → 自动复检；复检未出结果时办结被挡
  const r2 = svc.submitInitial(batch.id, s2.id, {
    items: [{ name: '接口', result: '不合格', remark: '错口' }], reportNo: 'R2', inspector: '张工', reportedAt: day('03'),
  })
  assert('初检不合格报送成功', r2.ok)
  b = svc.getBatch(batch.id)
  const s2b = b.subjects.find((s) => s.id === s2.id)
  assert('不合格自动生成复检单', s2b.reviewRequired === true && s2b.reviewReport === null)
  const blocked = svc.closeBatch(batch.id)
  assert('复检未出结果不允许办结', !blocked.ok && blocked.message.includes('复检'))

  // 5. 复检合格（时间最晚）→ 生效结论以最近一次报告为准
  const rv = svc.submitReview(batch.id, s2.id, {
    items: [{ name: '接口', result: '合格', remark: '已修复' }], reportNo: 'RV1', inspector: '王工', reportedAt: day('08'),
  })
  assert('复检结果报送成功', rv.ok)
  b = svc.getBatch(batch.id)
  const s2c = b.subjects.find((s) => s.id === s2.id)
  assert('初检不合格 vs 复检合格：以最近报告为准 → 合格', svc.effectiveConclusion(s2c) === '合格')

  // 复检重复报送也先到为准
  const rvDup = svc.submitReview(batch.id, s2.id, {
    items: [{ name: '接口', result: '不合格', remark: '' }], reportNo: 'RV-DUP', inspector: '赵工', reportedAt: day('09'),
  })
  assert('复检重复报送被拒收', !rvDup.ok)

  // 6. 办结 → 管段台账回写、待评定清单更新
  const closed = svc.closeBatch(batch.id)
  assert('批次办结成功', closed.ok && closed.message.includes('待评定清单'))
  b = svc.getBatch(batch.id)
  assert('批次状态为已办结', b.status === '已办结' && Boolean(b.closedAt))
  const pending = svc.pipePendingList()
  const p1 = pending.find((p) => p.pipeCode === 'DRAI-0001')
  const p2 = pending.find((p) => p.pipeCode === 'DRAI-0002')
  const p3 = pending.find((p) => p.pipeCode === 'DRAI-0003')
  assert('管段1：已评定合格', p1.verdict === '抽检合格' && p1.pending === false)
  assert('管段2：复检翻为合格，最终合格', p2.verdict === '抽检合格' && p2.batchNo === batch.batchNo)
  assert('未覆盖管段仍待评定', p3.pending === true && p3.verdict === '')

  // 7. 办结后冻结
  const frozen = svc.submitInitial(batch.id, s1.id, {
    items: [{ name: 'x', result: '不合格', remark: '' }], reportNo: 'X', inspector: 'x', reportedAt: day('10'),
  })
  assert('办结后改动被拒', !frozen.ok && frozen.message.includes('已办结'))

  // 8. localStorage 持久化（刷新模拟）
  delete require.cache[require.resolve('esbuild')]
  const svc2 = await load()
  assert('数据持久化：重载后批次仍在', svc2.allBatches().length === 1)
  assert('数据持久化：痕迹不丢', svc2.getBatch(batch.id).subjects[0].traces.length === 2)

  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail === 0 ? 0 : 1)
}

main().catch((e) => { console.error(e); process.exit(1) })
