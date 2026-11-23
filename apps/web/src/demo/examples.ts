import type { Project } from "@dep-tracker/domain";
import { item, needs, pool, reference } from "./build.ts";
import { sampleProject } from "./sample.ts";

/** An example the demo can open. `others` are the projects its reference nodes point at, keyed by their location. */
export interface Example {
  id: string;
  name: string;
  /** One line shown under the picker. */
  blurb: string;
  /** Whether it shows resourcing, references and the other richer features. */
  rich: boolean;
  build: () => { main: Project; others?: Record<string, Project> };
}

const conference = (): Project => ({
  id: "conference",
  name: "Annual conference",
  start: "2026-12-01T09:00:00.000Z",
  rootId: "event",
  nodes: [
    item("event", "Conference day runs smoothly", "1d", { labels: ["milestone"] }),
    item("venue", "Venue booked and confirmed", "5d", { labels: ["logistics"] }),
    item("speakers", "Speakers confirmed", "15d", { labels: ["content"], description: "Keynote plus six sessions." }),
    item("agenda", "Agenda published", "3d", { labels: ["content"] }),
    item("tickets", "Ticket sales open", "2d", { labels: ["marketing"] }),
    item("site", "Event website live", "6d", { labels: ["marketing"] }),
    item("catering", "Catering ordered", "4d", { labels: ["logistics"] }),
    item("signage", "Signage and badges printed", "3d", { labels: ["logistics"] }),
  ],
  edges: [
    ...needs("event", "agenda", "tickets", "catering", "signage"),
    ...needs("agenda", "speakers", "venue"),
    ...needs("tickets", "site", "venue"),
    ...needs("catering", "venue"),
    ...needs("signage", "agenda"),
    ...needs("site", "speakers"),
  ],
  labelColours: { milestone: "#7c3aed", content: "#2563eb", marketing: "#db2777", logistics: "#16a34a" },
});

const migration = (): Project => ({
  id: "migration",
  name: "Data migration",
  start: "2026-12-01T09:00:00.000Z",
  rootId: "cutover",
  nodes: [
    item("cutover", "Cut over to the new database", "1d", { labels: ["milestone"] }),
    item("freeze", "Change freeze and final backup", "1d", { labels: ["risk"] }),
    item("rehearsal", "Full rehearsal on a copy", "3d", { labels: ["risk", "test"] }),
    item("scripts", "Migration scripts written", "8d", { labels: ["build"] }),
    item("mapping", "Schema mapping agreed", "4d", { labels: ["design"] }),
    item("cleanse", "Source data cleansed", "6d", { labels: ["build"] }),
    item("target", "Target environment provisioned", "3d", { labels: ["infra"] }),
    item("comms", "Users told about the downtime", "1d", { labels: ["comms"] }),
  ],
  edges: [
    ...needs("cutover", "freeze", "rehearsal", "comms"),
    ...needs("rehearsal", "scripts", "target", "cleanse"),
    ...needs("scripts", "mapping"),
    ...needs("cleanse", "mapping"),
    ...needs("freeze", "rehearsal"),
  ],
  labelColours: { milestone: "#7c3aed", risk: "#dc2626", test: "#ea580c", build: "#2563eb", design: "#db2777", infra: "#0891b2", comms: "#16a34a" },
});

const house = (): Project => ({
  id: "house",
  name: "Build a house",
  start: "2026-12-01T09:00:00.000Z",
  rootId: "move-in",
  nodes: [
    item("move-in", "Family moves in", "2d", {
      labels: ["milestone"],
      description: "Certificate of completion in hand and the keys handed over.",
    }),
    item("inspect", "Final inspection and snag list", "5d", { labels: ["inspection"], resources: [{ typeName: "Site manager", count: 1 }] }),
    item("finishes", "Interior finishes", "20d", {
      labels: ["interior"],
      resources: [{ typeName: "Carpenter", count: 2, min: 1, max: 3 }, { typeName: "Electrician", count: 1 }],
    }),
    item("services", "Plumbing and electrics first fix", "12d", {
      labels: ["services"],
      resources: [{ typeName: "Electrician", count: 1, min: 1, max: 2 }],
    }),
    item("roof", "Roof on and weathertight", "10d", { labels: ["structure"], resources: [{ typeName: "Carpenter", count: 2, min: 2, max: 4 }] }),
    item("frame", "Frame and walls", "25d", { labels: ["structure"], resources: [{ typeName: "Carpenter", count: 3, min: 2, max: 4 }] }),
    item("foundations", "Foundations poured", "8d", { labels: ["structure", "weather"], notBefore: "2026-12-14T08:00:00.000Z", description: "The groundworker can't start before the site is cleared on 14 Dec." }),
    item("permit", "Planning permission", "", { labels: ["paperwork"], description: "Waiting on the council: no estimate yet, so it shows as unestimated." }),
    item("landscaping", "Landscaping", "7d", { labels: ["exterior"], notBefore: "2027-03-01T08:00:00.000Z" }),
  ],
  edges: [
    ...needs("move-in", "inspect", "landscaping"),
    ...needs("inspect", "finishes"),
    ...needs("finishes", "services", "roof"),
    ...needs("services", "frame"),
    ...needs("roof", "frame"),
    ...needs("frame", "foundations"),
    ...needs("foundations", "permit"),
    ...needs("landscaping", "roof"),
  ],
  labelColours: { milestone: "#7c3aed", structure: "#b45309", interior: "#db2777", services: "#2563eb", weather: "#0891b2", paperwork: "#dc2626", inspection: "#16a34a" },
  resourceTypes: [
    pool("Carpenter", [["Sean", "80d"], ["Declan", "60d"], ["Roisin", ""], ["Cathal", "30d"]]),
    pool("Electrician", [["Niamh", "40d"], ["Tom", ""]]),
    pool("Site manager", [["Orla", ""]]),
  ],
});

