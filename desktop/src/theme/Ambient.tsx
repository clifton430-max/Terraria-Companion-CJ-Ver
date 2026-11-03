// The cherry-blossom / snow / chess theme windows: full-display layers with the garland, Dock-edge
// grass and falling petals (or, on the chess map, chains and lanterns, fog, spores and drifting
// dust; see chessMap.ts). Two windows share this view: the bottom one (behind app windows) draws the
// Terraria world plus the theme when it's set to "behind"; the front one (always on top,
// click-through) draws only the theme when it's set to "in front", so it stays visible over other
// apps even while the world is shown. The petals run at ≤30 fps and stop entirely when turned
// off, hidden, or at zero density.

import { useEffect, useRef } from "react";
import { ambientGeometry, getPrefs, getWorldNav, getWorldPlay, onPointer, onPrefs, onWorldGoto, onWorldInput, onWorldNav, onWorldPlay, type AmbientGeometry, type Prefs, type ThemePrefs } from "../bridge";
import { normalizeTerrariaKeys } from "../overlay/controls";
import { WorldLayer } from "../world/layer";
import { createInputDispatcher } from "../world/input";
import { loadTexture } from "../assets/textures";
import { drawDecor, petalSprites, snowflakeSprites, type SnowArt } from "./decor";
import { stepPetals, type Petal, type PetalSettings } from "./petals";
import { ChessAtmosphere, type Pointer } from "./chessMap";
import "./ambient.css";

const FRAME_MS = 1000 / 30;

