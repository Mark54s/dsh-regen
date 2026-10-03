# dsh-regen

[中文说明](#中文说明) · [English](#english)

**A ChatGPT-style `重新生成` (regenerate) arrow for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness).** One click forks the turn and re-runs the *same* user prompt in the new session, so you get a fresh answer for the same question. The source session is never modified.

<!-- screenshot: assets/screenshot.png -->

## Why another one

Existing regenerate plugins do not load on current DSH builds: one requires a client package that no longer exists, another is refused by the host's peer-dependency gate. `dsh-regen` is a tiny, self-contained bundle that only uses public seams, and it additionally covers the case the others miss:

> **It works on turns whose generation failed.** A failed turn (rate limit, model rejected the reasoning effort, network error…) has no `assistant/message` in the log, so the official assistant icon row is never rendered for it — there is simply nowhere to click. `dsh-regen` renders its arrow in the turn tail for those turns, and keeps exactly one arrow visible per turn.

## English

### Features

- `↻` arrow in the icon row next to copy / branch — icon-only, no label, native tooltip.
- Regenerates by forking: new session = history up to (but excluding) that prompt + the prompt re-run. Lineage is kept through `parentSession`, the old session stays intact and is never touched.
- Works on failed / interrupted turns too (see above).
- Keeps the source session's `cwd`, workspace membership and model route.
- Busy / done / failed states on the arrow itself; failed turns red for a few seconds.

### Install

```sh
# from npm
dsh plugin --profile desktop add dsh-regen

# from GitHub
dsh plugin --profile desktop add github:OWNER/dsh-regen

# from a local checkout
dsh plugin --profile desktop add /path/to/dsh-regen
```

Restart DSH afterwards (Desktop: menu **应用 → 重启 DeepSeek Harness**). The plugin is a bundle: it declares `dsh.bundle.patch`, so installation registers it in `dsh.profile.bundles` automatically.

### HTTP contract

`POST /regen` (same-origin, served by the host half)

```jsonc
{ "sessionId": "session-…", "turn": 6 }          // target one turn
{ "sessionId": "session-…", "messageId": "…" }   // target the turn that produced a message
{ "sessionId": "session-…" }                      // default: last turn with a user prompt
```

```jsonc
{ "sessionId": "session-…", "parentSessionId": "session-…", "turn": 6, "hadAssistantReply": true, "cwd": "…", "notes": [] }
```

### Notes

- The retry reuses that turn's model route. If it failed upstream (HTTP 429 / gateway circuit breaker), wait for the upstream to recover first.
- Verified on `0.2.0-rc.2`: boots without missing dependencies, and an end-to-end run (normal turn and failed turn) produced the branch with the prompt delivered exactly once.

## 中文说明

**给 DSH 对话加一个 ChatGPT 式的「重新生成」箭头。** 点一下，就从这一轮**之前**分叉出一个新会话，用**同一个提问**重跑一遍——原来的会话一字不动。

### 特点

- 箭头 `↻` 就在左下角那一排功能键里（复制、分支旁边），只有图标、没有文字，悬停有提示。
- **生成失败/中断的回合也能用**：这类回合日志里没有助手消息，官方整排图标都不渲染，所以别的插件在这里点不到——本插件把箭头画在该回合末尾，并用 `:has()` 规则保证同一回合**只显示一个**箭头。
- 分叉出的会话沿用源会话的工作目录、工作区归属与模型路由，并通过 `parentSession` 保留谱系。
- 只使用公开接口：主机半用 `sessionQuery` / `agents` / `sessions` / `workspaceRegistry` / `webServer`，客户端只注册两个插槽条目。

### 安装

```powershell
dsh plugin --profile desktop add dsh-regen            # npm
dsh plugin --profile desktop add github:OWNER/dsh-regen  # GitHub
```

装完重启 DSH（桌面版：应用 → 重启 DeepSeek Harness）。

### 使用

鼠标移到任意回合（包括失败的那一轮）下方的功能键区域，点 `↻` 即可；生成完成后会自动切到新会话。

## Compatibility

- Verified working on DeepSeek Harness **0.2.0-rc.2** (desktop and web profiles).
- Uses only public seams: the client slots `conversation.chat.assistant-actions` / `conversation.chat.turnTail`, `ctx.sessions`, `ctx.uiWorkspace`, and the host services `sessionQuery` / `agents` / `sessions` / `workspaceRegistry` / `webServer`. No source patches, no engine internals.
- Declares `dsh.compatibility.dshReleases` so the plugin list can flag it for other builds.

## License

MIT
