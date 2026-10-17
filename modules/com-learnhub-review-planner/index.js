(function () {
  var root = document.createElement('div')
  root.id = 'app'
  document.body.appendChild(root)

  var INTERVALS = [1, 3, 7, 16, 35]
  var EVENT_COLOR = '#f5a623'
  var papers = []
  var state = { planned: [], logs: [], quizzes: {}, notifyDeclined: false }

  root.innerHTML = `
    <style>
      *{box-sizing:border-box} .wrap{padding:14px;color:var(--lh-text,#e6e9f2);font:13px/1.55 system-ui,sans-serif}
      .top{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:12px}
      h2{font-size:15px;font-weight:650;margin:0}.muted{color:var(--lh-muted,#9aa3b8);font-size:12px}
      label{display:block;margin:10px 0 4px;color:var(--lh-muted,#9aa3b8);font-size:12px}
      select{width:100%;border:1px solid var(--lh-line,#2a3145);border-radius:8px;background:var(--lh-bg,#0f1117);color:inherit;padding:8px;font:inherit}
      button{border:1px solid var(--lh-line,#2a3145);border-radius:8px;background:var(--lh-card,#1b202e);color:inherit;padding:7px 10px;cursor:pointer;font:inherit}
      button.primary{background:var(--lh-accent,#426ee8);border-color:transparent;color:white}button:disabled{opacity:.5;cursor:wait}
      .actions{display:flex;flex-wrap:wrap;gap:7px;margin-top:10px}
      .stats{display:flex;gap:8px;margin:12px 0}.stat{flex:1;border:1px solid var(--lh-line,#2a3145);border-radius:9px;padding:9px}.stat b{display:block;font-size:18px}
      .item{border:1px solid var(--lh-line,#2a3145);border-radius:9px;padding:10px;margin-top:8px}
      .item-head{display:flex;justify-content:space-between;align-items:flex-start;gap:8px}.item-head h3{font-weight:600;font-size:13px;margin:0}
      .tag{font-size:11px;color:var(--lh-muted,#9aa3b8);margin-top:2px}
      .qa{border:1px solid var(--lh-line,#2a3145);border-radius:9px;padding:10px;margin-top:8px}
      .qa .q{font-weight:600;margin:0 0 4px}.qa .a{color:var(--lh-muted,#9aa3b8);white-space:pre-wrap;overflow-wrap:anywhere;margin:0}
      .empty{border:1px dashed var(--lh-line,#2a3145);border-radius:9px;padding:18px;text-align:center;color:var(--lh-muted,#9aa3b8)}
      .section{margin-top:18px;font-weight:650}.notice{margin-top:8px;color:var(--lh-muted,#9aa3b8);font-size:12px}
    </style>
    <div class="wrap">
      <div class="top"><div><h2>复习规划</h2><div class="muted" id="today"></div></div><button id="refresh">刷新数据</button></div>
      <div class="stats">
        <div class="stat"><b id="stat-papers">0</b><span class="muted">论文总数</span></div>
        <div class="stat"><b id="stat-queue">0</b><span class="muted">今日待复习</span></div>
        <div class="stat"><b id="stat-done">0</b><span class="muted">已完成次数</span></div>
      </div>
      <div class="actions">
        <button class="primary" id="plan">生成复习计划</button>
        <button id="replan">重新规划</button>
      </div>
      <div class="notice">按每篇论文最后一次学习时间（高亮 / 问答 / 搜索记录的最新时间）生成 +1、+3、+7、+16、+35 天的复习节点，落在周末时顺延到周一，并写入日历（颜色 #f5a623）。</div>
      <div class="section">今日复习队列</div>
      <div id="queue"></div>
      <div class="section">AI 自测题</div>
      <label for="paper-select">选择论文</label>
      <select id="paper-select"></select>
      <div class="actions"><button id="quiz-btn">生成自测题</button></div>
      <div id="quiz-area"></div>
      <div class="notice">完成记录与自测题保存在本模块私有存储；AI 自测题与系统通知为可选权限，首次使用时申请。</div>
    </div>`

  var el = function (id) { return document.getElementById(id) }
  var save = async function () { await window.host.storage.set({ obj: state }) }
  var toast = function (message) { window.host.ui.toast({ text: message }) }

  function toDateStr(date) {
    var m = date.getMonth() + 1, d = date.getDate()
    return date.getFullYear() + '-' + (m < 10 ? '0' : '') + m + '-' + (d < 10 ? '0' : '') + d
  }
  function parseDate(str) {
    var parts = String(str).split('-')
    return new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]))
  }
  function addDays(dateStr, days) {
    var date = parseDate(dateStr)
    date.setDate(date.getDate() + days)
    return toDateStr(date)
  }
  function skipWeekend(dateStr) {
    var date = parseDate(dateStr), dow = date.getDay()
    if (dow === 6) date.setDate(date.getDate() + 2)
    else if (dow === 0) date.setDate(date.getDate() + 1)
    return toDateStr(date)
  }
  function diffDays(fromStr, toStr) {
    return Math.round((parseDate(toStr) - parseDate(fromStr)) / 86400000)
  }
  function intervalLabel(days) { return '+' + days + ' 天' }
  function today() { return toDateStr(new Date()) }

  function lastStudyDate(paper) {
    var times = []
    ;(paper.highlights || []).forEach(function (item) { if (item && item.createdAt) times.push(Number(item.createdAt)) })
    ;(paper.answers || []).forEach(function (item) { if (item && item.createdAt) times.push(Number(item.createdAt)) })
    ;(paper.searches || []).forEach(function (item) { if (item && item.createdAt) times.push(Number(item.createdAt)) })
    times = times.filter(function (t) { return isFinite(t) })
    var latest = times.length ? Math.max.apply(null, times) : (Number(paper.updatedAt) || Number(paper.createdAt) || Date.now())
    return toDateStr(new Date(latest))
  }
  function paperTitle(paperId) {
    for (var i = 0; i < papers.length; i++) {
      if (papers[i].id === paperId) return papers[i].title || '未命名论文'
    }
    return '（论文已删除或不可见）'
  }
  function completedMap() {
    var map = {}
    state.logs.forEach(function (log) { if (log) map[log.paperId + '|' + log.due] = true })
    return map
  }
  function currentQueue() {
    var done = completedMap(), day = today()
    return state.planned
      .filter(function (item) { return item && item.due && item.due <= day && !done[item.paperId + '|' + item.due] })
      .sort(function (a, b) { return a.due < b.due ? -1 : a.due > b.due ? 1 : 0 })
  }
  function setBusy(busy) {
    el('plan').disabled = busy
    el('replan').disabled = busy
  }

  function render() {
    el('today').textContent = today() + ' · 按艾宾浩斯遗忘曲线安排论文复习'
    el('stat-papers').textContent = String(papers.length)
    var queue = currentQueue()
    el('stat-queue').textContent = String(queue.length)
    el('stat-done').textContent = String(state.logs.length)
    renderQueue(queue)
    renderQuiz()
  }

  function renderQueue(queue) {
    var list = el('queue')
    list.replaceChildren()
    if (!queue.length) {
      var empty = document.createElement('div')
      empty.className = 'empty'
      empty.textContent = '今天没有待复习的论文。点击「生成复习计划」可按遗忘曲线安排节点。'
      list.appendChild(empty)
      return
    }
    queue.forEach(function (item) {
      var overdue = diffDays(item.due, today())
      var card = document.createElement('div')
      card.className = 'item'
      var head = document.createElement('div')
      head.className = 'item-head'
      var left = document.createElement('div')
      var title = document.createElement('h3')
      title.textContent = paperTitle(item.paperId)
      var tag = document.createElement('div')
      tag.className = 'tag'
      tag.textContent = intervalLabel(item.interval) + ' · 到期 ' + item.due + ' · ' + (overdue > 0 ? '已逾期 ' + overdue + ' 天' : '今日到期')
      left.append(title, tag)
      var done = document.createElement('button')
      done.textContent = '已复习'
      done.addEventListener('click', function () { completeItem(item) })
      head.append(left, done)
      card.appendChild(head)
      list.appendChild(card)
    })
  }

  async function completeItem(item) {
    state.logs.push({ paperId: item.paperId, due: item.due, doneAt: Date.now() })
    if (state.logs.length > 1000) state.logs = state.logs.slice(-1000)
    await save()
    render()
    toast('已记录完成，该项移出今日队列')
  }

  async function maybeNotify(count) {
    if (state.notifyDeclined) return
    try {
      var permission = await window.host.requestPermission({ capability: 'notify', reason: '在复习计划写入日历后发送系统通知提醒' })
      if (permission && permission.granted) {
        await window.host.ui.notify({ title: '复习规划', body: '已写入 ' + count + ' 个复习节点到日历' })
      } else {
        state.notifyDeclined = true
        await save()
      }
    } catch (error) { }
  }

  async function generatePlan(replan) {
    if (!papers.length) return toast('还没有论文数据，先在阅读器中添加文献')
    setBusy(true)
    var writtenCount = 0
    try {
      if (replan) {
        var ids = state.planned.map(function (item) { return item && item.eventId }).filter(Boolean)
        for (var i = 0; i < ids.length; i++) {
          try { await window.host.calendar.removeEvents({ filter: { id: ids[i] } }) } catch (error) { }
        }
        state.planned = []
      }
      var planned = {}, done = completedMap(), seen = {}
      state.planned.forEach(function (item) { if (item) planned[item.paperId + '|' + item.due] = true })
      var requests = []
      papers.forEach(function (paper) {
        var base = lastStudyDate(paper)
        INTERVALS.forEach(function (n) {
          var due = skipWeekend(addDays(base, n))
          var key = paper.id + '|' + due
          if (planned[key] || done[key] || seen[key]) return
          seen[key] = true
          requests.push({ paperId: paper.id, title: '复习：《' + (paper.title || '未命名论文') + '》', date: due, interval: n })
        })
      })
      if (!requests.length) {
        await save()
        render()
        toast(replan ? '重新规划完成，没有需要写入的新节点' : '所有复习节点都已在计划中或已完成')
        return
      }
      var written = await window.host.calendar.addEvents({
        events: requests.map(function (request) { return { title: request.title, date: request.date, color: EVENT_COLOR } })
      })
      var list = Array.isArray(written) ? written : []
      var used = {}
      list.forEach(function (event, index) {
        var target = -1
        if (index < requests.length && !used[index] && requests[index].title === event.title && requests[index].date === event.date) target = index
        if (target < 0) {
          for (var j = 0; j < requests.length; j++) {
            if (!used[j] && requests[j].title === event.title && requests[j].date === event.date) { target = j; break }
          }
        }
        if (target >= 0) {
          used[target] = true
          state.planned.push({ paperId: requests[target].paperId, due: requests[target].date, interval: requests[target].interval, eventId: event.id })
        }
      })
      writtenCount = list.length
      await save()
      render()
      toast('已写入 ' + list.length + ' 个复习节点到日历')
    } catch (error) {
      toast('生成复习计划失败：' + (error.message || error))
    } finally {
      setBusy(false)
    }
    if (writtenCount > 0) await maybeNotify(writtenCount)
  }

  function buildQuizContent(paper) {
    var parts = []
    ;(paper.highlights || []).forEach(function (h) {
      if (h && h.text) parts.push('【高亮 第' + h.page + '页】' + h.text + (h.note ? '（批注：' + h.note + '）' : ''))
    })
    ;(paper.answers || []).forEach(function (a) {
      if (a) parts.push('【问答】问：' + (a.question || '') + '；引文：' + (a.quote || ''))
    })
    if (!parts.length) return ''
    var content = '论文标题：' + (paper.title || '未命名') + '\n' + parts.join('\n')
    return content.length > 8000 ? content.slice(0, 8000) : content
  }

  function parseQuiz(text) {
    var items = []
    var match = text.match(/\[[\s\S]*\]/)
    if (match) {
      try {
        var arr = JSON.parse(match[0])
        if (Array.isArray(arr)) {
          arr.forEach(function (item) {
            var question = item && (item.question || item.q)
            if (!question) return
            items.push({ question: String(question).trim(), answer: String((item.answer || item.a) || '').trim() })
          })
        }
      } catch (error) { }
    }
    if (!items.length) {
      var current = null
      text.split(/\r?\n/).forEach(function (line) {
        var q = line.match(/^\s*(?:问题\s*\d*[：:]|Q\d*[：:])\s*(.+)$/i)
        var a = line.match(/^\s*(?:答案\s*\d*[：:]|A\d*[：:])\s*(.+)$/i)
        if (q) {
          if (current) items.push(current)
          current = { question: q[1].trim(), answer: '' }
        } else if (a && current) {
          current.answer = a[1].trim()
        }
      })
      if (current) items.push(current)
    }
    if (!items.length) items = [{ question: 'AI 返回内容未能解析为问答，原文如下', answer: text.slice(0, 1200) }]
    return items.slice(0, 5)
  }

  function renderQuiz() {
    var select = el('paper-select')
    var current = select.value
    select.replaceChildren()
    var placeholder = document.createElement('option')
    placeholder.value = ''
    placeholder.textContent = papers.length ? '选择论文…' : '暂无论文'
    select.appendChild(placeholder)
    papers.forEach(function (paper) {
      var option = document.createElement('option')
      option.value = paper.id
      option.textContent = paper.title || '未命名论文'
      select.appendChild(option)
    })
    var exists = false
    for (var i = 0; i < papers.length; i++) {
      if (papers[i].id === current) { exists = true; break }
    }
    select.value = exists ? current : ''
    var area = el('quiz-area')
    area.replaceChildren()
    var quiz = select.value ? state.quizzes[select.value] : null
    if (!quiz || !Array.isArray(quiz.items) || !quiz.items.length) {
      var hint = document.createElement('div')
      hint.className = 'empty'
      hint.textContent = papers.length ? '选择论文后点击「生成自测题」，将基于该论文的高亮与问答内容出 5 道问答。' : '导入论文并添加高亮后即可生成自测题。'
      area.appendChild(hint)
      return
    }
    var head = document.createElement('div')
    head.className = 'muted'
    head.style.marginTop = '6px'
    head.textContent = '最近一份自测题 · 生成于 ' + new Date(quiz.createdAt).toLocaleString()
    area.appendChild(head)
    quiz.items.forEach(function (item, index) {
      var card = document.createElement('div')
      card.className = 'qa'
      var q = document.createElement('p')
      q.className = 'q'
      q.textContent = (index + 1) + '. ' + item.question
      var a = document.createElement('p')
      a.className = 'a'
      a.textContent = item.answer ? '参考答案：' + item.answer : '（无参考答案）'
      card.append(q, a)
      area.appendChild(card)
    })
  }

  async function loadPapers() {
    try {
      var list = await window.host.data.papers.list({})
      papers = Array.isArray(list) ? list : []
    } catch (error) {
      toast('读取论文失败：' + (error.message || error))
      papers = []
    }
  }

  el('plan').addEventListener('click', function () { generatePlan(false) })
  el('replan').addEventListener('click', function () { generatePlan(true) })
  el('refresh').addEventListener('click', async function () {
    await loadPapers()
    render()
    toast('数据已刷新')
  })
  el('paper-select').addEventListener('change', renderQuiz)
  el('quiz-btn').addEventListener('click', async function () {
    var button = el('quiz-btn')
    var paperId = el('paper-select').value
    var paper = null
    for (var i = 0; i < papers.length; i++) {
      if (papers[i].id === paperId) { paper = papers[i]; break }
    }
    if (!paper) return toast('请先选择一篇论文')
    var content = buildQuizContent(paper)
    if (!content) return toast('该论文还没有高亮或问答内容，无法出题')
    button.disabled = true
    button.textContent = '生成中…'
    try {
      var permission = await window.host.requestPermission({ capability: 'ai.invoke', reason: '基于论文高亮与问答生成 5 道自测题' })
      if (!permission || !permission.granted) return toast('未获得 AI 权限')
      var result = await window.host.ai.chat({
        messages: [
          { role: 'system', content: '你是论文自测题生成助手。依据用户提供的论文标题、高亮摘录与问答内容出 5 道复习自测题。只输出 JSON 数组，格式为 [{"question":"问题","answer":"参考答案"}]，不要输出其他文字或代码块标记。问题应覆盖核心概念、方法与结论，答案基于给定内容、简洁准确。' },
          { role: 'user', content: content }
        ],
        temperature: 0.4
      })
      var items = parseQuiz(String(result))
      state.quizzes[paper.id] = { items: items, createdAt: Date.now() }
      await save()
      renderQuiz()
      toast('已生成 ' + items.length + ' 道自测题')
    } catch (error) {
      toast('生成自测题失败：' + (error.message || error))
    } finally {
      button.disabled = false
      button.textContent = '生成自测题'
    }
  })

  async function start() {
    try {
      var saved = await window.host.storage.get({})
      if (saved && typeof saved === 'object') {
        state = {
          planned: Array.isArray(saved.planned) ? saved.planned : [],
          logs: Array.isArray(saved.logs) ? saved.logs : [],
          quizzes: saved.quizzes && typeof saved.quizzes === 'object' ? saved.quizzes : {},
          notifyDeclined: saved.notifyDeclined === true
        }
      }
    } catch (error) {
      toast('读取复习记录失败：' + (error.message || error))
    }
    await loadPapers()
    render()
  }

  window.addEventListener('host-ready', start, { once: true })
})();
