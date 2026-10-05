# dep-tracker

Project Dependency Manager: a locally run web app that models a project as a dependency graph rooted in its success criteria and shows when each item can realistically finish, as a graph-based Gantt chart. Projects live in CSV, Excel, Google Sheets or Obsidian.

The product requirements are in [features/PRD.md](features/PRD.md). Work is delivered as thin end-to-end slices, each built test-first.

## Status

| Slice | Outcome | State |
| --- | --- | --- |
| S0 Walking skeleton | Open a CSV project and see its root node with its completion time | Done |
| S1 Add a dependency | Create a project, add dependency nodes; dates update and persist to CSV | Done |
| S2 Full scheduling and details | Not-before dates, dependency time, expandable editable node details, undo/redo | Done |
| S3 Graph-Gantt layout | Bars on a time axis, dependency edges, zoom/pan/fit/today, details panel, connect by drag or from the panel | Done |
| S4 Cycles | Cycles flagged with a banner, dependents blocked, the rest still dated; orphans flagged | Done |
| S5 Selection and animation | Dependencies and dependents highlighted, rest dimmed, critical chain emphasised, dashes flow at a speed scaled to work time | Done |
| S6 Labels | Labels with autocomplete, a label key with counts, saved colours (presets or picker), toggled highlighting | Done |
| S7 Excel adapter | Open, edit and import into Excel | Next |
| S8–S11 | See the PRD's delivery plan | Planned |

## Getting started

Requires Node.js 22 or later.

```sh
npm install
npx playwright install chromium   # once, for the end-to-end tests
npm start                         # builds the web app and serves it
```

Open http://127.0.0.1:4317, paste the full path of a project folder (try `fixtures/sample-project`) and choose **Open**.

| Script | What it does |
| --- | --- |
| `npm start` | Build the web app, then run the server on 127.0.0.1:4317 (`PORT` to change) |
| `npm run dev` | Rebuild the web app and restart the server on every change |
| `npm test` | Unit and integration tests (Node's built-in test runner via tsx) |
| `npm run test:e2e` | Playwright end-to-end tests; starts the server itself |
| `npm run typecheck` | TypeScript, no emit |
| `npm run test:all` | All of the above, the gate for every slice |

## Layout

```
packages/domain        Model, duration parsing, scheduling engine (shared by server and web)
packages/adapter-csv   CSV storage adapter
packages/storage-conformance  Shared test suite every storage adapter must pass
apps/server            Local API server (node:http), also serves the built web app
apps/web               React UI, bundled with esbuild
e2e                    Playwright acceptance tests, one file per slice
fixtures               Sample projects used by tests and demos
scripts                Build and dev runners
```

Tests sit beside the code they cover as `*.test.ts`.

## CSV project format

A project is a folder with three files. Multi-value cells (labels, links) are separated by semicolons. Dates are ISO 8601; durations use `w`, `d`, `h`, `m`, e.g. `1w 2d`.

```
project.csv   id, name, start, root_id
nodes.csv     id, title, work_time, not_before, labels, description, links
edges.csv     dependent_id, dependency_id   (optional while a project has no dependencies)
labels.csv    label, colour                 (optional; colours as #rrggbb)
```

## Stack choices

The PRD recommends Vitest, Vite and Fastify. S0 uses Node's built-in test runner, esbuild and `node:http` instead, which keeps dependencies to TypeScript, tsx, esbuild, React and Playwright. Swapping any of them in later only touches the scripts and the test imports.

## Working rules (for people and agents)

1. One slice per branch and pull request; start from the slice's acceptance criteria in the PRD.
2. Write the slice's Playwright test first and watch it fail for the right reason.
3. For every component you change, write a failing unit or integration test, make it pass, then refactor.
4. `npm run test:all` must be green before merging. Never weaken or delete a test to get there.
5. Scheduling logic lives only in `packages/domain`.

## Security

The server binds to 127.0.0.1 only and generates a per-launch token, which it writes into the page it serves; every API call must carry it (NFR-5).
