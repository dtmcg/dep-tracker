// Bundle the web app into apps/web/dist. Pass --watch to rebuild on change.
import { cp, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const web = path.join(root, "apps/web");
const dist = path.join(web, "dist");

/** @type {import("esbuild").BuildOptions} */
export const options = {
  entryPoints: [path.join(web, "src/main.tsx")],
  outfile: path.join(dist, "app.js"),
  bundle: true,
  format: "esm",
  jsx: "automatic",
  sourcemap: true,
  target: ["es2022"],
  define: { "process.env.NODE_ENV": '"production"' },
  logLevel: "warning",
};

export async function copyPublic() {
  await mkdir(dist, { recursive: true });
  await cp(path.join(web, "public"), dist, { recursive: true });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await copyPublic();
  if (process.argv.includes("--watch")) {
    const ctx = await esbuild.context(options);
    await ctx.watch();
    console.log("Watching web app for changes…");
  } else {
    await esbuild.build(options);
    console.log(`Built web app into ${path.relative(root, dist)}`);
  }
}
