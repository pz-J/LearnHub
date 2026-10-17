(function () {
  var root = document.createElement('div')
  root.id = 'app'
  document.body.appendChild(root)
  var state = { entries: [] }
  var onFocusDone = null

  root.innerHTML = `
    <style>
      *{box-sizing:border-box} .wrap{padding:14px;color:var(--lh-text,#e6e9f2);font:13px/1.55 system-ui,sans-serif}
      .top{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:12px}
      h2{font-size:15px;font-weight:650;margin:0}.muted{color:var(--lh-muted,#9aa3b8);font-size:12px}
      label{display:block;margin:10px 0 4px;color:var(--lh-muted,#9aa3b8);font-size:12px}
      input,textarea,select{width:100%;border:1px solid var(--lh-line,#2a3145);border-radius:8px;background:var(--lh-bg,#0f1117);color:inherit;padding:8px;font:inherit}
      textarea{min-height:76px;resize:vertical} button{border:1px solid var(--lh-line,#2a3145);border-radius:8px;background:var(--lh-card,#1b202e);color:inherit;padding:7px 10px;cursor:pointer;font:inherit}
      button.primary{background:var(--lh-accent,#426ee8);border-color:transparent;color:white}button:disabled{opacity:.5;cursor:wait}
      .actions{display:flex;flex-wrap:wrap;gap:7px;margin-top:10px}.stats{display:flex;gap:8px;margin:12px 0}.stat{flex:1;border:1px solid var(--lh-line,#2a3145);border-radius:9px;padding:9px}.stat b{display:block;font-size:18px}
      .entry{border:1px solid var(--lh-line,#2a3145);border-radius:9px;padding:10px;margin-top:8px}.entry-head{display:flex;justify-content:space-between;gap:8px}.entry h3{font-weight:600;font-size:13px;margin:0}.tag{font-size:11px;color:var(--lh-muted,#9aa3b8)}.body{white-space:pre-wrap;overflow-wrap:anywhere;margin-top:6px;color:var(--lh-muted,#9aa3b8)}
      .empty{border:1px dashed var(--lh-line,#2a3145);border-radius:9px;padding:18px;text-align:center;color:var(--lh-muted,#9aa3b8)}.section{margin-top:18px;font-weight:650}.notice{margin-top:8px;color:var(--lh-muted,#9aa3b8);font-size:12px}
    </style>
    <div class="wrap">
      <div class="top"><div><h2>科研日志</h2><div class="muted" id="today"></div></div><button id="summary">AI 日总结</button></div>
      <div class="stats"><div class="stat"><b id="count">0</b><span class="muted">今日记录</span></div><div class="stat"><b id="focus">0</b><span class="muted">专注时段</span></div></div>
      <form id="entry-form">
        <label for="kind">记录类型</label><select id="kind"><option>研究想法</option><option>阅读笔记</option><option>实验记录</option><option>下一步计划</option></select>
        <label for="title">标题</label><input id="title" maxlength="120" placeholder="例如：自旋轨道耦合的关键问题" required />
        <label for="body">内容</label><textarea id="body" maxlength="6000" placeholder="记录发现、疑问、证据或下一步行动…" required></textarea>
        <div class="actions"><button class="primary" type="submit">保存记录</button><button type="button" id="export">导出 Markdown</button></div>
      </form>
      <div class="section">最近记录</div><label for="filter">筛选记录</label><input id="filter" placeholder="按标题或内容搜索" />
      <div id="entries"></div><div class="notice">记录保存在本模块私有存储中。AI 总结和通知需要在模块中心单独授权。</div>
    </div>`

  var el = function (id) { return document.getElementById(id) }
  var today = function () { return new Date().toLocaleDateString('sv-SE') }
  var escapeMd = function (value) { return String(value || '').replace(/\r/g, '') }
  var save = async function () { await window.host.storage.set({ obj: state }) }
  var toast = function (message) { window.host.ui.toast({ text: message }) }

  function render() {
    var day = today()
    var entries = state.entries.filter(function (entry) { return entry.date === day })
    el('today').textContent = day + ' · 坚持记录研究过程'
    el('count').textContent = String(entries.length)
    el('focus').textContent = String(entries.filter(function (entry) { return entry.kind === '专注记录' }).length)
    var query = el('filter').value.trim().toLowerCase()
    var filtered = state.entries.filter(function (entry) { return !query || (entry.title + ' ' + entry.body).toLowerCase().includes(query) }).slice().sort(function (a, b) { return b.createdAt - a.createdAt }).slice(0, 50)
    var list = el('entries')
    list.replaceChildren()
    if (!filtered.length) {
      var empty = document.createElement('div'); empty.className = 'empty'; empty.textContent = query ? '没有匹配的记录。' : '还没有记录。写下今天遇到的问题、证据或下一步计划吧。'; list.appendChild(empty); return
    }
    filtered.forEach(function (entry) {
      var card = document.createElement('article'); card.className = 'entry'
      var head = document.createElement('div'); head.className = 'entry-head'
      var title = document.createElement('h3'); title.textContent = entry.title
      var tag = document.createElement('span'); tag.className = 'tag'; tag.textContent = entry.kind + ' · ' + new Date(entry.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      head.append(title, tag)
      var body = document.createElement('div'); body.className = 'body'; body.textContent = entry.body
      var actions = document.createElement('div'); actions.className = 'actions'
      var remove = document.createElement('button'); remove.textContent = '删除'; remove.addEventListener('click', async function () { state.entries = state.entries.filter(function (x) { return x.id !== entry.id }); await save(); render(); toast('记录已删除') })
      actions.appendChild(remove); card.append(head, body, actions); list.appendChild(card)
    })
  }

  async function addEntry(kind, title, body) {
    state.entries.push({ id: 'j_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7), date: today(), kind: kind, title: title, body: body, createdAt: Date.now() })
    while (state.entries.length > 500 || new TextEncoder().encode(JSON.stringify(state)).length > 700_000) state.entries.shift()
    await save(); render()
  }

  el('entry-form').addEventListener('submit', async function (event) {
    event.preventDefault()
    var title = el('title').value.trim(), body = el('body').value.trim()
    if (!title || !body) return
    await addEntry(el('kind').value, title, body)
    el('title').value = ''; el('body').value = ''; toast('已保存到科研日志')
  })
  el('filter').addEventListener('input', render)
  el('export').addEventListener('click', async function () {
    var permission = await window.host.requestPermission({ capability: 'files.pick', reason: '将科研日志导出为 Markdown 文件' })
    if (!permission.granted) return toast('未获得文件导出权限')
    var text = '# 科研日志\n\n' + state.entries.slice().sort(function (a, b) { return a.createdAt - b.createdAt }).map(function (entry) { return '## ' + entry.date + ' · ' + entry.title + '\n\n类型：' + entry.kind + '\n\n' + escapeMd(entry.body) }).join('\n\n---\n\n')
    await window.host.files.saveText({ fileName: 'research-journal.md', content: text })
  })
  el('summary').addEventListener('click', async function () {
    var button = el('summary')
    var entries = state.entries.filter(function (entry) { return entry.date === today() })
    if (!entries.length) return toast('今天还没有可总结的记录')
    button.disabled = true; button.textContent = '总结中…'
    try {
      var permission = await window.host.requestPermission({ capability: 'ai.invoke', reason: '生成今天的科研日志总结' })
      if (!permission.granted) return toast('未获得 AI 权限')
      var content = entries.map(function (entry) { return '[' + entry.kind + '] ' + entry.title + ': ' + entry.body }).join('\n')
      if (content.length > 12_000) content = content.slice(-12_000)
      var result = await window.host.ai.chat({ messages: [{ role: 'system', content: '你是科研复盘助手。请用中文总结今天的关键进展、未解决问题和下一步行动，简洁具体。' }, { role: 'user', content: content }] })
      await addEntry('AI 日总结', '今日科研复盘', String(result))
      toast('已将 AI 总结保存到日志')
    } catch (error) { toast('AI 总结失败：' + (error.message || error)) }
    finally { button.disabled = false; button.textContent = 'AI 日总结' }
  })

  async function start() {
    try {
      var saved = await window.host.storage.get({})
      if (saved && Array.isArray(saved.entries)) state = saved
    } catch (error) { toast('读取日志失败：' + (error.message || error)) }
    render()
    onFocusDone = async function (payload) {
      var minutes = Number(payload && (payload.minutes || payload.durationMinutes)) || 0
      await addEntry('专注记录', '完成一次专注' + (minutes ? ' · ' + minutes + ' 分钟' : ''), String(payload && (payload.label || payload.task || '专注时段已完成') || '专注时段已完成'))
    }
    window.host.events.on('focus:done', onFocusDone)
  }
  window.addEventListener('host-ready', start, { once: true })
  window.addEventListener('beforeunload', function () { if (onFocusDone) window.host.events.off('focus:done', onFocusDone) }, { once: true })
})();
