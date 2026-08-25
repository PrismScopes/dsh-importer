/**
 * dsh-importer — chat.deepseek.com 会话同步插件（node half）。
 *
 * 能力：
 *  - 把 chat.deepseek.com 网页版的会话清单与内容同步到 DSH 本地文件
 *    （沿用 dsweb-* 文件名，保证与旧动态插件数据无缝衔接）。
 *  - 全自动同步：首次自动官方导出导入全量清单，之后按配置间隔自动检查
 *    新会话并拉取内容；已拉取会话在远端有更新时自动重新拉取。
 *  - 经 webServer 暴露 JSON 端点供 client half（浏览器）调用；token 只存在
 *    节点侧，浏览器不接触原始凭据（status 端点回传 token 供设置页回填）。
 *  - 提供 token 书签配置端点（/api/dsweb/token，带 Origin 校验）。
 *
 * 数据目录：$DSH_HOME/dsh-importer（默认 ~/.dsh/dsh-importer）。用 node
 * 原生 fs/promises 直写，不经 ctx.fs（那是模型工具层的沙箱 fs，写操作被
 * 限制在 workspaceRoot；插件自身运行在完整 node 环境，数据应落在 DSH 数据
 * 根下，与 dsh-pocket 等插件一致）。
 *
 * 数据文件（$DSH_HOME/dsh-importer 下）：
 *  - dsweb-token.json      登录 token
 *  - dsweb-config.json     开关 / 间隔 / 上次同步 / 初始化版本
 *  - dsweb-index.json      会话索引（含消息数与 content_fetched 标记）
 *  - dsweb-sessions-<id>.json  每个会话的完整内容（供 AI 作为上下文读取）
 */

import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

export const name = 'dsh-importer'

/** 硬依赖：subprocess（curl 网络层）、timer（自动同步）。 */
export const inject = ['subprocess', 'timer']

const BASE = 'https://chat.deepseek.com'
const ALLOWED_ORIGINS = ['https://chat.deepseek.com', 'http://127.0.0.1:3080']

/** 数据目录：$DSH_HOME/dsh-importer（DSH_HOME 缺失时回退 ~/.dsh）。 */
function dataDir() {
  const home = process.env.DSH_HOME && process.env.DSH_HOME.trim().length > 0
    ? process.env.DSH_HOME
    : join(homedir(), '.dsh')
  return join(resolve(home), 'dsh-importer')
}

