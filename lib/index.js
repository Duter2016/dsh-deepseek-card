// dsh-deepseek-card 宿主侧
// 余额：直读 DeepSeek 官方 user/balance 接口（真实余额，无需手填总量/校准）。
// 会话记账：借鉴 dsh-whale-widget / dsh-zhipu-card，按模型归属累计 token 与金额。
// 价格：官方峰谷价（北京时间工作日 9-12、14-18 为峰，其余谷）。
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'

const PLUGIN_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const BASE = '/dsh-deepseek-card'          // 路由前缀
const KEY_REF = 'DEEPSEEK_API_KEY'         // 凭证引用
const BALANCE_URL = 'https://api.deepseek.com/user/balance' // 官方余额接口
const MATCH = /deepseek/i                  // 模型归属

// 官方峰谷价（元/百万 token）。{peak, off} 结构，priceFor 按当下时段取价。
const DEFAULT_PRICE = { in: 2, cache: 0.04, out: 8 } // 峰价兜底
const PRICES = {
  'deepseek-flash': {
    peak: { in: 2, cache: 0.04, out: 8 },
    off: { in: 1, cache: 0.02, out: 4 },
  },
}

function dshHome() {
  return process.env.DSH_HOME && process.env.DSH_HOME.trim()
    ? process.env.DSH_HOME.trim()
    : path.join(os.homedir(), '.dsh')
}
const STATE_FILE = path.join(dshHome(), '.dscard.json')
const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }

function defaults() {
  return {
    settings: { prices: {} }, // 单价覆盖（余额是官方真实值，无需总量/校准）
    days: {},   // 'YYYY-MM-DD' -> { tokens, cost, cache, input }
  }
}
let state = defaults()
let saveTimer = null
let curSess = null // 当前会话累计 { id, tokens, cache, input }，切换会话自动重置
let lastCtx = null // 最近一轮 token 总量（≈已占用上下文）

function loadState() {
  try {
    const parsed = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
    if (parsed && typeof parsed === 'object') {
      state = Object.assign(defaults(), parsed)
      state.settings = Object.assign(defaults().settings, parsed.settings || {})
      state.days = parsed.days && typeof parsed.days === 'object' ? parsed.days : {}
    }
  } catch (err) {}
}
function saveState() {
  try { fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2)) } catch (err) {}
}
function scheduleSave() {
  if (saveTimer) return
  saveTimer = setTimeout(() => { saveTimer = null; saveState() }, 5000)
}

function dayKey() {
  return new Date().toISOString().slice(0, 10)
}
// 峰 = 北京时间工作日 9-12、14-18；其余时段及周末全天为谷（谷价 = 峰价一半）。UTC+8 换算不依赖服务器时区
function peakNow() {
  const d = new Date(Date.now() + 8 * 3600e3)
  const h = d.getUTCHours(), wd = d.getUTCDay() >= 1 && d.getUTCDay() <= 5
  return wd && ((h >= 9 && h < 12) || (h >= 14 && h < 18))
}
function priceFor(model) {
  const p = (state.settings.prices && state.settings.prices[model]) || PRICES[model] || DEFAULT_PRICE
  if (p.peak && p.off) return peakNow() ? p.peak : p.off
  return p
}
function todayRec() {
  return state.days[dayKey()] || { tokens: 0, cost: 0, cache: 0, input: 0 }
}

// 官方余额：60s 缓存（同时充当 key 探活）
let balCache = { ts: 0, hasKey: false, ok: false, balance: null, currency: 'CNY', granted: null, topped: null }
async function fetchBalance(credentials) {
  const now = Date.now()
  if (now - balCache.ts < 60000) return balCache
  let hasKey = false
  try {
    const cred = await credentials.resolve(KEY_REF)
    const key = cred && cred.value
    hasKey = !!key
    if (key) {
      const r = await fetch(BALANCE_URL, { headers: { Authorization: 'Bearer ' + key } })
      if (r.status === 200) {
        const j = await r.json()
        const info = j && j.balance_infos && j.balance_infos[0]
        balCache = {
          ts: now, hasKey, ok: true,
          balance: Number(info && info.total_balance) || 0,
          currency: (info && info.currency) || 'CNY',
          granted: Number(info && info.granted_balance) || 0,
          topped: Number(info && info.topped_up_balance) || 0,
        }
        return balCache
      }
    }
  } catch (err) {}
  balCache = Object.assign({}, balCache, { ts: now, hasKey, ok: false })
  return balCache
}

