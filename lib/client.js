/**
 * dsh-importer — client half（浏览器 bundle）。
 *
 * 惰性 CJS client bundle 契约：执行本脚本只注册 factory
 * （window.__ModuleLoader__.load({ id, factory })）；factory 在物化时运行并
 * 返回 { name, inject, apply }，client kernel 随后调用 apply(ctx) 挂载。
 *
 * 本 bundle 填充官方 settings.section slot：在设置页注册"网页版同步"分节，
 * 提供三个子页面（会话列表 / 本地会话 / 设置），支持搜索排序分页、行内查看、
 * token 管理、自动同步开关，以及"发送"按钮——把引用本地会话文件的提示词
 * 填入主输入框，由用户确认后发送（AI 自行读取文件内容）。
 *
 * 数据源：节点侧统一 JSON 端点 POST /plugins/dsh-importer/api
 * （body { action, args }，同源 fetch，token 只存在于节点侧）。
 *
 * 样式：注入带 data-plugin-css 防重的 <style> 标签（与官方复杂 UI 插件一致；
 * 宿主清理插件注入样式时按该标记处理）。
 */
window.__ModuleLoader__.load({
  id: 'dsh-importer',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
    const React = require('react')

    const CSS = `
.dsw-root { font-size: 13px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Helvetica Neue', Arial, sans-serif; }
.dsw-tabs { display: flex; gap: 4px; background: rgba(128,128,128,0.09); padding: 4px; border-radius: 10px; margin-bottom: 14px; }
.dsw-tab { flex: 1; padding: 7px 10px; border-radius: 8px; border: none; background: transparent; color: inherit; font-size: 13px; font-family: inherit; cursor: pointer; opacity: 0.65; transition: all 0.15s; }
.dsw-tab:hover { opacity: 0.9; }
.dsw-tab.active { background: rgba(255,255,255,0.14); opacity: 1; font-weight: 600; box-shadow: 0 1px 3px rgba(0,0,0,0.15); }
.dsw-card { background: rgba(128,128,128,0.06); border: 1px solid rgba(128,128,128,0.14); border-radius: 10px; padding: 14px 16px; margin-bottom: 12px; }
.dsw-label { font-size: 13px; font-weight: 600; margin-bottom: 4px; }
.dsw-desc { font-size: 12px; color: rgba(128,128,128,0.72); margin-bottom: 10px; }
.dsw-toolbar { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; flex-wrap: wrap; }
.dsw-search { flex: 1; min-width: 120px; padding: 6px 10px; border-radius: 7px; border: 1px solid rgba(128,128,128,0.28); background: rgba(128,128,128,0.05); color: inherit; font-size: 12px; font-family: inherit; outline: none; }
.dsw-search:focus { border-color: rgba(255,255,255,0.4); }
.dsw-seg { display: flex; gap: 4px; background: rgba(128,128,128,0.09); padding: 3px; border-radius: 8px; }
.dsw-seg-btn { padding: 4px 10px; border-radius: 6px; border: none; background: transparent; color: inherit; font-size: 11px; font-family: inherit; cursor: pointer; opacity: 0.65; transition: all 0.15s; }
.dsw-seg-btn.active { background: rgba(255,255,255,0.14); opacity: 1; font-weight: 600; }
.dsw-pager { display: flex; align-items: center; justify-content: center; gap: 10px; margin-top: 10px; }
.dsw-list { display: flex; flex-direction: column; gap: 2px; }
.dsw-row { display: flex; align-items: center; gap: 10px; padding: 9px 10px; border-radius: 8px; transition: background 0.15s; }
.dsw-row:hover { background: rgba(128,128,128,0.08); }
.dsw-row-main { flex: 1; min-width: 0; }
.dsw-row-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; }
.dsw-row-meta { font-size: 11px; color: rgba(128,128,128,0.7); margin-top: 1px; }
.dsw-empty { color: rgba(128,128,128,0.7); font-size: 12px; padding: 10px 4px; }
.dsw-btn { padding: 5px 12px; border-radius: 7px; border: 1px solid rgba(128,128,128,0.28); background: transparent; color: inherit; cursor: pointer; font-size: 12px; font-family: inherit; transition: all 0.15s; white-space: nowrap; }
.dsw-btn:hover { background: rgba(128,128,128,0.12); }
.dsw-btn:disabled { opacity: 0.5; cursor: default; }
.dsw-btn.primary { background: rgba(255,255,255,0.16); border-color: rgba(255,255,255,0.2); }
.dsw-btn.primary:hover { background: rgba(255,255,255,0.24); }
.dsw-btn.danger:hover { border-color: rgba(229,72,77,0.7); color: #e5484d; }
.dsw-input { flex: 1; padding: 7px 10px; border-radius: 7px; border: 1px solid rgba(128,128,128,0.28); background: rgba(128,128,128,0.05); color: inherit; font-size: 13px; font-family: inherit; outline: none; }
.dsw-input:focus { border-color: rgba(255,255,255,0.4); }
.dsw-iconbtn { padding: 6px 9px; border-radius: 7px; border: 1px solid rgba(128,128,128,0.28); background: transparent; color: inherit; cursor: pointer; display: flex; align-items: center; transition: all 0.15s; }
.dsw-iconbtn:hover { background: rgba(128,128,128,0.12); }
.dsw-actions { display: flex; gap: 10px; }
.dsw-help { font-size: 12px; color: rgba(128,128,128,0.75); line-height: 1.7; }
.dsw-code { display: block; white-space: pre-wrap; background: rgba(128,128,128,0.1); padding: 8px 10px; border-radius: 7px; margin: 6px 0; font-size: 11px; font-family: 'Cascadia Code', Consolas, 'Courier New', monospace; word-break: break-all; }
.dsw-log { max-height: 200px; overflow-y: auto; font-size: 12px; }
.dsw-view { max-height: 420px; overflow-y: auto; }
.dsw-msg { margin-bottom: 12px; padding-bottom: 10px; border-bottom: 1px solid rgba(128,128,128,0.12); }
.dsw-msg-role { font-size: 11px; color: rgba(128,128,128,0.7); margin-bottom: 4px; }
.dsw-msg-body { font-size: 13px; white-space: pre-wrap; line-height: 1.7; }
.dsw-msg-think { font-size: 12px; white-space: pre-wrap; color: rgba(128,128,128,0.85); margin-top: 5px; line-height: 1.6; }
.dsw-summary { font-size: 11px; color: rgba(128,128,128,0.7); cursor: pointer; }
.dsw-badge { font-size: 10px; padding: 1px 6px; border-radius: 8px; border: 1px solid rgba(128,128,128,0.3); color: rgba(128,128,128,0.75); }
.dsw-badge.done { border-color: rgba(46,125,50,0.5); color: #4caf50; }
.dsw-inline-view { margin: 2px 10px 10px; background: rgba(128,128,128,0.06); border: 1px solid rgba(128,128,128,0.14); border-radius: 8px; padding: 12px 14px; }
`
    const TAG_ID = 'dsh-importer/DswSync.module.css'
    const injectCss = () => {
      if (typeof document === 'undefined') return
      if (document.querySelector('style[data-plugin-css="' + TAG_ID + '"]') !== null) return
      const tag = document.createElement('style')
      tag.dataset.plugin = 'dsh-importer'
      tag.dataset.pluginCss = TAG_ID
      tag.textContent = CSS
      document.head.appendChild(tag)
    }

    const api = async (action, args) => {
      const res = await fetch('/plugins/dsh-importer/api', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: action, args: args || {} })
      })
      return res.json()
    }

    exports.name = 'dsh-importer'
    exports.inject = ['slots']

    exports.apply = function (ctx) {
      injectCss()
      const slots = ctx.slots
      slots.inject('settings.section', () => slots.register(
        { name: 'settings.section', id: 'dsh-importer-sync', order: 50, label: '网页版同步' },
        (props) => {
          const [tab, setTab] = React.useState('sessions')
          const [tokenStatus, setTokenStatus] = React.useState(null)
          const [tokenInput, setTokenInput] = React.useState('')
          const [showToken, setShowToken] = React.useState(false)
          const [cfg, setCfg] = React.useState(null)
          const [sessions, setSessions] = React.useState([])
          const [locals, setLocals] = React.useState([])
          const [busy, setBusy] = React.useState({})
          const [syncing, setSyncing] = React.useState(false)
          const [log, setLog] = React.useState([])
          const [viewData, setViewData] = React.useState(null)
          const [sQuery, setSQuery] = React.useState('')
          const [sSort, setSSort] = React.useState('updated')
          const [sPage, setSPage] = React.useState(1)
          const [lQuery, setLQuery] = React.useState('')
          const [lSort, setLSort] = React.useState('updated')
          const [lPage, setLPage] = React.useState(1)
          const PAGE_SIZE = 50

          const addLog = (line) => setLog((ls) => [line + '  ' + new Date().toLocaleTimeString()].concat(ls).slice(0, 30))
          const refreshAll = async () => {
            try {
              const r = await api('status')
              if (r && r.ok) {
                if (r.tokenStatus) { setTokenStatus(r.tokenStatus); if (r.tokenStatus.hasToken && r.tokenStatus.token) setTokenInput(r.tokenStatus.token) }
                if (r.config) setCfg(r.config)
                if (r.sessions) setSessions(r.sessions)
                if (r.localSessions) setLocals(r.localSessions)
              }
            } catch (e) { addLog('状态读取失败') }
          }
          React.useEffect(() => { refreshAll() }, [])

          const saveToken = async () => {
            const t = (tokenInput || '').trim()
            if (!t) { addLog('请先粘贴 token'); return }
            try {
              const r = await api('token.set', { token: t, source: 'manual' })
              addLog(r.ok ? '已保存' : '保存失败')
              await refreshAll()
            } catch (e) { addLog('保存失败') }
          }
          const setConfig = async (patch) => {
            if (cfg) setCfg(Object.assign({}, cfg, patch))
            try {
              const r = await api('config.set', patch)
              if (!r.ok) addLog('更新失败')
              await refreshAll()
            } catch (e) { addLog('更新失败'); await refreshAll() }
          }
          const syncNow = async () => {
            setSyncing(true)
            try {
              const r = await api('syncNow')
              addLog(r.message || '同步完成')
              await refreshAll()
            } catch (e) { addLog('同步失败') }
            setSyncing(false)
          }
          const fetchOne = async (sid) => {
            setBusy((b) => Object.assign({}, b, { [sid]: true }))
            try {
              const r = await api('fetchSession', { sessionId: sid })
              addLog(r.ok ? ('已拉取：' + r.messageCount + ' 条消息') : '拉取失败')
              await refreshAll()
            } catch (e) { addLog('拉取失败') }
            setBusy((b) => { const nb = Object.assign({}, b); delete nb[sid]; return nb })
          }
          const toggleView = async (sid) => {
            if (viewData && viewData.session && viewData.session.id === sid) {
              setViewData(null)
              return
            }
            try {
              const r = await api('readSession', { sessionId: sid })
              if (r.ok) { setViewData(r.data) } else { addLog('读取失败') }
            } catch (e) { addLog('读取失败') }
          }
          const sendToAi = async (sid) => {
            setBusy((b) => Object.assign({}, b, { [sid]: true }))
            try {
              const r = await api('buildPrompt', { sessionId: sid })
              if (!r.ok) { addLog('生成提示词失败'); return }
              const tas = document.querySelectorAll('textarea')
              let ta = null
              for (const el of tas) {
                const ph = el.placeholder || ''
                if (el.offsetParent !== null && !/搜索/.test(ph) && ph) ta = el
              }
              if (!ta) { addLog('未找到输入框'); return }
              const proto = Object.getPrototypeOf(ta)
              const desc = Object.getOwnPropertyDescriptor(proto, 'value')
              if (desc && desc.set) desc.set.call(ta, r.text)
              else ta.value = r.text
              ta.dispatchEvent(new Event('input', { bubbles: true }))
              ta.focus()
              addLog('已填入输入框，确认后发送')
            } catch (e) { addLog('填入失败') }
            setBusy((b) => { const nb = Object.assign({}, b); delete nb[sid]; return nb })
          }
          const delLocal = async (sid) => {
            try {
              const r = await api('deleteSession', { sessionId: sid })
              addLog(r.ok ? '已删除' : '删除失败')
              await refreshAll()
            } catch (e) { addLog('删除失败') }
          }

          const fmtTime = (sec) => sec ? new Date(sec * 1000).toLocaleString() : '-'
          const fmtIso = (iso) => iso ? new Date(iso).toLocaleString() : '-'
          const roleOf = (m) => m && (m.role || m.type || '?')
          const fullText = (m, field) => {
            const c = m && m[field]
            const s = typeof c === 'string' ? c : (c == null ? '' : JSON.stringify(c))
            return s || ''
          }
          const computeList = (items, query, sortBy, page) => {
            const filtered = items.filter((s) => {
              if (!query) return true
              return (s.title || '').toLowerCase().includes(query.toLowerCase())
            })
            const sorted = filtered.slice().sort((a, b) => {
              if (sortBy === 'title') return (a.title || '').localeCompare(b.title || '', 'zh')
              if (sortBy === 'count') return (b.message_count || 0) - (a.message_count || 0)
              return (b.updated_at || 0) - (a.updated_at || 0)
            })
            const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE))
            const curPage = Math.min(page, totalPages)
            const pageRows = sorted.slice((curPage - 1) * PAGE_SIZE, curPage * PAGE_SIZE)
            return { sorted, pageRows, totalPages, curPage }
          }
          const isViewing = (sid) => !!(viewData && viewData.session && viewData.session.id === sid)

          const EyeIcon = (off) => React.createElement('svg', { width: 15, height: 15, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', style: { display: 'block' } },
            off
              ? [
                  React.createElement('path', { key: 'a', d: 'M9.88 9.88a3 3 0 1 0 4.24 4.24' }),
                  React.createElement('path', { key: 'b', d: 'M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68' }),
                  React.createElement('path', { key: 'c', d: 'M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61' }),
                  React.createElement('line', { key: 'd', x1: '2', x2: '22', y1: '2', y2: '22' })
                ]
              : [
                  React.createElement('path', { key: 'e', d: 'M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z' }),
                  React.createElement('circle', { key: 'f', cx: '12', cy: '12', r: '3' })
                ]
          )

          const tabBar = React.createElement('div', { className: 'dsw-tabs' },
            React.createElement('button', { className: 'dsw-tab' + (tab === 'sessions' ? ' active' : ''), onClick: () => setTab('sessions') }, '会话列表'),
            React.createElement('button', { className: 'dsw-tab' + (tab === 'locals' ? ' active' : ''), onClick: () => setTab('locals') }, '本地会话'),
            React.createElement('button', { className: 'dsw-tab' + (tab === 'settings' ? ' active' : ''), onClick: () => setTab('settings') }, '设置')
          )

          const tokenEl = React.createElement('div', { className: 'dsw-card' },
            React.createElement('div', { className: 'dsw-label' }, '登录 token'),
            React.createElement('div', { className: 'dsw-desc' }, tokenStatus
              ? (tokenStatus.hasToken
                  ? (tokenStatus.source === 'invalidated' ? '已失效，请重新配置' : '已配置')
                  : '未配置')
              : '读取中...'),
            React.createElement('div', { className: 'dsw-actions' },
              React.createElement('input', {
                className: 'dsw-input', type: 'text', autoComplete: 'off',
                style: { WebkitTextSecurity: showToken ? 'none' : 'disc' },
                placeholder: '粘贴 token', value: tokenInput,
                onChange: (e) => setTokenInput(e.target.value)
              }),
              React.createElement('button', { className: 'dsw-iconbtn', title: showToken ? '隐藏 token' : '显示 token', onClick: () => setShowToken(!showToken) }, EyeIcon(showToken)),
              React.createElement('button', { className: 'dsw-btn primary', onClick: saveToken }, '保存')
            )
          )

          const enabled = !!(cfg && cfg.enabled)
          const cfgEl = React.createElement('div', { className: 'dsw-card' },
            React.createElement('div', { className: 'dsw-label' }, '自动同步'),
            React.createElement('div', { className: 'dsw-desc' }, cfg
              ? ('每 ' + cfg.intervalMinutes + ' 分钟自动检查网页版新会话' + (cfg.enabled ? '' : '（当前已暂停）') + '；上次同步：' + (cfg.lastSyncAt ? fmtIso(cfg.lastSyncAt) : '从未'))
              : '读取中...'),
            React.createElement('div', { className: 'dsw-actions' },
              React.createElement('button', { className: 'dsw-btn' + (enabled ? ' primary' : ''), onClick: () => setConfig({ enabled: !enabled }) }, enabled ? '开启中' : '已暂停'),
              React.createElement('button', { className: 'dsw-btn' + (cfg && cfg.intervalMinutes === 2 ? ' primary' : ''), onClick: () => setConfig({ intervalMinutes: 2 }) }, '2 分钟'),
              React.createElement('button', { className: 'dsw-btn' + (cfg && cfg.intervalMinutes === 5 ? ' primary' : ''), onClick: () => setConfig({ intervalMinutes: 5 }) }, '5 分钟'),
              React.createElement('button', { className: 'dsw-btn' + (cfg && cfg.intervalMinutes === 10 ? ' primary' : ''), onClick: () => setConfig({ intervalMinutes: 10 }) }, '10 分钟')
            )
          )

          const sList = computeList(sessions, sQuery, sSort, sPage)
          const lList = computeList(locals, lQuery, lSort, lPage)

          const segEl = (active, setter, setPageFn) => React.createElement('div', { className: 'dsw-seg' },
            React.createElement('button', { className: 'dsw-seg-btn' + (active === 'updated' ? ' active' : ''), onClick: () => { setter('updated'); setPageFn(1) } }, '最近活动'),
            React.createElement('button', { className: 'dsw-seg-btn' + (active === 'title' ? ' active' : ''), onClick: () => { setter('title'); setPageFn(1) } }, '标题'),
            React.createElement('button', { className: 'dsw-seg-btn' + (active === 'count' ? ' active' : ''), onClick: () => { setter('count'); setPageFn(1) } }, '消息数')
          )

          const pagerEl = (list, setPageFn) => list.totalPages > 1
            ? React.createElement('div', { className: 'dsw-pager' },
                React.createElement('button', { className: 'dsw-btn', onClick: () => setPageFn(Math.max(1, list.curPage - 1)), disabled: list.curPage <= 1 }, '上一页'),
                React.createElement('span', { className: 'dsw-desc', style: { marginBottom: 0 } }, list.curPage + ' / ' + list.totalPages + ' 页'),
                React.createElement('button', { className: 'dsw-btn', onClick: () => setPageFn(Math.min(list.totalPages, list.curPage + 1)), disabled: list.curPage >= list.totalPages }, '下一页')
              )
            : null

          const inlineViewEl = viewData ? React.createElement('div', { className: 'dsw-inline-view' },
            React.createElement('div', { className: 'dsw-label', style: { marginBottom: 8 } },
              ((viewData.session && viewData.session.title) || '(无标题)') + '（' + (viewData.message_count || 0) + ' 条）'),
            React.createElement('div', { className: 'dsw-view' },
              (viewData.messages || []).map((m, i) => React.createElement('div', { key: m.message_id || i, className: 'dsw-msg' },
                React.createElement('div', { className: 'dsw-msg-role' },
                  '[' + roleOf(m) + ']' + (m.model ? ' · ' + m.model : '') + (m.inserted_at ? ' · ' + fmtTime(m.inserted_at) : '')),
                React.createElement('div', { className: 'dsw-msg-body' }, fullText(m, 'content') || '(空)'),
                fullText(m, 'thinking_content')
                  ? React.createElement('details', { style: { marginTop: 5 } },
                      React.createElement('summary', { className: 'dsw-summary' }, '思考过程'),
                      React.createElement('div', { className: 'dsw-msg-think' }, fullText(m, 'thinking_content')))
                  : null
              ))
            )
          ) : null

          const rowEl = (s, sid) => React.createElement('div', { key: 'row-' + sid, className: 'dsw-row' },
            React.createElement('div', { className: 'dsw-row-main' },
              React.createElement('div', { className: 'dsw-row-title' },
                (s.title || '(无标题)'), s.pinned ? ' 置顶' : '',
                React.createElement('span', { className: 'dsw-badge' + (s.content_fetched ? ' done' : ''), style: { marginLeft: 6 } }, s.content_fetched ? (s.message_count + ' 条') : (s.message_count ? (s.message_count + ' 条 · 未拉取') : '未拉取'))),
              React.createElement('div', { className: 'dsw-row-meta' }, fmtTime(s.updated_at) + ' · ' + (s.model_type || ''))
            ),
            s.content_fetched
              ? React.createElement('button', { className: 'dsw-btn' + (isViewing(sid) ? ' primary' : ''), onClick: () => toggleView(sid) }, isViewing(sid) ? '关闭' : '查看')
              : null,
            React.createElement('button', { className: 'dsw-btn', onClick: () => fetchOne(sid), disabled: !!busy[sid] }, busy[sid] ? '拉取中...' : (s.content_fetched ? '重新拉取' : '拉取'))
          )

          const sessionRows = []
          for (const s of sList.pageRows) {
            const sid = s.session_id || s.id
            sessionRows.push(rowEl(s, sid))
            if (isViewing(sid) && inlineViewEl) sessionRows.push(React.createElement('div', { key: 'view-' + sid }, inlineViewEl))
          }

          const localRows = []
          for (const l of lList.pageRows) {
            localRows.push(React.createElement('div', { key: 'row-' + l.session_id, className: 'dsw-row' },
              React.createElement('div', { className: 'dsw-row-main' },
                React.createElement('div', { className: 'dsw-row-title' }, l.title || '(无标题)'),
                React.createElement('div', { className: 'dsw-row-meta' }, l.message_count + ' 条 · ' + fmtTime(l.updated_at))
              ),
              React.createElement('button', { className: 'dsw-btn', onClick: () => sendToAi(l.session_id), disabled: !!busy[l.session_id] }, busy[l.session_id] ? '生成中...' : '发送'),
              React.createElement('button', { className: 'dsw-btn' + (isViewing(l.session_id) ? ' primary' : ''), onClick: () => toggleView(l.session_id) }, isViewing(l.session_id) ? '关闭' : '查看'),
              React.createElement('button', { className: 'dsw-btn danger', onClick: () => delLocal(l.session_id) }, '删除')
            ))
            if (isViewing(l.session_id) && inlineViewEl) localRows.push(React.createElement('div', { key: 'view-' + l.session_id }, inlineViewEl))
          }

          const listEl = React.createElement('div', null,
            React.createElement('div', { className: 'dsw-toolbar' },
              React.createElement('input', {
                className: 'dsw-search', type: 'text', placeholder: '搜索会话标题...',
                value: sQuery, onChange: (e) => { setSQuery(e.target.value); setSPage(1) }
              }),
              segEl(sSort, setSSort, setSPage)
            ),
            React.createElement('div', { className: 'dsw-toolbar' },
              React.createElement('button', { className: 'dsw-btn primary', onClick: syncNow, disabled: syncing }, syncing ? '同步中...' : '立即同步'),
              React.createElement('span', { className: 'dsw-desc', style: { marginBottom: 0 } }, '共 ' + sList.sorted.length + ' 个会话')
            ),
            React.createElement('div', { className: 'dsw-desc' }, cfg && cfg.lastSyncAt ? ('上次自动同步：' + fmtIso(cfg.lastSyncAt)) : '尚未同步，配置 token 后自动开始'),
            sList.sorted.length === 0
              ? React.createElement('div', { className: 'dsw-empty' }, sQuery ? '没有匹配的会话' : '暂无会话清单，等待自动同步')
              : React.createElement('div', null,
                  React.createElement('div', { className: 'dsw-list' }, sessionRows),
                  pagerEl(sList, setSPage)
                )
          )

          const localEl = React.createElement('div', null,
            React.createElement('div', { className: 'dsw-toolbar' },
              React.createElement('input', {
                className: 'dsw-search', type: 'text', placeholder: '搜索已拉取会话...',
                value: lQuery, onChange: (e) => { setLQuery(e.target.value); setLPage(1) }
              }),
              segEl(lSort, setLSort, setLPage)
            ),
            React.createElement('div', { className: 'dsw-desc' }, '共 ' + lList.sorted.length + ' 个已拉取会话'),
            lList.sorted.length === 0
              ? React.createElement('div', { className: 'dsw-empty' }, lQuery ? '没有匹配的会话' : '暂无已拉取内容的会话')
              : React.createElement('div', null,
                  React.createElement('div', { className: 'dsw-list' }, localRows),
                  pagerEl(lList, setLPage)
                )
          )

          const helpEl = React.createElement('div', { className: 'dsw-card' },
            React.createElement('div', { className: 'dsw-label' }, '获取 token'),
            React.createElement('div', { className: 'dsw-help' },
              React.createElement('div', null, '在已登录的 chat.deepseek.com 控制台执行以下命令，会自动复制到剪贴板：'),
              React.createElement('code', { className: 'dsw-code' },
                "copy(JSON.parse(localStorage.getItem('userToken')).value.token || JSON.parse(localStorage.getItem('userToken')).value)"),
              React.createElement('div', { style: { marginTop: 8 } }, '也可以把下面的代码保存为书签，在 chat.deepseek.com 页面点击一次即可自动配置：'),
              React.createElement('code', { className: 'dsw-code' },
                "javascript:(function(){try{var r=localStorage.getItem('userToken');var v=JSON.parse(r);var x=v&&v.value!==undefined?v.value:v;var t=typeof x==='string'?x:(x.token||x.access_token||null);if(!t){alert('未登录');return}fetch('http://127.0.0.1:3080/api/dsweb/token',{method:'POST',headers:{'Content-Type':'text/plain'},body:JSON.stringify({token:t,source:'bookmark'})}).then(function(r){return r.json()}).then(function(d){alert('配置'+(d.ok?'成功':'失败'))}).catch(function(e){alert('配置失败')})}})();")
            )
          )

          const logEl = React.createElement('div', { className: 'dsw-card' },
            React.createElement('div', { className: 'dsw-label' }, '操作记录'),
            React.createElement('div', { className: 'dsw-log' },
              log.length ? log.map((l, i) => React.createElement('div', { key: i }, l)) : React.createElement('div', { className: 'dsw-empty' }, '暂无')
            )
          )

          return React.createElement('div', { className: 'dsw-root' },
            tabBar,
            tab === 'sessions' ? listEl : null,
            tab === 'locals' ? localEl : null,
            tab === 'settings' ? React.createElement('div', null, tokenEl, cfgEl, helpEl, logEl) : null
          )
        }
      ))
    }

    return module.exports
  }
})
