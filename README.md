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
- European language registry with Polish as the default preferred audio/subtitle language.
- Simplified visible stream options: `Original`, `Auto`, `4K`, `1440p`, `1080p`, `720p`, `480p`, `360p`, `240p`, `144p`.
- Docker and Docker Compose files for TrueNAS Scale-style self-hosting.

The stream endpoint currently returns no streams until real addon aggregation and validation are implemented. This is intentional: the project should not show Stremio links unless the original stream and transcoded variants can be trusted to work.

The addon registry is currently in-memory. It proves the API shape, health checks and manifest validation. The next storage milestone is SQLite or PostgreSQL persisted on a TrueNAS dataset/volume.

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

## Docker

```bash
cp .env.example .env
docker compose up --build
```

## TrueNAS Scale notes

For the later TrueNAS deployment, persist these paths on datasets/volumes:

- `/data/cache` - transcode/session cache.
- future `/data/db` - SQLite database or PostgreSQL volume.
- future `/data/logs` - validation and search history logs if file logging is enabled.

Put Cloudflare/Caddy/Traefik/Nginx in front of the container and set `PUBLIC_BASE_URL` to the public HTTPS domain.

## Milestones

1. Add external addon registry: URL/GitHub input, manifest discovery, status checks. **Started.**
2. Implement real stream aggregation from configured addons.
3. Normalize results: quality, size, release group, language, subtitles, source addon.
4. Validate streams before exposing them: `HEAD`, partial `GET`, timeout handling, `ffprobe` where possible.
5. Select best original stream using preferred European audio/subtitle language rules.
6. Add FFmpeg HLS transcoding sessions for `Auto`, `4K`, `1440p`, `1080p`, `720p`, `480p`, `360p`, `240p`, `144p`.
7. Add admin web UI: addon management, status, search history, validation logs and selected file history.
8. Add persistent storage: PostgreSQL/SQLite plus cache directory for transcode/session metadata.
