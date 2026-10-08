import { type FormEvent, useState } from "react";
import type { Command, Project, ResourceType } from "@dep-tracker/domain";
import { addInstance, cloneInstance, removeInstance, resourceLabel } from "./resources.ts";

interface ResourcePoolProps {
  project: Project;
  /** False when the project's store can't hold a resource pool yet; the pool is then read-only. */
  saved: boolean;
  onApply: (commands: Command[]) => void;
}

/** The project's resource pool (Resourcing feature): types you click to expand, each with its instances. */
export function ResourcePool({ project, saved, onApply }: ResourcePoolProps) {
  const types = project.resourceTypes ?? [];
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [definingType, setDefiningType] = useState(false);
  const toggle = (name: string) =>
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

  return (
    <section className="resource-pool" role="region" aria-label="Resource pool">
      <div className="resource-head">
        <span className="label-key-title">Resources</span>
        <ul>
          {types.map((type) => (
            <li key={type.name}>
              <button className="resource-toggle" aria-expanded={open.has(type.name)} onClick={() => toggle(type.name)}>
                {type.name} ({type.resources.length})
              </button>
            </li>
          ))}
        </ul>
        {saved && !definingType && (
          <button className="ghost small" onClick={() => setDefiningType(true)}>
            Add resource type
          </button>
        )}
        {definingType && (
          <TypeForm
            existing={types}
            onSave={(name) => {
              onApply([{ type: "addResourceType", name }]);
              setOpen((current) => new Set(current).add(name));
              setDefiningType(false);
            }}
            onCancel={() => setDefiningType(false)}
          />
        )}
      </div>
      {!saved && (
        <p className="resource-note" role="note">
          This project's store can't hold resources yet; they are saved in CSV projects only for now.
        </p>
      )}
      {types.filter((t) => open.has(t.name)).map((type) => (
        <TypePanel key={type.name} type={type} saved={saved} onApply={onApply} />
      ))}
    </section>
  );
}

function TypeForm({ existing, onSave, onCancel }: { existing: ResourceType[]; onSave: (name: string) => void; onCancel: () => void }) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return setError("A resource type needs a name");
    if (existing.some((t) => t.name.toLowerCase() === trimmed.toLowerCase())) return setError(`There is already a resource type "${trimmed}"`);
    onSave(trimmed);
  };
  return (
    <form className="resource-form" aria-label="New resource type" onSubmit={submit}>
      <input aria-label="Resource type name" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Developer" />
      <button type="submit" className="small">
        Save
      </button>
      <button type="button" className="ghost small" onClick={onCancel}>
        Cancel
      </button>
      {error && (
        <span className="field-error" role="alert">
          {error}
        </span>
      )}
    </form>
  );
}

function TypePanel({ type, saved, onApply }: { type: ResourceType; saved: boolean; onApply: (commands: Command[]) => void }) {
  const [adding, setAdding] = useState(false);
  return (
    <div className="resource-panel" role="group" aria-label={`${type.name} resources`}>
      {type.resources.length === 0 && <p className="resource-empty">No {type.name.toLowerCase()} resources yet.</p>}
      <ul className="resource-list">
        {type.resources.map((resource) => (
          <li key={resource.id} data-testid="resource-instance">
            <span className="resource-name">{resourceLabel(type, resource)}</span>
            <span className="resource-available" data-testid="resource-available">
              {resource.available || "no time set"}
            </span>
            {saved && (
              <span className="resource-actions">
                <button
                  className="ghost small icon"
                  aria-label={`Add another like ${resourceLabel(type, resource)}`}
                  title="Add another with the same details"
                  onClick={() => onApply([cloneInstance(type, resource)])}
                >
                  +
                </button>
                <button
                  className="ghost small icon"
                  aria-label={`Remove ${resourceLabel(type, resource)}`}
                  title="Remove this one"
                  onClick={() => onApply([removeInstance(type, resource)])}
                >
                  −
                </button>
              </span>
            )}
          </li>
        ))}
      </ul>
      {saved && (
        <div className="resource-add">
          {adding ? (
            <InstanceForm
              type={type}
              onSave={(command) => {
                onApply([command]);
                setAdding(false);
              }}
              onCancel={() => setAdding(false)}
            />
          ) : (
            <>
              <button className="ghost small icon" aria-label={`Add ${type.name}`} title={`Add a ${type.name.toLowerCase()}`} onClick={() => setAdding(true)}>
                +
              </button>
              <button
                className="link-button small"
                onClick={() => {
                  if (type.resources.length === 0 || window.confirm(`Remove ${type.name} and its ${type.resources.length} resource(s)?`)) {
                    onApply([{ type: "removeResourceType", name: type.name }]);
                  }
                }}
              >
                Remove type
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function InstanceForm({ type, onSave, onCancel }: { type: ResourceType; onSave: (command: Command) => void; onCancel: () => void }) {
  const [name, setName] = useState("");
  const [available, setAvailable] = useState("");
  const [error, setError] = useState<string | null>(null);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    try {
      onSave(addInstance(type.name, { name, available }));
    } catch (err) {
      setError((err as Error).message);
    }
  };
  return (
    <form className="resource-form" aria-label={`New ${type.name}`} onSubmit={submit}>
      <label>
        Name
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label>
        Available time
        <input value={available} onChange={(e) => setAvailable(e.target.value)} placeholder="e.g. 40h or 3d" />
      </label>
      <button type="submit" className="small">
        Save
      </button>
      <button type="button" className="ghost small" onClick={onCancel}>
        Cancel
      </button>
      {error && (
        <span className="field-error" role="alert">
          {error}
        </span>
      )}
    </form>
  );
}
