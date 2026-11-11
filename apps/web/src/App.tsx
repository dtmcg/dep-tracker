import { useEffect, useMemo, useState } from "react";
import { type Api, createApi, type OpenedProject, pageToken } from "./api.ts";
import { type Features, FeaturesContext } from "./features.tsx";
import { ProjectView } from "./ProjectView.tsx";
import { ThemePicker } from "./ThemePicker.tsx";
import { StartScreen } from "./StartScreen.tsx";
import { useProjectSession } from "./useProjectSession.ts";

/** The online demo passes an in-memory api; `reset` puts the sample back as it was. */
export interface DemoBackend {
  api: Api;
  reset: () => OpenedProject;
}

export function App({ demo }: { demo?: DemoBackend } = {}) {
  const api = useMemo(() => demo?.api ?? createApi(pageToken()), [demo]);
  const [opened, setOpened] = useState<OpenedProject | null>(null);
  const [generation, setGeneration] = useState(0);
  const [features, setFeatures] = useState<Features>({ resourcing: false, demo: demo !== undefined });
  useEffect(() => {
    api.config().then((c) => setFeatures({ resourcing: c.resourcing === true, demo: demo !== undefined }), () => undefined);
  }, [api, demo]);
  useEffect(() => {
    if (demo) void api.openProject({ kind: "csv", path: "" }).then(setOpened);
  }, [api, demo]);
  const close = () => {
    if (demo) {
      setOpened(demo.reset());
      setGeneration((g) => g + 1);
    } else setOpened(null);
  };

  return (
    <FeaturesContext.Provider value={features}>
    <main className="shell">
      <div className="brand">
        <strong>dep-tracker</strong> Project dependency manager
        <ThemePicker />
      </div>
      {demo && (
        <p className="demo-banner" role="note">
          Online demo: your edits live in this browser tab and are lost on reload. Try adding a node, labelling it, or making a
          cycle. To keep real projects, <a href="https://github.com/dtmcg/dep-tracker">run dep-tracker locally</a>.
        </p>
      )}
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
