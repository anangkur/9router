# Refresh models

Reference for the two model-refresh endpoints and the dashboard buttons that call them.

## What a refresh does

- Pulls the provider's live model catalog over HTTP right now. No restart, no server-side cache to clear.
- Persists one field only: `lastModelsRefreshAt` on the connection, written after a successful fetch.
- Never rewrites the catalog on failure: an upstream error leaves the connection's stored custom models as they are.
- Reports `added` / `removed` by diffing the live ids against the stored custom rows of that provider. It does not import the live list into the database.
- Counts `freeCount` from the models the fetch itself marked free (`isFree`, or an id ending `-free`).

## Endpoints

Auth is the dashboard guard used by the rest of `/api/providers`: session cookie, or the CLI header `x-9r-cli-token`.

### `POST /api/providers/{connectionId}/models/refresh`

No request body.

```json
200 {
  "ok": true,
  "connectionId": "d0b2ad4b-5b22-40ee-8d7d-02417a8272ad",
  "provider": "openrouter",
  "fetched": 472,
  "freeCount": 0,
  "added": ["upstage/solar-mini-4-5", "xiaomi/mimo-v2.6-flash-mopd"],
  "removed": [],
  "lastModelsRefreshAt": "2026-11-25T05:20:35.585Z"
}
```

- `404` — unknown connection: `{"ok":false,"connectionId":"nope-123","error":"Connection not found"}`
- `409` — a refresh for this connection is already running: `{"ok":false,...,"error":"A models refresh is already running for this connection"}`
- upstream status passthrough (`401`, `429`, `500`, …) with the provider's message, no timestamp written
- `401` — missing or wrong auth header

### `POST /api/providers/refresh-models`

No request body. Walks every active connection **sequentially** (upstreams rate-limit hard). A connection without a live fetcher goes to `skipped[]`; a per-connection failure goes to `errors[]` and does not fail the batch.

```json
200 {
  "ok": true,
  "refreshed": 1,
  "results": [
    {
      "ok": true,
      "connectionId": "d0b2ad4b-5b22-40ee-8d7d-02417a8272ad",
      "provider": "openrouter",
      "fetched": 472,
      "freeCount": 0,
      "added": ["…"],
      "removed": [],
      "lastModelsRefreshAt": "2026-11-25T05:20:36.102Z"
    }
  ],
  "skipped": [
    { "connectionId": "c81b61f1-59f5-4ae4-91f5-4f133b9319dd", "provider": "glm", "reason": "No live models fetcher" }
  ],
  "errors": []
}
```

`errors[]` entries are `{connectionId, provider, error, status}`.

## Dashboard

- **Provider detail** (`/dashboard/providers/{provider}`) — `Refresh Models`, rendered when the provider has a live catalog fetch path and the page has an active connection; it refreshes that first active connection.
- **Providers list** (`/dashboard/providers`) — `Refresh all models` calls the batch endpoint and reports `N refreshed, M skipped[, K failed] — provider: +added/-removed`.

## Known asymmetry: catalog membership is not runnability

A refresh reports what the provider lists, not what your credential can execute. OpenRouter lists models a key cannot run: a guardrail refuses with `404 … matching your guardrail restrictions`, and a `:free` variant can answer `429` when its capacity is gone. Both are inference-time errors; the refresh stays green because the catalog did not change.
