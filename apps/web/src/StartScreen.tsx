import { type FormEvent, useEffect, useState } from "react";
import type { StorageDescriptor } from "@dep-tracker/domain";
import type { Api, KnownProject, OpenedProject } from "./api.ts";
import { projectsFolderPrefix, suggestFolder } from "./folders.ts";

type Tab = "open" | "new" | "import";
type Kind = StorageDescriptor["kind"];

/** The stores a project can live in, with what the location field asks for. Another store is one more entry here (and in the domain). */
export const STORES: { kind: Kind; name: string; location: string; hint: string; placeholder: string }[] = [
  {
    kind: "csv",
    name: "CSV folder",
    location: "Project folder",
    hint: "A folder containing project.csv, nodes.csv and edges.csv.",
    placeholder: "C:\\Users\\you\\projects\\my-plan",
  },
];
const storeOf = (kind: Kind) => STORES.find((s) => s.kind === kind)!;

// Importing copies a project from one kind of store to another, so it only appears once there are two.
const TABS: Tab[] = STORES.length > 1 ? ["open", "new", "import"] : ["open", "new"];
const TAB_NAMES: Record<Tab, string> = { open: "Open project", new: "New project", import: "Import" };

export function StartScreen({ api, onOpened }: { api: Api; onOpened: (project: OpenedProject) => void }) {
  const [tab, setTab] = useState<Tab>("open");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Where CSV projects go by default, e.g. ~/Documents/pdm_projects; "" until the server says.
  const [projectsDir, setProjectsDir] = useState("");
  useEffect(() => {
    api.config().then((c) => setProjectsDir(c.projectsDir), () => undefined);
  }, [api]);

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
        {TABS.map((t) => (
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
            {TAB_NAMES[t]}
          </button>
        ))}
      </div>

      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} className="panel">
        {tab === "open" && <OpenForm api={api} projectsDir={projectsDir} busy={busy} onSubmit={(storage) => run(() => api.openProject(storage))} />}
        {tab === "new" && <NewForm api={api} projectsDir={projectsDir} busy={busy} onSubmit={(input) => run(() => api.createProject(input))} />}
        {tab === "import" && <ImportForm api={api} busy={busy} onSubmit={(source, target) => run(() => api.importProject(source, target))} />}
      </div>

      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}
    </section>
  );
}

function StoreSelect({ id, label, value, onChange }: { id: string; label: string; value: Kind; onChange: (kind: Kind) => void }) {
  // With a single kind of store there is nothing to choose.
  if (STORES.length < 2) return null;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value as Kind)}>
        {STORES.map((s) => (
          <option key={s.kind} value={s.kind}>
            {s.name}
          </option>
        ))}
      </select>
    </div>
  );
}