// ---------- Pharmaceutical engineering ----------

const regulatory = "#dc2626";
const longLead = "#ea580c";
const gmp = "#7c3aed";

/** A separate project the tablet line depends on: the cleanroom air handling it is installed into. */
const cleanroomHvac = (): Project => ({
  id: "cleanroom-hvac",
  name: "Cleanroom HVAC upgrade",
  start: "2026-11-02T09:00:00.000Z",
  rootId: "handover",
  nodes: [
    item("handover", "HVAC qualified and handed over", "3d", { labels: ["gmp"] }),
    item("balance", "Air balance and room pressure test", "6d", { labels: ["gmp"] }),
    item("ahu", "Air handling units installed", "15d", { labels: ["long lead"] }),
    item("ahu-order", "AHUs ordered", "45d", { labels: ["long lead"], description: "Vendor lead time." }),
    item("ducting", "Ducting and HEPA housings", "12d"),
  ],
  edges: [...needs("handover", "balance"), ...needs("balance", "ahu", "ducting"), ...needs("ahu", "ahu-order")],
  labelColours: { gmp, "long lead": longLead },
});

const tabletLine = (): { main: Project; others: Record<string, Project> } => ({
  others: { "cleanroom-hvac": cleanroomHvac() },
  main: {
    id: "tablet-line",
    name: "Install and qualify a tablet manufacturing line",
    start: "2026-12-01T09:00:00.000Z",
    rootId: "release",
    nodes: [
      item("release", "Line qualified and releasing GMP batches", "3d", {
        labels: ["milestone", "gmp"],
        description: "QA releases the first three commercial-scale batches made on the new line.",
        links: ["https://example.com/pharma/tablet-line-charter"],
        resources: [{ typeName: "Validation Engineer", count: 1 }],
      }),
      item("pq", "PQ: three consecutive conforming batches", "10d", {
        labels: ["gmp", "validation"],
        resources: [{ typeName: "Validation Engineer", count: 2, min: 1, max: 3 }, { typeName: "Process Engineer", count: 2, min: 1, max: 3 }],
      }),
      item("oq", "OQ: operational qualification", "12d", {
        labels: ["gmp", "validation"],
        resources: [{ typeName: "Validation Engineer", count: 2, min: 1, max: 3 }, { typeName: "Commissioning Technician", count: 1 }],
      }),
      item("iq", "IQ: installation qualification", "8d", { labels: ["gmp", "validation"], resources: [{ typeName: "Validation Engineer", count: 1, min: 1, max: 2 }] }),
      item("cleaning", "Cleaning validation", "8d", { labels: ["gmp", "validation"], resources: [{ typeName: "Validation Engineer", count: 1 }] }),
      item("commission", "Commissioning and shakedown", "10d", { labels: ["commissioning"], resources: [{ typeName: "Commissioning Technician", count: 2, min: 1, max: 3 }, { typeName: "Process Engineer", count: 1 }] }),
      item("install", "Install and connect equipment", "15d", { labels: ["installation"], resources: [{ typeName: "Mechanical Fitter", count: 3, min: 2, max: 4 }, { typeName: "Electrician", count: 2, min: 1, max: 3 }] }),
      item("fat", "Factory acceptance test at the vendor", "5d", { labels: ["gmp", "validation"], resources: [{ typeName: "Process Engineer", count: 1 }] }),
      item("press", "Tablet press delivered", "70d", { labels: ["long lead"], description: "Vendor quoted ten weeks from purchase order." }),
      item("coater", "Coater and dryer delivered", "56d", { labels: ["long lead"] }),
      item("po", "Equipment purchase orders placed", "3d", { labels: ["procurement"] }),
      item("design", "Detailed design and P&IDs", "15d", { labels: ["design"], resources: [{ typeName: "Process Engineer", count: 2, min: 1, max: 3 }] }),
      item("urs", "User requirement specification approved", "5d", { labels: ["design", "gmp"], resources: [{ typeName: "Process Engineer", count: 1 }] }),
      item("utilities", "Utilities tie-in (power, purified water, air)", "15d", {
        labels: ["installation"],
        notBefore: "2027-01-18T08:00:00.000Z",
        description: "Needs the planned plant shutdown window, which opens on 18 Jan.",
        resources: [{ typeName: "Electrician", count: 2, min: 1, max: 2 }],
      }),
      reference("hvac", "Cleanroom HVAC upgrade", "cleanroom-hvac", { labels: ["gmp"], description: "Another project's success criteria. Click Open project to go to it." }),
      item("sops", "SOPs written and operators trained", "8d", { labels: ["gmp"], resources: [{ typeName: "Process Engineer", count: 1 }] }),
      item("mbr", "Master batch record approved", "5d", { labels: ["gmp"] }),
      item("filing", "Regulatory variation filed", "", { labels: ["regulatory"], description: "Waiting on the regulatory team's estimate, so it is flagged as unestimated." }),
    ],
    edges: [
      ...needs("release", "pq", "cleaning", "sops", "mbr", "filing"),
      ...needs("pq", "oq"),
      ...needs("cleaning", "oq"),
      ...needs("oq", "iq"),
      ...needs("iq", "commission"),
      ...needs("sops", "commission"),
      ...needs("commission", "install"),
      ...needs("install", "fat", "utilities", "hvac"),
      ...needs("fat", "press", "coater"),
      ...needs("press", "po"),
      ...needs("coater", "po"),
      ...needs("utilities", "design"),
      ...needs("po", "design"),
      ...needs("design", "urs"),
      ...needs("mbr", "design"),
    ],
    labelColours: { milestone: "#0f766e", gmp, validation: "#2563eb", "long lead": longLead, regulatory, commissioning: "#0891b2", installation: "#b45309", procurement: "#db2777", design: "#4f46e5" },
    resourceTypes: [
      pool("Process Engineer", [["Aoife", "90d"], ["Brian", "90d"], ["Ciara", "60d"]]),
      pool("Validation Engineer", [["Dara", "70d"], ["Eoin", "45d"], ["Fiona", ""]]),
      pool("Electrician", [["Gearoid", ""], ["Hannah", "40d"], ["Ian", "40d"]]),
      pool("Commissioning Technician", [["Jack", "50d"], ["Kate", "50d"]]),
      pool("Mechanical Fitter", [["Liam", ""], ["Maeve", ""], ["Niall", "30d"], ["Orla", "30d"]]),
    ],
  },
});

