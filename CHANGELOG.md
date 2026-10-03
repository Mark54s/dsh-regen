# Changelog

## 0.1.0 — 2026-10-03

- First release: an arrow-only `重新生成` action in the assistant icon row; it forks the turn
  and re-runs the same user prompt in the new session.
- Turns whose generation failed or was interrupted are supported too (they carry no
  assistant message, so the official icon row never renders for them): the arrow then sits
  at the turn tail, with a `:has()` rule keeping exactly one copy visible per turn.
- Explicit turn targeting (`turn`), message targeting (`messageId`) and "last prompt" default.
- Model route falls back to the profile default when the history has no successful request.
