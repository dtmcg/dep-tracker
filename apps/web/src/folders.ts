const separatorOf = (dir: string) => (dir.includes("\\") ? "\\" : "/");

/** The projects folder followed by a separator, ready for a project folder name to be typed after it. */
export function projectsFolderPrefix(dir: string): string {
  return dir ? dir.replace(/[\\/]+$/, "") + separatorOf(dir) : "";
}

/** Where a new project called `name` goes by default: its own folder inside the projects folder. */
export function suggestFolder(dir: string, name: string): string {
  if (!dir) return "";
  const folder = name
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return projectsFolderPrefix(dir) + folder;
}