/** Water-for-injection loop: a project the fill-finish line depends on. */
const wfiLoop = (): Project => ({
  id: "wfi-loop",
  name: "Water for injection loop",
  start: "2026-11-02T09:00:00.000Z",
  rootId: "wfi-ready",
  nodes: [
    item("wfi-ready", "WFI loop qualified", "2d", { labels: ["gmp"] }),
    item("wfi-sample", "Three-week sampling programme", "15d", { labels: ["gmp"] }),
    item("wfi-install", "Loop piping and still installed", "20d"),
    item("wfi-still", "WFI still delivered", "60d", { labels: ["long lead"] }),
  ],
  edges: [...needs("wfi-ready", "wfi-sample"), ...needs("wfi-sample", "wfi-install"), ...needs("wfi-install", "wfi-still")],
  labelColours: { gmp, "long lead": longLead },
});

const fillFinish = (): { main: Project; others: Record<string, Project> } => ({
  others: { "wfi-loop": wfiLoop() },
  main: {
    id: "fill-finish",
    name: "Install and qualify a fill-finish line",
    start: "2026-12-01T09:00:00.000Z",
    rootId: "sterile-release",
    nodes: [
      item("sterile-release", "Line qualified and releasing sterile batches", "3d", { labels: ["milestone", "gmp"], resources: [{ typeName: "Quality Engineer", count: 1 }] }),
      item("media-fill", "Media fill trials (three successful runs)", "12d", {
        labels: ["gmp", "sterility"],
        description: "Aseptic process simulation. A failed run means repeating all three.",
        resources: [{ typeName: "Microbiologist", count: 2, min: 2, max: 3 }, { typeName: "Quality Engineer", count: 1 }],
      }),
      item("sterilisation", "Sterilisation and VHP cycle validation", "10d", { labels: ["gmp", "sterility"], resources: [{ typeName: "Validation Engineer", count: 2, min: 1, max: 3 }] }),
      item("em", "Environmental monitoring qualification", "8d", { labels: ["gmp", "sterility"], resources: [{ typeName: "Microbiologist", count: 1, min: 1, max: 2 }] }),
      item("oq", "OQ of filler, isolator and capper", "14d", { labels: ["gmp", "validation"], resources: [{ typeName: "Validation Engineer", count: 2, min: 1, max: 3 }, { typeName: "Automation Engineer", count: 1 }] }),
      item("iq", "IQ of filler, isolator and capper", "8d", { labels: ["gmp", "validation"], resources: [{ typeName: "Validation Engineer", count: 1 }] }),
      item("commission", "Commissioning and software shakedown", "10d", { labels: ["commissioning"], resources: [{ typeName: "Automation Engineer", count: 2, min: 1, max: 2 }, { typeName: "Mechanical Fitter", count: 1 }] }),
      item("install", "Isolator and filler installed in the cleanroom", "15d", { labels: ["installation"], resources: [{ typeName: "Mechanical Fitter", count: 3, min: 2, max: 4 }] }),
      item("fat-sat", "Factory and site acceptance tests", "6d", { labels: ["validation"], resources: [{ typeName: "Automation Engineer", count: 1 }] }),
      item("filler", "Filling machine and isolator delivered", "84d", { labels: ["long lead"], description: "Twelve weeks from order for the isolator and filler." }),
      item("po", "Equipment purchase orders placed", "3d", { labels: ["procurement"] }),
      item("design", "Detailed design and contamination control strategy", "20d", { labels: ["design", "gmp"] }),
      item("urs", "User requirement specification approved", "5d", { labels: ["design", "gmp"] }),
      reference("wfi", "Water for injection loop", "wfi-loop", { labels: ["gmp"] }),
      item("leak", "Lyophiliser and capping line aligned", "", { labels: ["risk"], description: "Not estimated yet, so it is flagged and ignored in the dates." }),
    ],
    edges: [
      ...needs("sterile-release", "media-fill", "sterilisation", "em"),
      ...needs("media-fill", "oq"),
      ...needs("sterilisation", "oq"),
      ...needs("em", "oq"),
      ...needs("oq", "iq"),
      ...needs("iq", "commission"),
      ...needs("commission", "install", "wfi", "leak"),
      ...needs("install", "fat-sat"),
      ...needs("fat-sat", "filler"),
      ...needs("filler", "po"),
      ...needs("po", "design"),
      ...needs("design", "urs"),
    ],
    labelColours: { milestone: "#0f766e", gmp, sterility: "#0e7490", validation: "#2563eb", "long lead": longLead, commissioning: "#0891b2", installation: "#b45309", procurement: "#db2777", design: "#4f46e5", risk: "#dc2626" },
    resourceTypes: [
      pool("Validation Engineer", [["Aine", "70d"], ["Barry", "70d"], ["Clodagh", "40d"]]),
      pool("Microbiologist", [["Donal", "60d"], ["Edel", "60d"], ["Fergal", ""]]),
      pool("Automation Engineer", [["Grainne", ""], ["Henry", "50d"]]),
      pool("Mechanical Fitter", [["Ita", ""], ["Joe", ""], ["Kevin", "40d"]]),
      pool("Quality Engineer", [["Lorna", ""]]),
    ],
  },
});

export const EXAMPLES: Example[] = [
  { id: "mobile", name: "Mobile relaunch (sample)", blurb: "A small app release with labels, a not-before date and a resource pool.", rich: true, build: () => ({ main: sampleProject() }) },
  { id: "conference", name: "Annual conference", blurb: "Simple: labels and dependencies only.", rich: false, build: () => ({ main: conference() }) },
  { id: "migration", name: "Data migration", blurb: "Simple: a cut-over with risk and test labels.", rich: false, build: () => ({ main: migration() }) },
  { id: "house", name: "Build a house", blurb: "Trades as resources with min/max limits, not-before dates and an unestimated item.", rich: true, build: () => ({ main: house() }) },
  { id: "tablet-line", name: "Pharma: tablet manufacturing line", blurb: "Everything: IQ/OQ/PQ validation, long-lead equipment, a referenced HVAC project, resource limits, unestimated items.", rich: true, build: tabletLine },
  { id: "fill-finish", name: "Pharma: sterile fill-finish line", blurb: "Everything, sterile style: isolator, sterilisation and media fill trials, a referenced WFI project.", rich: true, build: fillFinish },
];
