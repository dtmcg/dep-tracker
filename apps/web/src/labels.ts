import type { Project, ProjectNode } from "@dep-tracker/domain";

/** Preset colours offered next to the picker (FR-20). */
export const PALETTE = [
  { name: "Blue", hex: "#2f5bd3" },
  { name: "Teal", hex: "#0b7f73" },
  { name: "Green", hex: "#3d8b2f" },
  { name: "Amber", hex: "#b85c00" },
  { name: "Red", hex: "#c62828" },
  { name: "Pink", hex: "#c2185b" },
  { name: "Purple", hex: "#6a3fb5" },
  { name: "Slate", hex: "#546171" },
] as const;

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** The label's saved colour, or a stable palette colour picked from its name. */
export function labelColour(project: Project, label: string): string {
  return project.labelColours?.[label] ?? PALETTE[hash(label) % PALETTE.length]!.hex;
}

export interface LabelEntry {
  label: string;
  count: number;
  colour: string;
}

/** The label key (FR-19): every label with its node count and colour, by name. */
export function labelSummary(project: Project): LabelEntry[] {
  const counts = new Map<string, number>();
  for (const node of project.nodes) for (const label of node.labels) counts.set(label, (counts.get(label) ?? 0) + 1);
  for (const label of Object.keys(project.labelColours ?? {})) if (!counts.has(label)) counts.set(label, 0);
  return [...counts.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([label, count]) => ({ label, count, colour: labelColour(project, label) }));
}

/** A node's labels that are switched on in the key, sorted by name. */
export function activeLabels(node: ProjectNode, active: Set<string>): string[] {
  return node.labels.filter((l) => active.has(l)).sort((a, b) => a.localeCompare(b));
}
