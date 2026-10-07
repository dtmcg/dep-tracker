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
| S7 Excel adapter | Open, create and edit .xlsx workbooks; import between stores; export to CSV | Done |
| S8 Obsidian adapter | One note per task in a vault folder, wikilink dependencies, tags for labels | Done |
| S9 Google Sheets adapter | Sign in with Google, then create in, open and edit Google Sheets; outside edits picked up within seconds | Done |
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
packages/adapter-csv   CSV storage adapter
packages/adapter-excel Excel (.xlsx) storage adapter
packages/xlsx          Minimal dependency-free .xlsx reader/writer (zip + SpreadsheetML)
packages/adapter-obsidian  Obsidian vault folder adapter (notes with frontmatter)
packages/adapter-gsheets   Google Sheets adapter, Google sign-in, and a stand-in Google service for tests
packages/sheet-layout      The Project / Tasks / Labels layout shared by Excel and Google Sheets
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

## Excel workbook format

One .xlsx file with three sheets, made to be read and edited by hand:

- **Project**: Field / Value rows for ID, Name, Start (a real date cell) and Success criteria (a task title).
- **Tasks**: one row per task with ID, Title, Work time (e.g. `3d`), Not before, Depends on, Labels, Description, Links, and greyed Starts / Completes columns that the app fills in and never reads back. Depends on lists dependency titles separated by semicolons; write `Title [id]` when two tasks share a title. A row you add without an ID gets one on the next save.
- **Labels**: Label / Colour (`#rrggbb`).

When the app saves, your own extra columns in Tasks and any other sheets you add are kept. Formatting you apply to the three sheets above is not.

## Obsidian vault format

A folder inside your vault, with one note per task named after its title:

```markdown
---
id: n02
work_time: 1w
not_before: 2026-11-02T09:00
depends_on:
  - "[[API contract agreed]]"
tags:
  - team/platform
links:
  - https://example.com/spec
---
The note body is the task's description.
```

- Dependencies are wikilinks, so Obsidian's graph view shows the plan. Renaming a note in Obsidian (which updates links) keeps its edges.
- Labels are tags; a `:` in a label is written as `/` (`team:web` ↔ `#team/web`), because Obsidian tags can't contain colons.
- A project note, `<project name> (project).md`, holds `dep_tracker: project`, `start`, `success_criteria: "[[Task]]"` and `label_colours`.
- A note you create by hand becomes a task when it has a `work_time`; it gets an `id` on the next save. Notes without `id` or `work_time` are left alone.
- When the app saves, it keeps note bodies and frontmatter keys it doesn't own. A task deleted in the app moves to the folder's `.trash`, and the previous text of every changed note is kept in `.dep-tracker-backup`. Both are hidden from Obsidian.
- Times are stored to the minute in local time, which is the format Obsidian's date-time properties use. The PRD suggested naming the root note after the project. I gave the project its own note instead, because the success criteria task already has its own title.

## Google Sheets

Projects in Google Sheets use the same Project / Tasks / Labels layout as Excel. To create one, make a blank sheet (sheets.new) and paste its link into New project. To open a project sheet, paste its link into Open.

### One-time setup

Google needs your own OAuth client:

1. In Google Cloud console, create a project and enable the **Google Sheets API**.
2. Under **OAuth consent screen**, set up an External app in Testing mode and add your Google account as a test user.
3. Under **Credentials**, create an **OAuth client ID** of type **Desktop app**.
4. Start dep-tracker with its ID and secret:

   ```powershell
   $env:GOOGLE_CLIENT_ID = "…apps.googleusercontent.com"
   $env:GOOGLE_CLIENT_SECRET = "…"
   npm start
   ```

5. On the start screen, choose **Google Sheet**, then **Connect Google account**.

Sign-in uses OAuth for installed apps with a loopback redirect (back to 127.0.0.1) and PKCE. Only the refresh token is kept, in `~/.dep-tracker/google-token.json`, readable by your user only. The PRD asks for the OS keychain; that needs a native module, so it's a follow-up. Set `DEP_TRACKER_CONFIG_DIR` to keep the token somewhere else.

Values are written exactly as typed, so a title like `=1+1` stays text. Dates are stored in the spreadsheet's own time zone. If you rename a task in the sheet, its links stay intact, because the app remembers titles from its last read and the next save updates Depends on.

The tests run against a stand-in for Google's sign-in and Sheets endpoints (`packages/adapter-gsheets/src/fake-google.ts`), not the real service.

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

A node can stand in for another project's success criteria ("Add reference to another project" in the node details). Its completion comes from that project; its own work time and not-before date are ignored. In the files it is a single `reference` value written as `kind:path`, e.g. `csv:C:\plans\partner`, `excel:/home/me/partner.xlsx`, `obsidian:/vault/partner`, `gsheets:<sheet id>`. Edit it by hand if you like. A reference that can't be read is flagged "unresolved" and blocks what depends on it; projects that reference each other in a loop are reported and not timed.

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
