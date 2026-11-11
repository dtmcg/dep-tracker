// Build the online demo (the app with an in-memory sample project, no backend) into ./site, ready for GitHub Pages.
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";
import { options } from "./build-web.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const web = path.join(root, "apps/web");
const site = path.join(root, "site");

await rm(site, { recursive: true, force: true });
await mkdir(site, { recursive: true });
await esbuild.build({ ...options, entryPoints: [path.join(web, "src/demo.tsx")], outfile: path.join(site, "app.js") });
await cp(path.join(web, "public/styles.css"), path.join(site, "styles.css"));
// Pages serves from /<repo>/, so the page must use relative URLs rather than the local server's absolute ones.
const html = (await readFile(path.join(web, "public/index.html"), "utf8"))
  .replace('href="/styles.css"', 'href="./styles.css"')
  .replace('src="/app.js"', 'src="./app.js"')
  .replace("<title>dep-tracker</title>", "<title>dep-tracker demo</title>");
await writeFile(path.join(site, "index.html"), html);
await writeFile(path.join(site, ".nojekyll"), "");
console.log("Built demo into site/");
