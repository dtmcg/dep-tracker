import { type Command, newId, parseDuration, type Resource, type ResourceType } from "@dep-tracker/domain";

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
