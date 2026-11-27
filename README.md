# Claude Code sessions

Browse every Claude Code CLI session stored on this machine from a dedicated
sidebar entry, resume one in a new terminal, or start a fresh session in any
directory.

## Install

```bash
# published package (the same install the in-app plugin market uses)
dsh plugin --profile web add dsh-claude-sessions

# straight from this repository
dsh plugin --profile web add github:lirunhui/dsh-claude-sessions
```

Desktop app: **Settings → Plugins → Add plugin**, then use the same package name.

After installing, refresh the window (a change to the Host half needs an
application restart) and open **Claude sessions** in the left sidebar.

## Requirements

- DeepSeek Harness 0.2.x with the Web GUI composition (the desktop app or `dsh web`).
- The Claude Code CLI (`claude`) installed and on `PATH`.
- A readable `~/.claude/projects` directory.

## What it shows

The Host half scans `~/.claude/projects/<project>/<session>.jsonl` and lists one
row per transcript with:

- the generated session title (`aiTitle`), falling back to the first human
  prompt, then the last prompt, then the session id prefix;
- the latest prompt (`last-prompt`);
- the git branch when the transcript recorded one;
- the last update time and the transcript size.

### Grouping, sorting, collapsing

- **Group by** project (default), time bucket (today, yesterday, previous 7 or
  30 days, older), git branch, or nothing.
- **Sort by** newest updated (default), oldest updated, newest created, largest
  transcript, or title A–Z. The order applies inside groups and, where the
  grouping allows it, to the groups themselves.
- Every section header collapses its rows; the toolbar button collapses or
  expands all sections at once. Grouping, sorting and collapsed sections are
  remembered in `localStorage` (`dsh.claudeSessions.group`, `.sort`,
  `.collapsed`).
- The search box filters titles, prompts, paths and branches.

## What a click does

Clicking a row sends its session id to the Host, which opens a new terminal in
the session's own working directory and runs:

```
claude --resume <session-id>
```

**New session** opens a dialog: choose a folder with the system picker (the
desktop app's own folder dialog) or click a directory from the recent list, then
start. Typing an absolute path remains available behind **Type a path instead**
when no picker is available. The Host opens a terminal in that directory and runs
`claude`, so the CLI begins a brand-new conversation there.

On Windows the plugin prefers Windows Terminal (`wt.exe`) and falls back to the
default console host (`cmd.exe /c start`). On macOS it uses Terminal.app through
`osascript`; on Linux it tries `x-terminal-emulator`, `gnome-terminal`,
`konsole`, then `xterm`.

The terminal is a normal system terminal, not an embedded DSH terminal: it
survives DSH window changes and behaves exactly like starting the CLI by hand.
The plugin never edits, deletes, or rewrites a transcript; it only reads.

## Routes

| Route | Meaning |
|---|---|
| `GET /dsh-claude-sessions/list` | Every transcript with title, last prompt, branch and timestamps |
| `POST /dsh-claude-sessions/open` | Resume one listed session in a new terminal |
| `POST /dsh-claude-sessions/new` | Start a fresh `claude` session in a validated directory |

All three are guarded by the composition's `connection` service, and the two
mutating routes also check the request's loopback origin.

## Configuration

The bundle patch may set:

```yaml
- id: dsh-claude-sessions
  name: dsh-claude-sessions
  config:
    claudeCommand: claude      # command that starts the CLI
    resumeFlag: --resume       # flag that resumes a session by id
    extraArgs: []              # extra arguments before the resume flag
    terminal: auto             # auto | windows-terminal | windows-console
    claudeHome: ''             # empty means ~/.claude
```

## Limitations

- Read-only: no delete, rename, or export.
- The CLI itself must be installed and on `PATH`; a failed launch is reported in
  the page.
- A session whose recorded working directory no longer exists is refused with
  the missing path instead of being opened somewhere else.
- Reading is bounded: each transcript is scanned from the head until the working
  directory, title and first prompt are known, plus a small tail window, so very
  large transcripts keep a fast, approximate preview.
- Only the newest 1000 transcripts are listed.
- Changing the Host half (a route or terminal choice) needs an application
  restart; the browser half reloads with a page refresh.
