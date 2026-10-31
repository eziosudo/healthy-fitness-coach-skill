# Raspberry Pi deployment

Upstream: https://github.com/Surge-Dan/healthy-fitness-coach-skill

`docker compose -f compose.raspberrypi.yml up -d --build`

Container: healthy-fitness-mcp. Host address: 10.0.0.45:8091/mcp. Transport: stateful MCP Streamable HTTP with Bearer authentication. HTTPS hostname syncfit-mcp.eziosudo.org (alias fitness-mcp.eziosudo.org) is routed through the dedicated syncfit-mcp Cloudflare Tunnel; TLS availability must be checked separately.

Secrets are mounted read-only from secrets/. MCP_APP_ACCESS_TOKEN_FILE is the fitness MCP bearer credential; it is separate from the Xunji API key. elements_calculate now uses EC_MCP_APP_ACCESS_TOKEN. Only the Xunji training API key is configured. Data/cache/DNA/write-operation state persist in data/. Neither secrets/ nor data/ should be committed.

For encrypted access without waiting for HTTPS, use SSH stdio:

```sh
ssh -T raspberrypi4 'docker exec -i healthy-fitness-mcp node src/stdio-docker.js'
```

The stdio entry authenticates through SSH and reads its Xunji key inside the container. Do not send the access token over the LAN HTTP endpoint.

Docker adaptations: Linux file-based credential provider, packaged shared Skill modules, non-root read-only container, persistent storage, HTTP sessions, constant-time bearer authentication, request size limit, Host/Origin checks, and an SSH stdio entry point. The original training write preview/confirmation/recovery logic is preserved.

Tunnel connector: syncfit-mcp-tunnel, tunnel ID d77a07e9-c696-48d6-86b4-066ed38bb7d7. Connector traffic goes directly to http://mcp:8080 inside the Compose network. Its token is mounted from secrets/cloudflared-token.

## Training API v2

Reads use `/api_trains_for_llm_v2`; writes use `/api_upsert_trains_for_llm_v2`. All read tools accept `include_full_data` (default false). Write tools now accept 1–4 same-day structured training objects, not legacy comma-separated strings. Read an existing training day in full mode and copy `records[].train` before changing it. Preserve all other fields, preview, obtain explicit user confirmation, then submit the same objects with preview_id and confirm:true. No live writes are performed by the automated test suite.

V2 cache lives under `data/HealthyFitnessCoach/xunji-cache-v2/{summary,full}`; old v1 cache is retained but not read. Full records preserve RPE, notes, heart rate summaries, unfinished sets and super/drop sets. Statistics count completed sets and normalize lbs to kg; recorded weight volume does not imply total work or automatically double unilateral dumbbell loads. Official plan, diet and body-measurement APIs are not exposed by these seven tools.

Run checks with `npm ci --prefix healthy-fitness-coach-plugin/mcp/xunji` and `npm test --prefix healthy-fitness-coach-plugin/mcp/xunji`. Start HTTP locally with XUNJI_API_KEY_FILE, MCP_APP_ACCESS_TOKEN_FILE, LOCALAPPDATA and MCP_ALLOWED_HOSTS configured, using `node healthy-fitness-coach-plugin/mcp/xunji/src/http-server.js`. Start SSH stdio with the command above.
