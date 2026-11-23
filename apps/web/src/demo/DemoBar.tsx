import { type FormEvent, useState } from "react";
import type { OpenedProject } from "../api.ts";
import { EXAMPLES } from "./examples.ts";
import type { MemoryBackend } from "./memoryApi.ts";

const BLANK = "__blank__";

/** The demo's picker: swap in an example project, or start a blank one with just its success criteria. */
export function DemoBar({ backend, onOpened }: { backend: MemoryBackend; onOpened: (opened: OpenedProject) => void }) {
  const [choice, setChoice] = useState(EXAMPLES[0]!.id);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const example = EXAMPLES.find((e) => e.id === choice);

  function pick(id: string) {
    setChoice(id);
    setStarting(false);
    setError(null);
    onOpened(backend.loadExample(id));
  }

  function start(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const name = String(data.get("name") ?? "");
    const criteria = String(data.get("criteria") ?? "");
    try {
      onOpened(backend.startNew(name, criteria));
      setChoice(BLANK);
      setStarting(false);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <section className="demo-bar" aria-label="Demo examples">
      <p className="demo-note" role="note">
        Online demo: edits live in this browser tab and are lost on reload. Pick an example, or start your own from scratch. To keep real
        projects, <a href="https://github.com/dtmcg/dep-tracker">run dep-tracker locally</a>.
      </p>
      <div className="demo-controls">
        <label htmlFor="demo-example">Example project</label>
        <select id="demo-example" value={choice} onChange={(e) => pick(e.target.value)}>
          {choice === BLANK && (
            <option value={BLANK} disabled>
              Your own project
            </option>
          )}
          {EXAMPLES.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
        </select>
        <button className="primary" onClick={() => setStarting((s) => !s)} aria-expanded={starting}>
          Start new
        </button>
        {example && <span className="demo-blurb">{example.blurb}</span>}
      </div>
      {starting && (
        <form className="demo-new" aria-label="Start a new project" onSubmit={start}>
          <label>
            Project name
            <input name="name" type="text" required autoFocus placeholder="Office move" />
          </label>
          <label>
            Success criteria
            <input name="criteria" type="text" placeholder="Everyone working from the new office" />
          </label>
          <button type="submit" className="primary">
            Start
          </button>
          <button type="button" className="ghost" onClick={() => setStarting(false)}>
            Cancel
          </button>
          {error && (
            <p className="field-error" role="alert">
              {error}
            </p>
          )}
        </form>
      )}
    </section>
  );
}
