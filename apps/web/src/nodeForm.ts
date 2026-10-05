import { type NodeChanges, parseDuration, type ProjectNode } from "@dep-tracker/domain";

export interface NodeForm {
  title: string;
  workTime: string;
  /** datetime-local value in the browser's time zone, or "". */
  notBefore: string;
  description: string;
  /** One URL per line. */
  links: string;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** ISO date-time → value for <input type="datetime-local"> in local time. */
export function toLocalInput(iso: string | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** datetime-local value (local time) → ISO, or null when empty. */
export function fromLocalInput(value: string): string | null {
  if (!value.trim()) return null;
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? "invalid" : new Date(ms).toISOString();
}

export function toForm(node: ProjectNode): NodeForm {
  return {
    title: node.title,
    workTime: node.workTime,
    notBefore: toLocalInput(node.notBefore),
    description: node.description,
    links: node.links.join("\n"),
  };
}

/** The changes a form makes to a node, and any field errors (FR-8 inline validation). */
export function formChanges(node: ProjectNode, form: NodeForm): { changes: NodeChanges; errors: Partial<Record<keyof NodeForm, string>> } {
  const errors: Partial<Record<keyof NodeForm, string>> = {};
  const changes: NodeChanges = {};

  const title = form.title.trim();
  if (!title) errors.title = "A title is required";
  else if (title !== node.title) changes.title = title;

  const workTime = form.workTime.trim();
  try {
    parseDuration(workTime);
    if (workTime !== node.workTime) changes.workTime = workTime;
  } catch (error) {
    errors.workTime = (error as Error).message;
  }

  const notBefore = fromLocalInput(form.notBefore);
  if (notBefore === "invalid") errors.notBefore = "Enter a valid date and time";
  else if (notBefore !== (node.notBefore ?? null)) changes.notBefore = notBefore;

  if (form.description !== node.description) changes.description = form.description;

  const links = form.links
    .split(/\s+/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (links.join("\n") !== node.links.join("\n")) changes.links = links;

  return { changes, errors };
}
