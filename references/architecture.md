# Architecture and provenance

The skill is intentionally local-first:

The farm environment is composed by `assets/web/farm-environment.js`: surrounding ground/skirt, distant hills, sky, clouds, celestial bodies, night lighting, and precipitation. `/api/farm/environment` reads/writes validated preferences through SQLite meta settings; `/api/farm/weather` proxies Open-Meteo and caches observations for 15 minutes in SQLite. The default city is Jinan; alternate cities resolve through Open-Meteo geocoding. Weather is fetched only for the farm and never sends todo/thread data. Failed requests retain matching-city cached observations with a stale flag. The client distinguishes environment previews from live weather and follows the selected city's timezone and sunrise/sunset in automatic mode.

- `assets/web/` contains the user's Vue 3 demo and its vendored browser libraries. The original layout and CSS are preserved; data access is replaced with the local API.
- `assets/blender/agent-farm.blend` is the editable source scene for the 3D task farm. `assets/web/models/agent-farm.glb` contains the browser-ready terrain, task slots, character rig, and animations. The cottage, chair, and stall are loaded from separate UV-preserving `*-clean.glb` assets so their original texture coordinates survive web optimization. `assets/web/farm3d.js` composes those assets and maps live todos and Codex state onto named scene nodes.
- `scripts/server.ts` is the loopback HTTP and JSON API server.
- `scripts/cli.ts` and platform wrappers are the stable skill interface.
- `scripts/lib/db.ts` owns SQLite validation, migrations, code allocation, and optimistic concurrency.
- `scripts/lib/codex.ts` reads Codex quota through `account/rateLimits/read`, lists recent sessions through `thread/list`, interprets local JSONL session events for activity, and reads the desktop app's local thread read-state for completed-but-unread tasks.

The dashboard always binds to `127.0.0.1:8021`. Every CLI operation probes `/api/health` first; when the Agent Todo service is absent, the CLI starts it and opens the dashboard before continuing. If the service is already running, it neither launches another process nor opens another browser tab.

The visible dashboard polls todos and Codex activity every five seconds and refreshes immediately on focus. Full Codex quota and thread metadata remain cached for 15 seconds; unchanged session files reuse parsed activity facts, keeping the faster UI cadence lightweight.

The 3D farm is loaded only when the user opens the farm module. It reuses the dashboard's existing five-second data snapshots and does not redownload the GLB during polling. Named nodes (`InboxSlot_*`, `Cell_Scheduled_*`, `Cell_Active_*`, and `Cell_Done_*`) provide deterministic task placement. `character-animated.glb` contains the supplied Tripo rig and its original `sit`, `walk`, `dig`, `shovel`, and `dance_05` clips. The old embedded character is removed at runtime. An explicit phase controller reverses `sit` to rise, walks to a session plant, digs, walks to a random roadside location on completion, dances once, returns, and sits. Root horizontal motion is held in place so the route controller owns world movement. Session plants and DOM-projected labels use the existing Codex thread IDs and titles, independently of SQLite todo cells; clicking a plant or label opens its Codex thread. The local action preview runs without modifying Codex or SQLite data.

The Codex integration was informed by the MIT-licensed [itvincent-git/codex-usage-desktop](https://github.com/itvincent-git/codex-usage-desktop), especially its local-first session scanning and Codex `app-server` quota fallback. This implementation is original TypeScript code and does not copy its Rust modules.

## Status limits

A separate read-only `app-server` process can list persisted threads and account limits but cannot observe the desktop app's in-memory loaded-thread set. The dashboard therefore combines persisted thread metadata with each session file's latest `task_started`, `task_complete`, and tool activity, plus `electron-thread-read-state-v1` from the desktop app's local state. All current Codex tasks are aggregated into one workstation: unfinished turns are blue, explicit input or escalation approval waits are orange, and completed unread threads are green. Approval detection recognizes `waitingOnApproval` thread flags and pending `require_escalated` tool calls immediately; a quiet unfinished turn remains a conservative fallback. The dashboard never approves commands or injects input into Codex.
