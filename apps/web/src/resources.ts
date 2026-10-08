import { type Command, newId, parseDuration, type ProjectNode, type Resource, type ResourceType } from "@dep-tracker/domain";

/** What a resource is called on screen: its name, or a stand-in when it hasn't got one. */
export function resourceLabel(type: ResourceType, resource: Resource): string {
  return resource.name.trim() || `Unnamed ${type.name.toLowerCase()}`;
}

/** The command to add a new instance from the form; both fields are optional, but an available time must be a duration. */
export function addInstance(typeName: string, form: { name: string; available: string }, id: string = newId()): Command {
  const available = form.available.trim();
  if (available) {
    try {
      parseDuration(available);
    } catch (error) {
      throw new Error(`Available time: ${(error as Error).message}`);
    }
  }
  return { type: "addResource", typeName, resource: { id, name: form.name.trim(), available } };
}

/** The command for the + beside an instance: a new one with the same details, placed right after it. */
export function cloneInstance(type: ResourceType, resource: Resource, id: string = newId()): Command {
  const index = type.resources.findIndex((r) => r.id === resource.id);
  return { type: "addResource", typeName: type.name, resource: { ...resource, id }, index: index + 1 };
}

/** The command for the − beside an instance. */
export const removeInstance = (type: ResourceType, resource: Resource): Command => ({ type: "removeResource", typeName: type.name, id: resource.id });

const setNeeds = (node: ProjectNode, resources: NonNullable<ProjectNode["resources"]>): Command => ({
  type: "updateNode",
  id: node.id,
  changes: { resources },
});

/** Commands for choosing a type for a work item. A name that isn't in the pool yet is created first. Needs 1 to begin with. */
export function requireType(node: ProjectNode, pool: ResourceType[], typeName: string): Command[] {
  const name = typeName.trim();
  if (!name) throw new Error("Choose a resource type or name a new one");
  const existing = pool.find((t) => t.name.toLowerCase() === name.toLowerCase());
  const current = node.resources ?? [];
  if (current.some((r) => r.typeName.toLowerCase() === name.toLowerCase())) throw new Error(`${existing?.name ?? name} is already required`);
  return [...(existing ? [] : [{ type: "addResourceType", name } as Command]), setNeeds(node, [...current, { typeName: existing?.name ?? name, count: 1 }])];
}

/** Whether the + / − beside a requirement can go further: not past the maximum, not below the minimum. */
export function canChange(r: { count: number; min?: number; max?: number }, by: 1 | -1): boolean {
  return by === 1 ? r.max === undefined || r.count < r.max : r.min === undefined || r.count > r.min;
}

/** The + and − beside a requirement: change the number needed by one, within its limits. Going below 1 drops the requirement. */
export function changeCount(node: ProjectNode, typeName: string, by: 1 | -1): Command {
  const current = (node.resources ?? []).find((r) => r.typeName === typeName);
  if (current && !canChange(current, by)) throw new Error(`${typeName} is already at its ${by === 1 ? "maximum" : "minimum"} of ${by === 1 ? current.max : current.min}`);
  const next = (node.resources ?? [])
    .map((r) => (r.typeName === typeName ? { ...r, count: r.count + by } : r))
    .filter((r) => r.count >= 1);
  return setNeeds(node, next);
}

const wholeNumber = (text: string, what: string): number | undefined => {
  const t = text.trim();
  if (!t) return undefined;
  if (!/^\d+$/.test(t) || Number(t) < 1) throw new Error(`${what} must be a whole number, at least 1 (or blank for none)`);
  return Number(t);
};

/** Set the minimum and maximum for a requirement (blank = no limit). The number allocated moves into range if it isn't. */
export function setLimits(node: ProjectNode, typeName: string, limits: { min: string; max: string }): Command {
  const min = wholeNumber(limits.min, "The minimum");
  const max = wholeNumber(limits.max, "The maximum");
  if (min !== undefined && max !== undefined && max < min) throw new Error(`The maximum (${max}) can't be less than the minimum (${min})`);
  return setNeeds(
    node,
    (node.resources ?? []).map((r) => {
      if (r.typeName !== typeName) return r;
      const count = Math.min(max ?? Infinity, Math.max(min ?? 1, r.count));
      return { typeName: r.typeName, count, ...(min !== undefined ? { min } : {}), ...(max !== undefined ? { max } : {}) };
    }),
  );
}
