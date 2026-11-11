import { applyCommands, type Command, type Project, schedule, type StorageDescriptor } from "@dep-tracker/domain";
import { type Api, ApiError, type OpenedProject } from "../api.ts";

/** Where the demo pretends its project lives. */
export const DEMO_STORAGE: StorageDescriptor = { kind: "csv", path: "in this browser tab" };

const unavailable = (what: string) => new ApiError(`${what} isn't available in the online demo; run dep-tracker locally for that.`, 400);

/**
 * The API, with the project kept in memory instead of behind a server: the same commands, validation and
 * scheduling as the real backend, nothing saved. Reloading the page starts again from the sample.
 */
export function createMemoryApi(seed: () => Project, options: { resourcing?: boolean } = {}): Api & { reset: () => OpenedProject } {
  let project = seed();
  let version = 1;

  const snapshot = (): OpenedProject => ({
    project: structuredClone(project),
    version: String(version),
    storage: DEMO_STORAGE,
    schedule: schedule(project),
  });

  return {
    reset() {
      project = seed();
      version += 1;
      return snapshot();
    },
    library: async () => [],
    forgetProject: async () => ({ ok: true }),
    config: async () => ({ projectsDir: "", resourcing: options.resourcing === true }),
    openProject: async () => snapshot(),
    getProject: async () => snapshot(),
    version: async () => ({ version: String(version) }),
    sendCommands: async (_id: string, expectedVersion: string, commands: Command[]) => {
      if (expectedVersion !== String(version)) throw new ApiError("The project changed, reload it", 409);
      try {
        if (!options.resourcing && commands.some((c) => ["addResourceType", "removeResourceType", "addResource", "removeResource"].includes(c.type))) {
          throw new ApiError("Resourcing is not enabled", 403);
        }
        project = applyCommands(project, commands);
      } catch (error) {
        if (error instanceof ApiError) throw error;
        throw new ApiError((error as Error).message, 422);
      }
      version += 1;
      return snapshot();
    },
    createProject: async () => {
      throw unavailable("Creating a project");
    },
    importProject: async () => {
      throw unavailable("Importing");
    },
    exportProject: async () => {
      throw unavailable("Exporting");
    },
  } satisfies Api & { reset: () => OpenedProject };
}
