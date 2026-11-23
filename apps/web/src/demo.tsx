import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { EXAMPLES } from "./demo/examples.ts";
import { createMemoryBackend } from "./demo/memoryApi.ts";
import { applyInitialTheme } from "./ThemePicker.tsx";

// The online demo: the same app, with the project kept in memory instead of behind the API server.
applyInitialTheme();

const container = document.getElementById("root");
if (!container) throw new Error("Missing #root element");

const backend = createMemoryBackend(EXAMPLES, { resourcing: true });

createRoot(container).render(
  <StrictMode>
    <App demo={backend} />
  </StrictMode>,
);
