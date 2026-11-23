import { useEffect, useMemo, useState } from "react";
import { createApi, type OpenedProject, pageToken } from "./api.ts";
import { DemoBar } from "./demo/DemoBar.tsx";
import type { MemoryBackend } from "./demo/memoryApi.ts";
import { type Features, FeaturesContext } from "./features.tsx";
import { ProjectView } from "./ProjectView.tsx";
import { ThemePicker } from "./ThemePicker.tsx";
import { StartScreen } from "./StartScreen.tsx";
import { useProjectSession } from "./useProjectSession.ts";

/** The online demo passes an in-memory backend in place of the API server. */
export function App({ demo }: { demo?: MemoryBackend } = {}) {
  const api = useMemo(() => demo ?? createApi(pageToken()), [demo]);
  const [opened, setOpened] = useState<OpenedProject | null>(null);
  const [generation, setGeneration] = useState(0);
  const [features, setFeatures] = useState<Features>({ resourcing: false, demo: demo !== undefined });
  useEffect(() => {
    api.config().then((c) => setFeatures({ resourcing: c.resourcing === true, demo: demo !== undefined }), () => undefined);
  }, [api, demo]);
  useEffect(() => {
    if (demo) setOpened(demo.reset());
  }, [api, demo]);
  const show = (next: OpenedProject) => {
    setOpened(next);
    setGeneration((g) => g + 1);
  };
  const close = () => (demo ? show(demo.reset()) : setOpened(null));

  return (
    <FeaturesContext.Provider value={features}>
    <main className="shell">
      <div className="brand">
        <strong>dep-tracker</strong> Project dependency manager
        <ThemePicker />
      </div>
      {demo && <DemoBar backend={demo} onOpened={show} />}
      {opened ? (
        <OpenProject key={`${opened.project.id}-${generation}`} api={api} opened={opened} onClose={close} onOpened={setOpened} />
      ) : (
        <StartScreen api={api} onOpened={setOpened} />
      )}
    </main>
    </FeaturesContext.Provider>
  );
}

function OpenProject({
  api,
  opened,
  onClose,
  onOpened,
}: {
  api: ReturnType<typeof createApi>;
  opened: OpenedProject;
  onClose: () => void;
  onOpened: (project: OpenedProject) => void;
}) {
  const session = useProjectSession(api, opened, onClose);
  return <ProjectView session={session} onOpenReference={async (storage) => onOpened(await api.openProject(storage))} />;
}
