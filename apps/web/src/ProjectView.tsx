import { type FormEvent, useState } from "react";
import { newId, type ProjectNode } from "@dep-tracker/domain";
import { formatDateTime } from "./format.ts";
import { dependencyCommands, displayOrder } from "./projectState.ts";
import type { Session } from "./useProjectSession.ts";

export function ProjectView({ session }: { session: Session }) {
  const { snapshot, saveState, notice } = session;
  const { project } = snapshot;
  const nodes = displayOrder(project, snapshot.schedule);

  return (
    <section aria-labelledby="project-name">
      <header className="project-header">
        <div>
          <h1 id="project-name">{project.name}</h1>
          <span className="meta">
            {project.nodes.length} node{project.nodes.length === 1 ? "" : "s"} · starts {formatDateTime(project.start)}
          </span>
        </div>
        <div className="header-actions">
          <span role="status" aria-label="Save status" className={`save-state ${saveState.kind}`}>
            {saveState.kind === "saving" ? "Saving…" : saveState.kind === "error" ? "Not saved" : "Saved"}
          </span>
          <button className="ghost" onClick={session.close}>
            Close
          </button>
        </div>
      </header>

      {saveState.kind === "error" && (
        <div className="error" role="alert">
          {saveState.message}
        </div>
      )}
      {notice && (
        <div className="notice" role="note">
          {notice}
        </div>
      )}

      <div className="node-list">
        {nodes.map((node) => (
          <NodeCard key={node.id} node={node} session={session} />
        ))}
      </div>
    </section>
  );
}

function NodeCard({ node, session }: { node: ProjectNode; session: Session }) {
  const { snapshot } = session;
  const times = snapshot.schedule.nodes[node.id];
  const error = snapshot.schedule.errors[node.id];
  const isRoot = node.id === snapshot.project.rootId;
  const [adding, setAdding] = useState(false);

  return (
    <article className="node" aria-label={node.title} data-root={String(isRoot)}>
      {isRoot && <span className="kicker">Success criteria</span>}
      <div className="node-head">
        <h2>{node.title}</h2>
        <button className="ghost small" onClick={() => setAdding((a) => !a)} aria-expanded={adding}>
          Add dependency
        </button>
      </div>
      <div className="times">
        {times ? (
          <span>
            Completes{" "}
            <time data-testid="completion" dateTime={times.completion}>
              {formatDateTime(times.completion)}
            </time>
          </span>
        ) : (
          <span className="warn">{error ?? "Not scheduled"}</span>
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
      {adding && (
        <AddDependencyForm
          dependent={node}
          onCancel={() => setAdding(false)}
          onAdd={(input) => {
            session.apply(dependencyCommands(node.id, input, newId()));
            setAdding(false);
          }}
        />
      )}
    </article>
  );
}

function AddDependencyForm({
  dependent,
  onAdd,
  onCancel,
}: {
  dependent: ProjectNode;
  onAdd: (input: { title: string; workTime: string }) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState("");
  const [workTime, setWorkTime] = useState("1d");
  const ids = { title: `dep-title-${dependent.id}`, work: `dep-work-${dependent.id}` };
  return (
    <form
      className="inline-form"
      aria-label={`New dependency of ${dependent.title}`}
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        onAdd({ title, workTime });
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") onCancel();
      }}
    >
      <div className="field grow">
        <label htmlFor={ids.title}>Title</label>
        <input id={ids.title} type="text" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus required />
      </div>
      <div className="field narrow">
        <label htmlFor={ids.work}>Work time</label>
        <input id={ids.work} type="text" value={workTime} onChange={(e) => setWorkTime(e.target.value)} required />
      </div>
      <div className="actions">
        <button type="submit">Add</button>
        <button type="button" className="ghost" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
