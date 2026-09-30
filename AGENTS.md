# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## What this is

WikiOS turns an Obsidian-compatible markdown vault into a local web app (search, article pages, graph view, stats). Local-first: it indexes the vault into SQLite and watches for file changes.

## Commands

- `npm run dev` — contributor mode: runs the Vite client (port 5211) and a tsx-watch Fastify server (port 5212) in parallel; the client proxies `/api` to the server.
- `npm run dev:spa` / `npm run build:spa` — the standalone graph SPA in `spa/` (dev port 5214; builds to `dist/spa` plus an embeddable library at `dist/spa-lib/wiki-graph.js`).
- `npm start` — user mode: builds everything and serves the built app from one process.
- `npm run build` — builds client (Vite → `dist/client`), server (`tsc -p tsconfig.server.json` → `dist-server`), and compiles `wiki-os.config.ts`.
- `npm test` — runs all Vitest tests.
- `npx vitest run tests/wiki-utils.test.ts` — run a single test file; add `-t "name"` to filter by test name.
- `npm run lint` — ESLint (flat config; `dist/` and `dist-server/` are ignored).
- `npm run typecheck` — checks both tsconfigs (client `tsconfig.json` and server `tsconfig.server.json`).
- `npm run smoke-test` — HTTP smoke test against a running instance (`WIKIOS_BASE_URL`, default `http://localhost:5211`).

## Architecture

Three layers with a strict dependency direction: `src/client` (React 19 UI) and `src/server` (Fastify) both depend on `src/lib` (the wiki core); `src/lib` depends on neither.

### `src/lib` — wiki core

Platform-agnostic. It never reads server config directly — the server injects adapters at startup via `configureServerWikiCore()` ([wiki-core-adapter.ts](src/server/wiki-core-adapter.ts)) which calls `configureWikiEnvironment()` ([wiki-environment.ts](src/lib/wiki-environment.ts)). Tests inject their own adapters the same way.

[wiki.ts](src/lib/wiki.ts) is the composition root and public API of the core. It wires together:

- `wiki-state.ts` — module-level runtime cache (`wikiCache`): open DB handle, watcher timers, pending paths, revision counters. Defines `WikiSetupRequiredError`.
- `wiki-db.ts` — better-sqlite3 index: migrations, integrity check, page upserts.
- `wiki-indexer.ts` — scans the vault, parses frontmatter/markdown, reconciles the index with disk (dependency-injected, generic over DB and config types).
- `wiki-queries.ts` — search, homepage, graph, stats, page lookup; derived-data cache keyed by revision.
- `wiki-watcher.ts` — fs watching with debounce, restart, and periodic reconcile.
- `wiki-classification.ts` — category derivation and person-page detection (frontmatter keys, tags, folder names, plus user overrides).

Startup self-heal: `ensureIndexReady()` in wiki.ts runs an integrity check on the existing SQLite index; if it fails or the DB can't open, the corrupt files are quarantined and the index is rebuilt from the vault.

### `src/server` — Fastify

[app.ts](src/server/app.ts) defines all routes under `/api`: `health`, `version`, `config`, `setup/*` (status, folder picker, save vault), `admin/reindex` (guarded by `WIKIOS_ADMIN_TOKEN`), `home`, `search`, `stats`, `graph`, `wiki/*`. It also serves the built client. When no vault is configured, API handlers return a `SETUP_REQUIRED`/`CONFIG_ERROR` payload and the client redirects to `/setup`.

[wiki-runtime.ts](src/server/wiki-runtime.ts) persists user state in `~/.wiki-os/config.json` (selected vault, person overrides) and stores hashed SQLite indexes under `~/.wiki-os/indexes/`. Env vars `WIKI_ROOT`, `WIKIOS_FORCE_WIKI_ROOT`, `PORT`, `WIKIOS_INDEX_DB`, `WIKIOS_DISABLE_WATCH` override behavior (see `.env.example`).

### `src/client` — React

`router.tsx` lazy-loads routes: `/` (home), `/setup`, `/stats`, `/graph`, `/wiki/*`, plus a 404. All server data goes through `api.ts`. Shared presentational components live in `src/components/`. Tailwind CSS 4 (PostCSS plugin), path alias `@` → `src/`.

### `spa/` — standalone graph SPA and embeddable library

The interactive 2D/3D graph UI lives in [graph-explorer.tsx](src/components/graph-explorer.tsx) (router-free; the `/graph` route is a thin wrapper that adds react-router links and navigation). `spa/` packages it for other systems: a relocatable SPA (drop a markdown folder, load graph JSON via `?data=` URL or `postMessage`) and a self-contained ES module exporting `mountWikiGraph()`. [spa/src/markdown-graph.ts](spa/src/markdown-graph.ts) reimplements the indexer's markdown→graph pipeline in the browser using the same `src/lib` functions; [tests/spa-markdown-graph.test.ts](tests/spa-markdown-graph.test.ts) asserts its output is identical to the server's `/api/graph` for the sample vault (regenerate `spa/public/demo-graph.json` when the sample vault changes). See [spa/README.md](spa/README.md) for integration patterns.

### Site config vs runtime config

`wiki-os.config.ts` at the repo root is the user-editable site config (branding, homepage labels, `people.mode`), typed as `WikiOsConfigInput` from `src/lib/wiki-config.ts`. It is compiled by `npm run build:config` and served at `/api/config`. This is distinct from the runtime config in `~/.wiki-os/config.json`, which stores the chosen vault path.

## Gotchas

- Two TypeScript configs: the server build (`tsconfig.server.json`) compiles `src/server` + `src/lib` to CommonJS in `dist-server`; the client is bundled by Vite. Keep `src/lib` compatible with both.
- [tests/naming-audit.test.ts](tests/naming-audit.test.ts) runs `git grep` over all tracked files and fails if legacy project names (pre-rename identifiers) appear anywhere, including docs and comments.
- Tests set `NODE_ENV=test`, which disables the periodic reconcile in the watcher; `WIKIOS_DISABLE_WATCH=1` disables watching entirely.
