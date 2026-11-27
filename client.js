/**
 * Browser half of the Claude Code session browser.
 *
 * Registers a `Claude sessions` entry in the left sidebar and the page it opens
 * in the main column. The page lists every transcript found by the Host half,
 * groups and sorts them locally, collapses project/time/branch sections, and
 * starts terminals through three Host routes:
 *
 * - resume one transcript (`POST /dsh-claude-sessions/open`);
 * - start a fresh session in a chosen directory (`POST /dsh-claude-sessions/new`).
 *
 * Grouping, sorting and collapsed sections persist in `localStorage` under this
 * plugin's own keys; the page holds no other state.
 */
window.__ModuleLoader__.load({
  id: 'dsh-claude-sessions',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    /** Locale namespace owned by this plugin. */
    const NS = 'claudeSessions'
    /** Sidebar entry id; the main panel registered under the same key. */
    const PANEL_ID = 'claude-sessions'
    const LIST_PATH = '/dsh-claude-sessions/list'
    const OPEN_PATH = '/dsh-claude-sessions/open'
    const NEW_PATH = '/dsh-claude-sessions/new'

    const DAY = 86400000
    const GROUP_MODES = ['project', 'time', 'branch', 'none']
    const SORT_MODES = ['updated-desc', 'updated-asc', 'created-desc', 'size-desc', 'title-asc']
    const STORE_GROUP = 'dsh.claudeSessions.group'
    const STORE_SORT = 'dsh.claudeSessions.sort'
    const STORE_COLLAPSED = 'dsh.claudeSessions.collapsed'
    /** Rows shown inside one group before its "more" control folds the rest away. */
    const SESSION_LIMIT = 3
    const TIME_BUCKETS = [
      { key: 'today', label: 'timeToday', start: 0 },
      { key: 'yesterday', label: 'timeYesterday', start: 1 },
      { key: 'week', label: 'timeWeek', start: 2 },
      { key: 'month', label: 'timeMonth', start: 30 },
      { key: 'older', label: 'timeOlder', start: Infinity },
    ]

    const en = {
      panel: 'Claude sessions',
      title: 'Claude Code sessions',
      subtitle: 'Every Claude Code CLI transcript on this machine.',
      summary: '{sessions} sessions · {projects} projects',
      statSessions: 'sessions',
      statProjects: 'projects',
      statLast: 'last active',
      updated: 'Last update {time}',
      search: 'Search sessions',
      groupBy: 'Group by',
      groupProject: 'Project',
      groupTime: 'Time',
      groupBranch: 'Branch',
      groupNone: 'No grouping',
      groupAll: 'All sessions',
      sortBy: 'Sort by',
      sortUpdatedDesc: 'Newest updated',
      sortUpdatedAsc: 'Oldest updated',
      sortCreatedDesc: 'Newest created',
      sortSizeDesc: 'Largest first',
      sortTitleAsc: 'Title A–Z',
      timeToday: 'Today',
      timeYesterday: 'Yesterday',
      timeWeek: 'Previous 7 days',
      timeMonth: 'Previous 30 days',
      timeOlder: 'Older',
      noBranch: 'No branch',
      more: 'Show {count} more',
      less: 'Show less',
      expandAll: 'Expand all',
      collapseAll: 'Collapse all',
      refresh: 'Refresh',
      refreshing: 'Refreshing…',
      loading: 'Reading Claude Code sessions…',
      empty: 'No Claude Code sessions yet',
      emptyHint: 'They appear here once the Claude Code CLI writes a transcript to {path}.',
      noMatch: 'No session matches “{query}”.',
      clearSearch: 'Clear search',
      failed: 'Could not read the session list.',
      retry: 'Retry',
      open: 'Resume',
      opening: 'Opening…',
      opened: 'Resumed in a new terminal. Switch to it to continue the session.',
      newSession: 'New session',
      newSessionHere: 'New session in this project',
      newSessionTitle: 'Start a Claude session',
      newSessionHint: 'Choose a directory; the CLI starts there in a new terminal.',
      directory: 'Working directory',
      directoryPlaceholder: 'An absolute path, e.g. C:\\work\\project',
      recent: 'Recent directories',
      recentEmpty: 'No directory has a transcript yet.',
      pickFolder: 'Choose folder…',
      picking: 'Opening the folder chooser…',
      noDirectory: 'No folder chosen yet',
      typeInstead: 'Type a path instead',
      errorPickUnavailable: 'No folder chooser is available here; type a path instead.',
      pickFailed: 'Could not open the folder chooser: {message}',
      sessionsCount: '{count} sessions',
      cancel: 'Cancel',
      start: 'Start',
      starting: 'Starting…',
      newSessionOpened: 'A new Claude session was opened in a terminal.',
      errorNotFound: 'That transcript is gone. Refresh the list and try again.',
      errorCwd: 'The session’s working directory no longer exists: {cwd}',
      errorBadCwd: 'Enter an absolute directory path.',
      errorNotDirectory: 'That directory does not exist: {cwd}',
      errorLaunch: 'Could not start a terminal: {message}',
      errorOrigin: 'This page is not allowed to start a terminal for this Host.',
      errorNewRoute: 'The Host does not provide the new-session route yet; restart DeepSeek Harness.',
      errorGeneric: 'Could not open the session: {message}',
      unknownProject: 'Unknown project',
      truncated: 'Showing the newest {count} sessions.',
    }

    const zh = {
      panel: 'Claude 会话',
      title: 'Claude Code 会话',
      subtitle: '本机上所有 Claude Code CLI 会话记录。',
      summary: '{sessions} 个会话 · {projects} 个项目',
      statSessions: '会话',
      statProjects: '项目',
      statLast: '最近活动',
      updated: '最后更新 {time}',
      search: '搜索会话',
      groupBy: '分组',
      groupProject: '按项目',
      groupTime: '按时间',
      groupBranch: '按分支',
      groupNone: '不分组',
      groupAll: '全部会话',
      sortBy: '排序',
      sortUpdatedDesc: '最近更新',
      sortUpdatedAsc: '最早更新',
      sortCreatedDesc: '最近创建',
      sortSizeDesc: '体积最大',
      sortTitleAsc: '标题 A–Z',
      timeToday: '今天',
      timeYesterday: '昨天',
      timeWeek: '最近 7 天',
      timeMonth: '最近 30 天',
      timeOlder: '更早',
      noBranch: '无分支',
      more: '显示其余 {count} 条',
      less: '收起',
      expandAll: '全部展开',
      collapseAll: '全部折叠',
      refresh: '刷新',
      refreshing: '刷新中…',
      loading: '正在读取 Claude Code 会话…',
      empty: '还没有 Claude Code 会话',
      emptyHint: 'Claude Code CLI 写入记录后会出现在这里：{path}',
      noMatch: '没有匹配“{query}”的会话。',
      clearSearch: '清空搜索',
      failed: '读取会话列表失败。',
      retry: '重试',
      open: '恢复',
      opening: '正在打开…',
      opened: '已在新终端中恢复该会话，切换过去即可继续。',
      newSession: '新建会话',
      newSessionHere: '在此项目新建会话',
      newSessionTitle: '新建 Claude 会话',
      newSessionHint: '选择工作目录，CLI 会在新终端里从该目录启动。',
      directory: '工作目录',
      directoryPlaceholder: '绝对路径，例如 C:\\work\\project',
      recent: '最近使用的目录',
      recentEmpty: '还没有任何目录的会话记录。',
      pickFolder: '选择文件夹…',
      picking: '正在打开文件夹选择器…',
      noDirectory: '还未选择文件夹',
      typeInstead: '改为手动输入路径',
      errorPickUnavailable: '当前环境没有文件夹选择器，请改为手动输入路径。',
      pickFailed: '无法打开文件夹选择器：{message}',
      sessionsCount: '{count} 个会话',
      cancel: '取消',
      start: '启动',
      starting: '启动中…',
      newSessionOpened: '已在新终端中新建 Claude 会话。',
      errorNotFound: '该记录已不存在，请刷新列表后重试。',
      errorCwd: '会话的工作目录已不存在：{cwd}',
      errorBadCwd: '请输入绝对路径的目录。',
      errorNotDirectory: '该目录不存在：{cwd}',
      errorLaunch: '无法启动终端：{message}',
      errorOrigin: '当前页面无权为该 Host 启动终端。',
      errorNewRoute: 'Host 还没有提供新建会话接口，请重启 DeepSeek Harness。',
      errorGeneric: '打开会话失败：{message}',
      unknownProject: '未知项目',
      truncated: '仅显示最新的 {count} 个会话。',
    }

    const CSS = `
.dcs-page {
  --dcs-bg: #0d1117;
  --dcs-bg-2: #11161d;
  --dcs-bg-3: #161c25;
  --dcs-hover: #1a212b;
  --dcs-line: #222a34;
  --dcs-line-2: #2c3642;
  --dcs-text: #d8e0e8;
  --dcs-text-2: #9aa6b4;
  --dcs-text-3: #6f7b8a;
  --dcs-accent: #58b6c8;
  --dcs-accent-dim: #2a5b66;
  --dcs-danger: #e06c75;
  --dcs-ok: #5fb87a;
  --dsh-scrollbar-thumb: #2c3642;
  --dsh-scrollbar-thumb-hover: #3a4653;
  color-scheme: dark;
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  box-sizing: border-box;
  background: var(--dcs-bg);
  color: var(--dcs-text);
}
.dcs-head { flex: none; display: flex; flex-direction: column; gap: 14px; padding: calc(22px + var(--dsh-frame-top-clearance, 0px)) clamp(18px, 3.5vw, 36px) 14px; border-bottom: 1px solid var(--dcs-line); }
.dcs-head-top { display: flex; flex-wrap: wrap; align-items: flex-end; justify-content: space-between; gap: 12px 20px; }
.dcs-heading { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.dcs-title { margin: 0; font-size: 18px; line-height: 26px; font-weight: 600; letter-spacing: 0.01em; }
.dcs-subtitle { margin: 0; font-size: 12px; line-height: 18px; color: var(--dcs-text-3); }
.dcs-stats { display: flex; align-items: stretch; overflow: hidden; border: 1px solid var(--dcs-line); border-radius: 8px; background: var(--dcs-bg-2); }
.dcs-stat { display: flex; flex-direction: column; gap: 1px; min-width: 80px; padding: 6px 14px; }
.dcs-stat + .dcs-stat { border-left: 1px solid var(--dcs-line); }
.dcs-stat-value { font-size: 15px; line-height: 20px; font-weight: 600; font-variant-numeric: tabular-nums; }
.dcs-stat-label { font-size: 10.5px; line-height: 14px; color: var(--dcs-text-3); }
.dcs-controls { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.dcs-search { flex: 1 1 200px; min-width: 150px; max-width: 320px; height: 32px; box-sizing: border-box; padding: 0 11px; border: 1px solid var(--dcs-line-2); border-radius: 6px; background: var(--dcs-bg-2); color: var(--dcs-text); font: inherit; font-size: 12.5px; outline: none; transition: border-color 120ms ease, box-shadow 120ms ease; }
.dcs-search::placeholder { color: var(--dcs-text-3); }
.dcs-search:focus-visible { border-color: var(--dcs-accent-dim); box-shadow: 0 0 0 1px var(--dcs-accent-dim); }
.dcs-select { height: 32px; box-sizing: border-box; padding: 0 8px; border: 1px solid var(--dcs-line-2); border-radius: 6px; background: var(--dcs-bg-2); color: var(--dcs-text); font: inherit; font-size: 12.5px; outline: none; cursor: pointer; }
.dcs-select:focus-visible { border-color: var(--dcs-accent-dim); box-shadow: 0 0 0 1px var(--dcs-accent-dim); }
.dcs-spacer { flex: 1 1 auto; }
.dcs-icon-button { display: inline-flex; align-items: center; justify-content: center; width: 32px; height: 32px; box-sizing: border-box; padding: 0; border: 1px solid var(--dcs-line-2); border-radius: 6px; background: var(--dcs-bg-2); color: var(--dcs-text-2); cursor: pointer; transition: background 120ms ease, color 120ms ease, border-color 120ms ease; }
.dcs-icon-button:active:not(:disabled) { background: var(--dcs-hover); }
.dcs-icon-button:disabled { opacity: 0.45; cursor: default; }
.dcs-icon-button:focus-visible { outline: 2px solid var(--dcs-accent-dim); outline-offset: 1px; }
@media (hover: hover) { .dcs-icon-button:hover:not(:disabled) { background: var(--dcs-hover); color: var(--dcs-text); border-color: #37424f; } }
.dcs-primary { display: inline-flex; align-items: center; justify-content: center; gap: 6px; height: 32px; box-sizing: border-box; padding: 0 13px; border: 1px solid transparent; border-radius: 6px; background: var(--dcs-accent); color: #08181d; font: inherit; font-size: 12.5px; font-weight: 600; cursor: pointer; }
.dcs-primary:active:not(:disabled) { background: #4aa6b8; }
.dcs-primary:disabled { opacity: 0.45; cursor: default; }
.dcs-primary:focus-visible { outline: 2px solid var(--dcs-accent-dim); outline-offset: 2px; }
@media (hover: hover) { .dcs-primary:hover:not(:disabled) { background: #6cc4d4; } }
.dcs-ghost { display: inline-flex; align-items: center; height: 32px; box-sizing: border-box; padding: 0 11px; border: 1px solid var(--dcs-line-2); border-radius: 6px; background: transparent; color: var(--dcs-text-2); font: inherit; font-size: 12.5px; cursor: pointer; }
.dcs-ghost:focus-visible { outline: 2px solid var(--dcs-accent-dim); outline-offset: 1px; }
@media (hover: hover) { .dcs-ghost:hover { background: var(--dcs-hover); color: var(--dcs-text); } }
.dcs-notice { margin: 0; padding: 7px 11px; border: 1px solid var(--dcs-line); border-left: 2px solid var(--dcs-accent); border-radius: 6px; background: var(--dcs-bg-2); font-size: 12px; line-height: 18px; color: var(--dcs-text-2); }
.dcs-notice[data-tone='ok'] { border-left-color: var(--dcs-ok); color: var(--dcs-text); }
.dcs-notice[data-tone='error'] { border-left-color: var(--dcs-danger); color: #f0a3a9; }
.dcs-body { flex: 1; min-height: 0; overflow-y: auto; padding: 16px clamp(18px, 3.5vw, 36px) 48px; }
.dcs-inner { display: flex; flex-direction: column; gap: 12px; max-width: 880px; margin: 0 auto; }
.dcs-message { margin: 0; font-size: 12.5px; line-height: 20px; color: var(--dcs-text-3); }
.dcs-failure { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; font-size: 12.5px; line-height: 20px; color: var(--dcs-danger); }
.dcs-group { overflow: hidden; border: 1px solid var(--dcs-line); border-radius: 10px; background: var(--dcs-bg-2); }
.dcs-group-head { display: flex; align-items: center; gap: 4px; padding-right: 8px; transition: background 120ms ease; }
@media (hover: hover) { .dcs-group-head:hover { background: var(--dcs-hover); } }
.dcs-group-toggle { display: flex; flex: 1; min-width: 0; align-items: center; gap: 8px; padding: 9px 4px 9px 12px; border: 0; background: transparent; color: inherit; font: inherit; text-align: left; cursor: pointer; }
.dcs-group-toggle:focus-visible { outline: 2px solid var(--dcs-accent-dim); outline-offset: -2px; }
.dcs-group-new { display: inline-flex; flex: none; align-items: center; justify-content: center; width: 24px; height: 24px; padding: 0; border: 1px solid transparent; border-radius: 6px; background: transparent; color: var(--dcs-text-3); font: inherit; font-size: 13px; line-height: 1; cursor: pointer; transition: background 120ms ease, color 120ms ease, border-color 120ms ease; }
.dcs-group-new:disabled { opacity: 0.6; cursor: default; }
.dcs-group-new:focus-visible { outline: 2px solid var(--dcs-accent-dim); outline-offset: 1px; }
@media (hover: hover) { .dcs-group-new:hover:not(:disabled) { background: #202935; border-color: var(--dcs-line-2); color: var(--dcs-text); } }
.dcs-group-title { flex: none; font-size: 13px; line-height: 20px; font-weight: 600; }
.dcs-group-count { flex: none; padding: 0 6px; border-radius: 999px; background: #1d2530; font-size: 10.5px; line-height: 17px; color: var(--dcs-text-2); font-variant-numeric: tabular-nums; }
.dcs-group-caption { flex: 1; min-width: 0; font-size: 11px; line-height: 16px; color: var(--dcs-text-3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dcs-group-time { flex: none; font-size: 11px; line-height: 16px; color: var(--dcs-text-3); white-space: nowrap; font-variant-numeric: tabular-nums; }
.dcs-chevron { flex: none; color: var(--dcs-text-2); transition: transform 160ms ease; }
.dcs-chevron[data-open='true'] { transform: rotate(90deg); }
.dcs-rows { margin: 0; padding: 0; list-style: none; }
.dcs-more { display: flex; align-items: center; justify-content: center; gap: 6px; width: 100%; box-sizing: border-box; padding: 8px 12px; border: 0; border-top: 1px solid var(--dcs-line); background: transparent; color: var(--dcs-text-2); font: inherit; font-size: 12px; cursor: pointer; transition: background 120ms ease, color 120ms ease; }
.dcs-more:focus-visible { outline: 2px solid var(--dcs-accent-dim); outline-offset: -2px; }
@media (hover: hover) { .dcs-more:hover { background: var(--dcs-hover); color: var(--dcs-text); } }
.dcs-row { position: relative; display: flex; align-items: center; gap: 12px; width: 100%; box-sizing: border-box; padding: 9px 12px; border: 0; border-top: 1px solid var(--dcs-line); background: transparent; color: inherit; font: inherit; text-align: left; cursor: pointer; transition: background 120ms ease; }
.dcs-row::before { content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: 2px; background: var(--dcs-accent); opacity: 0; transition: opacity 120ms ease; }
.dcs-rows li:first-child .dcs-row { border-top: 0; }
.dcs-row:focus-visible { outline: 2px solid var(--dcs-accent-dim); outline-offset: -2px; }
.dcs-row:disabled { cursor: default; }
@media (hover: hover) { .dcs-row:hover:not(:disabled) { background: var(--dcs-hover); } .dcs-row:hover::before { opacity: 0.9; } .dcs-row:hover .dcs-row-action { opacity: 1; } }
.dcs-row-main { display: flex; flex: 1; flex-direction: column; gap: 3px; min-width: 0; }
.dcs-row-title { font-size: 13.5px; line-height: 19px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dcs-row-prompt { font-size: 12px; line-height: 17px; color: var(--dcs-text-2); display: -webkit-box; -webkit-line-clamp: 1; -webkit-box-orient: vertical; overflow: hidden; overflow-wrap: anywhere; }
.dcs-row-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; font-size: 11px; line-height: 16px; color: var(--dcs-text-3); font-variant-numeric: tabular-nums; }
.dcs-chip { padding: 0 6px; border: 1px solid var(--dcs-accent-dim); border-radius: 4px; background: #132329; color: #8fd6e3; }
.dcs-row-id { font-family: var(--ds-font-family-code, ui-monospace, SFMono-Regular, Menlo, monospace); }
.dcs-row-action { display: inline-flex; flex: none; align-items: center; gap: 3px; height: 24px; box-sizing: border-box; padding: 0 8px; border: 1px solid var(--dcs-line-2); border-radius: 6px; font-size: 11.5px; line-height: 18px; color: var(--dcs-text-2); opacity: 0; transition: opacity 120ms ease; }
@media (hover: none) { .dcs-row-action { opacity: 1; } }
@media (prefers-reduced-motion: reduce) { .dcs-chevron, .dcs-row, .dcs-row-action, .dcs-row::before, .dcs-group-head { transition: none; } }
.dcs-empty { display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 56px 16px; text-align: center; }
.dcs-empty-icon { color: var(--dcs-text-3); }
.dcs-empty-title { margin: 0; font-size: 13.5px; line-height: 22px; font-weight: 600; }
.dcs-empty-text { margin: 0; max-width: 440px; font-size: 12px; line-height: 19px; color: var(--dcs-text-3); overflow-wrap: anywhere; }
.dcs-skeleton-row { display: flex; flex-direction: column; gap: 7px; padding: 13px 12px; }
.dcs-skeleton-bar { height: 10px; border-radius: 3px; background: #1c242e; animation: dcs-pulse 1.6s ease-in-out infinite; }
.dcs-skeleton-bar[data-w='title'] { width: min(240px, 60%); }
.dcs-skeleton-bar[data-w='prompt'] { width: min(420px, 85%); height: 8px; }
.dcs-skeleton-bar[data-w='meta'] { width: 150px; height: 7px; }
@keyframes dcs-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.45; } }
@media (prefers-reduced-motion: reduce) { .dcs-skeleton-bar { animation: none; } }
.dcs-overlay { position: fixed; inset: 0; z-index: 1200; display: flex; align-items: center; justify-content: center; padding: 24px; background: rgba(3, 6, 10, 0.62); }
.dcs-dialog { display: flex; flex-direction: column; gap: 14px; width: min(480px, 100%); max-height: min(620px, calc(100vh - 48px)); box-sizing: border-box; padding: 18px 20px 16px; overflow: hidden; border: 1px solid var(--dcs-line-2); border-radius: 12px; background: #141a22; color: var(--dcs-text); box-shadow: 0 24px 64px rgba(0, 0, 0, 0.5); }
.dcs-dialog:focus { outline: none; }
.dcs-dialog-head { display: flex; flex: none; align-items: flex-start; justify-content: space-between; gap: 12px; }
.dcs-dialog-title { margin: 0; font-size: 15.5px; line-height: 24px; font-weight: 600; }
.dcs-dialog-hint { margin: 3px 0 0; font-size: 12px; line-height: 18px; color: var(--dcs-text-3); }
.dcs-dialog-close { display: inline-flex; flex: none; align-items: center; justify-content: center; width: 26px; height: 26px; padding: 0; border: 1px solid transparent; border-radius: 6px; background: transparent; color: var(--dcs-text-3); cursor: pointer; }
@media (hover: hover) { .dcs-dialog-close:hover { border-color: var(--dcs-line-2); color: var(--dcs-text); background: var(--dcs-hover); } }
.dcs-field { display: flex; flex: none; flex-direction: column; gap: 8px; min-height: 0; }
.dcs-field-grow { flex: 1 1 auto; min-height: 0; }
.dcs-field-label { font-size: 11px; line-height: 16px; color: var(--dcs-text-3); }
.dcs-input { height: 34px; box-sizing: border-box; padding: 0 11px; border: 1px solid var(--dcs-line-2); border-radius: 6px; background: var(--dcs-bg-2); color: var(--dcs-text); font: inherit; font-size: 12.5px; outline: none; }
.dcs-input:focus { border-color: var(--dcs-accent-dim); box-shadow: 0 0 0 1px var(--dcs-accent-dim); }
.dcs-pick { display: flex; align-items: center; justify-content: center; gap: 8px; width: 100%; height: 40px; box-sizing: border-box; padding: 0 12px; border: 1px solid var(--dcs-line-2); border-radius: 8px; background: var(--dcs-hover); color: var(--dcs-text); font: inherit; font-size: 12.5px; cursor: pointer; transition: background 120ms ease, border-color 120ms ease; }
.dcs-pick:active:not(:disabled) { background: #202935; }
.dcs-pick:disabled { opacity: 0.55; cursor: default; }
.dcs-pick:focus-visible { outline: 2px solid var(--dcs-accent-dim); outline-offset: 2px; }
@media (hover: hover) { .dcs-pick:hover:not(:disabled) { border-color: #3d4a59; background: #202935; } }
.dcs-path { padding: 8px 11px; border: 1px solid var(--dcs-line); border-radius: 6px; background: #0f141b; font-family: var(--ds-font-family-code, ui-monospace, SFMono-Regular, Menlo, monospace); font-size: 11.5px; line-height: 18px; color: var(--dcs-text); overflow-wrap: anywhere; }
.dcs-path[data-empty='true'] { color: var(--dcs-text-3); font-family: inherit; }
.dcs-linkish { align-self: flex-start; padding: 0; border: 0; background: none; color: var(--dcs-text-3); font: inherit; font-size: 11.5px; line-height: 18px; cursor: pointer; }
.dcs-linkish:focus-visible { outline: 2px solid var(--dcs-accent-dim); outline-offset: 2px; }
@media (hover: hover) { .dcs-linkish:hover { color: var(--dcs-accent); } }
.dcs-recent { display: flex; flex: 1 1 auto; flex-direction: column; gap: 2px; min-height: 0; max-height: 240px; overflow-y: auto; margin: 0; padding: 0; list-style: none; }
.dcs-recent-row { display: flex; align-items: center; gap: 10px; width: 100%; box-sizing: border-box; padding: 7px 9px; border: 1px solid transparent; border-radius: 6px; background: transparent; color: inherit; font: inherit; text-align: left; cursor: pointer; }
.dcs-recent-row[data-selected='true'] { border-color: var(--dcs-accent-dim); background: #132329; }
@media (hover: hover) { .dcs-recent-row:hover { background: var(--dcs-hover); } }
.dcs-recent-path { flex: 1; min-width: 0; font-family: var(--ds-font-family-code, ui-monospace, SFMono-Regular, Menlo, monospace); font-size: 11px; line-height: 16px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dcs-recent-count { flex: none; font-size: 10.5px; line-height: 16px; color: var(--dcs-text-3); font-variant-numeric: tabular-nums; }
.dcs-dialog-error { margin: 0; font-size: 11.5px; line-height: 18px; color: #f0a3a9; overflow-wrap: anywhere; }
.dcs-dialog-foot { display: flex; flex: none; align-items: center; justify-content: flex-end; gap: 8px; }
`

    /** Fill `{name}` placeholders in a localized template. */
    function format(template, values) {
      return String(template).replace(/\{(\w+)\}/g, (match, key) => (key in values ? String(values[key]) : match))
    }

    /** Relative time in the page's active language. */
    function relativeTime(milliseconds) {
      if (!Number.isFinite(milliseconds) || milliseconds <= 0) return ''
      const delta = milliseconds - Date.now()
      const units = [
        ['year', 31536000000], ['month', 2592000000], ['day', 86400000],
        ['hour', 3600000], ['minute', 60000],
      ]
      let formatter
      try {
        formatter = new Intl.RelativeTimeFormat(document.documentElement.lang || undefined, { numeric: 'auto' })
      } catch {
        formatter = null
      }
      for (const [unit, size] of units) {
        if (Math.abs(delta) >= size) {
          const value = Math.round(delta / size)
          return formatter === null ? `${Math.abs(value)} ${unit}` : formatter.format(value, unit)
        }
      }
      try {
        return formatter === null ? '' : formatter.format(0, 'minute')
      } catch {
        return ''
      }
    }

    /** Compact file size for one transcript. */
    function formatSize(bytes) {
      if (!Number.isFinite(bytes) || bytes <= 0) return ''
      if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(1)} MB`
      if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`
      return `${bytes} B`
    }

    /** Last path segment of a workspace directory. */
    function projectName(cwd) {
      const parts = String(cwd).split(/[\\/]+/).filter((part) => part !== '')
      return parts.length === 0 ? '' : parts[parts.length - 1]
    }

    /** Midnight today, in the page's own time zone. */
    function startOfToday() {
      const date = new Date()
      date.setHours(0, 0, 0, 0)
      return date.getTime()
    }

    /** The time bucket one timestamp falls into. */
    function timeBucket(milliseconds) {
      const start = startOfToday()
      if (milliseconds >= start) return TIME_BUCKETS[0]
      if (milliseconds >= start - DAY) return TIME_BUCKETS[1]
      if (milliseconds >= start - 6 * DAY) return TIME_BUCKETS[2]
      if (milliseconds >= start - 29 * DAY) return TIME_BUCKETS[3]
      return TIME_BUCKETS[4]
    }

    /** Copy of `sessions` in the requested order. */
    function sortSessions(sessions, mode) {
      const copy = sessions.slice()
      switch (mode) {
        case 'updated-asc': return copy.sort((left, right) => left.updatedAt - right.updatedAt)
        case 'created-desc': return copy.sort((left, right) => (right.createdAt || 0) - (left.createdAt || 0))
        case 'size-desc': return copy.sort((left, right) => right.sizeBytes - left.sizeBytes)
        case 'title-asc': return copy.sort((left, right) => String(left.title || '').localeCompare(String(right.title || '')))
        default: return copy.sort((left, right) => right.updatedAt - left.updatedAt)
      }
    }

    /** Group already-sorted sessions; group order follows the chosen sort where the grouping allows it. */
    function groupSessions(sessions, mode, sortBy, t) {
      if (mode === 'none') {
        return sessions.length === 0 ? [] : [{ key: 'all', label: t('groupAll'), caption: '', cwd: '', sessions }]
      }
      const groups = new Map()
      const push = (key, label, caption, cwd, session) => {
        let group = groups.get(key)
        if (group === undefined) {
          group = { key, label, caption, cwd, sessions: [] }
          groups.set(key, group)
        }
        group.sessions.push(session)
      }
      for (const session of sessions) {
        if (mode === 'time') {
          const bucket = timeBucket(session.updatedAt)
          push(`time:${bucket.key}`, t(bucket.label), '', '', session)
        } else if (mode === 'branch') {
          const branch = typeof session.branch === 'string' ? session.branch : ''
          push(`branch:${branch}`, branch === '' ? t('noBranch') : branch, '', '', session)
        } else {
          const cwd = typeof session.cwd === 'string' ? session.cwd : ''
          push(`project:${cwd}`, projectName(cwd) || t('unknownProject'), cwd, cwd, session)
        }
      }
      const list = [...groups.values()]
      if (mode === 'time') {
        const order = new Map(TIME_BUCKETS.map((bucket, index) => [`time:${bucket.key}`, index]))
        list.sort((left, right) => (order.get(left.key) ?? 99) - (order.get(right.key) ?? 99))
        return list
      }
      const newest = (group) => Math.max(...group.sessions.map((session) => session.updatedAt))
      const oldest = (group) => Math.min(...group.sessions.map((session) => session.updatedAt))
      const created = (group) => Math.max(...group.sessions.map((session) => session.createdAt || 0))
      const weight = (group) => group.sessions.reduce((total, session) => total + session.sizeBytes, 0)
      switch (sortBy) {
        case 'updated-asc': list.sort((left, right) => oldest(left) - oldest(right)); break
        case 'created-desc': list.sort((left, right) => created(right) - created(left)); break
        case 'size-desc': list.sort((left, right) => weight(right) - weight(left)); break
        case 'title-asc': list.sort((left, right) => left.label.localeCompare(right.label)); break
        default: list.sort((left, right) => newest(right) - newest(left)); break
      }
      return list
    }

    /** Read a stored string, falling back when absent or unreadable. */
    function readStored(key, fallback) {
      try {
        const raw = localStorage.getItem(key)
        return raw === null ? fallback : raw
      } catch {
        return fallback
      }
    }

    /** Write a stored string; storage failures never break the page. */
    function writeStored(key, value) {
      try {
        localStorage.setItem(key, value)
      } catch {
        // Private mode or a full quota keeps the in-memory choice only.
      }
    }

    /** Stored collapsed group keys. */
    function readCollapsed() {
      const raw = readStored(STORE_COLLAPSED, '[]')
      try {
        const parsed = JSON.parse(raw)
        return Array.isArray(parsed) ? parsed.filter((value) => typeof value === 'string') : []
      } catch {
        return []
      }
    }

    async function apiList(force) {
      const response = await fetch(`${LIST_PATH}${force ? '?refresh=1' : ''}`, {
        credentials: 'same-origin',
        headers: { accept: 'application/json' },
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      return response.json()
    }

    async function apiPost(path, body) {
      const response = await fetch(path, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      const payload = await response.json().catch(() => null)
      if (payload === null || payload.ok !== true) {
        const error = new Error(payload !== null && typeof payload.message === 'string' ? payload.message : `HTTP ${response.status}`)
        error.code = payload !== null && typeof payload.code === 'string' ? payload.code : payload === null ? `HTTP ${response.status}` : ''
        error.cwd = payload !== null && typeof payload.cwd === 'string' ? payload.cwd : ''
        throw error
      }
      return payload
    }

    /** Localized failure text for a Host refusal. */
    function errorText(t, error) {
      const code = error !== null && error !== undefined && typeof error.code === 'string' ? error.code : ''
      const message = String((error && error.message) || error)
      if (code === 'session-not-found') return t('errorNotFound')
      if (code === 'cwd-missing') return format(t('errorCwd'), { cwd: (error && error.cwd) || '' })
      if (code === 'not-a-directory') return format(t('errorNotDirectory'), { cwd: (error && error.cwd) || '' })
      if (code === 'bad-cwd') return t('errorBadCwd')
      if (code === 'launch-failed') return format(t('errorLaunch'), { message })
      if (code === 'untrusted-origin') return t('errorOrigin')
      if (typeof code === 'string' && code.startsWith('HTTP 405')) return t('errorNewRoute')
      return format(t('errorGeneric'), { message })
    }

    /** The session list and its load state. */
    function useSessionList() {
      const [state, setState] = React.useState({ phase: 'loading', data: null, error: '' })
      const [nonce, setNonce] = React.useState(0)
      const force = React.useRef(false)
      React.useEffect(() => {
        let live = true
        setState((previous) => previous.phase === 'ready'
          ? { ...previous, phase: 'refreshing' }
          : { phase: 'loading', data: null, error: '' })
        apiList(force.current).then((data) => {
          if (live) setState({ phase: 'ready', data, error: '' })
        }).catch((error) => {
          if (live) setState({ phase: 'failed', data: null, error: String((error && error.message) || error) })
        })
        force.current = false
        return () => { live = false }
      }, [nonce])
      const reload = React.useCallback((refresh) => {
        force.current = refresh === true
        setNonce((value) => value + 1)
      }, [])
      return { state, reload }
    }

    /** Section disclosure: a filled caret, pointing right when closed and down when open. */
    function DisclosureCaret(props) {
      const size = typeof props.size === 'number' ? props.size : 11
      return h('svg', {
        className: 'dcs-chevron', width: size, height: size, viewBox: '0 0 16 16',
        fill: 'currentColor', 'aria-hidden': true, focusable: false,
        'data-open': props.open === true ? 'true' : 'false',
      }, h('path', { d: 'M6 3.4l5.4 4.6L6 12.6z' }))
    }

    /** Trailing affordance of a session row: a plain arrow, never a rotating caret. */
    function ArrowRightIcon(props) {
      const size = typeof props.size === 'number' ? props.size : 12
      return h('svg', {
        width: size, height: size, viewBox: '0 0 16 16', fill: 'none',
        'aria-hidden': true, focusable: false,
      },
      h('path', {
        d: 'M3.2 8h8.8M8.6 4.4L12.2 8l-3.6 3.6', stroke: 'currentColor', strokeWidth: 1.6,
        strokeLinecap: 'round', strokeLinejoin: 'round',
      }))
    }

    function PlusIcon(props) {
      const size = typeof props.size === 'number' ? props.size : 14
      return h('svg', {
        width: size, height: size, viewBox: '0 0 16 16', fill: 'none',
        'aria-hidden': true, focusable: false,
      }, h('path', {
        d: 'M8 3.2v9.6M3.2 8h9.6', stroke: 'currentColor', strokeWidth: 1.7,
        strokeLinecap: 'round',
      }))
    }

    function RefreshIcon(props) {
      const size = typeof props.size === 'number' ? props.size : 15
      return h('svg', {
        width: size, height: size, viewBox: '0 0 16 16', fill: 'none',
        'aria-hidden': true, focusable: false,
      },
      h('path', {
        d: 'M13 8a5 5 0 1 1-1.6-3.7', stroke: 'currentColor', strokeWidth: 1.5,
        strokeLinecap: 'round',
      }),
      h('path', {
        d: 'M13.2 2.4v3.2h-3.2', stroke: 'currentColor', strokeWidth: 1.5,
        strokeLinecap: 'round', strokeLinejoin: 'round',
      }))
    }

    function CollapseIcon(props) {
      const size = typeof props.size === 'number' ? props.size : 15
      const collapsed = props.collapsed === true
      return h('svg', {
        width: size, height: size, viewBox: '0 0 16 16', fill: 'none',
        'aria-hidden': true, focusable: false,
      },
      h('path', {
        d: collapsed ? 'M4.2 3.9L8 7.7l3.8-3.8' : 'M4.2 12.1L8 8.3l3.8 3.8',
        stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round',
      }),
      h('path', {
        d: collapsed ? 'M4.2 8.4L8 12.2l3.8-3.8' : 'M4.2 7.6L8 3.8l3.8 3.8',
        stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round',
      }))
    }

    function CloseIcon(props) {
      const size = typeof props.size === 'number' ? props.size : 14
      return h('svg', {
        width: size, height: size, viewBox: '0 0 16 16', fill: 'none',
        'aria-hidden': true, focusable: false,
      }, h('path', {
        d: 'M4 4l8 8M12 4l-8 8', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round',
      }))
    }

    function FolderIcon(props) {
      const size = typeof props.size === 'number' ? props.size : 16
      return h('svg', {
        width: size, height: size, viewBox: '0 0 16 16', fill: 'none',
        'aria-hidden': true, focusable: false,
      },
      h('path', {
        d: 'M1.9 4.6c0-.7.6-1.3 1.3-1.3h2.6l1.4 1.6h6c.7 0 1.3.6 1.3 1.3v5.6c0 .7-.6 1.3-1.3 1.3H3.2c-.7 0-1.3-.6-1.3-1.3V4.6z',
        stroke: 'currentColor', strokeWidth: 1.4, strokeLinejoin: 'round',
      }))
    }

    /** Expand/collapse glyph for a group's more control. */
    function ChevronToggle(props) {
      const size = typeof props.size === 'number' ? props.size : 12
      const style = props.up === true ? { transform: 'rotate(180deg)' } : undefined
      return h('svg', {
        width: size, height: size, viewBox: '0 0 16 16', fill: 'none', style,
        'aria-hidden': true, focusable: false,
      }, h('path', {
        d: 'M4 6.2L8 10l4-3.8', stroke: 'currentColor', strokeWidth: 1.5,
        strokeLinecap: 'round', strokeLinejoin: 'round',
      }))
    }

    /** Sidebar icon: a terminal window with a prompt. */
    function PanelIcon(props) {
      const size = typeof props.size === 'number' ? props.size : 20
      return h('svg', {
        width: size, height: size, viewBox: '0 0 36 36', fill: 'none',
        'aria-hidden': true, focusable: false,
      },
      h('rect', {
        x: 4.75, y: 6.75, width: 26.5, height: 22.5, rx: 4,
        stroke: 'currentColor', strokeWidth: 1.8,
      }),
      h('path', { d: 'M4.75 12.5h26.5', stroke: 'currentColor', strokeWidth: 1.5, opacity: 0.45 }),
      h('path', {
        d: 'M10.2 17.4l3.5 3.3-3.5 3.3', stroke: 'currentColor', strokeWidth: 1.8,
        strokeLinecap: 'round', strokeLinejoin: 'round',
      }),
      h('path', {
        d: 'M16.8 24h8.6', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round',
      }))
    }

    /** Empty-state artwork: a terminal window with a prompt and a caret. */
    function EmptyArtwork() {
      return h('svg', {
        className: 'dcs-empty-icon', width: 44, height: 44, viewBox: '0 0 44 44',
        fill: 'none', 'aria-hidden': true, focusable: false,
      },
      h('rect', { x: 5.75, y: 8.75, width: 32.5, height: 26.5, rx: 5, stroke: 'currentColor', strokeWidth: 1.5 }),
      h('path', { d: 'M5.75 15.5h32.5', stroke: 'currentColor', strokeWidth: 1.3, opacity: 0.4 }),
      h('path', {
        d: 'M12.2 21.4l4 3.8-4 3.8', stroke: 'currentColor', strokeWidth: 1.7,
        strokeLinecap: 'round', strokeLinejoin: 'round',
      }),
      h('path', { d: 'M19.6 29h9.6', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round' }))
    }

    /** One transcript row. */
    function SessionRow(props) {
      const session = props.session
      const busy = props.busy === true
      return h('li', null,
        h('button', {
          type: 'button',
          className: 'dcs-row',
          disabled: busy,
          title: props.t('open'),
          onClick: () => { props.onOpen(session.sessionId) },
        },
        h('span', { className: 'dcs-row-main' },
          h('span', { className: 'dcs-row-title' }, session.title || String(session.sessionId).slice(0, 8)),
          h('span', { className: 'dcs-row-prompt' }, session.lastPrompt || session.firstPrompt || '—'),
          h('span', { className: 'dcs-row-meta' },
            session.branch ? h('span', { className: 'dcs-chip' }, session.branch) : null,
            h('span', null, relativeTime(session.updatedAt)),
            h('span', null, formatSize(session.sizeBytes)),
            h('span', { className: 'dcs-row-id' }, String(session.sessionId).slice(0, 8)))),
        h('span', { className: 'dcs-row-action' },
          busy ? props.t('opening') : props.t('open'),
          h(ArrowRightIcon))))
    }

    /** One collapsible group, showing the newest few rows until its more control is used. */
    function GroupSection(props) {
      const group = props.group
      const t = props.t
      const collapsed = props.collapsed === true
      const expanded = props.expanded === true
      const limit = typeof props.limit === 'number' && props.limit > 0 ? props.limit : SESSION_LIMIT
      const total = group.sessions.length
      const truncated = !expanded && total > limit
      const shown = truncated ? group.sessions.slice(0, limit) : group.sessions
      const newest = Math.max(...group.sessions.map((session) => session.updatedAt))
      const more = total > limit
      const body = collapsed ? null : [
        h('ul', { className: 'dcs-rows', key: 'rows' }, shown.map((session) => h(SessionRow, {
          key: session.sessionId,
          session,
          busy: props.busyId === session.sessionId,
          onOpen: props.onOpen,
          t,
        }))),
        more ? h('button', {
          key: 'more',
          type: 'button',
          className: 'dcs-more',
          'aria-expanded': expanded ? 'true' : 'false',
          onClick: () => { props.onToggleMore(group.key) },
        },
        h(ChevronToggle, { up: expanded }),
        expanded ? t('less') : format(t('more'), { count: total - limit })) : null,
      ]
      const cwd = typeof group.cwd === 'string' ? group.cwd : ''
      const starting = props.starting === true
      return h('section', { className: 'dcs-group' },
        h('div', { className: 'dcs-group-head' },
          h('button', {
            type: 'button',
            className: 'dcs-group-toggle',
            'aria-expanded': collapsed ? 'false' : 'true',
            onClick: () => { props.onToggle(group.key) },
          },
          h(DisclosureCaret, { open: !collapsed }),
          h('span', { className: 'dcs-group-title' }, group.label),
          h('span', { className: 'dcs-group-count' }, String(total)),
          group.caption ? h('span', { className: 'dcs-group-caption', title: group.caption }, group.caption) : h('span', { className: 'dcs-group-caption' }),
          h('span', { className: 'dcs-group-time' }, relativeTime(newest))),
          cwd === '' ? null : h('button', {
            type: 'button',
            className: 'dcs-group-new',
            title: t('newSessionHere'),
            'aria-label': t('newSessionHere'),
            disabled: starting,
            onClick: () => { props.onNewSession(cwd) },
          }, starting ? h('span', { 'aria-hidden': true }, '…') : h(PlusIcon, { size: 12 }))),
        body)
    }

    /** Header controls: search, grouping, sorting, collapse-all, refresh, new session. */
    function Toolbar(props) {
      const t = props.t
      return h('div', { className: 'dcs-controls' },
        h('input', {
          type: 'search',
          className: 'dcs-search',
          value: props.query,
          placeholder: t('search'),
          'aria-label': t('search'),
          onChange: (event) => { props.onQuery(event.target.value) },
        }),
        h('select', {
          className: 'dcs-select',
          value: props.groupBy,
          'aria-label': t('groupBy'),
          title: t('groupBy'),
          onChange: (event) => { props.onGroupBy(event.target.value) },
        },
        [['project', 'groupProject'], ['time', 'groupTime'], ['branch', 'groupBranch'], ['none', 'groupNone']]
          .map(([value, key]) => h('option', { key: value, value }, t(key)))),
        h('select', {
          className: 'dcs-select',
          value: props.sortBy,
          'aria-label': t('sortBy'),
          title: t('sortBy'),
          onChange: (event) => { props.onSortBy(event.target.value) },
        },
        [['updated-desc', 'sortUpdatedDesc'], ['updated-asc', 'sortUpdatedAsc'], ['created-desc', 'sortCreatedDesc'],
          ['size-desc', 'sortSizeDesc'], ['title-asc', 'sortTitleAsc']]
          .map(([value, key]) => h('option', { key: value, value }, t(key)))),
        h('button', {
          type: 'button',
          className: 'dcs-icon-button',
          title: props.allCollapsed ? t('expandAll') : t('collapseAll'),
          'aria-label': props.allCollapsed ? t('expandAll') : t('collapseAll'),
          disabled: props.groupCount === 0,
          onClick: () => { props.onToggleAll() },
        }, h(CollapseIcon, { collapsed: props.allCollapsed })),
        h('span', { className: 'dcs-spacer' }),
        h('button', {
          type: 'button',
          className: 'dcs-icon-button',
          title: t('refresh'),
          'aria-label': t('refresh'),
          disabled: props.refreshing === true || props.loading === true,
          onClick: () => { props.onRefresh() },
        }, h(RefreshIcon)),
        h('button', {
          type: 'button',
          className: 'dcs-primary',
          onClick: () => { props.onNew() },
        }, h(PlusIcon), t('newSession')))
    }

    /** Folder-chosen new session: the system picker first, a typed path as the fallback. */
    function NewSessionDialog(props) {
      const t = props.t
      const [path, setPath] = React.useState('')
      const [manual, setManual] = React.useState(false)
      const [picking, setPicking] = React.useState(false)
      const [pickError, setPickError] = React.useState('')
      const input = React.useRef(null)
      const pickButton = React.useRef(null)
      const startButton = React.useRef(null)
      React.useEffect(() => {
        const onKeyDown = (event) => {
          if (event.key === 'Escape') { event.stopPropagation(); props.onClose() }
        }
        window.addEventListener('keydown', onKeyDown, true)
        if (pickButton.current !== null && typeof pickButton.current.focus === 'function') pickButton.current.focus()
        return () => { window.removeEventListener('keydown', onKeyDown, true) }
      }, [props.onClose])
      React.useEffect(() => {
        if (manual && input.current !== null && typeof input.current.focus === 'function') input.current.focus()
      }, [manual])
      // A chosen directory moves the next keystroke to Start: pick, then Enter.
      React.useEffect(() => {
        if (manual || path === '') return
        if (startButton.current !== null && typeof startButton.current.focus === 'function') startButton.current.focus()
      }, [manual, path])
      const pick = async () => {
        if (picking || props.busy === true) return
        setPicking(true)
        setPickError('')
        try {
          const chosen = await props.pickDirectory()
          if (typeof chosen === 'string' && chosen !== '') setPath(chosen)
        } catch (error) {
          const code = error !== null && error !== undefined && typeof error.code === 'string' ? error.code : ''
          setPickError(code === 'picker-unavailable'
            ? t('errorPickUnavailable')
            : format(t('pickFailed'), { message: String((error && error.message) || error) }))
          setManual(true)
        } finally {
          setPicking(false)
        }
      }
      const submit = () => {
        const cwd = path.trim()
        if (cwd === '' || props.busy === true) return
        props.onSubmit(cwd)
      }
      return h('div', {
        className: 'dcs-overlay',
        onMouseDown: (event) => { if (event.target === event.currentTarget) props.onClose() },
      },
      h('div', {
        className: 'dcs-dialog',
        role: 'dialog',
        'aria-modal': 'true',
        'aria-label': t('newSessionTitle'),
        onMouseDown: (event) => { event.stopPropagation() },
      },
      h('div', { className: 'dcs-dialog-head' },
        h('div', null,
          h('h2', { className: 'dcs-dialog-title' }, t('newSessionTitle')),
          h('p', { className: 'dcs-dialog-hint' }, t('newSessionHint'))),
        h('button', {
          type: 'button', className: 'dcs-dialog-close', 'aria-label': t('cancel'),
          onClick: () => { props.onClose() },
        }, h(CloseIcon))),
      h('div', { className: 'dcs-field' },
        h('span', { className: 'dcs-field-label' }, t('directory')),
        h('button', {
          type: 'button',
          className: 'dcs-pick',
          ref: pickButton,
          disabled: picking || props.busy === true,
          onClick: () => { void pick() },
        }, h(FolderIcon), picking ? t('picking') : t('pickFolder')),
        h('div', {
          className: 'dcs-path',
          'data-empty': path === '' ? 'true' : 'false',
          title: path === '' ? undefined : path,
        }, path === '' ? t('noDirectory') : path),
        manual
          ? h('input', {
            ref: input,
            className: 'dcs-input',
            type: 'text',
            value: path,
            placeholder: t('directoryPlaceholder'),
            'aria-label': t('directory'),
            spellCheck: false,
            autoComplete: 'off',
            onChange: (event) => { setPath(event.target.value) },
            onKeyDown: (event) => { if (event.key === 'Enter') { event.preventDefault(); submit() } },
          })
          : h('button', { type: 'button', className: 'dcs-linkish', onClick: () => { setManual(true) } }, t('typeInstead')),
        pickError === '' ? null : h('p', { className: 'dcs-dialog-error', role: 'alert' }, pickError)),
      h('div', { className: 'dcs-field dcs-field-grow' },
        h('span', { className: 'dcs-field-label' }, t('recent')),
        props.projects.length === 0
          ? h('p', { className: 'dcs-message' }, t('recentEmpty'))
          : h('ul', { className: 'dcs-recent' }, props.projects.slice(0, 12).map((project) => h('li', { key: project.cwd },
            h('button', {
              type: 'button',
              className: 'dcs-recent-row',
              'data-selected': path.trim() === project.cwd ? 'true' : 'false',
              title: project.cwd,
              onClick: () => { setPath(project.cwd) },
            },
            h('span', { className: 'dcs-recent-path' }, project.cwd),
            h('span', { className: 'dcs-recent-count' }, format(t('sessionsCount'), { count: project.count }))))))),
      props.error ? h('p', { className: 'dcs-dialog-error', role: 'alert' }, props.error) : null,
      h('div', { className: 'dcs-dialog-foot' },
        h('button', { type: 'button', className: 'dcs-ghost', onClick: () => { props.onClose() } }, t('cancel')),
        h('button', {
          type: 'button',
          className: 'dcs-primary',
          ref: startButton,
          disabled: props.busy === true || path.trim() === '',
          onClick: submit,
        }, h(PlusIcon), props.busy === true ? t('starting') : t('start')))))
    }

    /** Loading placeholder rows. */
    function Skeleton() {
      return h('div', { className: 'dcs-group' },
        [0, 1, 2, 3, 4].map((index) => h('div', { className: 'dcs-skeleton-row', key: index },
          h('div', { className: 'dcs-skeleton-bar', 'data-w': 'title' }),
          h('div', { className: 'dcs-skeleton-bar', 'data-w': 'prompt' }),
          h('div', { className: 'dcs-skeleton-bar', 'data-w': 'meta' }))))
    }

    /** The page: grouped session list, controls and the new-session dialog. */
    function ClaudeSessionsPage(props) {
      const t = typeof props.t === 'function' ? props.t : (key) => key
      const pickDirectory = typeof props.pickDirectory === 'function'
        ? props.pickDirectory
        : async () => { const error = new Error('picker-unavailable'); error.code = 'picker-unavailable'; throw error }
      const { state, reload } = useSessionList()
      const [query, setQuery] = React.useState('')
      const [groupBy, setGroupBy] = React.useState(() => {
        const stored = readStored(STORE_GROUP, 'project')
        return GROUP_MODES.includes(stored) ? stored : 'project'
      })
      const [sortBy, setSortBy] = React.useState(() => {
        const stored = readStored(STORE_SORT, 'updated-desc')
        return SORT_MODES.includes(stored) ? stored : 'updated-desc'
      })
      const [collapsed, setCollapsed] = React.useState(readCollapsed)
      const [expanded, setExpanded] = React.useState([])
      const [busyId, setBusyId] = React.useState('')
      const [notice, setNotice] = React.useState(null)
      const [dialog, setDialog] = React.useState(false)
      const [newBusy, setNewBusy] = React.useState(false)
      const [newError, setNewError] = React.useState('')
      const [newCwd, setNewCwd] = React.useState('')

      React.useEffect(() => {
        if (notice === null) return undefined
        const timer = setTimeout(() => { setNotice(null) }, 6000)
        return () => { clearTimeout(timer) }
      }, [notice])

      const openSession = React.useCallback(async (sessionId) => {
        setBusyId(sessionId)
        setNotice(null)
        try {
          await apiPost(OPEN_PATH, { sessionId })
          setNotice({ tone: 'ok', text: t('opened') })
        } catch (error) {
          setNotice({ tone: 'error', text: errorText(t, error) })
        } finally {
          setBusyId('')
        }
      }, [t])

      const startSession = React.useCallback(async (cwd) => {
        setNewBusy(true)
        setNewError('')
        try {
          await apiPost(NEW_PATH, { cwd })
          setDialog(false)
          setNotice({ tone: 'ok', text: t('newSessionOpened') })
          setQuery('')
          reload(true)
        } catch (error) {
          setNewError(errorText(t, error))
        } finally {
          setNewBusy(false)
        }
      }, [t, reload])

      const startAt = React.useCallback(async (cwd) => {
        setNewCwd(cwd)
        setNotice(null)
        try {
          await apiPost(NEW_PATH, { cwd })
          setNotice({ tone: 'ok', text: t('newSessionOpened') })
          reload(true)
        } catch (error) {
          setNotice({ tone: 'error', text: errorText(t, error) })
        } finally {
          setNewCwd('')
        }
      }, [t, reload])

      const closeDialog = React.useCallback(() => {
        setDialog(false)
        setNewError('')
      }, [])

      const changeGroupBy = React.useCallback((value) => {
        setGroupBy(value)
        writeStored(STORE_GROUP, value)
      }, [])

      const changeSortBy = React.useCallback((value) => {
        setSortBy(value)
        writeStored(STORE_SORT, value)
      }, [])

      const data = state.data
      const sessions = data !== null && Array.isArray(data.sessions) ? data.sessions : []
      const projects = React.useMemo(() => {
        const map = new Map()
        for (const session of sessions) {
          const cwd = typeof session.cwd === 'string' ? session.cwd : ''
          if (cwd === '') continue
          const known = map.get(cwd)
          if (known === undefined) map.set(cwd, { cwd, count: 1, last: session.updatedAt })
          else {
            known.count += 1
            known.last = Math.max(known.last, session.updatedAt)
          }
        }
        return [...map.values()].sort((left, right) => right.last - left.last)
      }, [sessions])
      const trimmed = query.trim().toLowerCase()
      const visible = React.useMemo(() => {
        const filtered = trimmed === ''
          ? sessions
          : sessions.filter((session) => [session.title, session.lastPrompt, session.firstPrompt, session.cwd, session.branch]
            .some((value) => typeof value === 'string' && value.toLowerCase().includes(trimmed)))
        return sortSessions(filtered, sortBy)
      }, [sessions, trimmed, sortBy])
      const groups = React.useMemo(() => groupSessions(visible, groupBy, sortBy, t), [visible, groupBy, sortBy, t])
      const allCollapsed = groups.length > 0 && groups.every((group) => collapsed.includes(group.key))
      const refreshing = state.phase === 'refreshing'
      const newest = sessions.length > 0 ? Math.max(...sessions.map((session) => session.updatedAt)) : 0

      const toggleGroup = React.useCallback((key) => {
        setCollapsed((previous) => {
          const next = previous.includes(key) ? previous.filter((value) => value !== key) : [...previous, key]
          writeStored(STORE_COLLAPSED, JSON.stringify(next))
          return next
        })
      }, [])

      const toggleMore = React.useCallback((key) => {
        setExpanded((previous) => previous.includes(key)
          ? previous.filter((value) => value !== key)
          : [...previous, key])
      }, [])

      const toggleAll = React.useCallback(() => {
        setCollapsed((previous) => {
          const everyCollapsed = groups.length > 0 && groups.every((group) => previous.includes(group.key))
          const next = everyCollapsed ? [] : groups.map((group) => group.key)
          writeStored(STORE_COLLAPSED, JSON.stringify(next))
          return next
        })
      }, [groups])

      const stats = [
        { key: 'sessions', label: t('statSessions'), value: String(sessions.length) },
        { key: 'projects', label: t('statProjects'), value: String(projects.length) },
        { key: 'last', label: t('statLast'), value: relativeTime(newest) || '—' },
      ]

      let body
      if (state.phase === 'loading' && data === null) {
        body = h(Skeleton)
      } else if (state.phase === 'failed') {
        body = h('div', { className: 'dcs-failure' },
          h('span', null, `${t('failed')} ${state.error}`),
          h('button', { type: 'button', className: 'dcs-ghost', onClick: () => { reload(true) } }, t('retry')))
      } else if (sessions.length === 0) {
        body = h('div', { className: 'dcs-empty' },
          h(EmptyArtwork),
          h('p', { className: 'dcs-empty-title' }, t('empty')),
          h('p', { className: 'dcs-empty-text' }, format(t('emptyHint'), { path: data !== null ? data.projectsRoot : '' })),
          h('button', { type: 'button', className: 'dcs-primary', onClick: () => { setDialog(true) } },
            h(PlusIcon), t('newSession')))
      } else if (visible.length === 0) {
        body = h('div', { className: 'dcs-empty' },
          h('p', { className: 'dcs-empty-title' }, format(t('noMatch'), { query: query.trim() })),
          h('button', { type: 'button', className: 'dcs-ghost', onClick: () => { setQuery('') } }, t('clearSearch')))
      } else {
        body = groups.map((group) => h(GroupSection, {
          key: group.key,
          group,
          collapsed: collapsed.includes(group.key),
          expanded: expanded.includes(group.key),
          limit: trimmed === '' ? SESSION_LIMIT : Infinity,
          busyId,
          starting: group.cwd !== '' && newCwd === group.cwd,
          onToggle: toggleGroup,
          onToggleMore: toggleMore,
          onNewSession: startAt,
          onOpen: openSession,
          t,
        }))
      }

      const notices = []
      if (notice !== null) {
        notices.push(h('p', { className: 'dcs-notice', 'data-tone': notice.tone, role: 'status', key: 'notice' }, notice.text))
      }
      if (data !== null && data.truncated === true) {
        notices.push(h('p', { className: 'dcs-notice', key: 'truncated' }, format(t('truncated'), { count: sessions.length })))
      }

      return h('div', { className: 'dcs-page' },
        h('style', null, CSS),
        h('header', { className: 'dcs-head' },
          h('div', { className: 'dcs-head-top' },
            h('div', { className: 'dcs-heading' },
              h('h1', { className: 'dcs-title' }, t('title')),
              h('span', { className: 'dcs-subtitle' }, t('subtitle'))),
            h('div', { className: 'dcs-stats' }, stats.map((item) => h('div', { className: 'dcs-stat', key: item.key },
              h('span', { className: 'dcs-stat-value' }, item.value),
              h('span', { className: 'dcs-stat-label' }, item.label))))),
          h(Toolbar, {
            t,
            query,
            onQuery: setQuery,
            groupBy,
            onGroupBy: changeGroupBy,
            sortBy,
            onSortBy: changeSortBy,
            allCollapsed,
            groupCount: groups.length,
            onToggleAll: toggleAll,
            onRefresh: () => { reload(true) },
            refreshing,
            loading: state.phase === 'loading',
            onNew: () => { setNewError(''); setDialog(true) },
          })),
        h('div', { className: 'dcs-body' },
          h('div', { className: 'dcs-inner' }, ...notices, body)),
        dialog ? h(NewSessionDialog, {
          t,
          projects,
          pickDirectory,
          busy: newBusy,
          error: newError,
          onClose: closeDialog,
          onSubmit: startSession,
        }) : null)
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'claude-sessions: dictionaries')
        const t = ctx.locale.bind(NS)
        // Desktop exposes its own native folder dialog; the web GUI reaches the
        // Host chooser through the workspace service. Both settle to a path or null.
        const pickDirectory = async () => {
          const bridge = globalThis.__DSH_DIRECTORY_PICKER__
          if (bridge !== undefined && bridge !== null && typeof bridge.pick === 'function') return await bridge.pick()
          const workspace = typeof ctx.get === 'function' ? ctx.get('uiWorkspace') : undefined
          if (workspace !== undefined && workspace !== null && typeof workspace.pickDirectory === 'function') {
            return await workspace.pickDirectory()
          }
          const error = new Error('picker-unavailable')
          error.code = 'picker-unavailable'
          throw error
        }
        ctx.effect(() => ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main',
          key: PANEL_ID,
          locale: NS,
          inject: () => ({ pickDirectory }),
        }, ClaudeSessionsPage)), 'claude-sessions: main panel')
        ctx.effect(() => ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist',
          id: PANEL_ID,
          order: 10,
          label: () => t('panel'),
          locale: NS,
        }, PanelIcon)), 'claude-sessions: sidebar entry')
      },
    }
  },
})
