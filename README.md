# SelfHosted Stream Aggregator Addon

Self-hosted Stremio/Nuvio addon aggregator focused on validating streams, selecting preferred European audio/subtitle languages, and exposing simplified Original/Auto/transcoded quality options.

## Current status

The repository now contains the first working TypeScript/Fastify scaffold:

- `GET /health` - health check.
- `GET /manifest.json` - Stremio-compatible addon manifest.
- `GET /stream/:type/:id.json` - stream endpoint for `movie` and `series` IDs.
- European language registry with Polish as the default preferred audio/subtitle language.
- Simplified visible stream options: `Original`, `Auto`, `4K`, `1440p`, `1080p`, `720p`, `480p`, `360p`, `240p`, `144p`.
- Docker and Docker Compose files for TrueNAS Scale-style self-hosting.

The stream endpoint currently returns no streams until real addon aggregation and validation are implemented. This is intentional: the project should not show Stremio links unless the original stream and transcoded variants can be trusted to work.

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

## Docker

```bash
cp .env.example .env
docker compose up --build
```

## Milestones

1. Add external addon registry: URL/GitHub input, manifest discovery, status checks.
2. Implement real stream aggregation from configured addons.
3. Normalize results: quality, size, release group, language, subtitles, source addon.
4. Validate streams before exposing them: `HEAD`, partial `GET`, timeout handling, `ffprobe` where possible.
5. Select best original stream using preferred European audio/subtitle language rules.
6. Add FFmpeg HLS transcoding sessions for `Auto`, `4K`, `1440p`, `1080p`, `720p`, `480p`, `360p`, `240p`, `144p`.
7. Add admin web UI: addon management, status, search history, validation logs and selected file history.
8. Add persistent storage: PostgreSQL/SQLite plus cache directory for transcode/session metadata.
