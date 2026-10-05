import { type FormEvent, useState } from "react";
import type { Api, OpenedProject } from "./api.ts";

type Tab = "open" | "new";

export function StartScreen({ api, onOpened }: { api: Api; onOpened: (project: OpenedProject) => void }) {
  const [tab, setTab] = useState<Tab>("open");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(action: () => Promise<OpenedProject>) {
    setBusy(true);
    setError(null);
    try {
      onOpened(await action());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="start">
      <div className="tabs" role="tablist" aria-label="Open or create a project">
        {(["open", "new"] as const).map((t) => (
          <button
            key={t}
            role="tab"
            id={`tab-${t}`}
            aria-selected={tab === t}
            aria-controls={`panel-${t}`}
            className={tab === t ? "tab active" : "tab"}
            onClick={() => {
              setTab(t);
              setError(null);
            }}
          >
            {t === "open" ? "Open project" : "New project"}
          </button>
        ))}
      </div>

      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} className="panel">
        {tab === "open" ? <OpenForm busy={busy} onSubmit={(path) => run(() => api.openProject({ kind: "csv", path }))} /> : null}
        {tab === "new" ? <NewForm busy={busy} onSubmit={(input) => run(() => api.createProject(input))} /> : null}
      </div>

      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}
    </section>
  );
}

function OpenForm({ busy, onSubmit }: { busy: boolean; onSubmit: (path: string) => void }) {
  const [folder, setFolder] = useState("");
  return (
    <form
      className="stack-form"
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        onSubmit(folder);
      }}
    >
      <label htmlFor="open-folder">Project folder</label>
      <p className="hint">A folder containing project.csv, nodes.csv and edges.csv.</p>
      <div className="row">
        <input
          id="open-folder"
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
      </div>
    </form>
  );
}

function NewForm({
  busy,
  onSubmit,
}: {
  busy: boolean;
  onSubmit: (input: Parameters<Api["createProject"]>[0]) => void;
}) {
  const [folder, setFolder] = useState("");
  const [name, setName] = useState("");
  const [start, setStart] = useState("");
  const [rootTitle, setRootTitle] = useState("");
  const [workTime, setWorkTime] = useState("1d");

  return (
    <form
      className="stack-form grid-form"
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        onSubmit({
          storage: { kind: "csv", path: folder },
          name,
          start: new Date(start).toISOString(),
          root: { title: rootTitle, workTime },
        });
      }}
    >
      <div className="field wide">
        <label htmlFor="new-folder">Folder</label>
        <input
          id="new-folder"
          type="text"
          value={folder}
          onChange={(e) => setFolder(e.target.value)}
          placeholder="C:\Users\you\projects\my-plan"
          spellCheck={false}
          required
        />
        <p className="hint">Created if it doesn't exist. Must not already hold a project.</p>
      </div>
      <div className="field">
        <label htmlFor="new-name">Project name</label>
        <input id="new-name" type="text" value={name} onChange={(e) => setName(e.target.value)} required />
      </div>
      <div className="field">
        <label htmlFor="new-start">Start</label>
        <input id="new-start" type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} required />
      </div>
      <div className="field">
        <label htmlFor="new-root">Success criteria</label>
        <input
          id="new-root"
          type="text"
          value={rootTitle}
          onChange={(e) => setRootTitle(e.target.value)}
          placeholder="What does done look like?"
          required
        />
      </div>
      <div className="field">
        <label htmlFor="new-work">Work time</label>
        <input id="new-work" type="text" value={workTime} onChange={(e) => setWorkTime(e.target.value)} required />
      </div>
      <div className="actions wide">
        <button type="submit" disabled={busy}>
          {busy ? "Creating…" : "Create project"}
        </button>
      </div>
    </form>
  );
}
