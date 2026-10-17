(function () {
  var root = document.createElement('div')
  root.id = 'app'
  document.body.appendChild(root)

  var state = { guides: {}, history: {} }
  var papers = []
  var generating = false
  var current = null
  var notifyAsked = false
  var notifyGranted = false

  var SYSTEM_PROMPT = [
    '你是论文精读向导，帮助研究者基于自己的阅读标记深入理解一篇论文。',
    '请用中文输出结构化 Markdown 导读，必须包含以下六个小节，标题与顺序保持一致：',
    '## 研究问题',
    '## 方法要点',
    '## 主要结论',
    '## 术语速查',
    '## 疑点与追问',
    '## 与我标记的联系',
    '写作要求：每个小节用简洁要点；术语速查以「术语：一句话解释」列出关键术语；疑点与追问给出值得进一步验证或追问的问题；与我标记的联系需引用用户标记的原文，说明它在全文论证中的作用；严格基于给定的标记与问答材料，不要编造论文中不存在的内容。'
  ].join('\n')

  root.innerHTML = `
    <style>
      *{box-sizing:border-box}
      .wrap{padding:14px;color:var(--lh-text,#e6e9f2);font:13px/1.55 system-ui,sans-serif}
      .top{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:12px}
      h2{font-size:15px;font-weight:650;margin:0}.muted{color:var(--lh-muted,#9aa3b8);font-size:12px}
      label{display:block;margin:10px 0 4px;color:var(--lh-muted,#9aa3b8);font-size:12px}
      select{width:100%;border:1px solid var(--lh-line,#2a3145);border-radius:8px;background:var(--lh-bg,#0f1117);color:inherit;padding:8px;font:inherit}
      button{border:1px solid var(--lh-line,#2a3145);border-radius:8px;background:var(--lh-card,#1b202e);color:inherit;padding:7px 10px;cursor:pointer;font:inherit}
      button.primary{background:var(--lh-accent,#426ee8);border-color:transparent;color:white}button:disabled{opacity:.5;cursor:wait}
      .actions{display:flex;flex-wrap:wrap;gap:7px;margin-top:10px}
      .entry,.item{border:1px solid var(--lh-line,#2a3145);border-radius:9px;padding:10px;margin-top:8px}
      .entry-head{display:flex;justify-content:space-between;gap:8px;align-items:center}
      .entry h3,.item h3{font-weight:600;font-size:13px;margin:0}
      .tag{font-size:11px;color:var(--lh-muted,#9aa3b8);white-space:nowrap}
      pre{white-space:pre-wrap;overflow-wrap:anywhere;margin:8px 0 0;font:12px/1.6 ui-monospace,Consolas,monospace;color:var(--lh-text,#e6e9f2);max-height:420px;overflow:auto;background:var(--lh-bg,#0f1117);border:1px solid var(--lh-line,#2a3145);border-radius:8px;padding:10px}
      .empty{border:1px dashed var(--lh-line,#2a3145);border-radius:9px;padding:18px;text-align:center;color:var(--lh-muted,#9aa3b8)}
      .section{margin-top:18px;font-weight:650}
      .hint{margin-top:8px;font-size:12px;color:var(--lh-muted,#9aa3b8)}
      .notice{margin-top:8px;color:var(--lh-muted,#9aa3b8);font-size:12px}
    </style>
    <div class="wrap">
      <div class="top"><div><h2>精读向导</h2><div class="muted">基于论文标记与问答，生成结构化精读导读</div></div><button id="reload" type="button">刷新论文</button></div>
      <label for="paper">选择论文</label><select id="paper"></select>
      <div class="actions"><button id="generate" class="primary" type="button">生成本文导读</button></div>
      <div class="hint" id="hint"></div>
      <div id="live" style="display:none"><div class="entry">
        <div class="entry-head"><h3 id="live-title"></h3><span class="tag">流式输出 · 自动滚动</span></div>
        <pre id="live-pre">生成中…</pre>
      </div></div>
      <div id="latest-wrap" style="display:none">
        <div class="section">最新导读</div>
        <div class="entry">
          <div class="entry-head"><h3 id="latest-title"></h3><span class="tag" id="latest-tag"></span></div>
          <pre id="latest-pre"></pre>
          <div class="actions"><button id="save-note" class="primary" type="button">存为笔记</button></div>
        </div>
      </div>
      <div class="section">历史导读</div>
      <div id="history"></div>
      <div class="notice">导读与历史保存在本模块私有存储中，每篇论文保留最新一份与最近 5 份历史。AI 调用使用应用「设置」中的全局 AI 配置。</div>
    </div>`

  var el = function (id) { return document.getElementById(id) }
  var toast = function (message) { window.host.ui.toast({ text: message }) }
  var save = function () { return window.host.storage.set({ obj: state }) }
  var paperTitle = function (paper) { return (paper && paper.title) || '未命名论文' }

  function selectedPaper() {
    var id = el('paper').value
    return papers.find(function (paper) { return paper.id === id }) || null
  }

  async function loadPapers() {
    var result = await window.host.data.papers.list({})
    return Array.isArray(result) ? result : []
  }

  function renderPapers() {
    var select = el('paper')
    var previous = select.value
    select.replaceChildren()
    if (!papers.length) {
      var option = document.createElement('option')
      option.value = ''
      option.textContent = '暂无论文，请先在文献库导入'
      select.appendChild(option)
      return
    }
    papers.forEach(function (paper) {
      var option = document.createElement('option')
      option.value = paper.id
      option.textContent = paperTitle(paper) + '（' + (paper.highlights || []).length + ' 条标记）'
      select.appendChild(option)
    })
    var keep = papers.some(function (paper) { return paper.id === previous })
    select.value = keep ? previous : papers[0].id
  }

  function renderLatest() {
    var paper = selectedPaper()
    var guide = paper ? state.guides[paper.id] : null
    var wrap = el('latest-wrap')
    if (!guide || !guide.content) { wrap.style.display = 'none'; return }
    wrap.style.display = ''
    el('latest-title').textContent = '导读：《' + paperTitle(paper) + '》'
    el('latest-tag').textContent = new Date(guide.createdAt).toLocaleString()
    el('latest-pre').textContent = guide.content
  }

  function renderHistory() {
    var list = el('history')
    list.replaceChildren()
    var paper = selectedPaper()
    var items = (paper && state.history[paper.id]) || []
    if (!items.length) {
      var empty = document.createElement('div')
      empty.className = 'empty'
      empty.textContent = paper ? '该论文还没有历史导读，点击「生成本文导读」开始。' : '选择论文后查看导读历史。'
      list.appendChild(empty)
      return
    }
    items.forEach(function (item, index) {
      var card = document.createElement('div')
      card.className = 'item'
      var head = document.createElement('div')
      head.className = 'entry-head'
      var title = document.createElement('h3')
      title.textContent = '第 ' + (items.length - index) + ' 次生成'
      var tag = document.createElement('span')
      tag.className = 'tag'
      tag.textContent = new Date(item.createdAt).toLocaleString()
      head.append(title, tag)
      var pre = document.createElement('pre')
      pre.textContent = item.content
      pre.style.display = 'none'
      var actions = document.createElement('div')
      actions.className = 'actions'
      var view = document.createElement('button')
      view.type = 'button'
      view.textContent = '回看'
      view.addEventListener('click', function () {
        var open = pre.style.display !== 'none'
        pre.style.display = open ? 'none' : ''
        view.textContent = open ? '回看' : '收起'
      })
      var remove = document.createElement('button')
      remove.type = 'button'
      remove.textContent = '删除'
      remove.addEventListener('click', async function () {
        state.history[paper.id] = (state.history[paper.id] || []).filter(function (x) { return x !== item })
        await save()
        renderHistory()
        toast('已删除该份历史导读')
      })
      actions.append(view, remove)
      card.append(head, pre, actions)
      list.appendChild(card)
    })
  }

  function renderAll() { renderPapers(); renderLatest(); renderHistory() }

  function trimStorage() {
    var budget = 500000
    var serialized = JSON.stringify(state)
    while (serialized.length > budget) {
      var oldestPaper = null
      var oldestTime = Infinity
      Object.keys(state.history).forEach(function (paperId) {
        var arr = state.history[paperId]
        if (!arr.length) return
        var last = arr[arr.length - 1]
        if (last.createdAt < oldestTime) { oldestTime = last.createdAt; oldestPaper = paperId }
      })
      if (!oldestPaper) break
      state.history[oldestPaper].pop()
      serialized = JSON.stringify(state)
    }
  }

  function buildContext(paper) {
    var head = '论文标题：' + paperTitle(paper)
    var meta = paper.meta || {}
    if (meta.authors) head += '\n作者：' + (Array.isArray(meta.authors) ? meta.authors.join(', ') : String(meta.authors))
    if (meta.year) head += '\n年份：' + String(meta.year)
    if (meta.venue) head += '\n发表处：' + String(meta.venue)
    var marks = (paper.highlights || []).map(function (highlight, index) {
      var page = highlight.page == null ? '?' : highlight.page
      return (index + 1) + '. [第' + page + '页] ' + String(highlight.text || '').trim()
    })
    var answers = (paper.answers || []).map(function (answer, index) {
      var line = (index + 1) + '. 问：' + String(answer.question || '').trim()
      if (answer.quote) line += '\n   引用：' + String(answer.quote).trim()
      if (answer.source) line += '\n   来源：' + String(answer.source).trim()
      return line
    })
    var blocks = [head, '以下是我在阅读器中对这篇论文做的全部标记（高亮原文）：\n' + marks.join('\n')]
    if (answers.length) blocks.push('以下是我在阅读中已有的问答记录：\n' + answers.join('\n'))
    var context = blocks.join('\n\n')
    if (context.length > 10000) context = context.slice(0, 9993) + '\n…（已截断）'
    return context
  }

  function onChunk(event) {
    if (!generating || !current) return
    var data = event && (event.payload || event)
    if (!data || data.reqId !== current.reqId || !data.delta) return
    var pre = el('live-pre')
    if (!current.received) { pre.textContent = ''; current.received = true }
    pre.textContent += data.delta
    pre.scrollTop = pre.scrollHeight
  }

  async function notifyOnce(title, body) {
    if (notifyGranted) {
      try { await window.host.ui.notify({ title: title, body: body }) } catch (error) { }
      return
    }
    if (notifyAsked) return
    notifyAsked = true
    try {
      var permission = await window.host.requestPermission({ capability: 'notify', reason: '导读生成或保存完成后发送系统通知' })
      if (permission && permission.granted) {
        notifyGranted = true
        try { await window.host.ui.notify({ title: title, body: body }) } catch (error) { }
      }
    } catch (error) { }
  }

  el('paper').addEventListener('change', function () {
    el('hint').textContent = ''
    renderLatest()
    renderHistory()
  })

  el('reload').addEventListener('click', async function () {
    try {
      papers = await loadPapers()
      renderAll()
      toast('已刷新论文列表')
    } catch (error) { toast('刷新论文失败：' + (error.message || error)) }
  })

  el('generate').addEventListener('click', async function () {
    if (generating) return
    var paper = selectedPaper()
    if (!paper) return toast('请先选择一篇论文')
    if (!(paper.highlights || []).length) return toast('这篇论文还没有标记，请先到阅读器中做高亮标记，再回来生成导读')
    generating = true
    var button = el('generate')
    button.disabled = true
    button.textContent = '生成中…'
    el('hint').textContent = ''
    var live = el('live')
    var pre = el('live-pre')
    live.style.display = ''
    el('live-title').textContent = '正在生成导读：《' + paperTitle(paper) + '》'
    pre.textContent = '生成中…'
    var reqId = 'pg_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7)
    current = { reqId: reqId, received: false }
    try {
      var result = await window.host.ai.chat({
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: buildContext(paper) }
        ],
        temperature: 0.4,
        reqId: reqId
      })
      var content = String(result || '').trim()
      if (!content) throw new Error('AI 返回了空内容')
      var entry = { content: content, createdAt: Date.now() }
      state.guides[paper.id] = entry
      var history = (state.history[paper.id] || []).slice()
      history.unshift(entry)
      state.history[paper.id] = history.slice(0, 5)
      trimStorage()
      await save()
      live.style.display = 'none'
      el('hint').textContent = '导读生成完成，已保存为该论文的最新导读与历史记录。'
      renderLatest()
      renderHistory()
      toast('导读生成完成')
      notifyOnce('精读向导', '《' + paperTitle(paper) + '》的导读已生成完成')
    } catch (error) {
      live.style.display = 'none'
      el('hint').textContent = '生成失败：' + (error.message || error) + '。若提示未配置或鉴权失败，请先到应用「设置」页配置 AI 服务（API Key 与模型），再回来重试。'
      toast('导读生成失败，请检查 AI 配置')
    } finally {
      generating = false
      current = null
      button.disabled = false
      button.textContent = '生成本文导读'
    }
  })

  el('save-note').addEventListener('click', async function () {
    var paper = selectedPaper()
    var guide = paper ? state.guides[paper.id] : null
    if (!guide || !guide.content) return toast('还没有可保存的导读')
    var button = el('save-note')
    button.disabled = true
    try {
      await window.host.data.notes.write({
        id: null,
        patch: { title: '导读：《' + paperTitle(paper) + '》', body: guide.content, paperId: paper.id }
      })
      toast('导读已存为笔记')
      notifyOnce('精读向导', '《' + paperTitle(paper) + '》的导读已写入笔记库')
    } catch (error) {
      toast('存为笔记失败：' + (error.message || error))
    } finally {
      button.disabled = false
    }
  })

  var bus = null
  function onBeforeUnload() { if (bus && bus.off) bus.off('ai:chunk', onChunk) }

  async function start() {
    try {
      var saved = await window.host.storage.get({})
      if (saved && typeof saved === 'object') {
        state.guides = saved.guides && typeof saved.guides === 'object' ? saved.guides : {}
        state.history = saved.history && typeof saved.history === 'object' ? saved.history : {}
      }
    } catch (error) { toast('读取历史导读失败：' + (error.message || error)) }
    try {
      papers = await loadPapers()
    } catch (error) { toast('读取论文列表失败：' + (error.message || error)) }
    renderAll()
    bus = window.events || (window.host && window.host.events)
    if (bus && typeof bus.on === 'function') {
      bus.on('ai:chunk', onChunk)
      window.addEventListener('beforeunload', onBeforeUnload, { once: true })
    }
  }

  window.addEventListener('host-ready', start, { once: true })
})();
