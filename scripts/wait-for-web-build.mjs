// Waits until the web bundle exists (another process builds it), so a second server can serve it.
import { access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../apps/web/dist");
const needed = ["index.html", "app.js", "styles.css"];
for (let i = 0; i < 600; i++) {
  const ready = await Promise.all(needed.map((f) => access(path.join(dist, f)).then(() => true, () => false)));
  if (ready.every(Boolean)) {
    // Give an in-progress build a moment to finish writing.
    await new Promise((r) => setTimeout(r, 1500));
    process.exit(0);
  }
  await new Promise((r) => setTimeout(r, 200));
}
console.error("The web bundle never appeared in", dist);
process.exit(1);
