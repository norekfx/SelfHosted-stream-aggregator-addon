# SelfHosted Stream Aggregator Addon

Self-hosted Stremio/Nuvio addon aggregator focused on validating streams, selecting preferred European audio/subtitle languages, and exposing simplified Original/Auto/transcoded quality options.

## Features

- **Multi-Addon Aggregation**: Aggregate streams from multiple Stremio/Nuvio-compatible addons
- **Stream Validation**: HEAD requests, Range GET, timeout handling, content verification, FFprobe duration checking
- **European Language Support**: 40+ European languages with Polish as default
- **Transcoding**: Live and VOD HLS transcoding with Intel QSV/VAAPI support
- **Admin Panel**: Full web UI for management, settings, and diagnostics
- **Library Management**: TMDB-based catalogs with automation
- **Docchi Integration**: Automatic episode mapping for Docchi addon
- **AnimeSub Subtitles**: Automatic subtitle fetching and local caching
- **Caching**: Stale-while-refresh pattern for optimal performance
- **Health Monitoring**: Technical health-check and system logs
- **Docker Ready**: Pre-built Docker images with FFmpeg

## Current status

The repository now contains the first working TypeScript/Fastify scaffold:

- `GET /` - modern dark admin web panel with first-run registration and later login.
- `GET /auth/status`, `POST /auth/register`, `POST /auth/login`, `POST /auth/logout` - admin authentication.
- `GET /auth/sessions`, `POST /auth/change-password`, `POST /auth/logout-other-sessions`, `POST /auth/logout-all-sessions` - security panel actions.
- `GET /health` - health check.
- `GET /manifest.json` - Stremio-compatible addon manifest.
- `GET /stream/:type/:id.json` - stream endpoint for `movie` and `series` IDs.
- `GET /catalog/:type/:id.json` - catalog endpoint for libraries.
- `GET /meta/:type/:id.json` - metadata endpoint for TMDB items.
- `GET /subtitles/:type/:id.json` - subtitles endpoint.
- `GET /subtitles/local/:type/:id/:index.vtt` - local subtitle file.
- Protected admin API under `/admin/*` for settings, addons, cache, history, diagnostics and system logs.
- `GET /admin/system/health`, `GET /admin/system/logs`, `DELETE /admin/system/logs` - technical health-check and log panel APIs.
- `GET /proxy/original/:streamId` - redirects the `Original` option to the selected original file.
- `GET /transcode/:streamId/:quality/master.m3u8` - starts or returns an FFmpeg HLS transcode playlist from the selected original.
- `GET /transcode/:streamId/:quality/:segment` - returns generated HLS `.ts` segments.
- `GET /transcode-vod/:streamId/:quality/master.m3u8` - VOD HLS transcoded playlist.
- `GET /transcode-vod/:streamId/:quality/:segment` - VOD HLS segment.
- SQLite persistence for addons, settings, auth users/sessions, search cache, selected originals, system logs and search history at `/data/db/aggregator.sqlite` by default.
- European language registry with Polish as the default preferred audio/subtitle language.
- Stream metadata parser for quality, release source, codec, size, audio kind, audio language and subtitle language.
- HTTP stream validator using `HEAD`, fallback `Range` GET, timeout, HTTP status, content type, content length and range support.
- Ranking that selects exactly one working original source.
- Stale-while-refresh cache: repeated playback can return the last working result immediately while the server refreshes addon results in the background.
- Buffer presets: disabled, auto, 2s, 5s, 10s, 15s, 20s, 30s, 45s, 60s.
- FFmpeg/HLS transcode session manager for `Auto`, `4K`, `1440p`, `1080p`, `720p`, `480p`, `360p`, `240p`, `144p`.
- VOD HLS transcoding with batch, worker, and worker v2 strategies.
- Intel QSV/VAAPI hardware acceleration support.
- Library management with TMDB catalogs and automation.
- Docchi episode mapping integration.
- AnimeSub subtitle integration.
- Docker and Docker Compose files for TrueNAS Scale-style self-hosting.
- GitHub Actions CI for TypeScript typecheck and build.

Important playback rule: `Original` is the original selected file. All quality options such as `Auto`, `4K`, `1080p` and `720p` are server-side transcodes generated from that same selected original, not separate streams from different addons.

The stream endpoint uses the stored working result immediately when available, then refreshes the search in the background if that setting is enabled. If there is no cache yet, it performs a full aggregation, validation and ranking before returning options.

