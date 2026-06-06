# SelfHosted Stream Aggregator Addon

Self-hosted Stremio/Nuvio addon aggregator focused on validating streams, selecting preferred European audio/subtitle languages, and exposing simplified Original/Auto/transcoded quality options.

## Current status

The repository now contains the first working TypeScript/Fastify scaffold:

- `GET /health` - health check.
- `GET /manifest.json` - Stremio-compatible addon manifest.
- `GET /stream/:type/:id.json` - stream endpoint for `movie` and `series` IDs.
- `GET /admin/addons` - list configured external addons.
- `POST /admin/addons` - register an external addon by manifest URL.
- `POST /admin/addons/:addonId/check` - manually refresh addon health.
- `GET /admin/aggregate/:type/:id` - diagnostic aggregation endpoint with normalized metadata for raw external addon results.
- SQLite persistence for registered addons at `/data/db/aggregator.sqlite` by default.
- European language registry with Polish as the default preferred audio/subtitle language.
- Stream metadata parser for quality, release source, codec, size, audio kind, audio language and subtitle language.
- Simplified visible stream options: `Original`, `Auto`, `4K`, `1440p`, `1080p`, `720p`, `480p`, `360p`, `240p`, `144p`.
- Docker and Docker Compose files for TrueNAS Scale-style self-hosting.

The stream endpoint currently runs aggregation but returns no streams until validation, ranking and transcoding readiness checks are implemented. This is intentional: the project should not show Stremio links unless the original stream and transcoded variants can be trusted to work.

## Development

```bash
npm install
cp .env.example .env
npm run dev
```

Open:

```text
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

Run parser examples:

```bash
npm run examples:metadata
```

## Docker

```bash
cp .env.example .env
docker compose up --build
```

## TrueNAS Scale notes

For TrueNAS deployment, persist `/data` on a dataset/volume. The default SQLite path is `/data/db/aggregator.sqlite`, and future cache/log paths will also live under `/data`.

Put Cloudflare/Caddy/Traefik/Nginx in front of the container and set `PUBLIC_BASE_URL` to the public HTTPS domain.

## Milestones

1. Add external addon registry: URL/GitHub input, manifest discovery, status checks. **Started.**
2. Add persistent storage: SQLite plus cache directory for transcode/session metadata. **Started.**
3. Implement real stream aggregation from configured addons. **Started.**
4. Normalize results: quality, size, release group, language, subtitles, source addon. **Started.**
5. Validate streams before exposing them: `HEAD`, partial `GET`, timeout handling, `ffprobe` where possible.
6. Select best original stream using preferred European audio/subtitle language rules.
7. Add FFmpeg HLS transcoding sessions for `Auto`, `4K`, `1440p`, `1080p`, `720p`, `480p`, `360p`, `240p`, `144p`.
8. Add admin web UI: addon management, status, search history, validation logs and selected file history.
