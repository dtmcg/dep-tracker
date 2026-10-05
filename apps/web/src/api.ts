import type { Command, LoadedProject, Schedule, StorageDescriptor } from "@dep-tracker/domain";

export interface OpenedProject extends LoadedProject {
  storage: StorageDescriptor;
  schedule: Schedule;
}

export interface NewProject {
  storage: StorageDescriptor;
  name: string;
  start: string;
  root: { title: string; workTime: string };
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
    openProject: (storage: StorageDescriptor) => post<OpenedProject>("/api/projects/open", { storage }),
    createProject: (input: NewProject) => post<OpenedProject>("/api/projects", input),
    getProject: (id: string) => request<OpenedProject>(projectUrl(id)),
    sendCommands: (id: string, expectedVersion: string, commands: Command[]) =>
      post<OpenedProject>(`${projectUrl(id)}/commands`, { expectedVersion, commands }),
    version: async (id: string) => (await request<{ version: string }>(`${projectUrl(id)}/version`)).version,
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
