# SelfHosted Stream Aggregator Addon

Self-hosted Stremio/Nuvio addon aggregator focused on validating streams, selecting preferred European audio/subtitle languages, and exposing simplified Original/Auto/transcoded quality options.

## Current status

The repository now contains the first working TypeScript/Fastify scaffold:

- `GET /` - modern dark admin web panel with first-run registration and later login.
- `GET /auth/status`, `POST /auth/register`, `POST /auth/login`, `POST /auth/logout` - admin authentication.
- `GET /auth/sessions`, `POST /auth/change-password`, `POST /auth/logout-other-sessions`, `POST /auth/logout-all-sessions` - security panel actions.
- `GET /health` - health check.
- `GET /manifest.json` - Stremio-compatible addon manifest.
- `GET /stream/:type/:id.json` - stream endpoint for `movie` and `series` IDs.
- Protected admin API under `/admin/*` for settings, addons, cache, history, diagnostics and system logs.
- `GET /admin/system/health`, `GET /admin/system/logs`, `DELETE /admin/system/logs` - technical health-check and log panel APIs.
- `GET /proxy/original/:streamId` - redirects the `Original` option to the selected original file.
- `GET /transcode/:streamId/:quality/master.m3u8` - starts or returns an FFmpeg HLS transcode playlist from the selected original.
- `GET /transcode/:streamId/:quality/:segment` - returns generated HLS `.ts` segments.
- SQLite persistence for addons, settings, auth users/sessions, search cache, selected originals, system logs and search history at `/data/db/aggregator.sqlite` by default.
- European language registry with Polish as the default preferred audio/subtitle language.
- Stream metadata parser for quality, release source, codec, size, audio kind, audio language and subtitle language.
- HTTP stream validator using `HEAD`, fallback `Range` GET, timeout, HTTP status, content type, content length and range support.
- Ranking that selects exactly one working original source.
- Stale-while-refresh cache: repeated playback can return the last working result immediately while the server refreshes addon results in the background.
- Buffer presets: disabled, auto, 2s, 5s, 10s, 15s, 20s, 30s, 45s, 60s.
- FFmpeg/HLS transcode session manager for `Auto`, `4K`, `1440p`, `1080p`, `720p`, `480p`, `360p`, `240p`, `144p`.
- Docker and Docker Compose files for TrueNAS Scale-style self-hosting.
- GitHub Actions CI for TypeScript typecheck and build.

Important playback rule: `Original` is the original selected file. All quality options such as `Auto`, `4K`, `1080p` and `720p` are server-side transcodes generated from that same selected original, not separate streams from different addons.

The stream endpoint uses the stored working result immediately when available, then refreshes the search in the background if that setting is enabled. If there is no cache yet, it performs a full aggregation, validation and ranking before returning options.

## Admin panel and authentication

Open the panel at:

```text
http://localhost:7000/
```

On the first run there are no users, so the panel shows admin registration. After the first admin account is created, the same screen becomes a login form. Sessions are stored in SQLite and sent as an HTTP-only cookie.

Public endpoints required for Stremio/Nuvio playback remain public and do not require the admin cookie:

- `/manifest.json`
- `/stream/:type/:id.json`
- `/proxy/original/:streamId`
- `/transcode/:streamId/:quality/master.m3u8`
- `/transcode/:streamId/:quality/:segment`

This means Stremio/Nuvio can install and play from the addon without knowing the admin login. External addons added in the panel are also not affected by admin authentication, because the server calls their manifest and stream endpoints as a backend client; only local management endpoints under `/admin/*` are protected.

Other public utility endpoints:

- `/`
- `/auth/status`
- `/auth/register` only before first admin exists
- `/auth/login`
- `/auth/logout`
- `/health`

Protected endpoints:

- `/admin/settings`
- `/admin/addons`
- `/admin/aggregate/:type/:id`
- `/admin/cache`
- `/admin/history`
- `/admin/system/health`
- `/admin/system/logs`
- `/auth/sessions`
- `/auth/change-password`
- `/auth/logout-other-sessions`
- `/auth/logout-all-sessions`

Panel sections:

- Dashboard - addon/cache/history summary.
- Instalacja - ready-to-copy manifest URL, test stream URL and Stremio/Nuvio readiness checklist.
- Addony - add addon by manifest URL, check status, enable/disable.
- Cache - inspect remembered movie/series selections and force refresh.
- Historia - view persisted searches and selected files.
- Diagnostyka - run manual aggregation for a movie or series ID.
- System - technical health-check and small error log panel.
- Ustawienia - preferred languages, buffer preset, validation timeout, transcode session limit, public URL and diagnostic toggles.
- Bezpieczeństwo - change password, view sessions, log out other sessions, log out all sessions.

Panel settings are now wired into runtime behavior:

- preferred audio/subtitle languages affect ranking and original selection,
- validation timeout affects stream checks,
- default buffer preset affects HLS transcode sessions,
- max transcode sessions affects FFmpeg process limiting,
- public URL affects generated Stremio stream URLs,
- background cache refresh can be enabled or disabled,
- diagnostic details can return full or compact aggregation payloads.

## Development

```bash
npm install
cp .env.example .env
npm run dev
```

Open:

```text
http://localhost:7000/
http://localhost:7000/manifest.json
http://localhost:7000/stream/movie/tt0133093.json
```

After registration/login, admin API examples can be called by the browser panel. Raw `curl` requests to protected endpoints require the session cookie.

Run parser examples:

```bash
npm run examples:metadata
```

Run local checks:

```bash
npm run typecheck
npm run build
```

## Docker

```bash
cp .env.example .env
docker compose up --build
```

The runtime image installs FFmpeg automatically and includes the static admin panel assets. Native Node modules such as `better-sqlite3` are built in the dependency stage before the production runtime image is assembled.

## TrueNAS Scale notes

For TrueNAS deployment, persist `/data` on a dataset/volume. The default SQLite path is `/data/db/aggregator.sqlite`, and transcode cache lives under `/data/cache/transcode`.

Useful environment variables:

```text
PUBLIC_BASE_URL=https://streams.example.com
STREAM_VALIDATION_TIMEOUT_MS=10000
FFMPEG_PATH=ffmpeg
DEFAULT_TRANSCODE_BUFFER_PRESET=auto
MAX_TRANSCODE_SESSIONS=2
```

Put Cloudflare/Caddy/Traefik/Nginx in front of the container and set `PUBLIC_BASE_URL` to the public HTTPS domain. The same value can also be managed later from the admin panel.

## Milestones

1. Add external addon registry: URL/GitHub input, manifest discovery, status checks. **Started.**
2. Add persistent storage: SQLite plus cache directory for transcode/session metadata. **Started.**
3. Implement real stream aggregation from configured addons. **Started.**
4. Normalize results: quality, size, release group, language, subtitles, source addon. **Started.**
5. Validate streams before exposing them: `HEAD`, partial `GET`, timeout handling, `ffprobe` where possible. **Started.**
6. Select best original stream using preferred European audio/subtitle language rules. **Started.**
7. Add FFmpeg HLS transcoding sessions for `Auto`, `4K`, `1440p`, `1080p`, `720p`, `480p`, `360p`, `240p`, `144p`. **Started.**
8. Add admin web UI: addon management, install panel, status, search history, validation logs and selected file history. **Started.**
9. Add first-run registration, admin login and security panel. **Started.**
10. Add CI, technical health-check and system log panel. **Started.**
