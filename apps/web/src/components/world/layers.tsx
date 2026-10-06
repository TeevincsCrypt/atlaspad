"use client";
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { WORLD_HEIGHT, WORLD_WIDTH } from "@atlaspad/shared/world";
import {
  ATMOSPHERE_FRAGMENT,
  ATMOSPHERE_VERTEX,
  HEX_FRAGMENT,
  HEX_VERTEX,
  LIGHTS_FRAGMENT,
  LIGHTS_VERTEX,
  MORPH_CHUNK,
  ROUTE_FRAGMENT,
  ROUTE_VERTEX,
  STARS_FRAGMENT,
  STARS_VERTEX,
  STRUCTURE_FRAGMENT,
  STRUCTURE_VERTEX,
} from "./shaders";
import { HEX_RADIUS, PLANE_HALF_H, PLANE_HALF_W, RADIUS, staticCellAttributes, type Uniforms, type WorldModel } from "./model";

const CELLS = WORLD_WIDTH * WORLD_HEIGHT;

function attr(geo: THREE.BufferGeometry, name: string, array: Float32Array, size: number, instanced: boolean) {
  const a = instanced ? new THREE.InstancedBufferAttribute(array, size) : new THREE.BufferAttribute(array, size);
  geo.setAttribute(name, a);
}

export function HexLayer({ model, uniforms }: { model: WorldModel; uniforms: Uniforms }) {
  const geometry = useMemo(() => {
    const base = new THREE.CircleGeometry(HEX_RADIUS, 6, Math.PI / 6);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = base.index;
    geo.setAttribute("position", base.getAttribute("position"));
    geo.instanceCount = CELLS;
    const { plane, lonLat } = staticCellAttributes();
    attr(geo, "aPlane", plane, 2, true);
    attr(geo, "aLonLat", lonLat, 2, true);
    attr(geo, "aColor", new Float32Array(CELLS * 3), 3, true);
    attr(geo, "aLift", new Float32Array(CELLS), 1, true);
    attr(geo, "aGlow", new Float32Array(CELLS), 1, true);
    attr(geo, "aRevealAt", new Float32Array(CELLS), 1, true);
    attr(geo, "aNationIdx", new Float32Array(CELLS), 1, true);
    attr(geo, "aBorder", new Float32Array(CELLS), 1, true);
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 100);
    return geo;
  }, []);

  useEffect(() => {
    const set = (name: string, data: Float32Array) => {
      const a = geometry.getAttribute(name) as THREE.InstancedBufferAttribute;
      (a.array as Float32Array).set(data);
      a.needsUpdate = true;
    };
    set("aColor", model.hex.color);
    set("aLift", model.hex.lift);
    set("aGlow", model.hex.glow);
    set("aRevealAt", model.hex.revealAt);
    set("aNationIdx", model.hex.nationIdx);
    set("aBorder", model.hex.border);
  }, [geometry, model]);

  const material = useMemo(
    () => new THREE.ShaderMaterial({ uniforms, vertexShader: HEX_VERTEX, fragmentShader: HEX_FRAGMENT, side: THREE.DoubleSide }),
    [uniforms],
  );
  return <mesh geometry={geometry} material={material} frustumCulled={false} />;
}

/** Continuous ocean surface under the hex cells (also morphs globe ↔ map). */
export function OceanLayer({ uniforms }: { uniforms: Uniforms }) {
  const { geometry, material } = useMemo(() => {
    const geo = new THREE.PlaneGeometry(1, 1, 128, 64);
    const mat = new THREE.ShaderMaterial({
      uniforms,
      vertexShader: /* glsl */ `
        ${MORPH_CHUNK}
        varying float vLat;
        void main() {
          vec2 plane = vec2((uv.x - 0.5) * ${(PLANE_HALF_W * 2).toFixed(4)}, (uv.y - 0.5) * ${(PLANE_HALF_H * 2).toFixed(4)});
          vec2 lonLat = vec2((uv.x - 0.5) * 6.2831853, (uv.y - 0.5) * 3.14159265 * 0.92);
          vec3 C, T, B, N;
          surfaceFrame(plane, lonLat, C, T, B, N);
          vLat = lonLat.y;
          gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(C - N * 0.01, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        varying float vLat;
        void main() {
          vec3 c = mix(vec3(0.018, 0.03, 0.06), vec3(0.03, 0.045, 0.08), abs(vLat));
          gl_FragColor = vec4(c, 1.0);
        }`,
      side: THREE.DoubleSide,
    });
    return { geometry: geo, material: mat };
  }, [uniforms]);
  return <mesh geometry={geometry} material={material} frustumCulled={false} />;
}

