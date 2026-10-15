# Architecture and provenance

The skill is intentionally local-first:

- `assets/web/` contains the user's Vue 3 demo and its vendored browser libraries. The original layout and CSS are preserved; data access is replaced with the local API.
- `scripts/server.ts` is the loopback HTTP and JSON API server.
- `scripts/cli.ts` and platform wrappers are the stable skill interface.
- `scripts/lib/db.ts` owns SQLite validation, migrations, code allocation, and optimistic concurrency.
- `scripts/lib/codex.ts` reads Codex quota through `account/rateLimits/read`, lists recent sessions through `thread/list`, interprets local JSONL session events for activity, and reads the desktop app's local thread read-state for completed-but-unread tasks.

The dashboard always binds to `127.0.0.1:8021`. Every CLI operation probes `/api/health` first; when the Agent Todo service is absent, the CLI starts it and opens the dashboard before continuing. If the service is already running, it neither launches another process nor opens another browser tab.

The visible dashboard polls todos and Codex activity every five seconds and refreshes immediately on focus. Full Codex quota and thread metadata remain cached for 15 seconds; unchanged session files reuse parsed activity facts, keeping the faster UI cadence lightweight.

The Codex integration was informed by the MIT-licensed [itvincent-git/codex-usage-desktop](https://github.com/itvincent-git/codex-usage-desktop), especially its local-first session scanning and Codex `app-server` quota fallback. This implementation is original TypeScript code and does not copy its Rust modules.

## Status limits

A separate read-only `app-server` process can list persisted threads and account limits but cannot observe the desktop app's in-memory loaded-thread set. The dashboard therefore combines persisted thread metadata with each session file's latest `task_started`, `task_complete`, and tool activity, plus `electron-thread-read-state-v1` from the desktop app's local state. All current Codex tasks are aggregated into one workstation: unfinished turns are blue, inferred input/approval waits are orange, and completed unread threads are green. `待确认` remains a conservative inference after a quiet unfinished turn or an explicit input/approval signal. The dashboard never approves commands or injects input into Codex.
