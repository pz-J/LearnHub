/* LearnHub 示例子模块（沙箱运行，无 Node 环境）
 * 宿主在 host-ready 事件后注入 window.host（RPC 代理）与 window.events。
 * 所有 host.* 调用都会经宿主内核做权限门禁。
 */
;(function () {
  var log = function (msg) {
    var box = document.getElementById('log')
    if (box) box.textContent = msg + '\n' + box.textContent
  }

  document.addEventListener('DOMContentLoaded', function () {
    var root = document.createElement('div')
    root.innerHTML =
      '<div class="card"><b>你好，LearnHub！</b><div class="dim" id="who">读取清单中…</div></div>' +
      '<div class="card">' +
      '<button id="save">保存问候语到私有存储</button> ' +
      '<button id="load">读取</button>' +
      '<div class="dim" id="store"></div>' +
      '</div>' +
      '<div class="card">' +
      '<button id="ai">申请 AI 权限并对话</button>' +
      '<div class="dim" id="aiout">（运行时将弹出授权对话框）</div>' +
      '</div>' +
      '<div class="card">' +
      '<button id="notify">申请通知权限并提醒</button>' +
      '</div>' +
      '<div class="card">' +
      '<button id="award">登记一个成就任务（演示 achievements.award）</button>' +
      '<div class="dim" id="awardout">登记后去「成就」页领取积木</div>' +
      '</div>' +
      '<div class="card dim" id="log"></div>'
    document.body.appendChild(root)

    var manifest = null
    window.addEventListener('host-ready', function (e) {
      manifest = e.detail.manifest
      document.getElementById('who').textContent =
        '模块：' + manifest.name + '（' + manifest.id + '）v' + manifest.version
    })

    document.getElementById('save').onclick = async function () {
      // 需要权限 storage.own（清单必需权限，安装时已授予）
      await host.storage.set({ obj: { greet: '我在 ' + new Date().toLocaleTimeString() + ' 保存过' } })
      document.getElementById('store').textContent = '已保存'
    }
    document.getElementById('load').onclick = async function () {
      var data = await host.storage.get({})
      document.getElementById('store').textContent = data.greet ? '问候语：' + data.greet : '（空）'
    }

    document.getElementById('ai').onclick = async function () {
      // ai.invoke 不在必需权限中 → 走元模块审批，弹授权对话框
      var res = await host.requestPermission({ capability: 'ai.invoke', reason: '示例模块想要调用 AI 打招呼' })
      if (!res.granted) {
        document.getElementById('aiout').textContent = '未获授权：' + (res.reason || '')
        return
      }
      document.getElementById('aiout').textContent = 'AI 回复中…'
      var text = await host.ai.chat({
        messages: [{ role: 'user', content: '请用一句话向 LearnHub 用户问好' }],
        reqId: 'hello-' + Date.now()
      })
      document.getElementById('aiout').textContent = 'AI：' + text
    }

    document.getElementById('notify').onclick = async function () {
      var res = await host.requestPermission({ capability: 'notify', reason: '示例模块想发一条系统通知' })
      if (res.granted) await host.ui.notify({ title: '你好示例', body: '通知权限已生效！' })
      else log('通知权限被拒绝：' + (res.reason || ''))
    }

    // 成就对接：向成就系统登记任务，用户在成就页领取积木奖励
    // 返回 true 表示登记成功；false 表示同一 taskId 已有未领取记录（宿主防刷积木）
    document.getElementById('award').onclick = async function () {
      var res = await host.requestPermission({ capability: 'achievements.award', reason: '示例模块想演示成就任务登记' })
      if (!res.granted) {
        document.getElementById('awardout').textContent = '未获授权：' + (res.reason || '')
        return
      }
      var ok = await host.achievements.award({ taskId: 'hello-demo', title: '示例模块：完成对接演示' })
      document.getElementById('awardout').textContent = ok
        ? '已登记，去「成就」页领取积木'
        : '该任务已有未领取记录（防刷机制生效），先去「成就」页领取'
    }

    // 事件总线：订阅宿主广播（如番茄钟完成）
    window.events.on('focus:done', function (p) {
      log('收到事件 focus:done：专注 ' + (p && p.minutes) + ' 分钟')
    })
  })
})()
