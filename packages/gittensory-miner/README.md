# @jsonbored/gittensory-miner

Foundation CLI for the local Gittensory miner runtime.

This package is the future home of the autonomous discover → analyze → plan → prepare → create → manage miner workflow. In this foundation phase it provides the package scaffold, a minimal CLI surface for `--help` and `--version`, and a non-blocking npm registry version nudge on startup.

## Status

Current scope is intentionally small:

- workspace package wiring
- CLI entry point
- `--help` and `version` commands
- laptop-mode `init` and `doctor` commands
- startup npm version nudge (override with `--no-update-check` or `GITTENSORY_MINER_NO_UPDATE_CHECK=1`)

Discovery, planning, create, and manage commands land in follow-up issues.

The package also includes the first metadata-only discovery primitive: `fetchCandidateIssues` lists open issue
metadata across target repos, and `searchCandidateIssues` does the same from a GitHub issue-search query. Both
paths hard-skip repos whose `AI-USAGE.md` or `CONTRIBUTING.md` explicitly bans AI-generated PRs. They perform
GitHub GET requests only, never clone source, never upload source, and never write to GitHub.

## Install

From a local checkout:

```sh
npm install
npm --workspace @jsonbored/gittensory-miner run build
```

## Commands

```sh
gittensory-miner --help
gittensory-miner help
gittensory-miner --version
gittensory-miner version
gittensory-miner init
gittensory-miner doctor
```

## Laptop Mode

Laptop mode is the zero-infra install-and-run path for local miner state. It uses a local SQLite state file and does not require Docker, Redis, or Postgres.

```sh
npm install -g @jsonbored/gittensory-miner@latest
gittensory-miner init
gittensory-miner doctor
```

`gittensory-miner init` creates the config directory and initializes the SQLite state database. By default the config directory is:

```sh
~/.config/gittensory-miner
```

Path resolution follows this order:

1. `GITTENSORY_MINER_CONFIG_DIR`
2. `XDG_CONFIG_HOME/gittensory-miner`
3. `~/.config/gittensory-miner`

The state database is stored at `state.sqlite3` inside the config directory. Re-running `init` is safe and does not delete existing state.

`gittensory-miner doctor` reports the Node version, config directory, SQLite state path, state file existence/writability, and Docker presence. Docker is informational only and is never required for laptop mode.

## Version check

On every invocation the CLI starts an async npm registry lookup (5s timeout). When the installed package is behind `@jsonbored/gittensory-miner@latest`, it prints a one-line upgrade command to stderr without blocking or failing the requested command. Set `GITTENSORY_NPM_REGISTRY_URL` to point at a mirror, same as `@jsonbored/gittensory-mcp`.
