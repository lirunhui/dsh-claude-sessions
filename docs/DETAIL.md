# Claude Code sessions

Claude Code keeps one JSONL transcript per session under
`~/.claude/projects/<project>/<session-id>.jsonl`. This plugin turns that
directory into a browsable page inside DeepSeek Harness.

## Use it

1. Open **Claude sessions** in the left sidebar.
2. Browse the grouped list. Change **Group by** (project, time, branch, none)
   and **Sort by** (newest/oldest updated, newest created, largest, title) in the
   toolbar; section headers collapse their rows and the toolbar button collapses
   or expands every section. Those three choices are remembered in
   `localStorage` under `dsh.claudeSessions.*`.
3. Search titles, prompts, paths and branches from the search box.
4. Click a row to resume it: a terminal opens in that session's working
   directory and runs `claude --resume <session-id>`, continuing the exact
   conversation. **New session** opens a dialog whose leading action is
   **Choose folder…**: the desktop app shows its native folder dialog and the Web
   GUI asks the Host's chooser, so the directory is picked rather than typed. A
   recent-directory list offers one-click choices, and **Type a path instead**
   reveals the text field when no chooser exists. Confirming starts a fresh
   `claude` in that directory.

## How it works

The Host half serves three routes on the DSH web server:

| Route | Meaning |
|---|---|
| `GET /dsh-claude-sessions/list` | Every transcript with its title, last prompt, branch and timestamps |
| `POST /dsh-claude-sessions/open` | Validate one listed session id and open `claude --resume <id>` in a new terminal |
| `POST /dsh-claude-sessions/new` | Validate an absolute directory and open `claude` there |

Reading is bounded and cached: each transcript is scanned from the head until
the working directory, the title and the first human prompt are known, plus a
small tail window for the newest title and last prompt. Unchanged files are
served from a per-file cache invalidated by mtime and size, so listing an idle
directory costs one `stat` per transcript.

Every route is guarded by the composition's `connection` service (browser
authentication plus the Host/Origin fence); the mutating routes also require a
loopback origin of their own. The Host never launches a terminal for a session
id it did not just list, and a session whose recorded working directory no
longer exists is refused with that path.

## Terminal choice

- **Windows** — Windows Terminal (`wt.exe`) when present, otherwise the default
  console host through `cmd.exe /c start`. The tab is titled `Claude · <title>`.
- **macOS** — Terminal.app through `osascript`.
- **Linux** — the first available of `x-terminal-emulator`, `gnome-terminal`,
  `konsole`, `xterm`.

The terminal is an ordinary system terminal, not the DSH right-sidebar terminal.

## Configuration

Set fields in the bundle patch when the CLI command, resume flag, or terminal
choice differs from the defaults (`claude`, `--resume`, automatic):

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

## Limitations

- Read-only: the plugin never edits, deletes, or exports a transcript.
- The `claude` CLI must be installed and on `PATH`.
- Only the newest 1000 transcripts are listed.
- The plugin does not embed the resumed session inside DSH; it hands it to the
  system terminal.
- A Host-half change (routes, terminal choice) takes effect after an
  application restart; browser-half changes load with a page refresh.
