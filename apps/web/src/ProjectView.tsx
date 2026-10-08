import { type FormEvent, useEffect, useState } from "react";
import { DetailsPanel } from "./DetailsPanel.tsx";
import { ShowTimesContext, useDateFormatter } from "./dateDisplay.tsx";
import { Gantt } from "./Gantt.tsx";
import { LabelKey } from "./LabelKey.tsx";
import type { StorageDescriptor } from "@dep-tracker/domain";
import type { Session } from "./useProjectSession.ts";
import { loadShowTimes, saveShowTimes } from "./viewMode.ts";

export function ProjectView(props: { session: Session; onOpenReference?: (storage: StorageDescriptor) => Promise<void> }) {
  const [showTimes, setShowTimesState] = useState(() => loadShowTimes(window.localStorage));
  const setShowTimes = (next: boolean) => {
    setShowTimesState(next);
    saveShowTimes(window.localStorage, next);
  };
  return (
    <ShowTimesContext.Provider value={showTimes}>
      <ProjectScreen {...props} showTimes={showTimes} onShowTimes={setShowTimes} />
    </ShowTimesContext.Provider>
  );
}

function ProjectScreen({
  session,
  onOpenReference,
  showTimes,
  onShowTimes,
}: {
  session: Session;
  onOpenReference?: (storage: StorageDescriptor) => Promise<void>;
  showTimes: boolean;
  onShowTimes: (on: boolean) => void;
}) {
  const formatDate = useDateFormatter();
  const { snapshot, saveState, notice } = session;
  const { project } = snapshot;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [activeLabels, setActiveLabels] = useState<Set<string>>(new Set());
  const toggleLabel = (label: string) =>
    setActiveLabels((current) => {
      const next = new Set(current);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  const selected = project.nodes.find((n) => n.id === selectedId) ?? null;
  useUndoShortcuts(session);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (e.key === "Escape" && !(target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) setSelectedId(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <section aria-labelledby="project-name" className="project">
      <header className="project-header">
        <div>
          <h1 id="project-name">{project.name}</h1>
          <span className="meta">
            {project.nodes.length} node{project.nodes.length === 1 ? "" : "s"} · starts {formatDate(project.start)} ·{" "}
            <span className="mono" title={snapshot.storage.path}>
              {{ csv: "CSV", excel: "Excel", obsidian: "Obsidian", gsheets: "Google Sheet" }[snapshot.storage.kind]}: {snapshot.storage.path}
            </span>
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
          <button className="ghost" onClick={() => setExporting((x) => !x)} aria-expanded={exporting}>
            Export to CSV
          </button>
          <button className="ghost" onClick={session.close}>
            Close
          </button>
        </div>
      </header>

      {exporting && <ExportForm session={session} onDone={() => setExporting(false)} />}

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

      {snapshot.schedule.projectCycles.length > 0 && (
        <section className="cycle-banner" role="region" aria-label="Project cycles">
          <strong>
            {snapshot.schedule.projectCycles.length === 1 ? "A loop between projects" : `${snapshot.schedule.projectCycles.length} loops between projects`} — the
            references below lead back to a project already in the chain, so the nodes that depend on them can't be scheduled.
          </strong>
          <ul>
            {snapshot.schedule.projectCycles.map(({ nodeId, path }) => (
              <li key={nodeId}>
                <button className="link-button" onClick={() => setSelectedId(nodeId)}>
                  {project.nodes.find((n) => n.id === nodeId)?.title ?? nodeId}
                </button>
                : {path.join(" → ")}
              </li>
            ))}
          </ul>
        </section>
      )}

      <LabelKey
        project={project}
        active={activeLabels}
        onToggle={toggleLabel}
        onColour={(label, colour) => session.apply([{ type: "setLabelColour", label, colour }])}
      />

      <div className={selected ? "workspace with-panel" : "workspace"}>
        <Gantt
          project={project}
          schedule={snapshot.schedule}
          selectedId={selectedId}
          activeLabels={activeLabels}
          showTimes={showTimes}
          onShowTimes={onShowTimes}
          onSelect={setSelectedId}
          onConnect={(dependencyId, dependentId) => session.apply([{ type: "addEdge", dependentId, dependencyId }])}
        />
        {selected && <DetailsPanel key={selected.id} node={selected} session={session} onClose={() => setSelectedId(null)} onOpenReference={onOpenReference} />}
      </div>
    </section>
  );
}

/** FR-27: write a CSV copy of the open project, whatever store it lives in. */
function ExportForm({ session, onDone }: { session: Session; onDone: () => void }) {
  const [folder, setFolder] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="inline-form export-form"
      aria-label="Export to CSV"
      onSubmit={async (e: FormEvent) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          await session.exportTo({ kind: "csv", path: folder });
          onDone();
        } catch (err) {
          setError((err as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="field grow">
        <label htmlFor="export-folder">CSV folder</label>
        <input id="export-folder" className="mono" type="text" value={folder} onChange={(e) => setFolder(e.target.value)} required placeholder="A new or empty folder" />
      </div>
      <div className="actions">
        <button type="submit" disabled={busy}>
          Export
        </button>
        <button type="button" className="ghost" onClick={onDone}>
          Cancel
        </button>
      </div>
      {error && (
        <p className="field-error wide" role="alert">
          {error}
        </p>
      )}
    </form>
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
