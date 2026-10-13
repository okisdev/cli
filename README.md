# okisdev

Personal command line interface for okis.dev.

```bash
npx okisdev <command>
```

## Commands

- `info` — print project info
- `ai usage collect` — collect all-agent AI usage and session counts via `ccusage` (including Grok) plus Oh My Pi from `~/.omp` and upload them to okis.dev. Days that ccusage has no Grok for still come from `~/.grok` (`AI_USAGE_INGEST_TOKEN`, `--dry` to preview, `--since` to scope recent days)
- `ai usage cursor` — collect Cursor usage from an exported usage-events CSV and upload it to okis.dev (`--csv <path>` required, `--dry` to preview, `--since` to scope recent days)
- `ai usage proxy` — collect llm-proxy usage from the `/api/usage/daily` feed and upload it to okis.dev (`LLM_PROXY_USAGE_TOKEN` required, `AI_USAGE_INGEST_TOKEN` to upload, `--dry` to preview, `--since` to scope recent days, `--tz` for day bucketing)
- `ai usage grok` — collect Grok CLI usage from `~/.grok` and upload it to okis.dev (`GROK_HOME` to override the data directory, `AI_USAGE_INGEST_TOKEN` to upload, `--dry` to preview, `--since` to scope recent days)
- `ai usage omp` — collect Oh My Pi usage from `~/.omp/agent/sessions` and upload it to okis.dev (`OMP_HOME` to override the data directory, `AI_USAGE_INGEST_TOKEN` to upload, `--dry` to preview, `--since` to scope recent days)
- `ai usage watch` — long-running watch that polls okis.dev for visitor traffic and uploads local plus llm-proxy usage on a visit or on a fallback interval (`AI_USAGE_INGEST_TOKEN` required unless `--dry`, `--poll-seconds`/`--interval-minutes`/`--min-gap-minutes`/`--since-days` to tune timing, `LLM_PROXY_USAGE_TOKEN` optional for the llm-proxy leg)

## License

[MIT](./LICENSE)