function OpenForm({ api, projectsDir, busy, onSubmit }: { api: Api; projectsDir: string; busy: boolean; onSubmit: (storage: StorageDescriptor) => void }) {
  const [kind, setKind] = useState<Kind>("csv");
  const [typed, setTyped] = useState<string | null>(null); // null until the person edits the field
  const location = typed ?? (kind === "csv" ? projectsFolderPrefix(projectsDir) : "");
  const setLocation = setTyped;
  // Projects created, opened or imported before, newest first (the server keeps this list itself).
  const [knownList, setKnown] = useState<KnownProject[] | null>(null); // null while loading
  const known = knownList ?? [];
  const [showManual, setShowManual] = useState(false);
  const [picked, setPicked] = useState("");
  useEffect(() => {
    // A list written when more kinds of store existed may name one this build can't open; leave those out.
    api.library().then((list) => setKnown(list.filter((p) => STORES.some((s) => s.kind === p.storage.kind))), () => undefined);
  }, [api]);
  const keyOf = (p: KnownProject) => `${p.storage.kind}:${p.storage.path}`;
  const choose = (key: string) => {
    setPicked(key);
    const project = known.find((p) => keyOf(p) === key);
    if (project) {
      setKind(project.storage.kind);
      setTyped(project.storage.path);
    }
  };
  const store = storeOf(kind);
  if (knownList === null) return null;
  if (known.length === 0 && !showManual) {
    return (
      <div className="empty-open">
        <p className="hint">No projects yet. Create one, or import an existing plan.</p>
        <button type="button" className="link-button" onClick={() => setShowManual(true)}>
          Open one from a specific location…
        </button>
      </div>
    );
  }
  return (
    <form
      className="stack-form grid-form"
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        onSubmit({ kind, path: location });
      }}
    >
      {known.length > 0 && (
        <div className="field wide">
          <label htmlFor="open-known">Your projects</label>
          <div className="row">
            <select id="open-known" value={picked} onChange={(e) => choose(e.target.value)}>
              <option value="">Choose a project…</option>
              {known.map((p) => (
                <option key={keyOf(p)} value={keyOf(p)}>
                  {p.name} — {storeOf(p.storage.kind).name}: {p.storage.path}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="ghost small"
              disabled={!picked}
              title="Forget this project in the list. Its files are left alone."
              onClick={() => {
                const project = known.find((p) => keyOf(p) === picked);
                if (!project) return;
                api.forgetProject(project.storage).then(() => {
                  setKnown((list) => list.filter((p) => keyOf(p) !== picked));
                  setPicked("");
                });
              }}
            >
              Remove from list
            </button>
          </div>
          <p className="hint">Or open something else below.</p>
        </div>
      )}
      <StoreSelect id="open-store" label="Store" value={kind} onChange={(k) => { setKind(k); setTyped(null); setPicked(""); }} />
      <div className="field wide">
        <label htmlFor="open-location">{store.location}</label>
        <div className="row">
          <input
            id="open-location"
            className="mono"
            type="text"
            value={location}
            onChange={(e) => {
              setLocation(e.target.value);
              setPicked("");
            }}
            placeholder={store.placeholder}
            spellCheck={false}
            required
          />
          <button type="submit" disabled={busy}>
            {busy ? "Opening…" : "Open"}
          </button>
        </div>
        <p className="hint">{store.hint}</p>
      </div>
    </form>
  );
}

function NewForm({
  api,
  projectsDir,
  busy,
  onSubmit,
}: {
  api: Api;
  projectsDir: string;
  busy: boolean;
  onSubmit: (input: Parameters<Api["createProject"]>[0]) => void;
}) {
  const [kind, setKind] = useState<Kind>("csv");
  const [typed, setTyped] = useState<string | null>(null); // null until the person edits the field
  const [name, setName] = useState("");
  // CSV projects default to their own folder under the projects folder, following the name until edited.
  const location = typed ?? (kind === "csv" ? suggestFolder(projectsDir, name) : "");
  const setLocation = setTyped;
  const [rootTitle, setRootTitle] = useState("");
  const locationLabel = kind === "csv" ? "Folder" : storeOf(kind).location;

  return (
    <form
      className="stack-form grid-form"
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        onSubmit({
          storage: { kind, path: location },
          name,
          root: { title: rootTitle },
        });
      }}
    >
      <StoreSelect id="new-store" label="Store" value={kind} onChange={(k) => { setKind(k); setTyped(null); }} />
      <div className="field wide">
        <label htmlFor="new-location">{locationLabel}</label>
        <input
          id="new-location"
          className="mono"
          type="text"
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          placeholder={storeOf(kind).placeholder}
          spellCheck={false}
          required
        />
        <p className="hint">
          {kind === "csv" && projectsDir
            ? "Created if it doesn't exist. Defaults to a folder named after the project, inside your projects folder."
            : "Created if it doesn't exist. Must not already hold a project."}
        </p>
      </div>
      <div className="field">
        <label htmlFor="new-name">Project name</label>
        <input id="new-name" type="text" value={name} onChange={(e) => setName(e.target.value)} required />
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
      <div className="actions wide">
        <button type="submit" disabled={busy}>
          {busy ? "Creating…" : "Create project"}
        </button>
      </div>
    </form>
  );
}

/** FR-25: read a project from one store and write a copy into another, then open the copy. */
function ImportForm({
  api,
  busy,
  onSubmit,
}: {
  api: Api;
  busy: boolean;
  onSubmit: (source: StorageDescriptor, target: StorageDescriptor) => void;
}) {
  const [fromKind, setFromKind] = useState<Kind>("csv");
  const [from, setFrom] = useState("");
  const [toKind, setToKind] = useState<Kind>("csv");
  const [to, setTo] = useState("");
  return (
    <form
      className="stack-form grid-form"
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        onSubmit({ kind: fromKind, path: from }, { kind: toKind, path: to });
      }}
    >
      <StoreSelect id="import-from-store" label="From store" value={fromKind} onChange={setFromKind} />
      <div className="field">
        <label htmlFor="import-from">From location</label>
        <input id="import-from" className="mono" type="text" value={from} onChange={(e) => setFrom(e.target.value)} placeholder={storeOf(fromKind).placeholder} required />
      </div>
      <StoreSelect id="import-to-store" label="To store" value={toKind} onChange={setToKind} />
      <div className="field">
        <label htmlFor="import-to">To location</label>
        <input id="import-to" className="mono" type="text" value={to} onChange={(e) => setTo(e.target.value)} placeholder={storeOf(toKind).placeholder} required />
      </div>
      <p className="hint wide">The original is left untouched; the copy opens, and edits go to the copy.</p>
      <div className="actions wide">
        <button type="submit" disabled={busy}>
          {busy ? "Importing…" : "Import"}
        </button>
      </div>
    </form>
  );
}
