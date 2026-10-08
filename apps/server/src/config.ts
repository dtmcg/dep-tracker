import path from "node:path";

/** Where CSV projects live unless told otherwise: <home>/Documents/pdm_projects (Windows, macOS, Linux). */
export function defaultProjectsDir(home: string, platform: NodeJS.Platform = process.platform, override?: string): string {
  if (override?.trim()) return override.trim();
  const join = platform === "win32" ? path.win32.join : path.posix.join;
  return join(home, "Documents", "pdm_projects");
}

/** The Resourcing feature is off unless the backend is started with --resourcing. */
export const RESOURCING_FLAG = "--resourcing";
export function resourcingEnabled(argv: readonly string[]): boolean {
  return argv.includes(RESOURCING_FLAG);
}
