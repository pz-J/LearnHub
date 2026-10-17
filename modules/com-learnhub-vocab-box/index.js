/* LearnHub 生词本模块（沙箱运行，纯 JS 单文件）
 * 在阅读器选中文本后一键收词，并在原文打紫色高亮（#9d6bff）。
 * 支持搜索过滤、删除、点击跳转、AI 解释（可选权限）、备注（自动保存）、
 * 导出 CSV 与复制全部（可选权限）。数据保存在本模块私有存储中。
 */
(function () {
  var root = document.createElement('div')
  root.id = 'app'
  document.body.appendChild(root)

  var BUTTON_ID = 'save-term'
  var VOCAB_COLOR = '#9d6bff'
  var TERM_MAX = 200
  var state = { terms: [] }
  var myId = ''
  var currentPaperId = null
  var openNoteId = null
  var busyAiId = null
  var busyCollect = false
  var saveTimer = null

  root.innerHTML = `
    <style>
      *{box-sizing:border-box} .wrap{padding:14px;color:var(--lh-text,#e6e9f2);font:13px/1.55 system-ui,sans-serif}
      .top{display:flex;align-items:flex-start;justify-content:space-between;gap:8px;margin-bottom:12px;flex-wrap:wrap}
      h2{font-size:15px;font-weight:650;margin:0}.muted{color:var(--lh-muted,#9aa3b8);font-size:12px}
      label{display:block;margin:10px 0 4px;color:var(--lh-muted,#9aa3b8);font-size:12px}
      input,textarea{width:100%;border:1px solid var(--lh-line,#2a3145);border-radius:8px;background:var(--lh-bg,#0f1117);color:inherit;padding:8px;font:inherit}
      textarea{min-height:64px;resize:vertical} button{border:1px solid var(--lh-line,#2a3145);border-radius:8px;background:var(--lh-card,#1b202e);color:inherit;padding:7px 10px;cursor:pointer;font:inherit}
      button.primary{background:var(--lh-accent,#426ee8);border-color:transparent;color:white}button:disabled{opacity:.5;cursor:wait}
      .toolbar{display:flex;flex-wrap:wrap;gap:7px}.actions{display:flex;flex-wrap:wrap;gap:7px;margin-top:10px}
      .entry{border:1px solid var(--lh-line,#2a3145);border-radius:9px;padding:10px;margin-top:8px}.entry-head{display:flex;justify-content:space-between;gap:8px;align-items:baseline}
      .entry h3{font-weight:600;font-size:13px;margin:0}h3.term{cursor:pointer}h3.term:hover{color:var(--lh-accent,#426ee8);text-decoration:underline}
      .tag{font-size:11px;color:var(--lh-muted,#9aa3b8);white-space:nowrap}.body{white-space:pre-wrap;overflow-wrap:anywhere;margin-top:6px;color:var(--lh-muted,#9aa3b8)}
      .detail{margin-top:8px}.empty{border:1px dashed var(--lh-line,#2a3145);border-radius:9px;padding:18px;text-align:center;color:var(--lh-muted,#9aa3b8)}
      .notice{margin-top:12px;color:var(--lh-muted,#9aa3b8);font-size:12px}
    </style>
    <div class="wrap">
      <div class="top"><div><h2>生词本</h2><div class="muted" id="count">正在加载…</div></div><button id="collect" class="primary" type="button">收词（当前选区）</button></div>
      <div class="toolbar"><button id="export" type="button">导出 CSV</button><button id="copy" type="button">复制全部</button></div>
      <label for="filter">筛选生词</label><input id="filter" placeholder="搜索生词、论文、备注或解释" />
      <div id="list"></div>
      <div class="notice">在阅读器选中文本后，点浮动工具条「收入生词本」收录并在原文打紫色标记。数据保存在本模块私有存储中；AI 解释与复制全部需单独授权。</div>
    </div>`

  var el = function (id) { return document.getElementById(id) }
  var save = async function () { await window.host.storage.set({ obj: state }) }
  var toast = function (message) { window.host.ui.toast({ text: message }) }
  var uid = function () { return 'v_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7) }
  var fmtTime = function (ts) { return new Date(ts).toLocaleString([], { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) }
  var abbr = function (value) { var s = String(value || ''); return s.length > 18 ? s.slice(0, 18) + '…' : s }
  var cleanTerm = function (raw) { return String(raw || '').replace(/\s+/g, ' ').trim().slice(0, TERM_MAX) }
  var paperLabel = function (term) { return term.paperTitle || term.paperId || '未知论文' }
  var byTimeDesc = function (a, b) { return b.createdAt - a.createdAt }

  function render() {
    el('count').textContent = '共 ' + state.terms.length + ' 个生词'
    var query = el('filter').value.trim().toLowerCase()
    var listBox = el('list')
    listBox.replaceChildren()
    var filtered = state.terms.filter(function (term) {
      if (!query) return true
      return ((term.term || '') + ' ' + (term.paperTitle || '') + ' ' + (term.paperId || '') + ' ' + (term.note || '') + ' ' + (term.explain || '')).toLowerCase().indexOf(query) >= 0
    }).slice().sort(byTimeDesc)
    if (!filtered.length) {
      var empty = document.createElement('div'); empty.className = 'empty'
      empty.textContent = query ? '没有匹配的生词。' : '还没有生词。在阅读器中选中文本，点浮动工具条「收入生词本」。'
      listBox.appendChild(empty)
      return
    }
    filtered.forEach(function (term) { listBox.appendChild(termCard(term)) })
  }

  function termCard(term) {
    var card = document.createElement('article'); card.className = 'entry'
    var head = document.createElement('div'); head.className = 'entry-head'
    var termEl = document.createElement('h3'); termEl.className = 'term'; termEl.textContent = term.term
    termEl.title = '点击跳转：在搜索链路中定位该生词'
    termEl.addEventListener('click', function () { jumpToTerm(term) })
    var tag = document.createElement('span'); tag.className = 'tag'
    tag.textContent = abbr(paperLabel(term)) + (term.page != null ? ' · p.' + term.page : '') + ' · ' + fmtTime(term.createdAt)
    head.append(termEl, tag); card.appendChild(head)
    if (term.explain) {
      var explain = document.createElement('div'); explain.className = 'body'; explain.textContent = term.explain
      card.appendChild(explain)
    }
    var actions = document.createElement('div'); actions.className = 'actions'
    var ai = document.createElement('button'); ai.type = 'button'; ai.textContent = term.explain ? '重新解释' : 'AI 解释'
    if (busyAiId === term.id) { ai.disabled = true; ai.textContent = '解释中…' }
    ai.addEventListener('click', function () { explainTerm(term) })
    var noteBtn = document.createElement('button'); noteBtn.type = 'button'; noteBtn.textContent = term.note ? '编辑备注' : '备注'
    noteBtn.addEventListener('click', function () { openNoteId = openNoteId === term.id ? null : term.id; render(); focusNote(term.id) })
    var remove = document.createElement('button'); remove.type = 'button'; remove.textContent = '删除'
    remove.addEventListener('click', async function () {
      state.terms = state.terms.filter(function (x) { return x.id !== term.id })
      if (openNoteId === term.id) openNoteId = null
      await save(); render(); toast('已删除生词')
    })
    actions.append(ai, noteBtn, remove); card.appendChild(actions)
    if (openNoteId === term.id) card.appendChild(noteEditor(term))
    return card
  }

  function noteEditor(term) {
    var box = document.createElement('div'); box.className = 'detail'
    var area = document.createElement('textarea')
    area.dataset.note = term.id
    area.value = term.note || ''
    area.placeholder = '记录这条生词的笔记（自动保存）'
    area.addEventListener('input', function () {
      term.note = area.value
      if (saveTimer) clearTimeout(saveTimer)
      saveTimer = setTimeout(function () { save() }, 400)
    })
    area.addEventListener('blur', function () {
      if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; save() }
    })
    box.appendChild(area)
    return box
  }

  function focusNote(termId) {
    var area = document.querySelector('textarea[data-note="' + termId + '"]')
    if (area) area.focus()
  }

  function jumpToTerm(term) {
    try {
      window.events.emit('search:open', { text: term.term, paperId: term.paperId })
    } catch (error) { toast('跳转失败：' + (error.message || error)) }
  }

  async function fetchTitle(paperId) {
    try {
      var paper = await window.host.data.papers.get({ paperId: paperId })
      if (paper && paper.title) return String(paper.title)
    } catch (error) { /* 无 storage.data 权限或论文不存在时静默降级为 paperId */ }
    return ''
  }

  /** 面板打开 / 打开新论文时刷新词条的论文标题信息（尽力而为） */
  async function refreshTitles() {
    var ids = {}
    state.terms.forEach(function (term) { if (term.paperId && !term.paperTitle) ids[term.paperId] = true })
    var changed = false
    for (var paperId in ids) {
      var title = await fetchTitle(paperId)
      if (title) {
        changed = true
        state.terms.forEach(function (term) { if (term.paperId === paperId) term.paperTitle = title })
      }
    }
    if (changed) { await save(); render() }
  }

  /** 收词主流程：去重 → 取选区 → 打紫色高亮 → 存入私有存储 */
  async function collectTerm(rawText, paperId, selectionPre) {
    var termText = cleanTerm(rawText)
    if (!termText) return toast('选区内容为空，未收录')
    if (!paperId) return toast('未获取到论文信息，未收录')
    paperId = String(paperId)
    var existing = state.terms.find(function (term) { return term.paperId === paperId && term.term === termText })
    if (existing) {
      existing.createdAt = Date.now()
      await save(); render()
      return toast('该生词已在生词本中，已更新收录时间')
    }
    var selection = selectionPre || null
    if (!selection) {
      try { selection = await window.host.reader.getSelection({}) } catch (error) { selection = null }
    }
    var term = { id: uid(), term: termText, paperId: paperId, createdAt: Date.now() }
    var title = await fetchTitle(paperId)
    if (title) term.paperTitle = title
    if (selection && typeof selection.page === 'number' && isFinite(selection.page) && Array.isArray(selection.rects) && selection.rects.length) {
      term.page = selection.page
      try {
        var added = await window.host.reader.addHighlight({
          paperId: paperId,
          highlight: { page: selection.page, rects: selection.rects, text: termText, color: VOCAB_COLOR }
        })
        if (added && added.id) term.highlightId = added.id
      } catch (error) { toast('原文标注失败：' + (error.message || error)) }
    }
    state.terms.push(term)
    await save(); render()
    toast('已收入生词本' + (term.page != null ? '（第 ' + term.page + ' 页）' : ''))
  }

  /** 面板内手动收词（工具条按钮之外的后备入口） */
  async function collectCurrent() {
    if (busyCollect) return
    busyCollect = true
    var button = el('collect')
    button.disabled = true
    try {
      var selection = await window.host.reader.getSelection({})
      if (!selection || !cleanTerm(selection.text)) { toast('阅读器中当前没有选中文本'); return }
      if (!currentPaperId) { toast('未获取到当前论文，请先在阅读器打开论文'); return }
      await collectTerm(selection.text, currentPaperId, selection)
    } catch (error) { toast('收词失败：' + (error.message || error)) }
    finally { busyCollect = false; button.disabled = false }
  }

  /** 阅读器浮动工具条按钮点击（宿主广播） */
  function onToolbarClick(payload) {
    var p = payload || {}
    if (p.id !== BUTTON_ID) return
    if (p.moduleId && myId && p.moduleId !== myId) return
    if (p.paperId) currentPaperId = String(p.paperId)
    collectTerm(p.text, p.paperId || currentPaperId, null)
  }

  function onPaperOpened(payload) {
    var p = payload || {}
    if (p && p.paperId) {
      currentPaperId = String(p.paperId)
      refreshTitles()
    }
  }

  async function explainTerm(term) {
    if (busyAiId) return
    busyAiId = term.id
    render()
    try {
      var permission = await window.host.requestPermission({ capability: 'ai.invoke', reason: '为生词生成中文释义、语境含义与例句' })
      if (!permission.granted) { toast('未获得 AI 权限'); return }
      var context = '生词：' + term.term
      context += '\n出处：' + paperLabel(term) + (term.page != null ? '（第 ' + term.page + ' 页）' : '')
      if (term.note) context += '\n我的笔记：' + term.note
      var result = await window.host.ai.chat({
        messages: [
          { role: 'system', content: '你是学术阅读助手。请用中文回答，按三部分依次输出：1. 释义；2. 语境含义（结合出处）；3. 一个例句。简洁准确。' },
          { role: 'user', content: context }
        ]
      })
      var explain = String(result || '').trim()
      if (!explain) { toast('AI 未返回内容'); return }
      term.explain = explain
      await save(); toast('已生成 AI 解释')
    } catch (error) { toast('AI 解释失败：' + (error.message || error)) }
    finally { busyAiId = null; render() }
  }

  function csvCell(value) { return '"' + String(value == null ? '' : value).replace(/"/g, '""') + '"' }

  el('collect').addEventListener('click', collectCurrent)
  el('filter').addEventListener('input', render)
  el('export').addEventListener('click', async function () {
    if (!state.terms.length) return toast('生词本为空，无可导出内容')
    try {
      var rows = state.terms.slice().sort(byTimeDesc).map(function (term) {
        return [term.term, term.explain || '', term.note || '', paperLabel(term), term.page == null ? '' : term.page, new Date(term.createdAt).toISOString()].map(csvCell).join(',')
      })
      var content = '\uFEFFterm,explain,note,paperTitle,page,createdAt\r\n' + rows.join('\r\n')
      await window.host.files.saveText({ fileName: 'vocab-box.csv', content: content })
      toast('已导出 ' + state.terms.length + ' 条生词')
    } catch (error) { toast('导出失败：' + (error.message || error)) }
  })
  el('copy').addEventListener('click', async function () {
    if (!state.terms.length) return toast('生词本为空')
    try {
      var permission = await window.host.requestPermission({ capability: 'clipboard', reason: '将生词本全部内容复制到剪贴板' })
      if (!permission.granted) return toast('未获得剪贴板权限')
      var text = state.terms.slice().sort(byTimeDesc).map(function (term) {
        var line = term.term
        if (term.explain) line += '\n解释：' + term.explain
        if (term.note) line += '\n备注：' + term.note
        line += '\n出处：' + paperLabel(term) + (term.page != null ? ' · 第 ' + term.page + ' 页' : '')
        return line
      }).join('\n\n')
      await window.host.clipboard.write({ text: text })
      toast('已复制 ' + state.terms.length + ' 条生词')
    } catch (error) { toast('复制失败：' + (error.message || error)) }
  })

  async function start() {
    try { myId = (window.host.manifest && window.host.manifest.id) || '' } catch (error) { myId = '' }
    try {
      var saved = await window.host.storage.get({})
      if (saved && Array.isArray(saved.terms)) state = saved
      if (!Array.isArray(state.terms)) state.terms = []
    } catch (error) { toast('读取生词本失败：' + (error.message || error)) }
    render()
    try {
      await window.host.reader.registerToolbarButton({ id: BUTTON_ID, title: '收入生词本' })
    } catch (error) { toast('注册阅读器按钮失败：' + (error.message || error)) }
    window.events.on('reader:toolbar-click', onToolbarClick)
    window.events.on('reader:paper-opened', onPaperOpened)
    refreshTitles()
  }

  window.addEventListener('host-ready', start, { once: true })
  window.addEventListener('beforeunload', function () {
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null }
    window.events.off('reader:toolbar-click', onToolbarClick)
    window.events.off('reader:paper-opened', onPaperOpened)
  }, { once: true })
})();
