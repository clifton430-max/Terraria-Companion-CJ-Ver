// The settings window as a stylish, slanted "pause menu": a deep blue animated backdrop with a
// broad pale slab of open space tinted in your selected companion's colours, where she hangs
// upside down by a rope, swaying, over her name in huge letters; big italic section names step
// down a diagonal beside her with a sweeping highlight on the chosen one, and that section's
// settings slide in on an angled panel. Original CSS/SVG (pause.css); no game assets. Keyboard: ↑/↓ choose a section, Enter or → opens it (Tab moves within it), Esc or ←
// (outside a text field) goes back, Esc on the list closes the window. Mouse: hover to choose,
// click to open.

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { CharacterId } from "../bridge";
import HangingCompanion from "./HangingCompanion";
import "./pause.css";

/** Your selected companion: who hangs in the open space, her name, and the colours it takes. */
export interface MenuCompanion {
  id: CharacterId;
  name: string;
  /** Her speech-bubble palette (pale top and bottom, a strong border colour, dark text). */
  colors: { top: string; bottom: string; border: string; text: string };
  /** Changes when her look changes (redraws her). */
  lookKey: string;
}

export interface MenuSection {
  id: string;
  label: string;
  sub: string;
}

/** The moon's phase today, 0 (new) .. 0.5 (full) .. 1 (new again). */
export function moonPhase(d: Date): number {
  const synodic = 29.530588853;
  const known = Date.UTC(2000, 0, 6, 18, 14); // a new moon
  const days = (d.getTime() - known) / 86400000;
  return (((days % synodic) + synodic) % synodic) / synodic;
}

/** "Early morning", "Daytime", "Evening"... for the clock. */
export function timeOfDay(h: number): string {
  if (h < 5) return "Late Night";
  if (h < 8) return "Early Morning";
  if (h < 12) return "Morning";
  if (h < 17) return "Daytime";
  if (h < 20) return "Evening";
  return "Night";
}

/** The next section index, wrapping. */
export function step(i: number, delta: number, n: number): number {
  return (((i + delta) % n) + n) % n;
}

function Moon({ phase }: { phase: number }) {
  // A lit disc with a shadow ellipse sliding across it.
  const lit = phase <= 0.5 ? phase * 2 : (1 - phase) * 2; // 0 new .. 1 full
  const waxing = phase < 0.5;
  const rx = Math.abs(1 - 2 * lit) * 18;
  return (
    <svg className="p3-moon" viewBox="-20 -20 40 40" aria-hidden="true">
      <circle r="18" fill="#0b1f5c" stroke="#7fe4ff" strokeWidth="1.5" />
      <path
        d={`M 0 -18 A 18 18 0 0 ${waxing ? 1 : 0} 0 18 A ${rx} 18 0 0 ${lit > 0.5 === waxing ? 0 : 1} 0 -18`}
        fill="#e9fbff"
      />
    </svg>
  );
}

function Clock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 15000);
    return () => clearInterval(t);
  }, []);
  const day = now.toLocaleDateString(undefined, { weekday: "short" }).toUpperCase();
  return (
    <div className="p3-clock" aria-label={now.toLocaleString()}>
      <span className="p3-date">
        {now.getMonth() + 1}/{now.getDate()}
      </span>
      <span className="p3-day">{day}</span>
      <Moon phase={moonPhase(now)} />
      <span className="p3-tod">{timeOfDay(now.getHours())}</span>
    </div>
  );
}

/** Her colours as the menu's theme variables (the slab, its accents, the name). */
function theme(c: MenuCompanion | null): CSSProperties {
  if (!c) return {};
  return { ["--slab-top" as string]: c.colors.top, ["--slab-bottom" as string]: c.colors.bottom, ["--accent" as string]: c.colors.border, ["--slab-ink" as string]: c.colors.text } as CSSProperties;
}

