# dep-tracker

Project Dependency Manager: a locally run web app that models a project as a dependency graph rooted in its success criteria and shows when each item can realistically finish, as a graph-based Gantt chart. Projects live in CSV folders. Storage sits behind an adapter interface, so other stores can be added later (see Storage).

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
| S7–S9 Excel, Obsidian and Google Sheets adapters | Built, then removed to focus on CSV (still in the git history) | Parked |
| S10 Cross-project references | Reference another project's root; its date flows in, unreadable or looping references are flagged, edits to the other project are picked up | Done |
| S11 UI styles | Light, Dark, High contrast and Blueprint styles, switchable from the header and remembered; follows your system until you choose | Done |

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
packages/adapter-csv   CSV storage adapter (the only store for now)
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

## Storage

CSV is the only store for now. The rest of the app doesn't know that: the server talks to a `StorageAdapter` (`packages/domain/src/model.ts`: `load`, `version`, `create`, `save`), the browser only ever sees a `StorageDescriptor` (`{ kind, path }`), and every adapter must pass the shared suite in `packages/storage-conformance`. To add a store later:

1. Add its descriptor to the `StorageDescriptor` union and its kind to `STORAGE_KINDS` (`packages/domain`).
2. Write an adapter package that passes `storage-conformance` (copy `packages/adapter-csv/src/conformance.test.ts`).
3. Register it in `apps/server/src/main.ts` (`adapters: { csv: csvAdapter, … }`) and add an entry to `STORES` in `apps/web/src/StartScreen.tsx`. The Store drop-down and the Import tab appear on their own once there is more than one store.

The Excel (.xlsx), Obsidian vault and Google Sheets adapters were built and then removed; they are in the git history (before the commit that removed them) if you want them back.

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

## Referencing another project

A node can stand in for another project's success criteria ("Add reference to another project" in the node details). Its completion comes from that project; its own work time and not-before date are ignored. In the files it is a single `reference` value written as `kind:path`, e.g. `csv:C:\plans\partner`. Edit it by hand if you like. A reference that can't be read is flagged "unresolved" and blocks what depends on it; projects that reference each other in a loop are reported and not timed.

## Where projects are kept

CSV projects default to `Documents/pdm_projects` in your home folder (`C:\Users\you\Documents\pdm_projects` on Windows, `/Users/you/Documents/pdm_projects` on macOS). The start screen pre-fills it: "New project" suggests `pdm_projects/<project name>`, and "Open project" starts with the folder path ready for you to add the project's name. You can type any other location. Set `DEP_TRACKER_PROJECTS_DIR` to change the default.

## Your projects list

The app remembers every project you create, open or import, and offers them in a "Your projects" drop-down on the Open project screen (most recent first; "Remove from list" forgets one without touching its files). The list is kept in `data/projects.json` next to the code (git-ignored) and you never need to edit it; if it goes missing the app simply starts with an empty list. Set `DEP_TRACKER_LIBRARY_FILE` to keep it elsewhere.

## Optional work time and start

"New project" asks only for where to keep it, a name and the success criteria; the project starts now. A node's work time is optional too: a node without one is shown dashed with a "no work time" badge, keeps its link, and adds nothing to the dates of what depends on it until you enter a work time. The Open project tab shows a "No projects yet" hint until you have created, opened or imported one.

## How the chart is laid out

Time runs left to right. Vertically the chart is balanced like a tree: each node sits at the midpoint of its dependencies, recursively, so the success criteria ends up in the middle and the chart re-balances as you add dependencies. Bars that follow one another in time may share a row; if a label doesn't fit before the next bar it moves inside the bar, and opens in full on hover or selection. Nodes that can't be scheduled go in a band at the bottom, and anything not linked to the success criteria goes below its tree.

## Time line view and node view

The chart has two views, switched from the toolbar above it (the choice is remembered). **Time line view** is the original: a bar per node, as long as its work time. **Node view** draws the same data as simple rounded boxes of one size, each showing the title and completion date and ending at the point on the time axis where the node is estimated to complete. Selection highlighting, animated edges, label colours, zoom, cycle and reference markers and the details panel work the same in both.

In node view a **Time scale** checkbox appears in the toolbar. Untick it to even the layout out: boxes sit in equally spaced columns by dependency depth (leaves on the left, the success criteria on the right) instead of at their completion dates, and the time axis, zoom controls and Today marker are hidden. Tick it again to return to the time axis. The checkbox is not shown in time line view, and the choice is remembered.

Node view boxes are square and show the node's earliest start, its work time and its completion. Dates show just the day by default; tick **Exact times** in the toolbar to add the hours and minutes everywhere a date is shown (chart, details panel, project header). The choice is remembered.

## Resourcing (feature flag)

Resourcing is in development and is off by default. Start the backend with the flag to turn it on for every project:

```
npm start -- --resourcing
```

With it on, each project shows a **Resources** strip under the label key: a resource pool, like labels but with instances.

- **Add resource type** defines a type such as "Developer" (names are unique, ignoring case).
- Click a type to expand it. Its instances are listed with their name and available time, and a **+** adds a new one: a name and an available time (a duration like `40h` or `3d`). Neither is required; an instance can be saved empty. A resource with no available time is treated as continuously available, and is listed as "always available".
- Beside every instance, **+** adds another with the same details (right after it) and **−** removes it. Edits can be undone like any other.
- **Remove type** deletes a type and its instances.

The pool is saved in the project's CSV folder as `resource_types.csv` (`type`) and `resources.csv` (`type,id,name,available`), which are only created once a pool exists and are easy to edit by hand. Without the flag, the strip is hidden and the server refuses resource commands.

### Resource requirements on work items

With `--resourcing` on, a selected work item's details panel has a **Resources needed** section. **Add resource requirement** lets you choose one of the pool's types, or **New type…** to create one on the spot (it joins the pool too). A requirement starts at 1; the **+** and **−** beside it change the number needed (a Developer × 2), and **−** at 1 removes it. Each requirement can also have a **minimum** and a **maximum** (the **Limits** link; blank means none, otherwise a whole number of at least 1, and the maximum can't be below the minimum): a Developer × 2 with min 1, max 3. The number allocated always stays within them, so **+** stops at the maximum and **−** at the minimum, and setting limits moves the number into range. A type can appear once per work item, and references to other projects can't have requirements.

It is saved in a `resources` column of `nodes.csv`, e.g. `Developer x 2 (min 1, max 3); Tester` (a type with no number needs 1, or its minimum if it has one). The column only appears once some work item needs a resource. Removing a type from the pool also clears it from the work items that needed it (undo restores both).
