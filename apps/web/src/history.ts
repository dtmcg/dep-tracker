import type { Command } from "@dep-tracker/domain";

/** Undo/redo stacks of command batches with their inverses (FR-13). */
export interface History {
  undo: { forward: Command[]; inverse: Command[] }[];
  redo: { forward: Command[]; inverse: Command[] }[];
}

const LIMIT = 100;

export const emptyHistory: History = { undo: [], redo: [] };

export function record(history: History, forward: Command[], inverse: Command[]): History {
  return { undo: [...history.undo, { forward, inverse }].slice(-LIMIT), redo: [] };
}

export function undoStep(history: History): { commands: Command[]; history: History } | null {
  const step = history.undo.at(-1);
  if (!step) return null;
  return { commands: step.inverse, history: { undo: history.undo.slice(0, -1), redo: [...history.redo, step] } };
}

export function redoStep(history: History): { commands: Command[]; history: History } | null {
  const step = history.redo.at(-1);
  if (!step) return null;
  return { commands: step.forward, history: { undo: [...history.undo, step], redo: history.redo.slice(0, -1) } };
}
