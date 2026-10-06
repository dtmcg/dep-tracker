import { type FormEvent, useEffect, useState } from "react";
import type { StorageDescriptor } from "@dep-tracker/domain";
import type { Api, OpenedProject } from "./api.ts";
import { projectsFolderPrefix, suggestFolder } from "./folders.ts";

type Tab = "open" | "new" | "import";
type Kind = StorageDescriptor["kind"];

/** The stores a project can live in, with what the location field asks for. */
export const STORES: { kind: Kind; name: string; location: string; hint: string; placeholder: string }[] = [
  {
    kind: "csv",
    name: "CSV folder",
    location: "Project folder",
    hint: "A folder containing project.csv, nodes.csv and edges.csv.",
    placeholder: "C:\\Users\\you\\projects\\my-plan",
  },
  {
    kind: "excel",
    name: "Excel workbook",
    location: "Workbook file",
    hint: "An .xlsx file with Project and Tasks sheets.",
    placeholder: "C:\\Users\\you\\Documents\\my-plan.xlsx",
  },
  {
    kind: "obsidian",
    name: "Obsidian vault folder",
    location: "Vault folder",
    hint: "A folder inside your vault holding one note per task and a \"(project)\" note.",
    placeholder: "C:\\Users\\you\\Vault\\Projects\\my-plan",
  },
  {
    kind: "gsheets",
    name: "Google Sheet",
    location: "Spreadsheet link",
    hint: "Paste the sheet's link. For a new project, start from a blank sheet (sheets.new).",
    placeholder: "https://docs.google.com/spreadsheets/d/…",
  },
];
const storeOf = (kind: Kind) => STORES.find((s) => s.kind === kind)!;

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
        {(["open", "new", "import"] as const).map((t) => (
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

/** Google sign-in status, and the button that starts it (S9). */
function GoogleConnect({ api }: { api: Api }) {
  const [status, setStatus] = useState<{ configured: boolean; connected: boolean } | null>(null);
  const [waiting, setWaiting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stopped = false;
    const check = () =>
      api
        .googleStatus()
        .then((s) => !stopped && setStatus(s))
        .catch(() => undefined);
    void check();
    // While waiting for the consent tab, watch for the sign-in to land.
    const timer = waiting ? setInterval(check, 1000) : undefined;
    return () => {
      stopped = true;
      if (timer) clearInterval(timer);
    };
  }, [api, waiting]);

  useEffect(() => {
    if (status?.connected) setWaiting(false);
  }, [status?.connected]);

  if (!status) return null;
  if (!status.configured) {
    return (
      <p className="hint wide google-status">
        Google Sheets needs a Google Cloud OAuth client. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET and restart the app (see the README).
      </p>
    );
  }
  if (status.connected) return <p className="hint wide google-status connected">✓ Connected to Google</p>;
  return (
    <div className="wide google-status">
      <button
        type="button"
        className="ghost"
        onClick={async () => {
          setError(null);
          try {
            window.open(await api.googleStart(), "_blank", "popup,width=520,height=680");
            setWaiting(true);
          } catch (e) {
            setError((e as Error).message);
          }
        }}
      >
        Connect Google account
      </button>
      <span className="hint">{waiting ? " Waiting for you to finish signing in…" : " Opens Google's sign-in page."}</span>
      {error && <p className="field-error">{error}</p>}
    </div>
  );
}

function OpenForm({ api, projectsDir, busy, onSubmit }: { api: Api; projectsDir: string; busy: boolean; onSubmit: (storage: StorageDescriptor) => void }) {
  const [kind, setKind] = useState<Kind>("csv");
  const [typed, setTyped] = useState<string | null>(null); // null until the person edits the field
  const location = typed ?? (kind === "csv" ? projectsFolderPrefix(projectsDir) : "");
  const setLocation = setTyped;
  const store = storeOf(kind);
  return (
    <form
      className="stack-form grid-form"
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        onSubmit({ kind, path: location });
      }}
    >
      <StoreSelect id="open-store" label="Store" value={kind} onChange={(k) => { setKind(k); setTyped(null); }} />
      {kind === "gsheets" && <GoogleConnect api={api} />}
      <div className="field wide">
        <label htmlFor="open-location">{store.location}</label>
        <div className="row">
          <input
            id="open-location"
            className="mono"
            type="text"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
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
  const [start, setStart] = useState("");
  const [rootTitle, setRootTitle] = useState("");
  const [workTime, setWorkTime] = useState("1d");
  const locationLabel = kind === "csv" ? "Folder" : storeOf(kind).location;

  return (
    <form
      className="stack-form grid-form"
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        onSubmit({
          storage: { kind, path: location },
          name,
          start: new Date(start).toISOString(),
          root: { title: rootTitle, workTime },
        });
      }}
    >
      <StoreSelect id="new-store" label="Store" value={kind} onChange={(k) => { setKind(k); setTyped(null); }} />
      {kind === "gsheets" && <GoogleConnect api={api} />}
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
          {kind === "excel"
            ? "A new .xlsx file; it must not exist yet."
            : kind === "gsheets"
              ? "A blank Google Sheet you can edit (create one at sheets.new)."
              : kind === "csv" && projectsDir
                ? "Created if it doesn't exist. Defaults to a folder named after the project, inside your projects folder."
                : "Created if it doesn't exist. Must not already hold a project."}
        </p>
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
  const [toKind, setToKind] = useState<Kind>("excel");
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
      {(fromKind === "gsheets" || toKind === "gsheets") && <GoogleConnect api={api} />}
      <p className="hint wide">The original is left untouched; the copy opens, and edits go to the copy.</p>
      <div className="actions wide">
        <button type="submit" disabled={busy}>
          {busy ? "Importing…" : "Import"}
        </button>
      </div>
    </form>
  );
}
