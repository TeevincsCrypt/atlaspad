"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { MapControls } from "@react-three/drei";
import * as THREE from "three";
import gsap from "gsap";
import type { MapControls as MapControlsImpl } from "three-stdlib";
import type { NationSummary } from "@atlaspad/shared";
import { effects, type WorldEffect } from "@/lib/effects";
import { useUi } from "@/lib/store";
import { Atmosphere, HexLayer, LightsLayer, OceanLayer, RoutesLayer, Stars, StructuresLayer } from "./layers";
import {
  PLANE_HALF_H,
  PLANE_HALF_W,
  cellFromPlane,
  cellFromSphere,
  statusCode,
  surfacePoint,
  type Uniforms,
  type WorldModel,
} from "./model";

export type WorldMode = "hero" | "map";
export type IntroKind = "full" | "short" | "none";

const HERO_POS = new THREE.Vector3(0, 1.2, 19.5);

// Intros run in wall-clock time even on slow GPUs (no slow-motion catch-up).
gsap.ticker.lagSmoothing(0);

/** Camera pose that frames the whole map for the current viewport (narrow screens frame the height). */
function mapPose(width: number, height: number): THREE.Vector3 {
  const aspect = width / Math.max(1, height);
  const vfov = THREE.MathUtils.degToRad(40) / 2;
  const hfov = Math.atan(Math.tan(vfov) * aspect);
  const fitW = PLANE_HALF_W / Math.tan(hfov);
  const fitH = (PLANE_HALF_H * 1.25) / Math.tan(vfov);
  const d = THREE.MathUtils.clamp(aspect < 1 ? fitH : Math.max(fitW, fitH) * 0.96, 10, 34);
  return new THREE.Vector3(0, d * 0.88, d * 0.47);
}
const SPACE_POS = new THREE.Vector3(0, 3, 150);
const ORIGIN = new THREE.Vector3();

/** Group space (map on XY, globe north +Z) → world space (rotation -90° about X). */
function toWorld(v: THREE.Vector3): THREE.Vector3 {
  return new THREE.Vector3(v.x, v.z, -v.y);
}

// ---------------------------------------------------------------------------------------------
// Particles
// ---------------------------------------------------------------------------------------------

const MAX_PARTICLES = 1600;

