// The crown window: each map's band and decorations in the menu bar itself (just under the menu
// bar's own window, so its menus and icons draw on top; click-through, never focusable; nothing is
// drawn below the bar). Cherry Blossom and Snow are drawn once per change; the chess map's
// lanterns sway, so it animates at up to 30 fps.

import { useEffect, useRef } from "react";
import { ambientGeometry, getPrefs, onPrefs, type Prefs, type ThemePrefs } from "../bridge";
import { ChessAtmosphere } from "./chessMap";
import { drawMenuBarDecor } from "./decor";
import "./ambient.css";

const FRAME_MS = 1000 / 30;

export default function Crown() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let disposed = false;
    let theme: ThemePrefs | null = null;
    let menuBar = 24;
    let raf = 0;
    let last = 0;
    let t = 0;
    const atmos = new ChessAtmosphere();
    const still = document.createElement("canvas");

    const fit = () => {
      const c = ref.current!;
      const dpr = window.devicePixelRatio || 1;
      for (const k of [c, still]) {
        k.width = Math.round(window.innerWidth * dpr);
        k.height = Math.round(window.innerHeight * dpr);
      }
      c.style.width = `${window.innerWidth}px`;
      c.style.height = `${window.innerHeight}px`;
    };
    const map = () => (theme?.map === "snow" || theme?.map === "chess" ? theme.map : "sakura");
    const on = () => !!theme?.enabled && !!theme.garland;

    const redraw = () => {
      const dpr = window.devicePixelRatio || 1;
      const s = still.getContext("2d")!;
      s.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (on()) drawMenuBarDecor(s, window.innerWidth, menuBar, map());
      else s.clearRect(0, 0, still.width, still.height);
      paint();
    };

    const paint = () => {
      const c = ref.current;
      if (!c) return;
      const dpr = window.devicePixelRatio || 1;
      const ctx = c.getContext("2d")!;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, c.width, c.height);
      ctx.drawImage(still, 0, 0);
      if (on() && map() === "chess") {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.imageSmoothingEnabled = false;
        // The bar, and just below it for the lanterns hanging from it.
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, 0, window.innerWidth, ChessAtmosphere.hangReach(menuBar));
        ctx.clip();
        atmos.drawHanging(ctx, t, window.innerWidth, menuBar);
        ctx.restore();
      }
    };

    const frame = (now: number) => {
      raf = 0;
      if (disposed || !on() || map() !== "chess") return;
      raf = requestAnimationFrame(frame);
      if (now - last < FRAME_MS) return;
      t += last ? Math.min(0.1, (now - last) / 1000) : 0;
      last = now;
      paint();
    };
    const restart = () => {
      if (on() && map() === "chess" && !raf) {
        last = 0;
        raf = requestAnimationFrame(frame);
      }
    };

    const apply = (p: Prefs) => {
      theme = p.theme ?? null;
      redraw();
      restart();
    };
    const relayout = async () => {
      const g = await ambientGeometry().catch(() => null);
      if (disposed) return;
      if (g) menuBar = g.menuBar;
      fit();
      redraw();
    };
    const onResize = () => void relayout();
    window.addEventListener("resize", onResize);
    let unlisten: (() => void) | undefined;
    (async () => {
      const prefs = await getPrefs();
      if (disposed) return;
      theme = prefs.theme ?? null;
      await relayout();
      restart();
      unlisten = await onPrefs(apply);
    })();
    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      unlisten?.();
    };
  }, []);
  return <canvas ref={ref} className="crown" aria-hidden="true" />;
}
