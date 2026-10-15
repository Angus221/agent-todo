# Agent Todo data contract

The persistent database is `data/agent-todo.sqlite`. The TypeScript store in `scripts/lib/db.ts` creates and migrates it.

## Todo fields

- `code`: stable four-digit identifier (`0001`–`9999`)
- `title`: required summary
- `description` / `content`: Markdown task details
- `status`: status id from the board
- `priority`: `P0`, `P1`, `P2`, or `P3`
- `dueDate`: local calendar date in `YYYY-MM-DD`
- `dueTime`: optional `HH:mm`
- `projectPath`: optional local project path
- `categoryId`: category id
- `area`: `workspace` or `personal`
- `tags`: array of at most 12 tags without `#`; AI-created todos use one `project-feature` tag by default, with the feature summarized in roughly four to five Chinese characters when applicable
- `version`: optimistic-concurrency version; pass it as `expectedVersion` on updates
- `resultSummary`, `artifacts`, `handledAt`: execution result metadata

## Board invariants

The protected statuses are `todo`, `in_progress`, and `done`. Their display names may be changed, but their ids and semantic `kind` values remain stable. The default optional review status is `review`.

The default categories are `work` and `personal`. Custom categories and statuses created in the dashboard are stored in the same database.

## Local HTTP API

- `GET /api/state`: todos, categories, and statuses
- `PATCH /api/state`: upsert dashboard state
- `GET|POST /api/todos`
- `GET|PUT|DELETE /api/todos/:code`
- `GET /api/codex/status`
- `POST /api/codex/refresh`

The server listens only on loopback unless `AGENT_TODO_HOST` is explicitly set.