function Particles({ model, uniforms }: { model: WorldModel; uniforms: Uniforms }) {
  const state = useMemo(
    () => ({
      pos: new Float32Array(MAX_PARTICLES * 3),
      vel: new Float32Array(MAX_PARTICLES * 3),
      col: new Float32Array(MAX_PARTICLES * 3),
      life: new Float32Array(MAX_PARTICLES),
      maxLife: new Float32Array(MAX_PARTICLES),
      size: new Float32Array(MAX_PARTICLES),
      next: 0,
    }),
    [],
  );
  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(state.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute("aColor", new THREE.BufferAttribute(state.col, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute("aAlpha", new THREE.BufferAttribute(new Float32Array(MAX_PARTICLES), 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute("aSize", new THREE.BufferAttribute(state.size, 1).setUsage(THREE.DynamicDrawUsage));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 200);
    return geo;
  }, [state]);
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: { uPixelRatio: uniforms.uPixelRatio },
        vertexShader: /* glsl */ `
          uniform float uPixelRatio;
          attribute vec3 aColor; attribute float aAlpha; attribute float aSize;
          varying vec3 vColor; varying float vAlpha;
          void main() {
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            vColor = aColor; vAlpha = aAlpha;
            gl_PointSize = aSize * uPixelRatio * (30.0 / -mv.z);
            gl_Position = projectionMatrix * mv;
          }`,
        fragmentShader: /* glsl */ `
          varying vec3 vColor; varying float vAlpha;
          void main() {
            float d = length(gl_PointCoord - 0.5);
            float a = smoothstep(0.5, 0.0, d);
            gl_FragColor = vec4(vColor * 2.0, a * a * vAlpha);
            if (gl_FragColor.a < 0.01) discard;
          }`,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    [uniforms],
  );

  const modelRef = useRef(model);
  modelRef.current = model;

  useEffect(() => {
    const spawn = (cell: number, color: THREE.Color, speed: number, spread: number, life: number, size: number) => {
      const i = state.next;
      state.next = (state.next + 1) % MAX_PARTICLES;
      const morph = uniforms.uMorph.value;
      const p = surfacePoint(cell, morph, 0.08);
      const n = morph > 0.5 ? new THREE.Vector3(0, 0, 1) : p.clone().normalize();
      const t = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(spread);
      state.pos.set([p.x + t.x * 0.2, p.y + t.y * 0.2, p.z + t.z * 0.05], i * 3);
      const v = n.multiplyScalar(speed * (0.6 + Math.random() * 0.8)).add(t.multiplyScalar(0.6));
      state.vel.set([v.x, v.y, v.z], i * 3);
      state.col.set([color.r, color.g, color.b], i * 3);
      state.life[i] = life;
      state.maxLife[i] = life;
      state.size[i] = size * (0.6 + Math.random() * 0.8);
    };
    const gold = new THREE.Color("#ffd27a");
    const green = new THREE.Color("#5cf2b0");
    const red = new THREE.Color("#ff4d5e");
    return effects.on((e: WorldEffect) => {
      const m = modelRef.current;
      if (e.kind === "trade") {
        const cells = m.cellsOf.get(e.nationId);
        if (!cells?.length) return;
        const n = Math.round(Math.min(48, 5 + Math.sqrt(e.magnitude) * 40));
        for (let k = 0; k < n; k++) {
          const cell = cells[Math.floor(Math.random() * cells.length)]!;
          if (e.side === "buy") spawn(cell, Math.random() < 0.5 ? gold : green, 0.9, 0.6, 1.6, 2.4);
          else spawn(cell, red, -0.15, 0.4, 1.3, 2.0);
        }
      } else if (e.kind === "burst") {
        const capital = m.layout.capitals.get(e.nationId);
        if (capital === undefined) return;
        if (e.type === "GOLDEN_AGE" || e.type === "FOUNDED" || e.type === "GRADUATED") {
          for (let k = 0; k < 260; k++) spawn(capital, gold, 1.6 + Math.random(), 2.2, 2.6, 3);
        } else if (e.type === "ECONOMIC_CRISIS") {
          for (let k = 0; k < 120; k++) spawn(capital, red, 0.4, 1.4, 2.2, 2.4);
        } else if (e.type === "WAR_DECLARED" || e.type === "WAR_ENDED") {
          const other = e.targetId ? m.layout.capitals.get(e.targetId) : undefined;
          for (let k = 0; k < 140; k++) spawn(k % 2 && other !== undefined ? other : capital, red, 1.0, 1.6, 1.8, 2.6);
        }
      }
    });
  }, [state, uniforms]);

  useFrame((_, dt) => {
    const alpha = geometry.getAttribute("aAlpha") as THREE.BufferAttribute;
    const a = alpha.array as Float32Array;
    let any = false;
    for (let i = 0; i < MAX_PARTICLES; i++) {
      if (state.life[i]! <= 0) {
        if (a[i] !== 0) {
          a[i] = 0;
          any = true;
        }
        continue;
      }
      any = true;
      state.life[i]! -= dt;
      const k = i * 3;
      state.vel[k + 2]! -= dt * 0.15;
      state.pos[k]! += state.vel[k]! * dt;
      state.pos[k + 1]! += state.vel[k + 1]! * dt;
      state.pos[k + 2]! += state.vel[k + 2]! * dt;
      state.vel[k]! *= 0.985;
      state.vel[k + 1]! *= 0.985;
      const t = Math.max(0, state.life[i]! / state.maxLife[i]!);
      a[i] = Math.sin(t * Math.PI) * 0.95;
    }
    if (any) {
      alpha.needsUpdate = true;
      (geometry.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
      (geometry.getAttribute("aColor") as THREE.BufferAttribute).needsUpdate = true;
      (geometry.getAttribute("aSize") as THREE.BufferAttribute).needsUpdate = true;
    }
  });
  return <points geometry={geometry} material={material} frustumCulled={false} />;
}

// ---------------------------------------------------------------------------------------------
// Per-nation live state → DataTexture (pulses, statuses, wars, highlight)
// ---------------------------------------------------------------------------------------------

function NationFx({ model, uniforms, highlight }: { model: WorldModel; uniforms: Uniforms; highlight: Map<number, number> }) {
  const pulses = useRef(new Map<number, { v: number; buy: boolean }>());
  const hovered = useUi((s) => s.hoveredNation);
  const selected = useUi((s) => s.selectedNation);
  const atWar = useMemo(() => {
    const set = new Set<number>();
    for (const n of model.nations.values()) if (n.activeWars > 0) set.add(n.id);
    return set;
  }, [model]);

  useEffect(
    () =>
      effects.on((e) => {
        if (e.kind !== "trade") return;
        const p = pulses.current.get(e.nationId);
        const add = Math.min(1, 0.35 + Math.sqrt(e.magnitude) * 0.8);
        pulses.current.set(e.nationId, { v: Math.min(1.2, (p?.v ?? 0) + add), buy: e.side === "buy" });
      }),
    [],
  );

  const lastStatus = useRef(0);
  useFrame((_, dt) => {
    const tex = uniforms.uNationTex.value;
    const data = tex.image.data as Float32Array;
    const now = Date.now() / 1000;
    const refreshStatus = now - lastStatus.current > 1;
    if (refreshStatus) lastStatus.current = now;
    for (const [id, idx] of model.indexOf) {
      const k = idx * 4;
      const p = pulses.current.get(id);
      if (p) {
        p.v = Math.max(0, p.v - dt * 0.8);
        if (p.v === 0) pulses.current.delete(id);
      }
      data[k] = p?.v ?? 0;
      data[k + 1] = p?.buy === false ? 0 : 1;
      if (refreshStatus) {
        const n = model.nations.get(id)!;
        data[k + 2] = (statusCode(n, now) + (atWar.has(id) ? 0.5 : 0)) / 10;
      }
      const base = highlight.get(id) ?? 1;
      data[k + 3] = id === hovered || id === selected ? Math.max(base, 1) + 0.45 : base;
    }
    tex.needsUpdate = true;
  });
  return null;
}

// ---------------------------------------------------------------------------------------------
// Camera director: intro, mode transitions, cinematics
// ---------------------------------------------------------------------------------------------

function CameraDirector({
  mode,
  intro,
  uniforms,
  spinRef,
  model,
  onIntroDone,
  onCinematic,
}: {
  mode: WorldMode;
  intro: IntroKind;
  uniforms: Uniforms;
  spinRef: React.RefObject<THREE.Group | null>;
  model: WorldModel;
  onIntroDone: () => void;
  onCinematic: (e: Extract<WorldEffect, { kind: "cinematic" }> | null) => void;
}) {
  const { camera, size } = useThree();
  const controls = useRef<MapControlsImpl>(null);
  const [interactive, setInteractive] = useState(false);
  const timeline = useRef<gsap.core.Timeline | null>(null);
  const lookTarget = useRef(new THREE.Vector3());
  const busy = useRef(false);
  const lastInteraction = useRef(0);
  const lastCinematic = useRef(0);
  const queue = useRef<Extract<WorldEffect, { kind: "cinematic" }>[]>([]);
  const cinematicsOn = useUi((s) => s.cinematicsOn);
  const isMobile = size.width < 768;

  // Mode transitions & intro
  useEffect(() => {
    timeline.current?.kill();
    setInteractive(false);
    busy.current = true;
    const tl = gsap.timeline({
      onComplete: () => {
        busy.current = false;
        if (mode === "map") {
          setInteractive(true);
          onIntroDone();
        }
      },
    });
    timeline.current = tl;
    const look = () => camera.lookAt(lookTarget.current);
    const spin = spinRef.current;
    const heroOffset = size.width >= 1024 ? 4.6 : 0;
    const heroY = size.width >= 1024 ? 0 : -2.2;

    if (mode === "hero") {
      uniforms.uReveal.value = Math.max(uniforms.uReveal.value, intro === "full" ? 0 : uniforms.uReveal.value);
      if (intro === "full") {
        camera.position.copy(SPACE_POS);
        uniforms.uMorph.value = 0;
        uniforms.uReveal.value = 0;
        uniforms.uRouteOpacity.value = 0;
        tl.to(camera.position, { x: HERO_POS.x, y: HERO_POS.y, z: HERO_POS.z, duration: 2.6, ease: "power3.out", onUpdate: look }, 0);
        tl.to(uniforms.uReveal, { value: 1, duration: 2.4, ease: "none" }, 0.8);
        tl.to(uniforms.uRouteOpacity, { value: 1, duration: 1 }, 2.4);
      } else if (intro === "none") {
        uniforms.uMorph.value = 0;
        uniforms.uReveal.value = 1;
        uniforms.uRouteOpacity.value = 1;
        uniforms.uAtmosphere.value = 1;
        camera.position.copy(HERO_POS);
        lookTarget.current.set(0, 0, 0);
        if (spin) spin.position.set(heroOffset, heroY, 0);
        look();
      } else {
        tl.to(uniforms.uMorph, { value: 0, duration: 1.4, ease: "power2.inOut" }, 0);
        tl.to(camera.position, { x: HERO_POS.x, y: HERO_POS.y, z: HERO_POS.z, duration: 1.4, ease: "power2.inOut", onUpdate: look }, 0);
        tl.to(uniforms.uReveal, { value: 1, duration: 0.6 }, 0);
        tl.to(uniforms.uRouteOpacity, { value: 1, duration: 0.6 }, 0.6);
      }
      tl.to(lookTarget.current, { x: 0, y: 0, z: 0, duration: 1.2, onUpdate: look }, 0);
      tl.to(uniforms.uAtmosphere, { value: 1, duration: 1 }, 0);
      if (spin) tl.to(spin.position, { x: heroOffset, y: heroY, duration: 1.4, ease: "power2.inOut" }, 0);
    } else {
      const fromSpace = intro === "full";
      let t = 0;
      if (fromSpace) {
        camera.position.copy(SPACE_POS);
        lookTarget.current.set(0, 0, 0);
        uniforms.uMorph.value = 0;
        uniforms.uReveal.value = 0;
        uniforms.uRouteOpacity.value = 0;
        uniforms.uAtmosphere.value = 1;
        if (spin) spin.position.set(0, 0, 0);
        tl.to(camera.position, { x: HERO_POS.x, y: HERO_POS.y, z: HERO_POS.z, duration: 2.3, ease: "power3.inOut", onUpdate: look }, 0);
        tl.to(uniforms.uReveal, { value: 1, duration: 2.0, ease: "none" }, 1.0);
        tl.to(uniforms.uRouteOpacity, { value: 1, duration: 0.8 }, 2.6);
        t = 3.1;
      }
      if (intro === "none") {
        uniforms.uMorph.value = 1;
        uniforms.uReveal.value = 1;
        uniforms.uRouteOpacity.value = 1;
        uniforms.uAtmosphere.value = 0;
        camera.position.copy(mapPose(size.width, size.height));
        lookTarget.current.set(0, 0, 0);
        if (spin) {
          spin.position.set(0, 0, 0);
          spin.rotation.y = 0;
        }
        look();
        tl.to({}, { duration: 0.01 });
      } else {
        if (spin) {
          const target = Math.round(spin.rotation.y / (Math.PI * 2)) * Math.PI * 2;
          tl.to(spin.rotation, { y: target, duration: 1.6, ease: "power2.inOut" }, t);
          tl.to(spin.position, { x: 0, y: 0, duration: 1.2, ease: "power2.inOut" }, t);
        }
        tl.to(uniforms.uReveal, { value: 1, duration: 0.4 }, t);
        tl.to(uniforms.uMorph, { value: 1, duration: 1.9, ease: "power2.inOut" }, t + 0.1);
        tl.to(uniforms.uAtmosphere, { value: 0, duration: 1.2 }, t + 0.1);
        const pose = mapPose(size.width, size.height);
        tl.to(camera.position, { x: pose.x, y: pose.y, z: pose.z, duration: 2.0, ease: "power2.inOut", onUpdate: look }, t);
        tl.to(lookTarget.current, { x: 0, y: 0, z: 0, duration: 1.2, onUpdate: look }, t);
      }
    }
    const skip = () => tl.progress(1);
    window.addEventListener("atlas:skip-intro", skip);
    return () => {
      window.removeEventListener("atlas:skip-intro", skip);
      tl.kill();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, intro]);

  // Cinematic fly-to for major world events (map mode only; never interrupts an active user).
  useEffect(
    () =>
      effects.on((e) => {
        if (e.kind === "focus") {
          const cap = model.layout.capitals.get(e.nationId);
          if (cap === undefined || mode !== "map" || !controls.current) return;
          const p = toWorld(surfacePoint(cap, 1));
          gsap.to(controls.current.target, { x: p.x, y: 0, z: p.z, duration: 1.1, ease: "power2.inOut" });
          gsap.to(camera.position, { x: p.x, y: 9, z: p.z + 5, duration: 1.1, ease: "power2.inOut" });
          return;
        }
        if (e.kind !== "cinematic") return;
        // Outside the interactive map (landing globe, intro) play the visual burst without moving the camera.
        if (mode !== "map" || !cinematicsOn) {
          effects.emit({ kind: "burst", type: e.type, nationId: e.nationId, targetId: e.targetId });
          return;
        }
        queue.current.push(e);
      }),
    [camera, mode, model, cinematicsOn],
  );

  useFrame(() => {
    if (mode !== "map" || !interactive || busy.current || !queue.current.length || !controls.current) return;
    const now = Date.now();
    if (!cinematicsOn || now - lastInteraction.current < 4000 || now - lastCinematic.current < 30_000) {
      if (!cinematicsOn) queue.current.length = 0;
      return;
    }
    const e = queue.current.shift()!;
    const cap = model.layout.capitals.get(e.nationId);
    if (cap === undefined) return;
    lastCinematic.current = now;
    busy.current = true;
    const c = controls.current;
    const savedTarget = c.target.clone();
    const savedPos = camera.position.clone();
    const a = toWorld(surfacePoint(cap, 1));
    let focus = a;
    let dist = 6;
    if (e.targetId) {
      const capB = model.layout.capitals.get(e.targetId);
      if (capB !== undefined) {
        const b = toWorld(surfacePoint(capB, 1));
        focus = a.clone().add(b).multiplyScalar(0.5);
        dist = Math.min(22, Math.max(7, a.distanceTo(b) * 1.1));
      }
    }
    c.enabled = false;
    onCinematic(e);
    const tl = gsap.timeline({
      onComplete: () => {
        c.enabled = true;
        busy.current = false;
        onCinematic(null);
      },
    });
    tl.to(c.target, { x: focus.x, y: 0, z: focus.z, duration: 1.6, ease: "power3.inOut", onUpdate: () => c.update() }, 0);
    tl.to(camera.position, { x: focus.x, y: dist * 0.85, z: focus.z + dist * 0.55, duration: 1.6, ease: "power3.inOut" }, 0);
    tl.call(() => effects.emit({ kind: "burst", type: e.type, nationId: e.nationId, targetId: e.targetId }), [], 1.4);
    tl.to(c.target, { x: savedTarget.x, y: savedTarget.y, z: savedTarget.z, duration: 1.6, ease: "power3.inOut", onUpdate: () => c.update() }, 5.4);
    tl.to(camera.position, { x: savedPos.x, y: savedPos.y, z: savedPos.z, duration: 1.6, ease: "power3.inOut" }, 5.4);
  });

  // Keep the map target within the world bounds.
  const clamp = () => {
    const c = controls.current;
    if (!c) return;
    lastInteraction.current = Date.now();
    const x = THREE.MathUtils.clamp(c.target.x, -PLANE_HALF_W, PLANE_HALF_W);
    const z = THREE.MathUtils.clamp(c.target.z, -PLANE_HALF_H, PLANE_HALF_H);
    const dx = x - c.target.x;
    const dz = z - c.target.z;
    if (dx || dz) {
      c.target.set(x, 0, z);
      camera.position.x += dx;
      camera.position.z += dz;
    }
  };

  return mode === "map" && interactive ? (
    <MapControls
      ref={controls}
      makeDefault
      target={ORIGIN}
      enableRotate={!isMobile}
      maxPolarAngle={1.05}
      minDistance={3}
      maxDistance={34}
      enableDamping
      dampingFactor={0.12}
      zoomSpeed={0.9}
      panSpeed={isMobile ? 1.2 : 0.9}
      onChange={clamp}
    />
  ) : null;
}

// ---------------------------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------------------------

/** Projects capital positions to screen space every frame and writes them to label elements owned by the DOM. */
function LabelProjector({ model, nations, registry }: { model: WorldModel; nations: NationSummary[]; registry: LabelRegistry }) {
  const { size, camera } = useThree();
  const anchors = useMemo(
    () =>
      nations
        .map((n) => {
          const cap = model.layout.capitals.get(n.id);
          return cap === undefined ? null : { id: n.id, world: toWorld(surfacePoint(cap, 1, 0.35)) };
        })
        .filter(Boolean) as { id: number; world: THREE.Vector3 }[],
    [nations, model],
  );
  const v = useMemo(() => new THREE.Vector3(), []);
  useFrame(() => {
    for (const a of anchors) {
      const el = registry.current.get(a.id);
      if (!el) continue;
      v.copy(a.world).project(camera);
      const visible = v.z < 1 && Math.abs(v.x) < 1.05 && Math.abs(v.y) < 1.05;
      el.style.opacity = visible ? "1" : "0";
      el.style.transform = `translate(-50%, -50%) translate(${((v.x + 1) / 2) * size.width}px, ${((1 - v.y) / 2) * size.height}px)`;
    }
  });
  return null;
}

export type LabelRegistry = React.RefObject<Map<number, HTMLElement>>;

// ---------------------------------------------------------------------------------------------
// Scene
// ---------------------------------------------------------------------------------------------

export interface WorldSceneProps {
  model: WorldModel;
  nations: NationSummary[];
  uniforms: Uniforms;
  mode: WorldMode;
  intro: IntroKind;
  highlight: Map<number, number>;
  onIntroDone: () => void;
  onHover: (id: number | null, x: number, y: number) => void;
  onOpen: (id: number) => void;
  onCinematic: (e: Extract<WorldEffect, { kind: "cinematic" }> | null) => void;
  showLabels: boolean;
  labelNations: NationSummary[];
  labelRegistry: LabelRegistry;
}

export function WorldScene(props: WorldSceneProps) {
  const { model, uniforms, mode } = props;
  const spin = useRef<THREE.Group>(null);
  const inner = useRef<THREE.Group>(null);
  const { gl } = useThree();
  const downAt = useRef<{ x: number; y: number; t: number } | null>(null);

  useEffect(() => {
    uniforms.uPixelRatio.value = gl.getPixelRatio();
  }, [gl, uniforms]);

  useFrame((_, dt) => {
    uniforms.uTime.value += dt;
    if (mode === "hero" && spin.current) spin.current.rotation.y += dt * 0.045;
  });

  const pick = (e: ThreeEvent<PointerEvent | MouseEvent>): number | null => {
    if (!inner.current) return null;
    const local = inner.current.worldToLocal(e.point.clone());
    const cell = uniforms.uMorph.value > 0.5 ? cellFromPlane(local.x, local.y) : cellFromSphere(local);
    if (cell === null) return null;
    const owner = model.layout.owner[cell] ?? 0;
    return owner || null;
  };

  return (
    <>
      <color attach="background" args={["#03040a"]} />
      <fog attach="fog" args={["#03040a", 60, 260]} />
      <Stars uniforms={uniforms} />
      <group ref={spin}>
        <group ref={inner} rotation-x={-Math.PI / 2}>
          <OceanLayer uniforms={uniforms} />
          <HexLayer model={model} uniforms={uniforms} />
          <StructuresLayer model={model} uniforms={uniforms} />
          <LightsLayer model={model} uniforms={uniforms} />
          <RoutesLayer model={model} uniforms={uniforms} />
          <Particles model={model} uniforms={uniforms} />
          {mode === "map" ? (
            <mesh
              position={[0, 0, 0.05]}
              onPointerMove={(e) => {
                const id = pick(e);
                props.onHover(id, e.nativeEvent.clientX, e.nativeEvent.clientY);
              }}
              onPointerOut={() => props.onHover(null, 0, 0)}
              onPointerDown={(e) => (downAt.current = { x: e.nativeEvent.clientX, y: e.nativeEvent.clientY, t: Date.now() })}
              onClick={(e) => {
                const d = downAt.current;
                if (d && (Math.abs(d.x - e.nativeEvent.clientX) > 6 || Math.abs(d.y - e.nativeEvent.clientY) > 6)) return;
                const id = pick(e);
                if (id) props.onOpen(id);
              }}
            >
              <planeGeometry args={[PLANE_HALF_W * 2, PLANE_HALF_H * 2]} />
              <meshBasicMaterial visible={false} />
            </mesh>
          ) : (
            <Atmosphere uniforms={uniforms} />
          )}
        </group>
      </group>
      {mode === "map" && props.showLabels && <LabelProjector model={model} nations={props.labelNations} registry={props.labelRegistry} />}
      <NationFx model={model} uniforms={uniforms} highlight={props.highlight} />
      <CameraDirector
        mode={mode}
        intro={props.intro}
        uniforms={uniforms}
        spinRef={spin}
        model={model}
        onIntroDone={props.onIntroDone}
        onCinematic={props.onCinematic}
      />
    </>
  );
}
