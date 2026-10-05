import { useMemo, useState } from "react";
import { createApi, type OpenedProject, pageToken } from "./api.ts";
import { ProjectView } from "./ProjectView.tsx";
import { StartScreen } from "./StartScreen.tsx";
import { useProjectSession } from "./useProjectSession.ts";

export function App() {
  const api = useMemo(() => createApi(pageToken()), []);
  const [opened, setOpened] = useState<OpenedProject | null>(null);

  return (
    <main className="shell">
      <div className="brand">
        <strong>dep-tracker</strong> Project dependency manager
      </div>
      {opened ? (
        <OpenProject key={opened.project.id} api={api} opened={opened} onClose={() => setOpened(null)} />
      ) : (
        <StartScreen api={api} onOpened={setOpened} />
      )}
    </main>
  );
}

function OpenProject({ api, opened, onClose }: { api: ReturnType<typeof createApi>; opened: OpenedProject; onClose: () => void }) {
  const session = useProjectSession(api, opened, onClose);
  return <ProjectView session={session} />;
}
