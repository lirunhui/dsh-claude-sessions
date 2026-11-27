# Claude Code 会话

Claude Code 为每个会话在 `~/.claude/projects/<项目>/<session-id>.jsonl`
下保存一份 JSONL 记录。本插件把这个目录变成 DeepSeek Harness 里可浏览的页面。

## 使用

1. 在左侧边栏打开 **Claude 会话**。
2. 浏览分组列表。工具栏可切换 **分组**（项目 / 时间 / 分支 / 不分组）与
   **排序**（最近更新、最早更新、最近创建、体积最大、标题 A–Z）；分组标题可
   单独折叠，工具栏按钮一次折叠/展开全部。这三项选择记在 `localStorage` 的
   `dsh.claudeSessions.*` 下。
3. 搜索框可过滤标题、提问、路径与分支。
4. 点击某一行即恢复该会话：终端在它自己的工作目录里打开并执行
   `claude --resume <session-id>`，直接接着上次对话。**新建会话** 会打开对话框，
   主要操作是 **选择文件夹…**：桌面端弹出系统原生的文件夹对话框，Web 端走 Host 的
   选择器，所以目录是「选」出来的而不是输入。下面还有最近目录可一键选中；只有在
   没有可用选择器时，**改为手动输入路径** 才会展开文本框。确认后在该目录里启动一个
   全新的 `claude`。

## 实现

Host 半在 DSH Web 服务器上注册三个路由：

| 路由 | 含义 |
|---|---|
| `GET /dsh-claude-sessions/list` | 返回全部记录及标题、最后提问、分支与时间 |
| `POST /dsh-claude-sessions/open` | 校验会话 id，在新终端里执行 `claude --resume <id>` |
| `POST /dsh-claude-sessions/new` | 校验绝对路径目录，在该目录里执行 `claude` |

读取是有界且带缓存的：每份记录从头部开始扫描，直到拿到工作目录、标题和第一条
人类提问，再读一小段尾部取最新标题与最后提问。未变化的文件走按 mtime/size 失效
的文件级缓存，所以空闲目录的列表读取只需每个文件一次 `stat`。

所有路由都经过组合的 `connection` 服务（浏览器鉴权 + Host/Origin 围栏）；
写操作路由另外要求回环来源。Host 只为刚列出的会话 id 启动终端；记录中的工作目录
已不存在时会带着该路径拒绝，而不是换到别处打开。

## 终端选择

- **Windows** — 有 Windows Terminal（`wt.exe`）时优先使用，否则用默认控制台
  `cmd.exe /c start`；标签标题为 `Claude · <标题>`。
- **macOS** — 通过 `osascript` 使用 Terminal.app。
- **Linux** — 依次尝试 `x-terminal-emulator`、`gnome-terminal`、`konsole`、`xterm`。

终端是普通的系统终端，不是 DSH 右栏内嵌终端。

## 配置

CLI 命令、恢复参数或终端选择与默认值（`claude`、`--resume`、自动）不同时，
在 bundle patch 里设置：

```yaml
- id: dsh-claude-sessions
  name: dsh-claude-sessions
  config:
    claudeCommand: claude
    resumeFlag: --resume
    extraArgs: []
    terminal: auto
    claudeHome: ''
```

## 限制

- 只读：不会修改、删除或导出任何记录。
- 需要已安装 `claude` CLI 且在 `PATH` 上。
- 最多只列最新的 1000 条记录。
- 插件不会把会话内嵌到 DSH 里，而是交给系统终端。
- Host 半的改动（路由、终端选择）需重启应用生效；浏览器半改动刷新页面即可。
