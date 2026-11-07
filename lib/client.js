// dsh-deepseek-card 前端：胶囊+卡片（结构同 zhipu-card；余额为官方真实值）
(function () {
  'use strict'
  var BASE = '/dsh-deepseek-card'
  var POS_KEY = 'deepseek-card:pos'
  if (document.getElementById('deepseek-card')) return

  var css = [
    '#deepseek-card{position:fixed;right:18px;bottom:98px;z-index:900;display:flex;flex-direction:column;align-items:flex-end;color:#1b1b1c;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;font-size:13px;line-height:1.45}',
    '#ds-capsule{display:inline-flex;align-items:center;gap:7px;height:32px;padding:0 12px 0 14px;border:1px solid rgba(0,0,0,.1);border-radius:18px;background:#fff;box-shadow:0 4px 12px rgba(15,17,21,.02),0 2px 8px rgba(15,17,21,.04);cursor:pointer;transition:background-color 120ms ease;touch-action:none}',
    '#ds-capsule:hover{background:#ebeef2}',
    '#ds-dot{flex:none;width:8px;height:8px;border-radius:50%;background:#adb2b8}',
    '#ds-dot.ok{background:#22c55e}#ds-dot.warn{background:#f59e0b}#ds-dot.error{background:#ef4444}',
    '#ds-capsule .ds-val{font-variant-numeric:tabular-nums;white-space:nowrap}',
    '#ds-card{display:none;width:280px;max-width:calc(100vw - 36px);margin-top:8px;padding:14px 16px 15px;border:1px solid rgba(0,0,0,.1);border-radius:16px;background:#fff;box-shadow:0 8px 26px rgba(15,17,21,.1),0 2px 6px rgba(15,17,21,.06);box-sizing:border-box}',
    '#ds-card.open{display:block}',
    '#ds-card .ds-title{display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;font-size:14px;font-weight:600}',
    '#ds-card .ds-row{display:flex;justify-content:space-between;padding:4px 0;color:#1b1b1c}',
    '#ds-card .ds-row .ds-label{color:#61666b}',
    '#ds-card .ds-row .ds-num{font-variant-numeric:tabular-nums;font-weight:600}',
    '#ds-card .ds-err{margin-top:6px;color:#ef4444;font-size:12px;word-break:break-all}',
    '#ds-card .ds-set{margin-top:12px;padding-top:10px;border-top:1px solid rgba(0,0,0,.06)}',
    '#ds-card .ds-set .ds-srow{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:3px 0}',
    '#ds-card .ds-set label{color:#61666b;font-size:12px}',
    '#ds-card textarea{width:100%;margin-top:6px;padding:6px 8px;border:1px solid rgba(0,0,0,.14);border-radius:8px;font:12px ui-monospace,monospace;box-sizing:border-box;min-height:56px}',
    '#ds-card .ds-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:10px}',
    '#ds-card button{padding:4px 12px;border:1px solid rgba(0,0,0,.14);border-radius:8px;background:#fff;cursor:pointer;font:inherit;font-size:12px}',
    '#ds-card button.ds-primary{background:#4176e6;border-color:#4176e6;color:#fff}',
  ].join('\n')

  var style = document.createElement('style')
  style.textContent = css
  document.head.appendChild(style)

  var root = document.createElement('div')
  root.id = 'deepseek-card'
  root.innerHTML =
    '<div id="ds-capsule"><span id="ds-dot"></span><span class="ds-val" id="ds-val">…</span></div>' +
    '<div id="ds-card">' +
      '<div class="ds-title"><span>DeepSeek 官方余额</span><span id="ds-key" style="font-size:11px;font-weight:400;color:#818590"></span><span id="ds-close" style="cursor:pointer;font-size:16px;padding:0 2px;color:#818590" title="收起">×</span></div>' +
      '<div class="ds-row"><span class="ds-label">余额（官方）</span><span class="ds-num" id="ds-balance">—</span></div>' +
      '<div class="ds-row"><span class="ds-label">今日已用（估算）</span><span class="ds-num" id="ds-today">—</span></div>' +
      '<div class="ds-row"><span class="ds-label">缓存命中率（会话）</span><span class="ds-num" id="ds-hit">—</span></div>' +
      '<div class="ds-row"><span class="ds-label">上下文占用</span><span class="ds-num" id="ds-ctx">—</span></div>' +
      '<div class="ds-err" id="ds-err" style="display:none"></div>' +
      '<div class="ds-set">' +
        '<div class="ds-srow"><label>计费时段</label><span id="ds-tariff" style="font-size:12px;font-weight:600;color:#61666b">…</span></div>' +
        '<div class="ds-srow"><label id="ds-tariff-note" style="font-size:11px;color:#818590;text-align:right;line-height:1.3"></label></div>' +
        '<label style="display:block">单价覆盖（JSON：{"模型名":{"peak":{"in":元,"cache":元,"out":元},"off":{...}}}，元/百万token）</label>' +
        '<textarea id="ds-prices" spellcheck="false"></textarea>' +
        '<div class="ds-actions"><button id="ds-save" class="ds-primary">保存</button></div>' +
      '</div>' +
    '</div>'
  ;(document.body || document.documentElement).appendChild(root)

  function fmtMoney(n, cur) { return (cur === 'USD' ? '$' : '¥') + (Math.round(n * 100) / 100).toFixed(2) }
  function fmtTokens(n) {
    n = Math.round(n)
    if (n >= 1e8) return (n / 1e8).toFixed(2) + '亿'
    if (n >= 1e4) return (n / 1e4).toFixed(1) + '万'
    return String(n)
  }
  function fmtToday(t) {
    return '¥' + (Math.round((t.cost || 0) * 100) / 100).toFixed(2) + '（' + fmtTokens(t.tokens || 0) + ' tok）'
  }

  function render(s) {
    var dot = document.getElementById('ds-dot')
    dot.className = s.keyValid ? 'ok' : (s.hasKey ? 'warn' : 'error')
    document.getElementById('ds-key').textContent = s.keyValid ? 'key ✓' : (s.hasKey ? 'key 异常' : '无 key')
    var hitDen = s.sess ? s.sess.tokens : 0 // 当前会话口径（与 balance-meter 一致）
    var hitTxt = hitDen > 0 ? ' · ' + Math.round((s.sess.cache || 0) / hitDen * 100) + '%' : ''
    document.getElementById('ds-val').textContent = '深度 ' + (s.balance == null ? '—' : fmtMoney(s.balance, s.currency)) + hitTxt
    document.getElementById('ds-balance').textContent = s.balance == null ? '—' :
      fmtMoney(s.balance, s.currency) + (s.granted != null ? '（含赠金 ' + fmtMoney(s.granted, s.currency) + '）' : '')
    document.getElementById('ds-today').textContent = fmtToday(s.today || {})
    var den = s.sess ? s.sess.tokens : 0
    document.getElementById('ds-hit').textContent = den > 0 ? Math.round((s.sess.cache || 0) / den * 100) + '%' : '—'
    var ctxEl = document.getElementById('ds-ctx')
    if (s.ctx && s.ctx.tokens > 0) {
      var pct = Math.min(100, Math.round(s.ctx.tokens / s.ctx.limit * 100))
      ctxEl.textContent = pct + '% · ' + fmtTokens(s.ctx.tokens) + ' / ' + fmtTokens(s.ctx.limit)
      ctxEl.style.color = pct >= 90 ? '#ef4444' : pct >= 70 ? '#f59e0b' : ''
    } else ctxEl.textContent = '—'
    var err = document.getElementById('ds-err')
    if (s.hasKey && !s.keyValid) { err.style.display = 'block'; err.textContent = '官方余额接口调用失败：检查 DEEPSEEK_API_KEY 或网络' } else err.style.display = 'none'
    // 计费时段：当前时段 + 该时段生效价（峰谷规则见 note 行）
    var tf = s.tariff, tEl = document.getElementById('ds-tariff'), tNote = document.getElementById('ds-tariff-note')
    if (tf && tf.price) {
      var p = tf.price
      var priceTxt = 'in ' + p.in + ' / cache ' + p.cache + ' / out ' + p.out + ' 元/M'
      var peak = tf.mode === 'peak'
      tEl.textContent = (peak ? '峰时段（2×）' : '谷时段（半价）') + ' · ' + priceTxt
      tEl.style.color = peak ? '#ef4444' : '#16a34a'
      tNote.textContent = '峰 9-12 / 14-18（工作日），其余及周末全天谷价'
    } else { tEl.textContent = '—'; tNote.textContent = '' }
  }

  function fillSettings(s) {
    document.getElementById('ds-prices').value = JSON.stringify(s.settings ? s.settings.prices : {}, null, 1)
  }

  function closeCard() { document.getElementById('ds-card').classList.remove('open') }
  document.getElementById('ds-close').addEventListener('click', function (e) { e.stopPropagation(); closeCard() })
  document.addEventListener('pointerdown', function (e) {
    var card = document.getElementById('ds-card')
    if (!card.classList.contains('open')) return
    if (card.contains(e.target) || capsule.contains(e.target)) return
    closeCard()
  })

  function load() {
    return fetch(BASE + '/summary.json').then(function (r) { return r.json() }).then(function (s) {
      render(s)
      return s
    }).catch(function () { document.getElementById('ds-val').textContent = '深度 —' })
  }

  var drag = null
  var capsule = document.getElementById('ds-capsule')
  capsule.addEventListener('pointerdown', function (e) {
    if (e.button !== 0) return
    var r = root.getBoundingClientRect()
    drag = { sx: e.clientX, sy: e.clientY, right: window.innerWidth - r.right, bottom: window.innerHeight - r.bottom, moved: false }
    capsule.setPointerCapture(e.pointerId)
  })
  capsule.addEventListener('pointermove', function (e) {
    if (!drag) return
    var dx = e.clientX - drag.sx, dy = e.clientY - drag.sy
    if (!drag.moved && Math.abs(dx) < 5 && Math.abs(dy) < 5) return
    drag.moved = true
    var right = Math.max(0, Math.min(window.innerWidth - 60, drag.right - dx))
    var bottom = Math.max(0, Math.min(window.innerHeight - 60, drag.bottom - dy))
    root.style.right = right + 'px'
    root.style.bottom = bottom + 'px'
  })
  capsule.addEventListener('pointerup', function (e) {
    if (!drag) return
    if (drag.moved) {
      var r = root.getBoundingClientRect()
      try { localStorage.setItem(POS_KEY, JSON.stringify({ right: window.innerWidth - r.right, bottom: window.innerHeight - r.bottom })) } catch (err) {}
    }
    var moved = drag.moved
    drag = null
    if (moved) e.stopImmediatePropagation()
  })

  try {
    var saved = JSON.parse(localStorage.getItem(POS_KEY) || 'null')
    if (saved) { root.style.right = saved.right + 'px'; root.style.bottom = saved.bottom + 'px' }
  } catch (e) {}

  document.getElementById('ds-capsule').addEventListener('click', function () {
    var card = document.getElementById('ds-card')
    var opening = !card.classList.contains('open')
    card.classList.toggle('open')
    if (opening) load().then(function (s) { if (s) fillSettings(s) })
  })

  document.getElementById('ds-save').addEventListener('click', function () {
    var prices = {}
    try { prices = JSON.parse(document.getElementById('ds-prices').value || '{}') } catch (e) {}
    fetch(BASE + '/settings.json', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prices: prices }),
    }).then(load)
  })

  load()
  setInterval(load, 60000)
})()
