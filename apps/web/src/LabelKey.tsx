import { type CSSProperties, useEffect, useRef, useState } from "react";
import type { Project } from "@dep-tracker/domain";
import { labelSummary, PALETTE } from "./labels.ts";

interface LabelKeyProps {
  project: Project;
  active: Set<string>;
  onToggle: (label: string) => void;
  onColour: (label: string, colour: string) => void;
}

/** The label key (FR-19..21): click a label to highlight its nodes; set its colour from presets or a picker. */
export function LabelKey({ project, active, onToggle, onColour }: LabelKeyProps) {
  const entries = labelSummary(project);
  const [editing, setEditing] = useState<string | null>(null);
  if (entries.length === 0) return null;

  return (
    <section className="label-key" role="region" aria-label="Label key">
      <span className="label-key-title">Labels</span>
      <ul>
        {entries.map(({ label, count, colour }) => (
          <li key={label} style={{ "--label-colour": colour } as CSSProperties}>
            <button className="label-toggle" aria-pressed={active.has(label)} onClick={() => onToggle(label)}>
              {label} ({count})
            </button>
            <button
              className="label-swatch"
              aria-label={`Colour for ${label}`}
              aria-expanded={editing === label}
              onClick={() => setEditing(editing === label ? null : label)}
            />
            {editing === label && (
              <ColourPopover
                label={label}
                colour={colour}
                onPick={(c) => onColour(label, c)}
                onClose={() => setEditing(null)}
              />
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function ColourPopover({
  label,
  colour,
  onPick,
  onClose,
}: {
  label: string;
  colour: string;
  onPick: (colour: string) => void;
  onClose: () => void;
}) {
  const custom = useRef<HTMLInputElement>(null);
  // Commit the native picker on "change" (when a colour is chosen), not on every "input" while dragging.
  useEffect(() => {
    const el = custom.current;
    if (!el) return;
    const onChange = () => onPick(el.value);
    el.addEventListener("change", onChange);
    return () => el.removeEventListener("change", onChange);
  }, [onPick]);

  return (
    <div className="colour-popover" role="group" aria-label={`Colours for ${label}`} onKeyDown={(e) => e.key === "Escape" && onClose()}>
      {PALETTE.map((p) => (
        <button
          key={p.hex}
          className="preset"
          aria-label={`Use ${p.name} for ${label}`}
          aria-pressed={p.hex === colour}
          style={{ background: p.hex }}
          onClick={() => {
            onPick(p.hex);
            onClose();
          }}
        />
      ))}
      <input ref={custom} type="color" aria-label={`Custom colour for ${label}`} defaultValue={colour} />
    </div>
  );
}
