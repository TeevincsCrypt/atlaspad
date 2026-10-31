"use client";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Canvas } from "@react-three/fiber";
import { Bloom, EffectComposer } from "@react-three/postprocessing";
import { AnimatePresence, motion } from "motion/react";
import { FastForward } from "lucide-react";
import { isDemo } from "@/lib/demo-nations";
import { useWorldNations } from "@/lib/world-nations";
import { useUi } from "@/lib/store";
import { useMediaQuery } from "@/lib/hooks";
import { buildWorldModel, createUniforms } from "./model";
import { computeHighlight } from "./highlight";
import { WorldScene, type IntroKind, type WorldMode } from "./WorldScene";
import type { NationSummary } from "@atlaspad/shared";

let previousMode: WorldMode | null = null;

const useIsMobile = () => useMediaQuery("(max-width: 767px)");

let webglSupport: boolean | undefined;
function supportsWebGL(): boolean {
  if (webglSupport !== undefined) return webglSupport;
  try {
    const c = document.createElement("canvas");
    webglSupport = Boolean(c.getContext("webgl2") ?? c.getContext("webgl"));
  } catch {
    webglSupport = false;
  }
  return webglSupport;
}
const noopSubscribe = () => () => {};

/**
 * The persistent Atlas world. Mounted once in the root layout and shown behind the landing page (rotating globe)
 * and the World page (interactive map), so "ENTER ATLAS" can unroll the globe into the map without a reload.
 */
export function WorldStage() {
  const path = usePathname();
  const mode: WorldMode | null = path === "/" ? "hero" : path.startsWith("/world") ? "map" : null;
  // Detected once on the client; null during SSR and hydration.
  const webgl = useSyncExternalStore<boolean | null>(noopSubscribe, supportsWebGL, () => null);
  if (!mode || webgl === null) return null;
  if (!webgl) {
    return (
      <div className="fixed inset-0 -z-0 bg-[radial-gradient(ellipse_at_center,#0d1424,#03040a_70%)]">
        {mode === "map" && (
          <div className="absolute inset-x-0 top-1/2 text-center text-sm text-dim">
            Your browser can&apos;t render the 3D world (WebGL unavailable). Use Discover and Leaderboard to explore nations.
          </div>
        )}
      </div>
    );
  }
  return <Stage mode={mode} />;
}

