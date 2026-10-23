import { useEffect, useState } from "react";
import { Modal } from "./ui";

/** Plain-language explanations opened from each panel's three-dot control. */
const NOTES: { key: string; title: string; text: string }[] = [
  {
    key: "network availability",
    title: "Network availability",
    text: "The share of sites that are in service right now. Higher is better.",
  },
  {
    key: "active incidents",
    title: "Active incidents",
    text: "Alarms the network has raised, with their severity. Open one to see its site and whether a crew is assigned.",
  },
  {
    key: "site power alarms",
    title: "Site power alarms",
    text: "This is a cumulative count for the current simulation run: ATS failures to crank plus fuel-theft events. Events stay in the total after they clear, so this is not the number of sites currently failing. Active ATS alarms are shown in Site power & fleet, and current site outages appear under Active incidents. Zero means neither event type has been recorded this run; it does not guarantee that every site currently has power.",
  },
  {
    key: "qci 9 throughput",
    title: "QCI 9 throughput",
    text: "The average data speed for ordinary internet traffic (QCI 9) over the last hour.",
  },
  {
    key: "e-rab drop rate",
    title: "E-RAB drop rate",
    text: "The share of data sessions that were dropped. Lower is better.",
  },
  {
    key: "sites operational",
    title: "Sites operational",
    text: "How many sites are running, out of the total in the network.",
  },
  {
    key: "live network",
    title: "Live network",
    text: "A map of every site, fibre ring and crew. Switch between Map and Schematic, and use the layers button to choose what is shown.",
  },
  {
    key: "traffic & quality",
    title: "Traffic & quality",
    text: "Recent traffic and drop rate. Pick 30 min, 24 h or 7 d. The line above the chart says how much of that window has been recorded.",
  },
  {
    key: "radio load watch",
    title: "Radio load watch",
    text: "The four busiest sites by radio use (PRB), with their signal quality (CQI).",
  },
  {
    key: "oracle outlook",
    title: "Oracle outlook",
    text: "The model's highest chance that a site will fail in the next hour. Above the action threshold, the system recommends a fix.",
  },
  {
    key: "site power & fleet",
    title: "Site power & fleet",
    text: "Where sites get their power (grid, battery, diesel or solar), and how many maintenance vehicles are free.",
  },
  {
    key: "a1 commander",
    title: "A1 Commander",
    text: "Actions the AI proposes. A person approves or vetoes each one before any crew is sent.",
  },
  {
    key: "towers",
    title: "Towers",
    text: "The live status of every tower: state, radio load, signal quality and fibre ring. Select a row to show it on the map.",
  },
  {
    key: "fibre rings",
    title: "Fibre rings",
    text: "Loop routes that connect sites. A ring with a cut can still be served from its other side.",
  },
  {
    key: "maintenance",
    title: "Maintenance fleet",
    text: "Crew vehicles that are free for repairs, out of the total.",
  },
];

type PanelNoteContent = { title: string; text: string };

/** A single shared modal; only explicit panel-info controls can open it. */
export function PanelNote() {
  const [note, setNote] = useState<PanelNoteContent | null>(null);

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const trigger = target.closest<HTMLButtonElement>("[data-panel-info]");
      const title = trigger?.dataset.panelInfo?.trim();
      if (!title) return;

      const normalizedTitle = title.toLowerCase();
      const entry = NOTES.find((item) => normalizedTitle.includes(item.key));
      setNote(
        entry ?? {
          title,
          text: "This panel presents live information from the SuliNOC simulation. Use its labels and values to review the current network state.",
        },
      );
    };

    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);

  if (!note) return null;
  return (
    <Modal title={note.title} onClose={() => setNote(null)} hideEyebrow>
      <p className="dialog-intro">{note.text}</p>
    </Modal>
  );
}
