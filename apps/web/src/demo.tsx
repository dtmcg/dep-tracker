import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { createMemoryApi } from "./demo/memoryApi.ts";
import { sampleProject } from "./demo/sample.ts";
import { applyInitialTheme } from "./ThemePicker.tsx";

// The online demo: the same app, with the project kept in memory instead of behind the API server.
applyInitialTheme();

const container = document.getElementById("root");
if (!container) throw new Error("Missing #root element");

const memory = createMemoryApi(sampleProject, { resourcing: true });

createRoot(container).render(
  <StrictMode>
    <App demo={{ api: memory, reset: memory.reset }} />
  </StrictMode>,
);
