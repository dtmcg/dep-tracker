import type { Command, ExternalTime, LoadedProject, Schedule, StorageDescriptor } from "@dep-tracker/domain";

export interface OpenedProject extends LoadedProject {
  storage: StorageDescriptor;
  schedule: Schedule;
  /** Completion of each reference node, as worked out by the server. */
  externals?: Record<string, ExternalTime>;
  /** Changes when a project this one references changes on disk. */
  referencesVersion?: string;
}

/** A project this app has created, opened or imported before. */
export interface KnownProject {
  name: string;
  storage: StorageDescriptor;
  lastOpened: string;
}

export interface NewProject {
  storage: StorageDescriptor;
  name: string;
  /** When the project starts; the server uses the current time if left out. */
  start?: string;
  root: { title: string; workTime?: string };
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export type Api = ReturnType<typeof createApi>;

/** Client for the local API server. The token comes from index.html (NFR-5). */
export function createApi(token: string, fetchFn: typeof fetch = (...args) => fetch(...args)) {
  async function request<T>(url: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set("x-dep-tracker-token", token);
    if (init.body) headers.set("content-type", "application/json");
    let res: Response;
    try {
      res = await fetchFn(url, { ...init, headers });
    } catch {
      throw new ApiError("Could not reach the dep-tracker server. Is it running?", 0);
    }
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new ApiError((body as { error?: string }).error ?? `Request failed (${res.status})`, res.status);
    return body as T;
  }

  const post = <T>(url: string, body: unknown) => request<T>(url, { method: "POST", body: JSON.stringify(body) });
  const projectUrl = (id: string) => `/api/projects/${encodeURIComponent(id)}`;

  return {
    library: async () => (await request<{ projects: KnownProject[] }>("/api/library")).projects,
    forgetProject: (storage: StorageDescriptor) => post<{ ok: boolean }>("/api/library/forget", { storage }),
    config: () => request<{ projectsDir: string; resourcing?: boolean }>("/api/config"),
    openProject: (storage: StorageDescriptor) => post<OpenedProject>("/api/projects/open", { storage }),
    createProject: (input: NewProject) => post<OpenedProject>("/api/projects", input),
    getProject: (id: string) => request<OpenedProject>(projectUrl(id)),
    sendCommands: (id: string, expectedVersion: string, commands: Command[]) =>
      post<OpenedProject>(`${projectUrl(id)}/commands`, { expectedVersion, commands }),
    version: (id: string) => request<{ version: string; referencesVersion?: string }>(`${projectUrl(id)}/version`),
    importProject: (source: StorageDescriptor, target: StorageDescriptor) =>
      post<OpenedProject>("/api/projects/import", { source, target }),
    exportProject: (id: string, storage: StorageDescriptor) =>
      post<{ storage: StorageDescriptor; version: string }>(`${projectUrl(id)}/export`, { storage }),
  };
}

/** The token the server wrote into index.html. */
export function pageToken(): string {
  return document.querySelector<HTMLMetaElement>('meta[name="dep-tracker-token"]')?.content ?? "";
}
