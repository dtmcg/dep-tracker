/** How the chart draws nodes: bars sized by work time on a time line, or uniform boxes placed where each one completes. */
export const VIEWS = [
  { id: "timeline", name: "Time line view" },
  { id: "nodes", name: "Node view" },
] as const;
export type ViewMode = (typeof VIEWS)[number]["id"];
export const DEFAULT_VIEW: ViewMode = "timeline";
const KEY = "dep-tracker.view";

export interface ViewStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function loadView(storage: ViewStorage): ViewMode {
  try {
    const saved = storage.getItem(KEY);
    return VIEWS.find((v) => v.id === saved)?.id ?? DEFAULT_VIEW;
  } catch {
    return DEFAULT_VIEW;
  }
}

export function saveView(storage: ViewStorage, view: ViewMode): void {
  try {
    storage.setItem(KEY, view);
  } catch {
    // The choice just won't outlast this tab.
  }
}