export function LightsLayer({ model, uniforms }: { model: WorldModel; uniforms: Uniforms }) {
  const geometry = useMemo(() => {
    const l = model.lights;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(l.count * 3), 3));
    attr(geo, "aPlane", l.plane, 2, false);
    attr(geo, "aLonLat", l.lonLat, 2, false);
    attr(geo, "aOffset", l.offset, 2, false);
    attr(geo, "aSize", l.size, 1, false);
    attr(geo, "aPhase", l.phase, 1, false);
    attr(geo, "aRevealAt", l.revealAt, 1, false);
    attr(geo, "aNationIdx", l.nationIdx, 1, false);
    attr(geo, "aColor", l.color, 3, false);
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 100);
    return geo;
  }, [model]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms,
        vertexShader: LIGHTS_VERTEX,
        fragmentShader: LIGHTS_FRAGMENT,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    [uniforms],
  );
  return <points geometry={geometry} material={material} frustumCulled={false} />;
}

export function StructuresLayer({ model, uniforms }: { model: WorldModel; uniforms: Uniforms }) {
  const geometry = useMemo(() => {
    const s = model.structures;
    const base = new THREE.BoxGeometry(1, 1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = base.index;
    geo.setAttribute("position", base.getAttribute("position"));
    geo.setAttribute("normal", base.getAttribute("normal"));
    geo.instanceCount = s.count;
    attr(geo, "aPlane", s.plane, 2, true);
    attr(geo, "aLonLat", s.lonLat, 2, true);
    attr(geo, "aOffset", s.offset, 2, true);
    attr(geo, "aSize", s.size, 3, true);
    attr(geo, "aColor", s.color, 3, true);
    attr(geo, "aRevealAt", s.revealAt, 1, true);
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 100);
    return geo;
  }, [model]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  const material = useMemo(
    () => new THREE.ShaderMaterial({ uniforms, vertexShader: STRUCTURE_VERTEX, fragmentShader: STRUCTURE_FRAGMENT }),
    [uniforms],
  );
  if (!model.structures.count) return null;
  return <mesh geometry={geometry} material={material} frustumCulled={false} />;
}

export function RoutesLayer({ model, uniforms }: { model: WorldModel; uniforms: Uniforms }) {
  const geometry = useMemo(() => {
    const r = model.routes;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(r.count * 3), 3));
    attr(geo, "aPlaneA", r.planeA, 2, false);
    attr(geo, "aPlaneB", r.planeB, 2, false);
    attr(geo, "aLonLatA", r.lonLatA, 2, false);
    attr(geo, "aLonLatB", r.lonLatB, 2, false);
    attr(geo, "aT", r.t, 1, false);
    attr(geo, "aColor", r.color, 3, false);
    attr(geo, "aKind", r.kind, 1, false);
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 100);
    return geo;
  }, [model]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: { ...uniforms, uOpacity: uniforms.uRouteOpacity },
        vertexShader: ROUTE_VERTEX,
        fragmentShader: ROUTE_FRAGMENT,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    [uniforms],
  );
  if (!model.routes.count) return null;
  return <lineSegments geometry={geometry} material={material} frustumCulled={false} />;
}

export function Atmosphere({ uniforms }: { uniforms: Uniforms }) {
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: { uOpacity: uniforms.uAtmosphere },
        vertexShader: ATMOSPHERE_VERTEX,
        fragmentShader: ATMOSPHERE_FRAGMENT,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.FrontSide,
      }),
    [uniforms],
  );
  return (
    <mesh material={material} scale={RADIUS * 1.08}>
      <sphereGeometry args={[1, 64, 64]} />
    </mesh>
  );
}

export function Stars({ count = 2600, uniforms }: { count?: number; uniforms: Uniforms }) {
  const geometry = useMemo(() => {
    const pos = new Float32Array(count * 3);
    const size = new Float32Array(count);
    const phase = new Float32Array(count);
    let s = 12345;
    const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
    for (let i = 0; i < count; i++) {
      const u = rnd() * 2 - 1;
      const th = rnd() * Math.PI * 2;
      const r = 160 + rnd() * 120;
      const q = Math.sqrt(1 - u * u);
      pos.set([r * q * Math.cos(th), r * u, r * q * Math.sin(th)], i * 3);
      size[i] = 0.6 + Math.pow(rnd(), 3) * 2.4;
      phase[i] = rnd();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("aSize", new THREE.BufferAttribute(size, 1));
    geo.setAttribute("aPhase", new THREE.BufferAttribute(phase, 1));
    return geo;
  }, [count]);
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: { uTime: uniforms.uTime, uPixelRatio: uniforms.uPixelRatio },
        vertexShader: STARS_VERTEX,
        fragmentShader: STARS_FRAGMENT,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    [uniforms],
  );
  return <points geometry={geometry} material={material} frustumCulled={false} />;
}