export default {
  name: 'deepseek-card',
  apply(root) {
    const disposers = []
    disposers.push(root.on('webserver/index-inject', (table) => {
      try {
        if (!Array.isArray(table)) return
        for (const row of table) {
          if (row && row.kind === 'script' && typeof row.text === 'string' && row.text.includes(BASE + '/widget.js')) return
        }
        table.push({
          kind: 'script', placement: 'body',
          text: '(function(){try{var d=document.body||document.head||document.documentElement;if(!d)return;' +
            'var s=document.createElement("script");s.src="' + BASE + '/widget.js";' +
            's.onerror=function(){};d.appendChild(s)}catch(e){}})()',
        })
      } catch (err) {}
    }))

    root.inject(['webServer', 'credentials'], (ctx) => {
      loadState()

      // 会话事件记账：assistant/message 携带每步真实 usage
      disposers.push(ctx.on('session/event', (session, event) => {
        try {
          if (!event || event.type !== 'assistant/message') return
          const d = event.data
          const u = d && d.usage
          if (!u || typeof u !== 'object') return
          const model = (d.message && d.message.source && d.message.source.model) || ''
          if (!MATCH.test(model)) return
          const inTok = Number(u.inputTokens) || 0
          const cacheTok = Number(u.cacheReadTokens) || 0
          const outTok = Number(u.outputTokens) || 0
          const toks = inTok + cacheTok + outTok
          if (toks <= 0) return
          const p = priceFor(model)
          const cost = (inTok / 1e6) * p.in + (cacheTok / 1e6) * p.cache + (outTok / 1e6) * p.out
          const day = dayKey()
          const rec = state.days[day] || (state.days[day] = { tokens: 0, cost: 0, cache: 0, input: 0 })
          rec.tokens += toks
          rec.cost += cost
          rec.cache += cacheTok
          rec.input += inTok
          lastCtx = { tokens: toks, model }
          const sid = session && (session.id || session.sessionId) || 'default'
          if (!curSess || curSess.id !== sid) curSess = { id: sid, tokens: 0, cache: 0, input: 0 }
          curSess.tokens += toks; curSess.cache += cacheTok; curSess.input += inTok
          scheduleSave()
        } catch (err) {}
      }))

      // 轻量安全栅栏：回环 Host + 同源校验
      function rejected(req, res) {
        const deny = (code) => { try { res.statusCode = code || 403; res.end() } catch (err) {} return true }
        const host = String(req.headers.host || '').split(':')[0]
        if (host !== '127.0.0.1' && host !== 'localhost' && host !== '::1') return deny(403)
        if (String(req.headers['sec-fetch-site'] || '') === 'cross-site') return deny(403)
        const origin = req.headers.origin
        if (origin && !String(origin).includes(host)) return deny(403)
        return false
      }
      const register = (route) => {
        const inner = route.handler
        disposers.push(ctx.webServer.register(Object.assign({}, route, {
          handler: async (req, res) => { if (rejected(req, res)) return; return inner(req, res) },
        })))
      }

      let widgetCache = { mtime: 0, text: '' }
      function widgetJs() {
        const file = path.join(PLUGIN_ROOT, 'lib', 'client.js')
        try {
          const mtime = fs.statSync(file).mtimeMs
          if (mtime !== widgetCache.mtime) widgetCache = { mtime, text: fs.readFileSync(file, 'utf8') }
        } catch (err) { return '// client.js missing' }
        return widgetCache.text
      }

      register({
        kind: 'exact', path: BASE + '/widget.js',
        handler: (req, res) => {
          res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'no-store' })
          res.end(widgetJs())
        },
      })

      register({
        kind: 'exact', path: BASE + '/summary.json',
        handler: async (req, res) => {
          const bal = await fetchBalance(ctx.credentials)
          // 计费时段：展示「最近使用模型」（无则主力 deepseek-flash）在当前时段的生效价
          const tariffModel = (lastCtx && lastCtx.model) || 'deepseek-flash'
          res.writeHead(200, JSON_HEADERS)
          res.end(JSON.stringify({
            ok: true, name: 'DeepSeek', keyRef: KEY_REF,
            hasKey: bal.hasKey, keyValid: bal.ok,
            balance: bal.balance, currency: bal.currency,
            granted: bal.granted, topped: bal.topped,
            tariff: { mode: peakNow() ? 'peak' : 'off', model: tariffModel, price: priceFor(tariffModel) },
            today: todayRec(),
            sess: curSess ? { tokens: curSess.tokens, cache: curSess.cache, input: curSess.input } : null,
            ctx: lastCtx ? { tokens: lastCtx.tokens, model: lastCtx.model,
              limit: Number(state.settings.ctxLimit) || 128000 } : null,
          }))
        },
      })

      register({
        kind: 'exact', path: BASE + '/settings.json',
        handler: async (req, res) => {
          if (req.method === 'POST') {
            let body = ''
            for await (const chunk of req) body += chunk
            try {
              const patch = JSON.parse(body || '{}')
              if (patch.ctxLimit !== undefined) state.settings.ctxLimit = Math.max(0, Number(patch.ctxLimit) || 0)
              if (patch.prices && typeof patch.prices === 'object') {
                state.settings.prices = {}
                for (const [m, p] of Object.entries(patch.prices)) {
                  const flat = p && !p.peak && !p.off
                  const inP = Number(flat ? p && p.in : p && p.peak && p.peak.in)
                  const cacheP = Number(flat ? p && p.cache : p && p.peak && p.peak.cache)
                  const outP = Number(flat ? p && p.out : p && p.peak && p.peak.out)
                  if (m && [inP, cacheP, outP].every(Number.isFinite)) {
                    state.settings.prices[m] = flat
                      ? { in: inP, cache: cacheP, out: outP }
                      : { peak: { in: inP, cache: cacheP, out: outP }, off: p.off }
                  }
                }
              }
              saveState()
            } catch (err) {}
          }
          res.writeHead(200, JSON_HEADERS)
          res.end(JSON.stringify({ ok: true, settings: state.settings }))
        },
      })

      disposers.push(ctx.webServer.tapIndex((html) => {
        if (html.includes(BASE + '/widget.js')) return html
        const tag = '<script defer src="' + BASE + '/widget.js"></script>'
        if (html.includes('</body>')) return html.replace('</body>', tag + '</body>')
        return html + tag
      }))
    })

    root.effect(() => () => {
      if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; saveState() }
      for (const d of disposers) { try { d() } catch (err) {} }
    })
  },
}
