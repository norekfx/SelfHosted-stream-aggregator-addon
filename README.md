# SelfHosted Stream Aggregator Addon

Self-hosted Stremio/Nuvio addon aggregator focused on validating streams, selecting preferred European audio/subtitle languages, and exposing simplified Original/Auto/transcoded quality options.

## Current status

The repository now contains the first working TypeScript/Fastify scaffold:

- `GET /` - modern dark admin web panel.
- `GET /health` - health check.
- `GET /manifest.json` - Stremio-compatible addon manifest.
- `GET /stream/:type/:id.json` - stream endpoint for `movie` and `series` IDs.
- `GET /admin/settings` and `PATCH /admin/settings` - persistent app settings.
- `GET /admin/addons` - list configured external addons.
- `POST /admin/addons` - register an external addon by manifest URL.
- `POST /admin/addons/:addonId/check` - manually refresh addon health.
- `GET /admin/aggregate/:type/:id` - diagnostic aggregation endpoint with normalized metadata, validation results, ranked streams and selected original.
- `GET /admin/cache` - list cached media selections.
- `GET /admin/cache/:type/:id` - inspect cached result for one movie/series item.
- `POST /admin/cache/:type/:id/refresh` - force a cache refresh.
- `GET /admin/history` - list persisted search history.
- `GET /proxy/original/:streamId` - redirects the `Original` option to the selected original file.
- `GET /transcode/:streamId/:quality/master.m3u8` - starts or returns an FFmpeg HLS transcode playlist from the selected original.
- `GET /transcode/:streamId/:quality/:segment` - returns generated HLS `.ts` segments.
- SQLite persistence for addons, settings, search cache, selected originals and search history at `/data/db/aggregator.sqlite` by default.
- European language registry with Polish as the default preferred audio/subtitle language.
- Stream metadata parser for quality, release source, codec, size, audio kind, audio language and subtitle language.
- HTTP stream validator using `HEAD`, fallback `Range` GET, timeout, HTTP status, content type, content length and range support.
- Ranking that selects exactly one working original source.
- Stale-while-refresh cache: repeated playback can return the last working result immediately while the server refreshes addon results in the background.
- Buffer presets: disabled, auto, 2s, 5s, 10s, 15s, 20s, 30s, 45s, 60s.
- FFmpeg/HLS transcode session manager for `Auto`, `4K`, `1440p`, `1080p`, `720p`, `480p`, `360p`, `240p`, `144p`.
- Docker and Docker Compose files for TrueNAS Scale-style self-hosting.

Important playback rule: `Original` is the original selected file. All quality options such as `Auto`, `4K`, `1080p` and `720p` are server-side transcodes generated from that same selected original, not separate streams from different addons.

The stream endpoint uses the stored working result immediately when available, then refreshes the search in the background. If there is no cache yet, it performs a full aggregation, validation and ranking before returning options.

## Admin panel

Open the panel at:

```text
http://localhost:7000/
```

Panel sections:

- Dashboard - addon/cache/history summary.
- Addony - add addon by manifest URL, check status, enable/disable.
- Cache - inspect remembered movie/series selections and force refresh.
- Historia - view persisted searches and selected files.
- Diagnostyka - run manual aggregation for a movie or series ID.
- Ustawienia - preferred languages, buffer preset, validation timeout, transcode session limit, public URL and diagnostic toggles.

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

Register an external addon:

```bash
curl -X POST http://localhost:7000/admin/addons \
  -H 'content-type: application/json' \
  -d '{"manifestUrl":"https://example.com/manifest.json"}'
```

List registered addons:

```bash
curl http://localhost:7000/admin/addons
```

Run diagnostic aggregation:

```bash
curl http://localhost:7000/admin/aggregate/movie/tt0133093
```

Inspect cache and history:

```bash
curl http://localhost:7000/admin/cache
curl http://localhost:7000/admin/cache/movie/tt0133093
curl -X POST http://localhost:7000/admin/cache/movie/tt0133093/refresh
curl http://localhost:7000/admin/history
```

Run parser examples:

```bash
npm run examples:metadata
```

## Docker

```bash
cp .env.example .env
docker compose up --build
```

The runtime image installs FFmpeg automatically and includes the static admin panel assets.

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

Put Cloudflare/Caddy/Traefik/Nginx in front of the container and set `PUBLIC_BASE_URL` to the public HTTPS domain.

## Milestones

1. Add external addon registry: URL/GitHub input, manifest discovery, status checks. **Started.**
2. Add persistent storage: SQLite plus cache directory for transcode/session metadata. **Started.**
3. Implement real stream aggregation from configured addons. **Started.**
4. Normalize results: quality, size, release group, language, subtitles, source addon. **Started.**
5. Validate streams before exposing them: `HEAD`, partial `GET`, timeout handling, `ffprobe` where possible. **Started.**
6. Select best original stream using preferred European audio/subtitle language rules. **Started.**
7. Add FFmpeg HLS transcoding sessions for `Auto`, `4K`, `1440p`, `1080p`, `720p`, `480p`, `360p`, `240p`, `144p`. **Started.**
8. Add admin web UI: addon management, status, search history, validation logs and selected file history. **Started.**
