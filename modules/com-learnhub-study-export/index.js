(function () {
  var root = document.createElement('div')
  root.id = 'app'
  document.body.appendChild(root)

  var state = { papers: [], selected: {} }

  root.innerHTML = `
    <style>
      *{box-sizing:border-box}
      .wrap{padding:14px;color:var(--lh-text,#e6e9f2);font:13px/1.55 system-ui,sans-serif}
      .top{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:12px}
      h2{font-size:15px;font-weight:650;margin:0}
      .muted{color:var(--lh-muted,#9aa3b8);font-size:12px}
      button{border:1px solid var(--lh-line,#2a3145);border-radius:8px;background:var(--lh-card,#1b202e);color:inherit;padding:7px 10px;cursor:pointer;font:inherit}
      button.primary{background:var(--lh-accent,#426ee8);border-color:transparent;color:white}
      button:disabled{opacity:.5;cursor:wait}
      .stats{display:flex;gap:8px;margin:12px 0}
      .stat{flex:1;border:1px solid var(--lh-line,#2a3145);border-radius:9px;padding:9px}
      .stat b{display:block;font-size:18px}
      .toolbar{display:flex;flex-wrap:wrap;align-items:center;gap:7px;margin:10px 0}
      .toolbar .spacer{flex:1}
      .checkline{display:flex;align-items:center;gap:6px;color:var(--lh-muted,#9aa3b8);font-size:12px;white-space:nowrap;cursor:pointer}
      input[type=checkbox]{accent-color:var(--lh-accent,#426ee8)}
      .paper{border:1px solid var(--lh-line,#2a3145);border-radius:9px;padding:10px;margin-top:8px}
      .paper-head{display:flex;align-items:center;gap:8px}
      .paper-title{flex:1;font-weight:600;font-size:13px;overflow-wrap:anywhere}
      .section{margin-top:18px;font-weight:650}
      pre{margin:8px 0 0;border:1px solid var(--lh-line,#2a3145);border-radius:9px;background:var(--lh-bg,#0f1117);color:var(--lh-muted,#9aa3b8);padding:10px;max-height:320px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;font:12px/1.5 ui-monospace,Consolas,monospace}
      .empty{border:1px dashed var(--lh-line,#2a3145);border-radius:9px;padding:18px;text-align:center;color:var(--lh-muted,#9aa3b8)}
      .notice{margin-top:8px;color:var(--lh-muted,#9aa3b8);font-size:12px}
    </style>
    <div class="wrap">
      <div class="top">
        <div><h2>导出复习稿</h2><div class="muted">把思维链路、问答归档与标记解释整合为 Markdown 复习稿</div></div>
        <button id="refresh">刷新数据</button>
      </div>
      <div class="stats">
        <div class="stat"><b id="count-papers">0</b><span class="muted">文献</span></div>
        <div class="stat"><b id="count-answers">0</b><span class="muted">问答</span></div>
        <div class="stat"><b id="count-marks">0</b><span class="muted">标记</span></div>
      </div>
      <div class="toolbar">
        <label class="checkline"><input type="checkbox" id="select-all" />全选</label>
        <span class="muted" id="sel-label"></span>
        <span class="spacer"></span>
        <button id="preview-btn">生成预览</button>
        <button id="export-merged" class="primary">合并导出</button>
        <button id="copy">复制全文</button>
      </div>
      <div id="papers"></div>
      <div id="preview" hidden>
        <div class="section">Markdown 预览</div>
        <div class="muted" id="preview-meta"></div>
        <pre id="md"></pre>
      </div>
      <div class="notice">导出通过另存对话框保存 .md 文件；「复制全文」需要剪贴板权限，首次使用会弹窗申请。</div>
    </div>`

  var el = function (id) { return document.getElementById(id) }
  var today = function () { return new Date().toLocaleDateString('sv-SE') }
  var toast = function (message) { window.host.ui.toast({ text: message }) }
  var errMsg = function (error) { return (error && error.message) || String(error) }
  var arr = function (value) { return Array.isArray(value) ? value : [] }

  // 折叠换行并转义 #/反引号，避免用户文本破坏 Markdown 结构
  var esc = function (value) {
    return String(value == null ? '' : value)
      .replace(/\r\n?/g, '\n')
      .split('\n')
      .map(function (line) { return line.trim() })
      .filter(Boolean)
      .join(' ')
      .replace(/`/g, '\\`')
      .replace(/(^|\s)(#{1,6})(\s)/g, '$1\\$2$3')
  }

  var quoteBlock = function (value) {
    var lines = String(value == null ? '' : value).replace(/\r\n?/g, '\n').split('\n').map(function (line) { return line.trim() })
    while (lines.length && !lines[0]) lines.shift()
    while (lines.length && !lines[lines.length - 1]) lines.pop()
    if (!lines.length) lines = ['（空）']
    return lines.map(function (line) { return '> ' + esc(line) }).join('\n')
  }

  var countAnswers = function (paper) { return arr(paper && paper.answers).length }
  var countHighlights = function (paper) { return arr(paper && paper.highlights).length }

  var metaNote = function (paper) {
    var meta = (paper && paper.meta) || {}
    var bits = []
    if (meta.year) bits.push(String(meta.year))
    if (meta.venue) bits.push(esc(meta.venue))
    var authors = Array.isArray(meta.authors) ? meta.authors : (meta.authors ? [meta.authors] : [])
    if (authors.length) bits.push('作者：' + authors.map(esc).join('、'))
    return bits.join(' · ')
  }

  var sourceLine = function (source) {
    var raw = String(source == null ? '' : source).trim()
    if (!raw) return ''
    if (/^https?:\/\//i.test(raw)) return '来源：[链接](' + raw + ')'
    return '来源：' + esc(raw)
  }

  var searchesSection = function (paper) {
    var searches = arr(paper && paper.searches)
    if (!searches.length) return '（暂无思维链路）'
    var groups = []
    var index = {}
    searches.forEach(function (item) {
      var key = String((item && item.mapId) || '未分组')
      if (!index[key]) { index[key] = []; groups.push({ mapId: key, queries: index[key] }) }
      var query = esc(item && item.query)
      if (query && index[key].indexOf(query) < 0) index[key].push(query)
    })
    var text = groups.map(function (group) {
      if (!group.queries.length) return ''
      return '**链路 ' + esc(group.mapId) + '**\n\n' + group.queries.map(function (query) { return '- ' + query }).join('\n')
    }).filter(Boolean).join('\n\n')
    return text || '（暂无思维链路）'
  }

  var answersSection = function (paper) {
    var answers = arr(paper && paper.answers)
    if (!answers.length) return '（暂无问答归档）'
    return answers.map(function (item) {
      var lines = ['**问：' + esc(item && item.question) + '**', '', quoteBlock(item && item.quote)]
      var source = item ? sourceLine(item.source) : ''
      if (source) lines.push('', source)
      return lines.join('\n')
    }).join('\n\n')
  }

  var highlightsSection = function (paper) {
    var highlights = arr(paper && paper.highlights)
    if (!highlights.length) return '（暂无标记）'
    return highlights.map(function (item) {
      var page = item && item.page != null && item.page !== '' ? String(item.page) : '?'
      var line = '- 第 ' + page + ' 页：「' + esc(item && item.text) + '」'
      if (String((item && item.color) || '').toLowerCase() === '#37c99e') line += '（答案）'
      var extra = []
      if (item && item.note) extra.push('  - 笔记：' + esc(item.note))
      if (item && item.aiExplain) extra.push('  - 解释：' + esc(item.aiExplain))
      return extra.length ? line + '\n' + extra.join('\n') : line
    }).join('\n')
  }

  var paperSection = function (paper) {
    var lines = ['# 《' + esc((paper && paper.title) || '未命名文献') + '》']
    var note = metaNote(paper)
    if (note) lines.push('', '> ' + note)
    lines.push(
      '', '## 思维链路问题', '', searchesSection(paper),
      '', '## 问答归档', '', answersSection(paper),
      '', '## 标记与解释', '', highlightsSection(paper)
    )
    return lines.join('\n')
  }

  var buildDoc = function (papers) {
    var answers = 0
    var marks = 0
    papers.forEach(function (paper) { answers += countAnswers(paper); marks += countHighlights(paper) })
    var head = [
      '# 复习稿',
      '',
      '> 生成时间：' + new Date().toLocaleString('sv-SE') + ' ｜ 共 ' + papers.length + ' 篇 / ' + answers + ' 问答 / ' + marks + ' 标记',
      '',
      '## 目录',
      ''
    ]
    papers.forEach(function (paper, i) {
      head.push((i + 1) + '. 《' + esc((paper && paper.title) || '未命名文献') + '》（标记 ' + countHighlights(paper) + ' · 问答 ' + countAnswers(paper) + '）')
    })
    var body = papers.map(paperSection).join('\n\n---\n\n')
    return head.join('\n') + '\n\n---\n\n' + body + '\n'
  }

  var safeName = function (title) {
    var text = String(title == null ? '' : title).replace(/[\\/:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim()
    if (text.length > 30) text = text.slice(0, 30).trim()
    return text || '文献'
  }

  var selectedPapers = function () { return state.papers.filter(function (paper) { return state.selected[paper.id] }) }

  function render() {
    var list = el('papers')
    list.replaceChildren()
    var answers = 0
    var marks = 0
    state.papers.forEach(function (paper) { answers += countAnswers(paper); marks += countHighlights(paper) })
    el('count-papers').textContent = String(state.papers.length)
    el('count-answers').textContent = String(answers)
    el('count-marks').textContent = String(marks)
    var selected = selectedPapers().length
    var selectAll = el('select-all')
    selectAll.checked = state.papers.length > 0 && selected === state.papers.length
    selectAll.indeterminate = selected > 0 && selected < state.papers.length
    el('sel-label').textContent = '已选 ' + selected + ' / ' + state.papers.length + ' 篇'
    if (!state.papers.length) {
      var empty = document.createElement('div')
      empty.className = 'empty'
      empty.textContent = '还没有文献数据。先在阅读器中打开论文，添加标记、搜索链路或问答，再回来生成复习稿。'
      list.appendChild(empty)
      return
    }
    state.papers.forEach(function (paper) {
      var card = document.createElement('div')
      card.className = 'paper'
      var head = document.createElement('div')
      head.className = 'paper-head'
      var box = document.createElement('input')
      box.type = 'checkbox'
      box.checked = !!state.selected[paper.id]
      box.addEventListener('change', function () { state.selected[paper.id] = box.checked; render() })
      var title = document.createElement('span')
      title.className = 'paper-title'
      title.textContent = paper.title || '未命名文献'
      var single = document.createElement('button')
      single.textContent = '单篇导出'
      single.addEventListener('click', function () { exportSingle(paper) })
      head.append(box, title, single)
      var meta = document.createElement('div')
      meta.className = 'muted'
      meta.textContent = [paper.course, '标记 ' + countHighlights(paper), '问答 ' + countAnswers(paper)].filter(Boolean).join(' · ')
      card.append(head, meta)
      list.appendChild(card)
    })
  }

  function renderPreview() {
    var papers = selectedPapers()
    if (!papers.length) { el('preview').hidden = true; return toast('请先勾选至少一篇论文') }
    var markdown = buildDoc(papers)
    el('md').textContent = markdown
    el('preview-meta').textContent = '共 ' + papers.length + ' 篇 · ' + markdown.length + ' 字符 · 生成于 ' + new Date().toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' })
    el('preview').hidden = false
  }

  async function exportMerged() {
    var papers = selectedPapers()
    if (!papers.length) return toast('请先勾选至少一篇论文')
    try {
      await window.host.files.saveText({ fileName: '复习稿-' + today() + '.md', content: buildDoc(papers) })
      toast('合并复习稿已保存')
    } catch (error) { toast('导出失败：' + errMsg(error)) }
  }

  async function exportSingle(paper) {
    try {
      await window.host.files.saveText({ fileName: '复习稿-' + safeName(paper.title) + '-' + today() + '.md', content: buildDoc([paper]) })
      toast('该篇复习稿已保存')
    } catch (error) { toast('导出失败：' + errMsg(error)) }
  }

  async function copyAll() {
    var papers = selectedPapers()
    if (!papers.length) return toast('请先勾选至少一篇论文')
    var button = el('copy')
    try {
      var permission = await window.host.requestPermission({ capability: 'clipboard', reason: '将复习稿 Markdown 复制到剪贴板' })
      if (!permission || !permission.granted) { button.hidden = true; return toast('未获得剪贴板权限，已隐藏「复制全文」按钮') }
      await window.host.clipboard.write({ text: buildDoc(papers) })
      toast('复习稿已复制到剪贴板')
    } catch (error) { toast('复制失败：' + errMsg(error)) }
  }

  async function load() {
    try {
      var papers = await window.host.data.papers.list({})
      state.papers = Array.isArray(papers) ? papers.slice() : []
    } catch (error) {
      state.papers = []
      toast('读取文献数据失败：' + errMsg(error))
    }
    state.papers.sort(function (a, b) { return ((b && b.updatedAt) || 0) - ((a && a.updatedAt) || 0) })
    state.selected = {}
    state.papers.forEach(function (paper) { state.selected[paper.id] = true })
    el('preview').hidden = true
    render()
  }

  el('refresh').addEventListener('click', load)
  el('select-all').addEventListener('change', function () {
    var checked = el('select-all').checked
    state.papers.forEach(function (paper) { state.selected[paper.id] = checked })
    render()
  })
  el('preview-btn').addEventListener('click', renderPreview)
  el('export-merged').addEventListener('click', exportMerged)
  el('copy').addEventListener('click', copyAll)

  window.addEventListener('host-ready', load, { once: true })
})()