function Stage({ mode }: { mode: WorldMode }) {
  const { world, real, all } = useWorldNations();
  const router = useRouter();
  const isMobile = useIsMobile();
  const introSeen = useUi((s) => s.introSeen);
  const setIntroSeen = useUi((s) => s.setIntroSeen);
  const introPlaying = useUi((s) => s.introPlaying);
  const setIntroPlaying = useUi((s) => s.setIntroPlaying);
  const filter = useUi((s) => s.mapFilter);
  const query = useUi((s) => s.mapQuery);
  const setHover = useUi((s) => s.setHover);
  const setSelected = useUi((s) => s.setSelectedNation);
  const setActiveCinematic = useUi((s) => s.setActiveCinematic);
  const uniforms = useMemo(() => createUniforms(), []);
  const labelRegistry = useRef(new Map<number, HTMLElement>());

  const intro = useMemo<IntroKind>(() => {
    let kind: IntroKind;
    if (mode === "map") kind = previousMode === "hero" ? "short" : introSeen ? "none" : "full";
    else kind = previousMode === "map" ? "short" : introSeen ? "none" : "full";
    return kind;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);
  useEffect(() => {
    previousMode = mode;
  }, [mode]);
  useEffect(() => {
    setIntroPlaying(intro !== "none");
  }, [intro, mode, setIntroPlaying]);

  // On-chain nations plus the labelled demo nations (when shown); demo nations never navigate to a nation page.
  const nations = all;
  const wars = useMemo(() => world.data?.wars ?? [], [world.data]);
  const alliances = useMemo(() => world.data?.alliances ?? [], [world.data]);

  // Rebuild the GPU model only when the world's shape changes (membership, territory, tier, buildings, routes).
  const shapeKey = useMemo(
    () =>
      JSON.stringify([
        nations.map((n) => [n.id, n.territoryCells, n.tier, n.emblem, n.buildings.length, n.rank, Math.round(Math.log2(1 + n.citizens))]),
        wars.filter((w) => w.status === "active").map((w) => w.id),
        alliances.map((a) => [a.id, a.memberIds]),
      ]),
    [nations, wars, alliances],
  );
  const model = useMemo(
    () => buildWorldModel(nations, wars, alliances),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [shapeKey],
  );
  // Live per-nation values (statuses, wars) without rebuilding geometry.
  useEffect(() => {
    for (const n of nations) model.nations.set(n.id, n);
  }, [nations, model]);

  const labelNations = useMemo(
    () => [...nations].sort((a, b) => (a.rank ?? 1e9) - (b.rank ?? 1e9)).slice(0, isMobile ? 10 : 36),
    [nations, isMobile],
  );

  const highlight = useMemo(
    () => (mode === "map" ? computeHighlight(nations, wars, filter, query) : new Map<number, number>()),
    [mode, nations, wars, filter, query],
  );

  const coarse = useRef(false);
  useEffect(() => {
    coarse.current = window.matchMedia("(pointer: coarse)").matches;
  }, []);

  const onOpen = useCallback(
    (id: number) => {
      if (coarse.current || isDemo({ id })) setSelected(id);
      else router.push(`/nation/${id}`);
    },
    [router, setSelected],
  );

  const onIntroDone = useCallback(() => {
    setIntroPlaying(false);
    setIntroSeen(true);
  }, [setIntroPlaying, setIntroSeen]);

  // Hero intro completion (no map controls): mark as seen after the fly-in.
  useEffect(() => {
    if (mode !== "hero" || intro === "none") return;
    const t = setTimeout(() => {
      setIntroPlaying(false);
      setIntroSeen(true);
    }, intro === "full" ? 3000 : 1400);
    return () => clearTimeout(t);
  }, [mode, intro, setIntroPlaying, setIntroSeen]);

  return (
    <div className={`fixed inset-0 z-0 ${mode === "hero" ? "pointer-events-none" : ""}`}>
      <Canvas
        dpr={isMobile ? [1, 1.5] : [1, 2]}
        gl={{ antialias: true, powerPreference: "high-performance", alpha: false, stencil: false }}
        camera={{ fov: 40, near: 0.1, far: 700, position: [0, 3, 150] }}
        onPointerMissed={() => setSelected(null)}
      >
        <Suspense fallback={null}>
          <WorldScene
            model={model}
            nations={nations}
            uniforms={uniforms}
            mode={mode}
            intro={intro}
            highlight={highlight}
            onIntroDone={onIntroDone}
            onHover={setHover}
            onOpen={onOpen}
            onCinematic={(e) => setActiveCinematic(e ? { type: e.type, nationId: e.nationId, targetId: e.targetId, title: e.title, body: e.body } : null)}
            showLabels={!introPlaying}
            labelNations={labelNations}
            labelRegistry={labelRegistry}
          />
          {!isMobile && (
            <EffectComposer multisampling={0}>
              <Bloom mipmapBlur intensity={0.9} luminanceThreshold={0.5} luminanceSmoothing={0.25} radius={0.7} />
            </EffectComposer>
          )}
        </Suspense>
      </Canvas>
      {mode === "map" && !introPlaying && <LabelsOverlay nations={labelNations} registry={labelRegistry} onOpen={onOpen} />}
      {/* Vignette keeps HUD text readable over the world */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_45%,rgba(3,4,10,0.75)_100%)]" />
      <AnimatePresence>
        {introPlaying && mode === "map" && (
          <motion.div className="pointer-events-none absolute inset-0 z-10" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <IntroTitles nations={real.length} citizens={real.reduce((s, n) => s + n.citizens, 0)} kind={intro} />
            <button
              onClick={() => window.dispatchEvent(new Event("atlas:skip-intro"))}
              className="pointer-events-auto absolute bottom-24 right-6 flex items-center gap-2 rounded-lg border border-line-strong bg-black/50 px-3 py-2 font-mono text-[11px] uppercase tracking-[0.16em] text-dim backdrop-blur hover:text-fg sm:bottom-8"
            >
              Skip <FastForward className="size-3.5" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function IntroTitles({ nations, citizens, kind }: { nations: number; citizens: number; kind: IntroKind }) {
  const lines = kind === "full" ? ["Approaching the Atlas", nations ? `${nations} nations · ${citizens.toLocaleString("en-US")} citizens` : "A world waiting to be founded", "The market shapes the world"] : ["Entering the Atlas"];
  return (
    <div className="absolute inset-x-0 top-[22%] flex flex-col items-center gap-3">
      {lines.map((l, i) => (
        <motion.div
          key={l}
          initial={{ opacity: 0, y: 8, filter: "blur(6px)" }}
          animate={{ opacity: [0, 1, 1, 0], y: 0, filter: "blur(0px)" }}
          transition={{ duration: kind === "full" ? 1.7 : 1.3, delay: i * 1.3, times: [0, 0.2, 0.75, 1] }}
          className="absolute font-display text-sm uppercase tracking-[0.5em] text-gold-bright/90 sm:text-base"
        >
          {l}
        </motion.div>
      ))}
    </div>
  );
}

function LabelsOverlay({
  nations,
  registry,
  onOpen,
}: {
  nations: NationSummary[];
  registry: React.RefObject<Map<number, HTMLElement>>;
  onOpen: (id: number) => void;
}) {
  const hovered = useUi((s) => s.hoveredNation);
  return (
    <div className="pointer-events-none absolute inset-0 z-[5] overflow-hidden">
      {nations.map((n) => (
        <button
          key={n.id}
          ref={(el) => {
            if (el) registry.current.set(n.id, el);
            else registry.current.delete(n.id);
          }}
          onClick={() => onOpen(n.id)}
          style={{ opacity: 0 }}
          className={`pointer-events-auto absolute left-0 top-0 whitespace-nowrap rounded-md border px-1.5 py-0.5 font-display uppercase tracking-[0.18em] backdrop-blur-sm will-change-transform ${
            n.id === hovered ? "border-gold/60 bg-black/70 text-gold-bright" : "border-white/10 bg-black/45 text-white/80 hover:text-white"
          } ${(n.rank ?? 99) <= 5 ? "text-[10px]" : "text-[8.5px]"}`}
        >
          {n.name}
        </button>
      ))}
    </div>
  );
}