export function apply(ctx, config = {}) {
  let token = null
  let tokenSource = null
  let tokenUpdatedAt = null
  let syncInFlight = false
  let initInFlight = false

  const subprocess = ctx.subprocess

  const PLACEHOLDER_TOKENS = new Set(['test', 'token', 'invalid', 'placeholder', 'your-token', 'abc', '123456'])

  const extractToken = (v) => {
    if (!v) return null
    const raw = typeof v === 'string' ? v : (v.token || v.access_token || v.accessToken || null)
    if (!raw) return null
    const t = String(raw).trim()
    if (t.length < 16) return null
    if (PLACEHOLDER_TOKENS.has(t.toLowerCase())) return null
    return t
  }

  const filePath = (name) => join(dataDir(), name)
  const ensureDataDir = () => mkdir(dataDir(), { recursive: true })

  const readJsonFile = async (name, fallback) => {
    try {
      return JSON.parse(await readFile(filePath(name), 'utf8'))
    } catch (e) { return fallback }
  }
  const writeJsonFile = async (name, obj) => {
    try {
      await ensureDataDir()
      await writeFile(filePath(name), JSON.stringify(obj, null, 2), 'utf8')
      return { ok: true }
    } catch (e) { return { ok: false, error: String(e) } }
  }

  const removeFiles = async (names) => {
    for (const n of names) {
      try { await unlink(filePath(n)) } catch (e) { /* 文件不存在则忽略 */ }
    }
  }

  const readConfig = () => readJsonFile('dsweb-config.json', { enabled: true, intervalMinutes: 2, lastSyncAt: null, lastInitAt: null, initVersion: 0 })
  const readTokenFile = () => readJsonFile('dsweb-token.json', null)
  const readLocalIndex = () => readJsonFile('dsweb-index.json', [])
  const writeLocalIndex = (idx) => writeJsonFile('dsweb-index.json', idx)

  const ensureToken = async () => {
    if (token) return token
    const saved = await readTokenFile()
    if (saved && saved.token) {
      token = saved.token
      tokenSource = saved.source || 'saved'
      tokenUpdatedAt = saved.updatedAt || null
    }
    return token
  }

  const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36'
  const dsApi = async (path, maxTime) => {
    const tk = await ensureToken()
    if (!tk) throw new Error('未设置 token')
    let exe
    try { exe = await subprocess.resolveExecutable('curl') } catch (e) { throw new Error('无法解析 curl') }
    const cwd = dataDir()
    const handle = subprocess.spawn({
      argv: [exe, '-s', '--max-time', String(maxTime || 25), '-H', 'User-Agent: ' + BROWSER_UA, '-H', 'Accept: application/json', '-H', 'Referer: https://chat.deepseek.com/', '-H', 'Origin: https://chat.deepseek.com', '-H', 'Authorization: Bearer ' + tk, BASE + path],
      cwd: cwd,
      stdio: { stdin: 'ignore', stdout: { maxBytes: 8388608 }, stderr: { maxBytes: 65536 } },
      graceMs: 5000
    })
    const outcome = await handle.done
    const read = handle.collected.stdout.readFrom(0)
    const errRead = handle.collected.stderr.readFrom(0)
    if (outcome.exitCode !== 0) throw new Error('curl exit ' + outcome.exitCode + (errRead.text ? ': ' + errRead.text.slice(0, 200) : ''))
    if (!read.text) throw new Error('curl 空响应')
    try { return JSON.parse(read.text) } catch (e) { throw new Error('响应不是 JSON: ' + read.text.slice(0, 200)) }
  }

  const saveSessionData = async (sessionId, payload) => {
    try {
      await ensureDataDir()
      const path = filePath('dsweb-sessions-' + String(sessionId) + '.json')
      await writeFile(path, JSON.stringify(payload, null, 2), 'utf8')
      return { ok: true, path: path }
    } catch (e) { return { ok: false, error: String(e) } }
  }

  const fetchSessionContent = async (sid) => {
    const json = await dsApi('/api/v0/chat/history_messages?chat_session_id=' + encodeURIComponent(sid))
    const biz = json && json.data && json.data.biz_data
    if (!biz) throw new Error('无 biz_data')
    const messages = biz.chat_messages || []
    const session = biz.chat_session || {}
    const payload = {
      saved_at: new Date().toISOString(),
      session: { id: session.id || sid, title: session.title || '', title_type: session.title_type, updated_at: session.updated_at, pinned: session.pinned, model_type: session.model_type },
      message_count: messages.length,
      messages: messages
    }
    const w = await saveSessionData(sid, payload)
    if (!w.ok) throw new Error(w.error)
    return payload
  }

  const upsertIndex = async (sid, title, updatedAt, modelType, messageCount, contentFetched) => {
    const locals = await readLocalIndex()
    const idx = locals.filter((l) => l.session_id !== sid)
    idx.push({ session_id: sid, title: title || '', updated_at: updatedAt || 0, model_type: modelType || '', message_count: messageCount || 0, content_fetched: !!contentFetched, saved_at: new Date().toISOString() })
    await writeLocalIndex(idx)
    return idx
  }

  const fetchRecentSessions = async () => {
    const json = await dsApi('/api/v0/chat_session/fetch_page?count=100')
    const biz = json && json.data && json.data.biz_data
    if (!biz) throw new Error('fetch_page 无 biz_data')
    return (biz.chat_sessions || []).map((s) => ({ id: s.id, title: s.title, title_type: s.title_type, updated_at: s.updated_at, pinned: s.pinned, model_type: s.model_type }))
  }

  const syncOnce = async () => {
    if (syncInFlight) return { ok: true, message: '同步已在运行' }
    if (initInFlight) return { ok: true, message: '初始化进行中，稍后自动同步' }
    syncInFlight = true
    try {
      const tk = await ensureToken()
      if (!tk) { ctx.logger.info(`[${name}] 无 token，跳过同步`); return { ok: false, message: '未配置 token' } }
      const remote = await fetchRecentSessions()
      const locals = await readLocalIndex()
      const localById = new Map(locals.map((l) => [l.session_id, l]))
      let pulled = 0
      let refreshed = 0
      let touched = 0
      for (const s of remote) {
        const local = localById.get(s.id)
        if (!local) {
          try {
            const payload = await fetchSessionContent(s.id)
            await upsertIndex(s.id, payload.session.title, payload.session.updated_at, payload.session.model_type, payload.message_count, true)
            pulled++
          } catch (e) {
            ctx.logger.warn(`[${name}] 拉取会话失败 ${s.id.slice(0, 8)}: ${String(e)}`)
            await upsertIndex(s.id, s.title, s.updated_at, s.model_type, 0, false)
          }
        } else if (local.content_fetched && (local.updated_at || 0) < (s.updated_at || 0)) {
          try {
            const payload = await fetchSessionContent(s.id)
            await upsertIndex(s.id, payload.session.title, payload.session.updated_at, payload.session.model_type, payload.message_count, true)
            refreshed++
          } catch (e) {
            ctx.logger.warn(`[${name}] 刷新会话失败 ${s.id.slice(0, 8)}: ${String(e)}`)
          }
        } else if (!local.content_fetched && (local.updated_at || 0) !== (s.updated_at || 0)) {
          await upsertIndex(s.id, s.title, s.updated_at, s.model_type, local.message_count || 0, false)
          touched++
        }
      }
      const cfg = await readConfig()
      cfg.lastSyncAt = new Date().toISOString()
      await writeJsonFile('dsweb-config.json', cfg)
      ctx.logger.info(`[${name}] 同步完成：新增 ${pulled}，刷新 ${refreshed}，更新活动 ${touched}`)
      return { ok: true, newSessions: pulled, refreshed: refreshed, touched: touched, total: remote.length }
    } catch (e) {
      ctx.logger.warn(`[${name}] 同步失败: ${String(e)}`)
      return { ok: false, message: String(e).slice(0, 120) }
    } finally {
      syncInFlight = false
    }
  }

  const initImport = async () => {
    if (initInFlight) return { ok: true, message: '初始化已在运行' }
    if (syncInFlight) return { ok: true, message: '同步进行中，稍后重试' }
    initInFlight = true
    let cwd = null
    try {
      const tk = await ensureToken()
      if (!tk) throw new Error('未配置 token')
      ctx.logger.info(`[${name}] 触发官方导出...`)
      await dsApi('/api/v0/export_all')
      let url = null
      for (let i = 0; i < 40; i++) {
        const r = await dsApi('/api/v0/download_export_history')
        const code = r.data && r.data.biz_code
        const biz = r.data && r.data.biz_data
        if (code === 1 || code === 2) break
        if (biz && biz.status === 'FINISHED' && biz.history_download_url) { url = biz.history_download_url; break }
        await ctx.timer.timeout(5000)
      }
      if (!url) throw new Error('导出超时')
      cwd = dataDir()
      await ensureDataDir()
      const exe = await subprocess.resolveExecutable('curl')
      const dl = subprocess.spawn({ argv: [exe, '-s', '--max-time', '120', '-o', 'dsweb-export.zip', url], cwd: cwd, stdio: { stdin: 'ignore', stdout: { maxBytes: 4096 }, stderr: { maxBytes: 65536 } }, graceMs: 5000 })
      await dl.done
      const tarExe = await subprocess.resolveExecutable('tar')
      const extract = subprocess.spawn({ argv: [tarExe, '-xf', 'dsweb-export.zip', '-C', cwd], cwd: cwd, stdio: { stdin: 'ignore', stdout: { maxBytes: 4096 }, stderr: { maxBytes: 65536 } }, graceMs: 5000 })
      await extract.done
      const text = await readFile(filePath('conversations.json'), 'utf8')
      const convs = JSON.parse(text)
      const existingIdx = await readLocalIndex()
      const fetchedMap = {}
      for (const l of existingIdx) fetchedMap[l.session_id] = !!l.content_fetched
      let count = 0
      for (const c of convs) {
        const sid = c.id
        if (!sid) continue
        const updatedAt = c.updated_at ? new Date(c.updated_at).getTime() / 1000 : 0
        let msgCount = 0
        if (c.mapping && typeof c.mapping === 'object') {
          for (const key of Object.keys(c.mapping)) {
            const node = c.mapping[key]
            if (node && node.message != null) msgCount++
          }
        }
        await upsertIndex(sid, c.title || '', updatedAt, '', msgCount, !!fetchedMap[sid])
        count++
      }
      const cfg = await readConfig()
      cfg.lastInitAt = new Date().toISOString()
      cfg.lastSyncAt = new Date().toISOString()
      cfg.initVersion = 11
      await writeJsonFile('dsweb-config.json', cfg)
      ctx.logger.info(`[${name}] 初始化完成：导入 ${count} 个会话清单（含消息数）`)
      return { ok: true, imported: count }
    } catch (e) {
      ctx.logger.warn(`[${name}] 初始化失败: ${String(e)}`)
      return { ok: false, message: String(e).slice(0, 120) }
    } finally {
      initInFlight = false
      if (cwd) await removeFiles(['dsweb-export.zip', 'conversations.json'])
    }
  }

  // 自动同步：每 30 秒检查一次开关与间隔，到期执行一次同步。
  ctx.effect(() => ctx.timer.interval(async () => {
    try {
      const cfg = await readConfig()
      if (!cfg.enabled) return
      const last = cfg.lastSyncAt ? new Date(cfg.lastSyncAt).getTime() : 0
      const due = Date.now() - last >= (cfg.intervalMinutes || 2) * 60000
      if (due) await syncOnce()
    } catch (e) { ctx.logger.warn(`[${name}] 定时同步错误: ${String(e)}`) }
  }, 30000), 'dsh-importer auto sync')

  const maybeAutoInit = async () => {
    try {
      const tk = await ensureToken()
      if (!tk) return
      const cfg = await readConfig()
      if (cfg.lastInitAt && (cfg.initVersion || 0) >= 11) return
      const r = await initImport()
      if (!r.ok && /同步进行中/.test(r.message || '')) {
        ctx.timer.timeout(() => maybeAutoInit(), 30000)
      }
    } catch (e) { ctx.logger.warn(`[${name}] 自动初始化失败: ${String(e)}`) }
  }

  // ---- JSON 端点（client half 通过 fetch 调用） ----

  const readBody = (req) => new Promise((resolve2, reject) => {
    let b = ''
    req.on('data', (c) => { b += c.toString() })
    req.on('end', () => resolve2(b))
    req.on('error', reject)
  })
  const sendJson = (res, status, obj, cors) => {
    res.writeHead(status, Object.assign({ 'Content-Type': 'application/json; charset=utf-8' }, cors))
    res.end(JSON.stringify(obj))
  }
  const corsFor = (origin) => {
    if (!origin || ALLOWED_ORIGINS.indexOf(origin) !== -1) {
      return { 'Access-Control-Allow-Origin': origin || '*', 'Access-Control-Allow-Methods': 'POST, GET, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '86400' }
    }
    return null
  }

  const api = {
    'status': async () => {
      await ensureToken()
      const cfg = await readConfig()
      const idx = await readLocalIndex()
      idx.sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0))
      const locals = idx.filter((l) => l.content_fetched)
      return {
        ok: true,
        tokenStatus: { hasToken: !!token, source: tokenSource, updatedAt: tokenUpdatedAt, token: token || null },
        config: cfg,
        sessions: idx,
        localSessions: locals
      }
    },
    'token.set': async (args) => {
      const t = extractToken(args && args.token)
      if (!t) return { ok: false, error: 'token 无效' }
      token = t; tokenSource = (args && args.source) || 'manual'; tokenUpdatedAt = new Date().toISOString()
      const w = await writeJsonFile('dsweb-token.json', { token: t, source: tokenSource, updatedAt: tokenUpdatedAt })
      if (w.ok) maybeAutoInit()
      return w
    },
    'config.set': async (args) => {
      const cfg = await readConfig()
      if (args && typeof args.enabled === 'boolean') cfg.enabled = args.enabled
      if (args && typeof args.intervalMinutes === 'number') cfg.intervalMinutes = args.intervalMinutes
      const w = await writeJsonFile('dsweb-config.json', cfg)
      return w.ok ? { ok: true } : w
    },
    'syncNow': async () => {
      const r = await syncOnce()
      if (!r.ok) return { ok: false, message: r.message || '同步失败' }
      const parts = []
      if (r.newSessions) parts.push('新增 ' + r.newSessions + ' 个')
      if (r.refreshed) parts.push('刷新 ' + r.refreshed + ' 个')
      if (r.touched) parts.push('更新活动 ' + r.touched + ' 个')
      return { ok: true, message: parts.length ? ('同步完成，' + parts.join('，')) : '同步完成，无变化' }
    },
    'initImport': async () => {
      const r = await initImport()
      return r.ok ? { ok: true, message: '已导入 ' + r.imported + ' 个会话清单' } : { ok: false, message: r.message || '初始化失败' }
    },
    'fetchSession': async (args) => {
      const sid = args && args.sessionId
      if (!sid) return { ok: false, error: '缺少 sessionId' }
      try {
        const payload = await fetchSessionContent(sid)
        await upsertIndex(sid, payload.session.title, payload.session.updated_at, payload.session.model_type, payload.message_count, true)
        return { ok: true, messageCount: payload.message_count }
      } catch (e) { return { ok: false, error: String(e) } }
    },
    'buildPrompt': async (args) => {
      const sid = args && args.sessionId
      if (!sid) return { ok: false, error: '缺少 sessionId' }
      try {
        const path = filePath('dsweb-sessions-' + String(sid) + '.json')
        const text = '阅读以下内容并将其作为上下文的一部分，理解内容后根据我的要求回答：`' + path + '`'
        return { ok: true, text: text }
      } catch (e) { return { ok: false, error: String(e) } }
    },
    'readSession': async (args) => {
      const sid = args && args.sessionId
      if (!sid) return { ok: false, error: '缺少 sessionId' }
      try {
        return { ok: true, data: JSON.parse(await readFile(filePath('dsweb-sessions-' + String(sid) + '.json'), 'utf8')) }
      } catch (e) { return { ok: false, error: String(e) } }
    },
    'deleteSession': async (args) => {
      const sid = args && args.sessionId
      if (!sid) return { ok: false, error: '缺少 sessionId' }
      const locals = await readLocalIndex()
      await writeLocalIndex(locals.filter((l) => l.session_id !== sid))
      await removeFiles(['dsweb-sessions-' + String(sid) + '.json'])
      return { ok: true }
    }
  }

  // webServer 是异步激活的可选服务：用 ctx.inject 子 fiber 等待它就绪后再
  // 注册路由（官方可选后端惯用法，同 dsh-balance 对 webServer 的处理）。
  ctx.inject(['webServer'], (webCtx) => {
    const webServer = webCtx.get('webServer')
    if (webServer === undefined) return
    // 统一 API 端点：POST body { action, args }
    webCtx.effect(() => webServer.register({
      kind: 'exact', path: '/plugins/dsh-importer/api',
      handler: async (req, res) => {
        const origin = req.headers.origin
        if (origin && ALLOWED_ORIGINS.indexOf(origin) === -1) {
          sendJson(res, 403, { ok: false, error: 'origin not allowed' })
          return
        }
        const cors = corsFor(origin)
        if (req.method === 'OPTIONS') { res.writeHead(204, cors); res.end(); return }
        if (req.method !== 'POST') { sendJson(res, 405, { ok: false, error: 'method not allowed' }, cors); return }
        try {
          const body = JSON.parse(await readBody(req))
          const action = body && body.action
          const handler = api[action]
          if (typeof handler !== 'function') { sendJson(res, 400, { ok: false, error: 'unknown action: ' + String(action) }, cors); return }
          const result = await handler(body.args)
          sendJson(res, 200, result, cors)
        } catch (e) {
          sendJson(res, 400, { ok: false, error: String(e) }, cors)
        }
      }
    }), 'dsh-importer: api route')

    // 书签配置端点（向后兼容旧路径）：POST { token, source }
    webCtx.effect(() => webServer.register({
      kind: 'exact', path: '/api/dsweb/token',
      handler: async (req, res) => {
        const origin = req.headers.origin
        if (origin && ALLOWED_ORIGINS.indexOf(origin) === -1) {
          sendJson(res, 403, { ok: false, error: 'origin not allowed' })
          return
        }
        const cors = corsFor(origin)
        if (req.method === 'OPTIONS') { res.writeHead(204, cors); res.end(); return }
        if (req.method !== 'POST') { sendJson(res, 405, { ok: false, error: 'method not allowed' }, cors); return }
        try {
          const parsed = JSON.parse(await readBody(req))
          const t = extractToken(parsed.token)
          if (!t) { sendJson(res, 400, { ok: false, error: 'token 无效' }, cors); return }
          token = t; tokenSource = parsed.source || 'bookmark'; tokenUpdatedAt = new Date().toISOString()
          await writeJsonFile('dsweb-token.json', { token: t, source: tokenSource, updatedAt: tokenUpdatedAt })
          maybeAutoInit()
          sendJson(res, 200, { ok: true }, cors)
        } catch (e) { sendJson(res, 400, { ok: false, error: String(e) }, cors) }
      }
    }), 'dsh-importer: token route')
  })

  maybeAutoInit()
  ctx.logger.info(`[${name}] host ready（数据目录：${dataDir()}，自动同步 + Origin 校验）`)
}