export default function Ambient({ front = false }: { front?: boolean }) {
  const worldRef = useRef<HTMLCanvasElement>(null);
  const decorRef = useRef<HTMLCanvasElement>(null);
  const petalRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let disposed = false;
    let theme: ThemePrefs | null = null;
    let geo: AmbientGeometry = { width: window.innerWidth, height: window.innerHeight, menuBar: 0, dockEdge: "hidden", dockSize: 0 };
    let plants: ImageBitmap | undefined;
    const snowArt: SnowArt = {};
    const atmos = new ChessAtmosphere();
    let pointer: Pointer | null = null;
    let petals: Petal[] = [];
    let raf = 0;
    let last = 0;
    let t = 0;
    const petalSet = petalSprites();
    const flakeSet = snowflakeSprites();
    let sprites = petalSet;
    const rnd = Math.random;
    // The terrain-only Terraria world, under the decorations (see src/world/layer.ts).
    const world = front ? null : new WorldLayer(worldRef.current!);
    /** This window draws the theme only for its own layer. */
    const mine = (t: ThemePrefs | null): ThemePrefs | null => (t && (t.layer === "front") === front ? t : null);

    const fit = (c: HTMLCanvasElement) => {
      const dpr = window.devicePixelRatio || 1;
      c.width = Math.round(window.innerWidth * dpr);
      c.height = Math.round(window.innerHeight * dpr);
      c.style.width = `${window.innerWidth}px`;
      c.style.height = `${window.innerHeight}px`;
      const ctx = c.getContext("2d")!;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.imageSmoothingEnabled = false;
      return ctx;
    };

    const redrawDecor = () => {
      const c = decorRef.current;
      if (!c) return;
      const ctx = fit(c);
      if (!theme?.enabled) return;
      const map = theme.map === "snow" || theme.map === "chess" ? theme.map : "sakura";
      // (The garland, snow trim and lanterns hang from the menu bar, in the crown window.)
      drawDecor(ctx, { ...geo, width: window.innerWidth, height: window.innerHeight }, { garland: false, grass: theme.grass, plants, map, snow: snowArt });
    };

    const settings = (): PetalSettings | null =>
      theme && theme.enabled && theme.petals && theme.density > 0
        ? { density: theme.density, speed: theme.speed, wind: theme.wind, sway: theme.sway, spin: theme.spin, size: theme.size, style: theme.style }
        : null;

    /** The chess map animates its lanterns and fog even with the dust turned off. */
    const chessOn = () => !!theme?.enabled && theme.map === "chess";

    const frame = (now: number) => {
      raf = 0;
      const s = settings();
      const c = petalRef.current;
      if (!(s || chessOn()) || !c || disposed || document.visibilityState === "hidden") return;
      raf = requestAnimationFrame(frame);
      if (now - last < FRAME_MS) return;
      const dt = last ? Math.min(0.1, (now - last) / 1000) : 0;
      last = now;
      t += dt;
      const w = window.innerWidth;
      const h = window.innerHeight;
      const ctx = c.getContext("2d")!;
      const dpr = window.devicePixelRatio || 1;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, w, h);
      if (chessOn()) {
        const ground = h - (geo.dockEdge === "bottom" ? geo.dockSize : 0);
        atmos.step(dt, t, s, w, h, ground, pointer);
        atmos.draw(ctx, t, w, geo.menuBar, ground, s?.size ?? 1, false, !!theme?.grass);
        return;
      }
      if (!s) return;
      petals = stepPetals(petals, dt, t, s, w, h, rnd);
      for (const p of petals) {
        const img = sprites[p.kind];
        const k = 2 * p.scale * s.size; // CSS px per petal pixel
        const sx = Math.cos(p.flip);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.scale(Math.abs(sx) < 0.25 ? 0.25 * Math.sign(sx || 1) : sx, 1);
        ctx.globalAlpha = 0.9;
        ctx.drawImage(img, (-img.width * k) / 2, (-img.height * k) / 2, img.width * k, img.height * k);
      }
      ctx.globalAlpha = 1;
    };

    const restart = () => {
      if (!settings() && !chessOn()) {
        cancelAnimationFrame(raf);
        raf = 0;
        petals = [];
        if (petalRef.current) fit(petalRef.current);
        return;
      }
      if (!raf) {
        last = 0;
        raf = requestAnimationFrame(frame);
      }
    };

    const apply = (p: Prefs) => {
      world?.setKeys(normalizeTerrariaKeys(p.control?.terrariaKeys));
      world?.setCharacters(p.characters);
      world?.apply(p.world);
      const prev = theme;
      theme = mine(p.theme ?? null);
      sprites = theme?.map === "snow" ? flakeSet : petalSet;
      // Switching maps restarts the particles so the old ones don't linger.
      if (prev && prev.map !== theme?.map) {
        petals = [];
        atmos.clear();
      }
      if (!prev || !theme || prev.enabled !== theme.enabled || prev.garland !== theme?.garland || prev.grass !== theme?.grass || prev.map !== theme?.map) redrawDecor();
      restart();
    };

    const relayout = async () => {
      const g = await ambientGeometry().catch(() => null);
      if (disposed) return;
      if (g) geo = g;
      document.documentElement.style.setProperty("--menu-bar", `${geo.menuBar}px`);
      if (petalRef.current) fit(petalRef.current);
      redrawDecor();
      world?.resize();
    };

    const onResize = () => void relayout();
    const onVisibility = () => restart();
    window.addEventListener("resize", onResize);
    document.addEventListener("visibilitychange", onVisibility);
    let unlisten: (() => void) | undefined;
    let unlistenNav: (() => void) | undefined;
    let unlistenPlay: (() => void) | undefined;
    let unlistenGoto: (() => void) | undefined;
    let unlistenInput: (() => void) | undefined;
    let unlistenPointer: (() => void) | undefined;
    (async () => {
      const prefs = await getPrefs();
      if (disposed) return;
      theme = mine(prefs.theme ?? null);
      sprites = theme?.map === "snow" ? flakeSet : petalSet;
      await relayout();
      restart();
      unlisten = await onPrefs(apply);
      // The chess map's dust swirls around the pointer (Rust streams it while that map shows).
      unlistenPointer = await onPointer(({ x, y }) => {
        const now = t;
        const dt = pointer ? Math.max(1 / 60, now - pointer.at) : 1;
        pointer = { x, y, vx: pointer ? (x - pointer.x) / dt : 0, vy: pointer ? (y - pointer.y) / dt : 0, at: now };
      });
      if (world) {
        world.setKeys(normalizeTerrariaKeys(prefs.control?.terrariaKeys));
        world.setCharacters(prefs.characters);
        world.apply(prefs.world);
        unlistenPlay = await onWorldPlay((on, mode) => world.setPlay(on, mode));
        unlistenGoto = await onWorldGoto((x, y) => world.goto(x, y));
        // The world is under the desktop icons: its clicks and keys arrive from Rust's event tap.
        unlistenInput = await onWorldInput(createInputDispatcher());
        if (await getWorldPlay().catch(() => false)) world.setPlay(true);
        unlistenNav = await onWorldNav((on) => world.setNav(on));
        if (await getWorldNav().catch(() => false)) world.setNav(true);
      }
      // Real Terraria plant sprites for the grass, when the install is available.
      plants = (await loadTexture("Images/Tiles_3")) ?? undefined;
      // Winter art from the install: the Snow Balla snowman, snowballs, a present, a Christmas tree.
      const [snowman, snowball, present, tree] = await Promise.all(["Images/NPC_145", "Images/Item_949", "Images/Item_1869", "Images/Tiles_171"].map((n) => loadTexture(n)));
      Object.assign(snowArt, { snowman: snowman ?? undefined, snowball: snowball ?? undefined, present: present ?? undefined, tree: tree ?? undefined });
      if (!disposed) redrawDecor();
    })();

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      document.removeEventListener("visibilitychange", onVisibility);
      unlisten?.();
      unlistenNav?.();
      unlistenPlay?.();
      unlistenGoto?.();
      unlistenInput?.();
      unlistenPointer?.();
      world?.destroy();
    };
  }, []);

  return (
    <>
      <canvas ref={worldRef} className="world-layer" aria-label="Terraria world" hidden />
      <canvas ref={decorRef} className="ambient-layer" aria-hidden="true" />
      <canvas ref={petalRef} className="ambient-layer" aria-hidden="true" />
    </>
  );
}
