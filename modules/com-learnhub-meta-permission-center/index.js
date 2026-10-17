(function () {
  var root = document.createElement('div')
  root.id = 'app'
  document.body.appendChild(root)
  var modules = []
  var selectedId = 'com.learnhub.study-journal'
  var busy = false

  root.innerHTML = `
    <style>
      *{box-sizing:border-box}.wrap{padding:14px;color:var(--lh-text,#e6e9f2);font:13px/1.55 system-ui,sans-serif}
      h2{font-size:15px;font-weight:650;margin:0}.muted{color:var(--lh-muted,#9aa3b8);font-size:12px}.intro{margin:6px 0 14px;color:var(--lh-muted,#9aa3b8);font-size:12px}
      select{width:100%;border:1px solid var(--lh-line,#2a3145);border-radius:8px;background:var(--lh-bg,#0f1117);color:inherit;padding:8px;font:inherit}
      button{border:1px solid var(--lh-line,#2a3145);border-radius:8px;background:var(--lh-card,#1b202e);color:inherit;padding:7px 10px;cursor:pointer;font:inherit}button.primary{background:var(--lh-accent,#426ee8);border-color:transparent;color:white}button:disabled{opacity:.5;cursor:wait}
      .section{font-weight:650;margin:16px 0 8px}.card{border:1px solid var(--lh-line,#2a3145);border-radius:9px;padding:10px;margin-top:8px}.row{display:flex;align-items:center;justify-content:space-between;gap:8px}.title{font-weight:600}.desc{font-size:12px;color:var(--lh-muted,#9aa3b8);margin-top:3px}.chip{display:inline-block;border:1px solid var(--lh-line,#2a3145);border-radius:999px;padding:2px 8px;margin:3px 4px 0 0;font-size:11px}.chip.granted{border-color:#2d8a65;color:#75d6a8}.chip.required{border-color:#8c6a2d;color:#e7c47a}.actions{display:flex;flex-wrap:wrap;gap:7px;margin-top:12px}.empty{border:1px dashed var(--lh-line,#2a3145);border-radius:9px;padding:16px;color:var(--lh-muted,#9aa3b8);text-align:center}.notice{margin-top:14px;border-radius:8px;background:var(--lh-card,#1b202e);padding:10px;color:var(--lh-muted,#9aa3b8);font-size:12px}
    </style>
    <div class="wrap">
      <h2>元模块权限管家</h2>
      <p class="intro">集中管理模块声明过的可选权限。每次授权仍会由 LearnHub 弹出确认；必需权限需停用或卸载模块才能停止使用。</p>
      <label class="muted" for="target">选择模块</label><select id="target"></select>
      <div id="details"></div>
      <div class="section">可选权限</div><div id="optional"></div>
      <div class="notice">元模块只能申请目标模块清单中已声明的可选权限。任意主进程桥接 API 尚未开放，不能通过此页面调用任意 IPC。</div>
    </div>`

  var el = function (id) { return document.getElementById(id) }
  var toast = function (text) { return window.host.ui.toast({ text: text }) }
  var target = function () { return modules.find(function (m) { return m.id === selectedId }) }

  async function refresh() {
    modules = await window.host.meta.listModules({})
    var select = el('target')
    select.replaceChildren()
    modules.filter(function (m) { return m.id !== 'com.learnhub.meta.permission-center' }).forEach(function (m) {
      var option = document.createElement('option'); option.value = m.id; option.textContent = m.manifest.name + (m.enabled ? '' : '（已停用）'); select.appendChild(option)
    })
    if (!modules.some(function (m) { return m.id === selectedId && m.id !== 'com.learnhub.meta.permission-center' })) {
      var first = modules.find(function (m) { return m.id !== 'com.learnhub.meta.permission-center' })
      selectedId = first ? first.id : ''
    }
    select.value = selectedId
    await renderTarget()
  }

  async function renderTarget() {
    var mod = target()
    el('details').replaceChildren(); el('optional').replaceChildren()
    if (!mod) {
      var empty = document.createElement('div'); empty.className = 'empty'; empty.textContent = '没有可管理的模块。请先安装科研日志或其他外部模块。'; el('details').appendChild(empty); return
    }
    var detail = document.createElement('div'); detail.className = 'card'
    var row = document.createElement('div'); row.className = 'row'
    var name = document.createElement('div'); name.className = 'title'; name.textContent = mod.manifest.name
    var status = document.createElement('span'); status.className = 'chip'; status.textContent = mod.enabled ? '已启用' : '已停用'
    row.append(name, status)
    var id = document.createElement('div'); id.className = 'desc'; id.textContent = mod.id
    detail.append(row, id)
    ;(mod.manifest.permissions || []).forEach(function (cap) { var chip = document.createElement('span'); chip.className = 'chip required'; chip.textContent = '必需 · ' + cap; detail.appendChild(chip) })
    el('details').appendChild(detail)

    var granted = await window.host.meta.grants({ moduleId: mod.id })
    var optional = mod.manifest.optionalPermissions || []
    if (!optional.length) { var none = document.createElement('div'); none.className = 'empty'; none.textContent = '该模块没有声明可选权限。'; el('optional').appendChild(none); return }
    optional.forEach(function (cap) {
      var card = document.createElement('div'); card.className = 'card'
      var top = document.createElement('div'); top.className = 'row'
      var label = document.createElement('span'); label.className = 'title'; label.textContent = cap
      var chip = document.createElement('span'); chip.className = 'chip ' + (granted.includes(cap) ? 'granted' : ''); chip.textContent = granted.includes(cap) ? '已授权' : '未授权'
      top.append(label, chip); card.appendChild(top)
      var actions = document.createElement('div'); actions.className = 'actions'
      var button = document.createElement('button'); button.className = granted.includes(cap) ? '' : 'primary'; button.textContent = granted.includes(cap) ? '撤销授权' : '申请授权'
      button.disabled = busy || !mod.enabled
      button.addEventListener('click', async function () {
        if (busy) return
        busy = true; button.disabled = true
        try {
          if (granted.includes(cap)) {
            await window.host.meta.revoke({ moduleId: mod.id, capability: cap })
            toast('已撤销 ' + cap)
          } else {
            var result = await window.host.meta.requestPermission({ moduleId: mod.id, capability: cap, reason: '通过元模块权限管家申请' })
            toast(result.granted ? '已授予 ' + cap : '未授予：' + (result.reason || '用户拒绝'))
          }
          await renderTarget()
        } catch (error) { toast('权限操作失败：' + (error.message || error)) }
        finally { busy = false; await renderTarget() }
      })
      actions.appendChild(button); card.appendChild(actions); el('optional').appendChild(card)
    })
  }

  el('target').addEventListener('change', function (event) { selectedId = event.target.value; renderTarget() })
  window.addEventListener('host-ready', function () {
    refresh().catch(function (error) { toast('无法读取模块列表：' + (error.message || error)) })
  }, { once: true })
})();
