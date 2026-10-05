import { type FormEvent, useState } from "react";
import type { ProjectNode } from "@dep-tracker/domain";
import { openProject, type OpenedProject } from "./api.ts";
import { formatDateTime } from "./format.ts";

function NodeCard({ node, opened }: { node: ProjectNode; opened: OpenedProject }) {
  const times = opened.schedule.nodes[node.id];
  const error = opened.schedule.errors[node.id];
  const isRoot = node.id === opened.project.rootId;
  return (
    <article className="node" aria-label={node.title} data-root={String(isRoot)}>
      {isRoot && <span className="kicker">Success criteria</span>}
      <h2>{node.title}</h2>
      <div className="times">
        {times ? (
          <span>
            Completes{" "}
            <time data-testid="completion" dateTime={times.completion}>
              {formatDateTime(times.completion)}
            </time>
          </span>
        ) : (
          <span role="status">{error ?? "Not scheduled"}</span>
        )}
        <span>
          Work <b>{node.workTime}</b>
        </span>
      </div>
      {node.labels.length > 0 && (
        <ul className="labels" aria-label="Labels">
          {node.labels.map((label) => (
            <li key={label}>{label}</li>
          ))}
        </ul>
      )}
    </article>
  );
}

export function App() {
  const [folder, setFolder] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [opened, setOpened] = useState<OpenedProject | null>(null);

  async function onOpen(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setOpened(await openProject({ kind: "csv", path: folder }));
    } catch (e) {
      setOpened(null);
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const root = opened?.project.nodes.find((n) => n.id === opened.project.rootId);

  return (
    <main className="shell">
      <div className="brand">
        <strong>dep-tracker</strong> Project dependency manager
      </div>

      <form className="open-form" onSubmit={onOpen}>
        <label htmlFor="folder">Project folder</label>
        <p className="hint">A folder containing project.csv, nodes.csv and edges.csv.</p>
        <input
          id="folder"
          type="text"
          value={folder}
          onChange={(e) => setFolder(e.target.value)}
          placeholder="C:\Users\you\projects\my-plan"
          spellCheck={false}
          required
        />
        <button type="submit" disabled={busy}>
          {busy ? "Opening…" : "Open"}
        </button>
      </form>

      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}

      {opened && (
        <section aria-labelledby="project-name">
          <header className="project-header">
            <h1 id="project-name">{opened.project.name}</h1>
            <span className="meta">
              {opened.project.nodes.length} node{opened.project.nodes.length === 1 ? "" : "s"} · starts{" "}
              {formatDateTime(opened.project.start)}
            </span>
          </header>
          {root && <NodeCard node={root} opened={opened} />}
        </section>
      )}
    </main>
  );
}
