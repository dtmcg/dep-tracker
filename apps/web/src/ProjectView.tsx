import { useEffect, useState } from "react";
import { DetailsPanel } from "./DetailsPanel.tsx";
import { formatDateTime } from "./format.ts";
import { Gantt } from "./Gantt.tsx";
import type { Session } from "./useProjectSession.ts";

export function ProjectView({ session }: { session: Session }) {
  const { snapshot, saveState, notice } = session;
  const { project } = snapshot;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = project.nodes.find((n) => n.id === selectedId) ?? null;
  useUndoShortcuts(session);

  return (
    <section aria-labelledby="project-name" className="project">
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

      {snapshot.schedule.cycles.length > 0 && (
        <CycleBanner cycles={snapshot.schedule.cycles} titleOf={(id) => project.nodes.find((n) => n.id === id)?.title ?? id} onSelect={setSelectedId} />
      )}

      <div className={selected ? "workspace with-panel" : "workspace"}>
        <Gantt
          project={project}
          schedule={snapshot.schedule}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onConnect={(dependencyId, dependentId) => session.apply([{ type: "addEdge", dependentId, dependencyId }])}
        />
        {selected && <DetailsPanel key={selected.id} node={selected} session={session} onClose={() => setSelectedId(null)} />}
      </div>
    </section>
  );
}

/** Lists each dependency cycle; its node names select the node (FR-4). */
function CycleBanner({ cycles, titleOf, onSelect }: { cycles: string[][]; titleOf: (id: string) => string; onSelect: (id: string) => void }) {
  return (
    <section className="cycle-banner" role="region" aria-label="Dependency cycles">
      <strong>
        {cycles.length === 1 ? "A dependency cycle" : `${cycles.length} dependency cycles`} — these nodes and everything that depends on
        them can't be scheduled until it is broken.
      </strong>
      <ul>
        {cycles.map((path) => (
          <li key={path.join(">")}>
            {path.map((id, i) => (
              <span key={`${id}-${i}`}>
                {i > 0 && " → "}
                <button className="link-button" onClick={() => onSelect(id)}>
                  {titleOf(id)}
                </button>
              </span>
            ))}
          </li>
        ))}
      </ul>
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