## Public Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /` | Admin web panel |
| `GET /manifest.json` | Stremio-compatible addon manifest |
| `GET /stream/:type/:id.json` | Stream endpoint for movies and series |
| `GET /catalog/:type/:id.json` | Catalog endpoint for libraries |
| `GET /meta/:type/:id.json` | Metadata endpoint for TMDB items |
| `GET /subtitles/:type/:id.json` | Subtitles endpoint |
| `GET /subtitles/local/:type/:id/:index.vtt` | Local subtitle file |
| `GET /proxy/original/:streamId` | Redirect to original stream |
| `GET /transcode/:streamId/:quality/master.m3u8` | Live HLS transcoded playlist |
| `GET /transcode/:streamId/:quality/:segment` | Live HLS segment |
| `GET /transcode-vod/:streamId/:quality/master.m3u8` | VOD HLS transcoded playlist |
| `GET /transcode-vod/:streamId/:quality/:segment` | VOD HLS segment |
| `GET /health` | Health check |

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
- `/admin/libraries`
- `/admin/animesub/*`
- `/admin/docchi/*`
- `/admin/transcode/*`
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
- Biblioteki - manage TMDB-based library catalogs with automation.
- Napisy - AnimeSub subtitle management and preview.

Panel settings are now wired into runtime behavior:

- preferred audio/subtitle languages affect ranking and original selection,
- validation timeout affects stream checks,
- default buffer preset affects HLS transcode sessions,
- max transcode sessions affects FFmpeg process limiting,
- public URL affects generated Stremio stream URLs,
- background cache refresh can be enabled or disabled,
- diagnostic details can return full or compact aggregation payloads.

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `HOST` | `0.0.0.0` | Server host |
| `PORT` | `7000` | Server port |
| `PUBLIC_BASE_URL` | - | Public HTTPS URL for Stremio access |
| `DATA_DIR` | `/data` | Data directory for database and cache |
| `DATABASE_PATH` | - | Custom database path |
| `STREAM_VALIDATION_TIMEOUT_MS` | `10000` | Stream validation timeout in ms |
| `FFMPEG_PATH` | `ffmpeg` | FFmpeg binary path |
| `DEFAULT_TRANSCODE_BUFFER_PRESET` | `auto` | Default buffer preset |
| `MAX_TRANSCODE_SESSIONS` | `2` | Maximum concurrent transcode sessions |

### Admin Panel Settings

- Preferred audio/subtitle languages (40+ European languages)
- Stream validation timeout
- Link validation mode (best/all/number)
- Max transcode sessions
- Transcode buffer preset
- TMDB API configuration (API key or read access token)
- Metadata sync interval (0-1440 minutes)
- Docchi mapping modes (disabled, animation_series, series, all)
- Docchi stream force modes (enabled, disabled, partial)
- Transcode quality settings (min/max quality, CRF, bitrate)
- Intel QSV/VAAPI modes (disabled, encode, decode_encode)
- VOD transcode strategy (batch, worker, worker_v2)
- VOD buffer progression (target, infinite)
- Cache limits (transcode cache in GB)

## Transcoding Qualities

| Quality | Resolution | Bitrate (kbps) | Audio (kbps) |
|---------|------------|----------------|--------------|
| Auto | Varies | Varies | 128 |
| 4K | 3840x2160 | 18000 | 192 |
| 1440p | 2560x1440 | 10000 | 192 |
| 1080p | 1920x1080 | 6000 | 160 |
| 720p | 1280x720 | 3500 | 128 |
| 480p | 854x480 | 1800 | 128 |
| 360p | 640x360 | 1000 | 96 |
| 240p | 426x240 | 600 | 96 |
| 144p | 256x144 | 250 | 64 |

## Library Automation

### Docchi Automation Modes
- `disabled`: No Docchi mapping
- `animation_series`: Only animation/series
- `series`: All series
- `all`: All content

### AnimeSub Automation Modes
- `manual`: Manual only
- `24h`: Every 24 hours
- `3d`: Every 3 days
- `7d`: Every 7 days
- `14d`: Every 14 days
- `30d`: Every 30 days

### Missing Retry Modes
- `never`: Never retry
- `once`: Retry once
- `twice`: Retry twice
- `daily`: Retry daily

### Library Modes
- `discover`: TMDB discover
- `trending`: Trending content
- `popular`: Popular content
- `top_rated`: Top rated content
- `now_playing`: Now playing (movies)
- `upcoming`: Upcoming (movies)
- `airing_today`: Airing today (series)
- `on_the_air`: On the air (series)

## Database Schema

