import { type FormEvent, useEffect, useMemo, useState } from "react";
import { newId, type ProjectNode } from "@dep-tracker/domain";
import { formatDateTime } from "./format.ts";
import { renderMarkdown } from "./markdown.ts";
import { formChanges, type NodeForm, toForm } from "./nodeForm.ts";
import { applyLocally, dependencyCommands, displayOrder } from "./projectState.ts";
import type { Session } from "./useProjectSession.ts";

export function ProjectView({ session }: { session: Session }) {
  const { snapshot, saveState, notice } = session;
  const { project } = snapshot;
  const nodes = displayOrder(project, snapshot.schedule);
  useUndoShortcuts(session);

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
          <button className="ghost" onClick={session.undo} disabled={!session.canUndo} title="Undo (Ctrl+Z)">
            Undo
          </button>
          <button className="ghost" onClick={session.redo} disabled={!session.canRedo} title="Redo (Ctrl+Shift+Z)">
            Redo
          </button>
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

/** Ctrl/Cmd+Z undo, Ctrl/Cmd+Shift+Z or Ctrl+Y redo, outside text fields. */
function useUndoShortcuts(session: Session) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (!(e.ctrlKey || e.metaKey)) return;
      const key = e.key.toLowerCase();
      if (key === "z" && !e.shiftKey) {
        e.preventDefault();
        session.undo();
      } else if ((key === "z" && e.shiftKey) || key === "y") {
        e.preventDefault();
        session.redo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [session]);
}

function NodeCard({ node, session }: { node: ProjectNode; session: Session }) {
  const { snapshot } = session;
  const times = snapshot.schedule.nodes[node.id];
  const error = snapshot.schedule.errors[node.id];
  const isRoot = node.id === snapshot.project.rootId;
  const [adding, setAdding] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const detailsId = `details-${node.id}`;

  return (
    <article className="node" aria-label={node.title} data-root={String(isRoot)} data-expanded={expanded}>
      {isRoot && <span className="kicker">Success criteria</span>}
      <div className="node-head">
        <h2>
          <button className="title-button" aria-expanded={expanded} aria-controls={detailsId} onClick={() => setExpanded((x) => !x)}>
            {node.title}
          </button>
        </h2>
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
      {expanded && <NodeDetails id={detailsId} node={node} session={session} />}
    </article>
  );
}

function NodeDetails({ id, node, session }: { id: string; node: ProjectNode; session: Session }) {
  const { snapshot } = session;
  const times = snapshot.schedule.nodes[node.id];
  const isRoot = node.id === snapshot.project.rootId;
  const [editing, setEditing] = useState(false);
  const description = useMemo(() => renderMarkdown(node.description), [node.description]);

  return (
    <section id={id} className="details" aria-label={`Details of ${node.title}`}>
      {editing ? (
        <NodeEditor node={node} session={session} onDone={() => setEditing(false)} />
      ) : (
        <>
          <dl className="facts">
            <div>
              <dt>Work time</dt>
              <dd data-testid="detail-work">{node.workTime}</dd>
            </div>
            <div>
              <dt>Not before</dt>
              <dd data-testid="detail-not-before">{node.notBefore ? formatDateTime(node.notBefore) : "None"}</dd>
            </div>
            <div>
              <dt>Dependency time</dt>
              <dd data-testid="detail-dependency-time">{times?.dependencyTime ? formatDateTime(times.dependencyTime) : "None"}</dd>
            </div>
            <div>
              <dt>Completion</dt>
              <dd data-testid="detail-completion">{times ? formatDateTime(times.completion) : "Not scheduled"}</dd>
            </div>
          </dl>
          {node.description ? (
            <div className="description" dangerouslySetInnerHTML={{ __html: description }} />
          ) : (
            <p className="hint">No description.</p>
          )}
          {node.links.length > 0 && (
            <ul className="links" aria-label="Links">
              {node.links.map((href) => (
                <li key={href}>
                  <a href={href} target="_blank" rel="noopener noreferrer">
                    {href}
                  </a>
                </li>
              ))}
            </ul>
          )}
          <div className="actions">
            <button className="ghost small" onClick={() => setEditing(true)}>
              Edit
            </button>
            {!isRoot && (
              <button className="ghost small danger" onClick={() => session.apply([{ type: "removeNode", id: node.id }])}>
                Delete node
              </button>
            )}
          </div>
        </>
      )}
    </section>
  );
}

function NodeEditor({ node, session, onDone }: { node: ProjectNode; session: Session; onDone: () => void }) {
  const [form, setForm] = useState<NodeForm>(() => toForm(node));
  const { changes, errors } = formChanges(node, form);
  const valid = Object.keys(errors).length === 0;
  const dirty = Object.keys(changes).length > 0;
  const preview = useMemo(() => {
    if (!valid) return null;
    try {
      return applyLocally(session.snapshot, [{ type: "updateNode", id: node.id, changes }]).schedule.nodes[node.id] ?? null;
    } catch {
      return null;
    }
  }, [session.snapshot, node.id, valid, JSON.stringify(changes)]);
  const field = (key: keyof NodeForm) => ({
    id: `edit-${key}-${node.id}`,
    value: form[key],
    "aria-invalid": errors[key] ? true : undefined,
    onChange: (e: { target: { value: string } }) => setForm((f) => ({ ...f, [key]: e.target.value })),
  });

  return (
    <form
      className="editor"
      aria-label={`Edit ${node.title}`}
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        if (valid && dirty) session.apply([{ type: "updateNode", id: node.id, changes }]);
        onDone();
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") onDone();
      }}
    >
      <div className="field wide">
        <label htmlFor={`edit-title-${node.id}`}>Title</label>
        <input type="text" {...field("title")} />
        {errors.title && <p className="field-error">{errors.title}</p>}
      </div>
      <div className="field">
        <label htmlFor={`edit-workTime-${node.id}`}>Work time</label>
        <input type="text" {...field("workTime")} />
        {errors.workTime && <p className="field-error">{errors.workTime}</p>}
      </div>
      <div className="field">
        <label htmlFor={`edit-notBefore-${node.id}`}>Not before</label>
        <input type="datetime-local" {...field("notBefore")} />
        {errors.notBefore && <p className="field-error">{errors.notBefore}</p>}
      </div>
      <div className="field wide">
        <label htmlFor={`edit-description-${node.id}`}>Description</label>
        <textarea rows={4} {...field("description")} placeholder="Markdown supported" />
      </div>
      <div className="field wide">
        <label htmlFor={`edit-links-${node.id}`}>Links</label>
        <textarea rows={2} {...field("links")} placeholder="One URL per line" />
      </div>
      <div className="actions wide">
        <span className="preview">
          Completes{" "}
          <b data-testid="preview-completion">{preview ? formatDateTime(preview.completion) : "—"}</b>
        </span>
        <span className="spacer" />
        <button type="button" className="ghost" onClick={onDone}>
          Cancel
        </button>
        <button type="submit" disabled={!valid || !dirty}>
          Save
        </button>
      </div>
    </form>
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
