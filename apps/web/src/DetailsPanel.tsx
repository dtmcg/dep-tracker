import { type FormEvent, useMemo, useState } from "react";
import { describeConsumption, newId, nodeConsumption, parseReference, type ProjectNode, STORAGE_KINDS, type StorageDescriptor } from "@dep-tracker/domain";
import { useDateFormatter } from "./dateDisplay.tsx";
import { useFeatures } from "./features.tsx";
import { changeCount, requireType } from "./resources.ts";
import { renderMarkdown } from "./markdown.ts";
import { formChanges, type NodeForm, toForm } from "./nodeForm.ts";
import { applyLocally, dependencyCommands, referenceCommands } from "./projectState.ts";
import type { Session } from "./useProjectSession.ts";

/** Side panel for the selected node (FR-7, FR-8, FR-9, FR-10). */
const KIND_NAMES: Record<StorageDescriptor["kind"], string> = { csv: "CSV folder" };

export function DetailsPanel({
  node,
  session,
  onClose,
  onOpenReference,
}: {
  node: ProjectNode;
  session: Session;
  onClose: () => void;
  /** Opens the project a reference node points at. */
  onOpenReference?: (storage: StorageDescriptor) => Promise<void>;
}) {
  const formatDate = useDateFormatter();
  const { resourcing } = useFeatures();
  const { snapshot } = session;
  const { project } = snapshot;
  const times = snapshot.schedule.nodes[node.id];
  const isRoot = node.id === project.rootId;
  const [mode, setMode] = useState<"view" | "edit" | "add" | "addRef">("view");
  const [openError, setOpenError] = useState<string | null>(null);
  const description = useMemo(() => renderMarkdown(node.description), [node.description]);
  const titleOf = (id: string) => project.nodes.find((n) => n.id === id)?.title ?? id;
  const dependencies = project.edges.filter((e) => e.dependentId === node.id).map((e) => e.dependencyId);
  const dependents = project.edges.filter((e) => e.dependencyId === node.id).map((e) => e.dependentId);

  return (
    <aside className="details-panel" aria-label={`Details of ${node.title}`}>
      <header className="panel-head">
        <div>
          {isRoot && <span className="kicker">Success criteria</span>}
          <h2>{node.title}</h2>
        </div>
        <button className="ghost small" aria-label="Close details" onClick={onClose}>
          ✕
        </button>
      </header>

      {mode === "edit" ? (
        <NodeEditor node={node} session={session} onDone={() => setMode("view")} />
      ) : (
        <>
          <dl className="facts">
            {node.ref ? (
              <div>
                <dt>Other project</dt>
                <dd data-testid="detail-reference">
                  {KIND_NAMES[node.ref.storage.kind]}: <span className="mono">{node.ref.storage.path}</span>
                </dd>
              </div>
            ) : (
              <>
                <div>
                  <dt>Work time</dt>
                  <dd data-testid="detail-work">{node.workTime || "Not set"}</dd>
                </div>
                <div>
                  <dt>Not before</dt>
                  <dd data-testid="detail-not-before">{node.notBefore ? formatDate(node.notBefore) : "None"}</dd>
                </div>
                <div>
                  <dt>Dependency time</dt>
                  <dd data-testid="detail-dependency-time">{times?.dependencyTime ? formatDate(times.dependencyTime) : "None"}</dd>
                </div>
              </>
            )}
            <div>
              <dt>Completion</dt>
              <dd data-testid="detail-completion">{times ? formatDate(times.completion) : "Not scheduled"}</dd>
            </div>
          </dl>
          {snapshot.schedule.flags[node.id]?.includes("unestimated") && (
            <p className="hint">No work time yet, so this adds nothing to the dates of what depends on it. Enter one under Edit.</p>
          )}
          {!times && <p className="warn">{snapshot.schedule.errors[node.id]}</p>}
          {snapshot.schedule.flags[node.id]?.includes("orphan") && (
            <p className="hint">Not linked to the success criteria: nothing on its path depends on this node.</p>
          )}
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
          {node.ref && onOpenReference && (
            <div className="actions">
              <button className="small" onClick={() => onOpenReference(node.ref!.storage).catch((e: Error) => setOpenError(e.message))}>
                Open that project
              </button>
            </div>
          )}
          {openError && (
            <p className="warn" role="alert">
              {openError}
            </p>
          )}
          <div className="actions">
            {!node.ref && (
              <>
                <button className="small" onClick={() => setMode(mode === "add" ? "view" : "add")} aria-expanded={mode === "add"}>
                  Add dependency
                </button>
                <button className="small" onClick={() => setMode(mode === "addRef" ? "view" : "addRef")} aria-expanded={mode === "addRef"}>
                  Add reference to another project
                </button>
              </>
            )}
            <button className="ghost small" onClick={() => setMode("edit")}>
              Edit
            </button>
            {!isRoot && (
              <button
                className="ghost small danger"
                onClick={() => {
                  session.apply([{ type: "removeNode", id: node.id }]);
                  onClose();
                }}
              >
                Delete node
              </button>
            )}
          </div>
          {mode === "add" && (
            <AddDependencyForm
              dependent={node}
              onCancel={() => setMode("view")}
              onAdd={(input) => {
                session.apply(dependencyCommands(node.id, input, newId()));
                setMode("view");
              }}
            />
          )}

          {mode === "addRef" && (
            <AddReferenceForm
              dependent={node}
              onCancel={() => setMode("view")}
              onAdd={(input) => {
                session.apply(referenceCommands(node.id, input, newId()));
                setMode("view");
              }}
            />
          )}

          <NodeLabels node={node} session={session} />

          {resourcing && !node.ref && <NodeResources node={node} session={session} />}

          <section className="relations" aria-label="Depends on">
            <h3>Depends on</h3>
            {dependencies.length === 0 ? (
              <p className="hint">Nothing yet.</p>
            ) : (
              <ul>
                {dependencies.map((id) => (
                  <li key={id}>
                    <span>{titleOf(id)}</span>
                    <button
                      className="ghost small"
                      aria-label={`Remove dependency on ${titleOf(id)}`}
                      onClick={() => session.apply([{ type: "removeEdge", dependentId: node.id, dependencyId: id }])}
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <ConnectExisting node={node} session={session} exclude={new Set([node.id, ...dependencies])} />
          </section>

          <section className="relations" aria-label="Needed by">
            <h3>Needed by</h3>
            {dependents.length === 0 ? (
              <p className="hint">{isRoot ? "This is the success criteria." : "Nothing depends on this yet."}</p>
            ) : (
              <ul>
                {dependents.map((id) => (
                  <li key={id}>{titleOf(id)}</li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </aside>
  );
}

/** What this work item needs from the resource pool: pick a type (or name a new one), then adjust the number with + and −. */
function NodeResources({ node, session }: { node: ProjectNode; session: Session }) {
  const pool = session.snapshot.project.resourceTypes ?? [];
  const needs = node.resources ?? [];
  const choices = pool.filter((t) => !needs.some((r) => r.typeName === t.name));
  const consumption = nodeConsumption(node);
  const NEW = "\u0000new";
  const [choice, setChoice] = useState("");
  const [newName, setNewName] = useState("");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const picking = choice === NEW ? newName : choice;
  const add = () => {
    try {
      session.apply(requireType(node, pool, picking));
      setChoice("");
      setNewName("");
      setAdding(false);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <section className="relations node-resources" aria-label="Resources needed">
      <h3>Resources needed</h3>
      {needs.length === 0 ? (
        <p className="hint">None yet.</p>
      ) : (
        <ul>
          {needs.map((r) => (
            <li key={r.typeName} data-testid="requirement">
              <span className="requirement-name">{r.typeName}</span>
              <span className="requirement-count" data-testid="requirement-count" aria-label={`${r.count} ${r.typeName} needed`}>
                × {r.count}
              </span>
              <span className="requirement-use" data-testid="requirement-consumption">
                uses {describeConsumption(consumption.find((c) => c.typeName === r.typeName)!)}
              </span>
              {(
                <span className="resource-actions">
                  <button className="ghost small icon" aria-label={`One more ${r.typeName}`} onClick={() => session.apply([changeCount(node, r.typeName, 1)])}>
                    +
                  </button>
                  <button className="ghost small icon" aria-label={`One fewer ${r.typeName}`} onClick={() => session.apply([changeCount(node, r.typeName, -1)])}>
                    −
                  </button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {!adding && (
        <button className="small" onClick={() => setAdding(true)}>
          Add resource requirement
        </button>
      )}
      {adding && (
        <form
          className="resource-form"
          aria-label="New resource requirement"
          onSubmit={(e) => {
            e.preventDefault();
            add();
          }}
        >
          <label>
            Resource type
            <select value={choice} onChange={(e) => setChoice(e.target.value)}>
              <option value="">Choose…</option>
              {choices.map((t) => (
                <option key={t.name} value={t.name}>
                  {t.name}
                </option>
              ))}
              <option value={NEW}>New type…</option>
            </select>
          </label>
          {choice === NEW && (
            <label>
              New type name
              <input autoFocus value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. Designer" />
            </label>
          )}
          <button type="submit" className="small">
            Add
          </button>
          <button type="button" className="ghost small" onClick={() => { setAdding(false); setError(null); }}>
            Cancel
          </button>
          {error && (
            <span className="field-error" role="alert">
              {error}
            </span>
          )}
        </form>
      )}
    </section>
  );
}

function NodeLabels({ node, session }: { node: ProjectNode; session: Session }) {
  const [draft, setDraft] = useState("");
  const all = [...new Set(session.snapshot.project.nodes.flatMap((n) => n.labels))].sort();
  const suggestions = all.filter((l) => !node.labels.includes(l));
  const setLabels = (labels: string[]) => session.apply([{ type: "updateNode", id: node.id, changes: { labels } }]);
  const listId = `label-options-${node.id}`;
  const inputId = `label-input-${node.id}`;
  return (
    <section className="relations node-labels" aria-label="Node labels">
      <h3>Labels</h3>
      {node.labels.length > 0 && (
        <ul className="chips">
          {node.labels.map((label) => (
            <li key={label}>
              {label}
              <button
                className="chip-remove"
                aria-label={`Remove label ${label}`}
                onClick={() => setLabels(node.labels.filter((l) => l !== label))}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      <form
        className="connect"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          const label = draft.trim();
          if (label && !node.labels.includes(label)) setLabels([...node.labels, label]);
          setDraft("");
        }}
      >
        <label htmlFor={inputId}>Add label</label>
        <input id={inputId} type="text" list={listId} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="e.g. risk or team:web" />
        <datalist id={listId}>
          {suggestions.map((l) => (
            <option key={l} value={l} />
          ))}
        </datalist>
      </form>
    </section>
  );
}

function ConnectExisting({ node, session, exclude }: { node: ProjectNode; session: Session; exclude: Set<string> }) {
  const options = session.snapshot.project.nodes.filter((n) => !exclude.has(n.id)).sort((a, b) => a.title.localeCompare(b.title));
  const [choice, setChoice] = useState("");
  if (options.length === 0) return null;
  const id = `connect-${node.id}`;
  return (
    <form
      className="connect"
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        if (!choice) return;
        session.apply([{ type: "addEdge", dependentId: node.id, dependencyId: choice }]);
        setChoice("");
      }}
    >
      <label htmlFor={id}>Add existing dependency</label>
      <div className="row">
        <select id={id} value={choice} onChange={(e) => setChoice(e.target.value)}>
          <option value="">Choose a node…</option>
          {options.map((n) => (
            <option key={n.id} value={n.id}>
              {n.title}
            </option>
          ))}
        </select>
        <button type="submit" className="ghost small" disabled={!choice}>
          Connect
        </button>
      </div>
    </form>
  );
}

function NodeEditor({ node, session, onDone }: { node: ProjectNode; session: Session; onDone: () => void }) {
  const formatDate = useDateFormatter();
  const [form, setForm] = useState<NodeForm>(() => toForm(node));
  const { changes, errors } = formChanges(node, form);
  const valid = Object.keys(errors).length === 0;
  const dirty = Object.keys(changes).length > 0;
  const changesKey = JSON.stringify(changes);
  const preview = useMemo(() => {
    if (!valid) return null;
    try {
      return applyLocally(session.snapshot, [{ type: "updateNode", id: node.id, changes }]).schedule.nodes[node.id] ?? null;
    } catch {
      return null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.snapshot, node.id, valid, changesKey]);
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
      {node.ref ? (
        <div className="field wide">
          <label htmlFor={`edit-reference-${node.id}`}>Other project</label>
          <input type="text" {...field("reference")} placeholder="csv:C:\\plans\\partner" />
          {errors.reference && <p className="field-error">{errors.reference}</p>}
        </div>
      ) : (
        <>
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
        </>
      )}
      <div className="field wide">
        <label htmlFor={`edit-description-${node.id}`}>Description</label>
        <textarea rows={5} {...field("description")} placeholder="Markdown supported" />
      </div>
      <div className="field wide">
        <label htmlFor={`edit-links-${node.id}`}>Links</label>
        <textarea rows={2} {...field("links")} placeholder="One URL per line" />
      </div>
      <div className="actions wide">
        <span className="preview">
          Completes <b data-testid="preview-completion">{preview ? formatDate(preview.completion) : "—"}</b>
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
  const [workTime, setWorkTime] = useState("");
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
        <input id={ids.work} type="text" value={workTime} onChange={(e) => setWorkTime(e.target.value)} placeholder="optional, e.g. 2d" />
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

function AddReferenceForm({
  dependent,
  onAdd,
  onCancel,
}: {
  dependent: ProjectNode;
  onAdd: (input: { title: string; storage: StorageDescriptor }) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<StorageDescriptor["kind"]>("csv");
  const [path, setPath] = useState("");
  const [error, setError] = useState<string | null>(null);
  const ids = { title: `ref-title-${dependent.id}`, kind: `ref-kind-${dependent.id}`, path: `ref-path-${dependent.id}` };
  return (
    <form
      className="inline-form"
      aria-label={`New reference needed by ${dependent.title}`}
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        try {
          const storage = parseReference(`${kind}:${path}`);
          setError(null);
          onAdd({ title, storage });
        } catch (err) {
          setError((err as Error).message);
        }
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") onCancel();
      }}
    >
      <div className="field grow">
        <label htmlFor={ids.title}>Title</label>
        <input id={ids.title} type="text" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus required />
      </div>
      <div className="field">
        <label htmlFor={ids.kind}>Stored in</label>
        <select id={ids.kind} value={kind} onChange={(e) => setKind(e.target.value as StorageDescriptor["kind"])}>
          {STORAGE_KINDS.map((k) => (
            <option key={k} value={k}>
              {KIND_NAMES[k]}
            </option>
          ))}
        </select>
      </div>
      <div className="field grow">
        <label htmlFor={ids.path}>Location</label>
        <input id={ids.path} type="text" value={path} onChange={(e) => setPath(e.target.value)} required placeholder="Folder, file path or sheet id" />
        {error && <p className="field-error">{error}</p>}
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