export default function PauseMenu({
  sections,
  active,
  onActive,
  onClose,
  companion,
  children,
}: {
  sections: MenuSection[];
  active: string;
  onActive: (id: string) => void;
  onClose: () => void;
  companion: MenuCompanion | null;
  children: ReactNode;
}) {
  const index = Math.max(0, sections.findIndex((s) => s.id === active));
  const [focus, setFocus] = useState<"list" | "content">("list");
  const [hover, setHover] = useState<number | null>(null);
  const [opened, setOpened] = useState(0); // bumps on every section change (replays the wipe)
  const content = useRef<HTMLDivElement>(null);
  const items = useRef<(HTMLButtonElement | null)[]>([]);
  const lit = hover ?? index;

  const choose = useCallback(
    (i: number) => {
      const id = sections[i].id;
      if (id !== active) {
        onActive(id);
        setOpened((n) => n + 1);
      }
    },
    [sections, active, onActive],
  );

  const enter = useCallback(() => {
    setFocus("content");
    // Into the section: its first control takes focus (Tab moves on from there).
    window.setTimeout(() => {
      const first = content.current?.querySelector<HTMLElement>("button, input, select, textarea, [tabindex]:not([tabindex='-1'])");
      (first ?? content.current)?.focus();
    }, 30);
  }, []);

  const back = useCallback(() => {
    setFocus("list");
    items.current[index]?.focus();
  }, [index]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement;
      if (focus === "list") {
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          e.preventDefault();
          setHover(null);
          const i = step(index, e.key === "ArrowDown" ? 1 : -1, sections.length);
          choose(i);
          items.current[i]?.focus();
        } else if (e.key === "Enter" || e.key === "ArrowRight") {
          e.preventDefault();
          enter();
        } else if (e.key === "Escape") {
          e.preventDefault();
          onClose();
        }
      } else if (e.key === "Escape" || (e.key === "ArrowLeft" && !typing && !(e.target instanceof HTMLButtonElement && e.target.getAttribute("role") === "radio"))) {
        if (typing && e.key === "Escape") (e.target as HTMLElement).blur();
        e.preventDefault();
        back();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [focus, index, sections.length, choose, enter, back, onClose]);

  // (In a narrow window the list scrolls sideways: keep the chosen section in view.)
  useEffect(() => {
    items.current[index]?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [index]);

  const current = sections[index];
  const bubbles = useMemo(() => Array.from({ length: 22 }, (_, i) => ({ left: (i * 37) % 100, delay: (i * 1.7) % 9, size: 3 + ((i * 7) % 9), dur: 9 + ((i * 5) % 8) })), []);

  return (
    <div className={`p3 focus-${focus}`} style={theme(companion)}>
      <div className="p3-bg" aria-hidden="true">
        <div className="p3-rays" />
        <div className="p3-caustics" />
        {bubbles.map((b, i) => (
          <i key={i} className="p3-bubble" style={{ left: `${b.left}%`, animationDelay: `-${b.delay}s`, animationDuration: `${b.dur}s`, width: b.size, height: b.size }} />
        ))}
      </div>
      {/* The open space in her colours, with her hanging in it over her name. */}
      <div className="p3-slab" aria-hidden="true">
        <div className="p3-slab-shine" />
      </div>
      {companion && (
        <>
          <HangingCompanion key={companion.id} id={companion.id} lookKey={companion.lookKey} />
          <div className="p3-name" key={`name-${companion.name}`} aria-label={companion.name}>
            {companion.name}
          </div>
        </>
      )}

      <Clock />

      <nav className="p3-list" aria-label="Menu" onMouseLeave={() => setHover(null)}>
        {sections.map((s, i) => (
          <button
            key={s.id}
            ref={(el) => {
              items.current[i] = el;
            }}
            className={`p3-item ${i === index ? "active" : ""} ${i === lit ? "lit" : ""}`}
            style={{ ["--i" as string]: i }}
            aria-current={i === index ? "page" : undefined}
            onMouseEnter={() => setHover(i)}
            onFocus={() => focus === "list" && setHover(null)}
            onClick={() => {
              choose(i);
              enter();
            }}
          >
            <span className="p3-shard" aria-hidden="true" />
            <span className="p3-label">{s.label}</span>
          </button>
        ))}
      </nav>

      <section className="p3-panel" key={opened} aria-label={current?.label} onMouseDown={() => focus === "list" && setFocus("content")}>
        <header className="p3-head">
          <h1>{current?.label}</h1>
          <p>{current?.sub}</p>
        </header>
        <div className="p3-content" ref={content} tabIndex={-1}>
          {children}
        </div>
      </section>

      <footer className="p3-hints" aria-hidden="true">
        <span>
          <kbd>↑</kbd>
          <kbd>↓</kbd> Select
        </span>
        <span>
          <kbd>⏎</kbd> Confirm
        </span>
        <span>
          <kbd>Esc</kbd> {focus === "content" ? "Back" : "Close"}
        </span>
      </footer>
    </div>
  );
}