| Table | Description |
|-------|-------------|
| `addons` | Registered external addons |
| `search_cache` | Cached search results |
| `search_history` | Search history |
| `app_settings` | Application settings |
| `admin_users` | Admin user accounts |
| `admin_sessions` | Admin sessions |
| `system_logs` | System log entries |
| `libraries` | Library definitions |
| `library_cache` | Library catalog cache |
| `meta_cache` | Metadata cache |
| `subtitle_cache` | Subtitle cache |
| `library_automation_status` | Automation task status |

## Intel QSV/VAAPI Hardware Acceleration

The addon supports Intel Quick Sync Video (QSV) and VAAPI for hardware-accelerated transcoding.

### QSV Modes
- `disabled`: CPU encoding only
- `encode`: QSV encoding only
- `decode_encode`: QSV decode and encode

### VAAPI
Fallback to VAAPI h264_vaapi for older Intel GPUs (Haswell and newer).

### Requirements
- Intel CPU with QSV support
- FFmpeg with h264_qsv encoder
- `/dev/dri/renderD128` device accessible
- LIBVA_DRIVER_NAME environment variable set

## Docker Deployment

### Basic Setup
```bash
cp .env.example .env
docker compose up -d
```

### Data Persistence
Mount `/data` to persist database and transcode cache:
```yaml
volumes:
  - ./data:/data
```

### TrueNAS Scale
For TrueNAS Scale deployment, persist `/data` on a dataset/volume.

### Environment Variables
See Configuration section above for all available variables.

## Development

```bash
npm install
cp .env.example .env
npm run dev
```

### Available Scripts
- `npm run dev`: Start development server with watch
- `npm run start`: Start production server
- `npm run build`: Build TypeScript
- `npm run typecheck`: Type check without building
- `npm run examples:metadata`: Run stream metadata parser examples

### Open:
```text
http://localhost:7000/
http://localhost:7000/manifest.json
http://localhost:7000/stream/movie/tt0133093.json
```

After registration/login, admin API examples can be called by the browser panel. Raw `curl` requests to protected endpoints require the session cookie.

## API Examples

### Register Admin
```bash
curl -X POST http://localhost:7000/auth/register \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"securepassword123"}'
```

### Get Settings
```bash
curl -H "Cookie: ssa_admin_session=<token>" \
  http://localhost:7000/admin/settings
```

### Add Addon
```bash
curl -X POST http://localhost:7000/admin/addons \
  -H "Cookie: ssa_admin_session=<token>" \
  -H "Content-Type: application/json" \
  -d '{"manifestUrl":"https://example.com/manifest.json","enabled":true}'
```

### Health Check
```bash
curl http://localhost:7000/health
```

## Troubleshooting

### FFmpeg Not Found
Ensure FFmpeg is installed and in PATH, or set `FFMPEG_PATH` environment variable.

### Transcoding Fails
- Check FFmpeg installation
- Verify Intel QSV/VAAPI support
- Check transcode cache directory permissions

### Streams Not Validating
- Increase `STREAM_VALIDATION_TIMEOUT_MS`
- Check network connectivity to addon sources
- Review system logs for details

### Database Corruption
Delete the SQLite database and restart the addon to recreate it.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Acknowledgments

- [Stremio](https://stremio.com/) for the addon API
- [TMDB](https://www.themoviedb.org/) for the movie/series database
- [Kometa Team](https://github.com/Kometa-Team) for Anime-IDs
- All addon developers for their contributions

## Milestones

1. Add external addon registry: URL/GitHub input, manifest discovery, status checks. ✅
2. Add persistent storage: SQLite plus cache directory for transcode/session metadata. ✅
3. Implement real stream aggregation from configured addons. ✅
4. Normalize results: quality, size, release group, language, subtitles, source addon. ✅
5. Validate streams before exposing them: HEAD, partial GET, timeout handling, ffprobe where possible. ✅
6. Select best original stream using preferred European audio/subtitle language rules. ✅
7. Add FFmpeg HLS transcoding sessions for Auto, 4K, 1440p, 1080p, 720p, 480p, 360p, 240p, 144p. ✅
8. Add admin web UI: addon management, install panel, status, search history, validation logs and selected file history. ✅
9. Add first-run registration, admin login and security panel. ✅
10. Add CI, technical health-check and system log panel. ✅
11. Add library management with TMDB catalogs. ✅
12. Add Docchi episode mapping integration. ✅
13. Add AnimeSub subtitle integration. ✅
14. Add VOD HLS transcoding with worker strategies. ✅
15. Add Intel QSV/VAAPI hardware acceleration support. ✅