import { type FormEvent, useState } from "react";
import type { StorageDescriptor } from "@dep-tracker/domain";
import type { Api, OpenedProject } from "./api.ts";

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
];
const storeOf = (kind: Kind) => STORES.find((s) => s.kind === kind)!;

const TAB_NAMES: Record<Tab, string> = { open: "Open project", new: "New project", import: "Import" };

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
        {tab === "open" && <OpenForm busy={busy} onSubmit={(storage) => run(() => api.openProject(storage))} />}
        {tab === "new" && <NewForm busy={busy} onSubmit={(input) => run(() => api.createProject(input))} />}
        {tab === "import" && <ImportForm busy={busy} onSubmit={(source, target) => run(() => api.importProject(source, target))} />}
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

function OpenForm({ busy, onSubmit }: { busy: boolean; onSubmit: (storage: StorageDescriptor) => void }) {
  const [kind, setKind] = useState<Kind>("csv");
  const [location, setLocation] = useState("");
  const store = storeOf(kind);
  return (
    <form
      className="stack-form grid-form"
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        onSubmit({ kind, path: location });
      }}
    >
      <StoreSelect id="open-store" label="Store" value={kind} onChange={setKind} />
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

function NewForm({ busy, onSubmit }: { busy: boolean; onSubmit: (input: Parameters<Api["createProject"]>[0]) => void }) {
  const [kind, setKind] = useState<Kind>("csv");
  const [location, setLocation] = useState("");
  const [name, setName] = useState("");
  const [start, setStart] = useState("");
  const [rootTitle, setRootTitle] = useState("");
  const [workTime, setWorkTime] = useState("1d");
  const locationLabel = kind === "csv" ? "Folder" : "Workbook file";

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
      <StoreSelect id="new-store" label="Store" value={kind} onChange={setKind} />
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
          {kind === "csv" ? "Created if it doesn't exist. Must not already hold a project." : "A new .xlsx file; it must not exist yet."}
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
function ImportForm({ busy, onSubmit }: { busy: boolean; onSubmit: (source: StorageDescriptor, target: StorageDescriptor) => void }) {
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
      <p className="hint wide">The original is left untouched; the copy opens, and edits go to the copy.</p>
      <div className="actions wide">
        <button type="submit" disabled={busy}>
          {busy ? "Importing…" : "Import"}
        </button>
      </div>
    </form>
  );
}
