import { useEffect, useMemo, useState } from "react";
import { createApi, type OpenedProject, pageToken } from "./api.ts";
import { type Features, FeaturesContext } from "./features.tsx";
import { ProjectView } from "./ProjectView.tsx";
import { ThemePicker } from "./ThemePicker.tsx";
import { StartScreen } from "./StartScreen.tsx";
import { useProjectSession } from "./useProjectSession.ts";

export function App() {
  const api = useMemo(() => createApi(pageToken()), []);
  const [opened, setOpened] = useState<OpenedProject | null>(null);
  const [features, setFeatures] = useState<Features>({ resourcing: false });
  useEffect(() => {
    api.config().then((c) => setFeatures({ resourcing: c.resourcing === true }), () => undefined);
  }, [api]);

  return (
    <FeaturesContext.Provider value={features}>
    <main className="shell">
      <div className="brand">
        <strong>dep-tracker</strong> Project dependency manager
        <ThemePicker />
      </div>
      {opened ? (
        <OpenProject key={opened.project.id} api={api} opened={opened} onClose={() => setOpened(null)} onOpened={setOpened} />
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
