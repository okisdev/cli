# okisdev

## 0.0.7

- Add `ai usage collect cursor` subcommand to ingest Cursor usage from an exported usage-events CSV (`--csv <path>`), covering a data source `ccusage` does not
- Estimate cost via modelpedia pricing for Cursor day/model rows where the CSV reports 0 (subscription-included usage), keeping the CSV cost whenever it is greater than 0
- Add `ai usage grok` subcommand to ingest Grok CLI usage from `~/.grok`, including session counts and token data from the unified log; `ai usage collect` runs it automatically and merges it into the same upload

## 0.0.6

- Rewrite `ai usage collect` to source all agents from `ccusage daily` (Claude Code, Codex, OpenCode, Hermes, and others) instead of only Claude Code and Codex
- Collect session counts from `ccusage session` and upload them alongside daily usage
- Add `--since <date>` to scope a run to recent days

## 0.0.3

- Add `ai usage collect` command

## 0.0.2

- Add `info` command

## 0.0.1

- Initial release
