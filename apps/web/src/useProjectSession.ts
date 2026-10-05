import { useCallback, useEffect, useRef, useState } from "react";
import { type Command, invertCommands } from "@dep-tracker/domain";
import { type Api, ApiError, type OpenedProject } from "./api.ts";
import { emptyHistory, type History, record, redoStep, undoStep } from "./history.ts";
import { applyLocally } from "./projectState.ts";

export type SaveState = { kind: "saved" } | { kind: "saving" } | { kind: "error"; message: string };

export interface Session {
  snapshot: OpenedProject;
  saveState: SaveState;
  notice: string | null;
  apply: (commands: Command[]) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  close: () => void;
}

const POLL_MS = 3000;

/**
 * Holds the open project. Edits apply optimistically with the shared engine,
 * then save in order; a failed save rolls back (FR-11, FR-12). The store is
 * polled for outside edits and reloaded when it changes (FR-26).
 */
export function useProjectSession(api: Api, initial: OpenedProject, onClose: () => void): Session {
  const [snapshot, setSnapshot] = useState(initial);
  const [saveState, setSaveState] = useState<SaveState>({ kind: "saved" });
  const [notice, setNotice] = useState<string | null>(null);
  const confirmed = useRef(initial); // last state the server accepted
  const latest = useRef(initial); // what the user currently sees, including unsaved edits
  const queue = useRef(Promise.resolve());
  const pending = useRef(0);
  const [history, setHistory] = useState<History>(emptyHistory);
  const historyRef = useRef<History>(emptyHistory);
  const setHist = useCallback((next: History) => {
    historyRef.current = next;
    setHistory(next);
  }, []);

  const reload = useCallback(
    async (message: string) => {
      const fresh = await api.getProject(confirmed.current.project.id);
      confirmed.current = fresh;
      latest.current = fresh;
      setSnapshot(fresh);
      setNotice(message || null);
      setHist(emptyHistory); // inverses no longer apply to a reloaded project
    },
    [api, setHist],
  );

  const show = useCallback((next: OpenedProject) => {
    latest.current = next;
    setSnapshot(next);
  }, []);

  const send = useCallback(
    (commands: Command[], onApplied: (inverse: Command[]) => void) => {
      let optimistic: OpenedProject;
      let inverse: Command[];
      try {
        inverse = invertCommands(latest.current.project, commands);
        optimistic = { ...latest.current, ...applyLocally(latest.current, commands) };
        onApplied(inverse);
      } catch (error) {
        setSaveState({ kind: "error", message: (error as Error).message });
        return;
      }
      show(optimistic);
      pending.current += 1;
      setSaveState({ kind: "saving" });
      setNotice(null);
      queue.current = queue.current.then(async () => {
        try {
          const saved = await api.sendCommands(confirmed.current.project.id, confirmed.current.version, commands);
          confirmed.current = saved;
          pending.current -= 1;
          if (pending.current === 0) {
            show(saved);
            setSaveState({ kind: "saved" });
          }
        } catch (error) {
          pending.current -= 1;
          const conflict = error instanceof ApiError && error.status === 409;
          show(confirmed.current);
          setHist(emptyHistory);
          setSaveState({
            kind: "error",
            message: conflict
              ? "The project changed on disk, so your last change was not saved. Reloaded the latest version."
              : `Your last change was not saved: ${(error as Error).message}`,
          });
          if (conflict) await reload("").catch(() => undefined);
        }
      });
    },
    [api, reload, show, setHist],
  );

  const apply = useCallback(
    (commands: Command[]) => send(commands, (inverse) => setHist(record(historyRef.current, commands, inverse))),
    [send, setHist],
  );

  const undo = useCallback(() => {
    const step = undoStep(historyRef.current);
    if (step) send(step.commands, () => setHist(step.history));
  }, [send, setHist]);

  const redo = useCallback(() => {
    const step = redoStep(historyRef.current);
    if (step) send(step.commands, () => setHist(step.history));
  }, [send, setHist]);

  // Detect edits made outside the app: poll, and check again when the window regains focus.
  useEffect(() => {
    let stopped = false;
    const check = async () => {
      if (stopped || pending.current > 0) return;
      try {
        const version = await api.version(confirmed.current.project.id);
        if (!stopped && pending.current === 0 && version !== confirmed.current.version) {
          await reload("The project changed on disk and has been reloaded.");
        }
      } catch {
        // Transient: the next poll will try again.
      }
    };
    const timer = setInterval(check, POLL_MS);
    window.addEventListener("focus", check);
    return () => {
      stopped = true;
      clearInterval(timer);
      window.removeEventListener("focus", check);
    };
  }, [api, reload]);

  return {
    snapshot,
    saveState,
    notice,
    apply,
    undo,
    redo,
    canUndo: history.undo.length > 0,
    canRedo: history.redo.length > 0,
    close: onClose,
  };
}
