import * as THREE from "three";
import {
  MAP_HEIGHT,
  MAP_WIDTH,
  HEX_ROW,
  HEX_W,
  HEX_SIZE,
  Terrain,
  WORLD_HEIGHT,
  WORLD_WIDTH,
  cellCol,
  cellIndex,
  cellLonLat,
  cellPosition,
  cellRow,
  generateWorld,
  isBorderCell,
  layoutWorld,
  neighbors,
  type WorldGrid,
  type WorldLayout,
} from "@atlaspad/shared/world";
import { decodeEmblem, type AllianceSummary, type NationSummary, type WarSummary } from "@atlaspad/shared";

export const WORLD_SCALE = 0.1;
export const RADIUS = (MAP_WIDTH * WORLD_SCALE) / (Math.PI * 2);
export const HEX_RADIUS = HEX_SIZE * WORLD_SCALE;
export const PLANE_HALF_W = (MAP_WIDTH * WORLD_SCALE) / 2;
export const PLANE_HALF_H = (MAP_HEIGHT * WORLD_SCALE) / 2;
const CELLS = WORLD_WIDTH * WORLD_HEIGHT;

export interface Uniforms {
  [key: string]: THREE.IUniform;
  uMorph: THREE.IUniform<number>;
  uRadius: THREE.IUniform<number>;
  uTime: THREE.IUniform<number>;
  uReveal: THREE.IUniform<number>;
  uNationTex: THREE.IUniform<THREE.DataTexture>;
  uNationTexSize: THREE.IUniform<number>;
  uHexRadius: THREE.IUniform<number>;
  uPixelRatio: THREE.IUniform<number>;
  uRouteOpacity: THREE.IUniform<number>;
  uAtmosphere: THREE.IUniform<number>;
}

export const NATION_TEX_SIZE = 4096;

export function createUniforms(): Uniforms {
  const data = new Float32Array(NATION_TEX_SIZE * 4);
  const tex = new THREE.DataTexture(data, NATION_TEX_SIZE, 1, THREE.RGBAFormat, THREE.FloatType);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  return {
    uMorph: { value: 0 },
    uRadius: { value: RADIUS },
    uTime: { value: 0 },
    uReveal: { value: 1 },
    uNationTex: { value: tex },
    uNationTexSize: { value: NATION_TEX_SIZE },
    uHexRadius: { value: HEX_RADIUS },
    uPixelRatio: { value: 1 },
    uRouteOpacity: { value: 1 },
    uAtmosphere: { value: 1 },
  };
}

// ---------------------------------------------------------------------------------------------
// Coordinates (mirrors shaders.ts MORPH_CHUNK; group space, before the -90° X rotation)
// ---------------------------------------------------------------------------------------------

export function planeOf(cell: number): [number, number] {
  const p = cellPosition(cell);
  return [p.x * WORLD_SCALE, p.y * WORLD_SCALE];
}

export function lonLatOf(cell: number): [number, number] {
  const l = cellLonLat(cell);
  return [l.lon, l.lat];
}

export function surfacePoint(cell: number, morph: number, lift = 0, out = new THREE.Vector3()): THREE.Vector3 {
  const [px, py] = planeOf(cell);
  const [lon, lat] = lonLatOf(cell);
  const sN = new THREE.Vector3(Math.cos(lat) * Math.sin(lon), -Math.cos(lat) * Math.cos(lon), Math.sin(lat));
  const pC = new THREE.Vector3(px, py, 0);
  const sC = sN.clone().multiplyScalar(RADIUS);
  const N = sN.clone().lerp(new THREE.Vector3(0, 0, 1), morph).normalize();
  return out.copy(sC.lerp(pC, morph)).addScaledVector(N, lift);
}

/** Group-space (pre-rotation) point → nearest cell index, for map mode (plane z=0). */
export function cellFromPlane(x: number, y: number): number | null {
  const mx = x / WORLD_SCALE;
  const my = y / WORLD_SCALE;
  const rowF = (MAP_HEIGHT / 2 - HEX_ROW / 2 - my) / HEX_ROW;
  const r0 = Math.round(rowF);
  let best: number | null = null;
  let bestD = Infinity;
  for (let r = r0 - 1; r <= r0 + 1; r++) {
    if (r < 0 || r >= WORLD_HEIGHT) continue;
    const colF = (mx + MAP_WIDTH / 2 - HEX_W / 2) / HEX_W - 0.5 * (r & 1);
    const c0 = Math.round(colF);
    for (let c = c0 - 1; c <= c0 + 1; c++) {
      if (c < 0 || c >= WORLD_WIDTH) continue;
      const i = cellIndex(c, r);
      const p = cellPosition(i);
      const d = (p.x - mx) ** 2 + (p.y - my) ** 2;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
  }
  return bestD <= HEX_SIZE * HEX_SIZE * 1.2 ? best : null;
}

/** Group-space point on the globe → cell. */
export function cellFromSphere(p: THREE.Vector3): number | null {
  const n = p.clone().normalize();
  const lat = Math.asin(THREE.MathUtils.clamp(n.z, -1, 1));
  const lon = Math.atan2(n.x, -n.y);
  const x = (lon / (Math.PI * 2)) * MAP_WIDTH;
  const y = (lat / (Math.PI * 0.92)) * MAP_HEIGHT;
  return cellFromPlane(x * WORLD_SCALE, y * WORLD_SCALE);
}

// ---------------------------------------------------------------------------------------------
// Colors
// ---------------------------------------------------------------------------------------------

const TERRAIN_COLORS: Record<Terrain, THREE.Color> = {
  [Terrain.Ocean]: new THREE.Color("#060a14"),
  [Terrain.Shallows]: new THREE.Color("#0a1222"),
  [Terrain.Land]: new THREE.Color("#161c28"),
  [Terrain.Highland]: new THREE.Color("#1e2533"),
  [Terrain.Ice]: new THREE.Color("#1a2232"),
};
const TERRAIN_LIFT: Record<Terrain, number> = {
  [Terrain.Ocean]: 0,
  [Terrain.Shallows]: 0.004,
  [Terrain.Land]: 0.014,
  [Terrain.Highland]: 0.024,
  [Terrain.Ice]: 0.01,
};

/** National color tuned to stay legible on the dark world. */
export function nationThreeColor(emblem: string): THREE.Color {
  const c = new THREE.Color(decodeEmblem(emblem).primary);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  c.setHSL(hsl.h, Math.min(0.85, Math.max(0.35, hsl.s)), Math.min(0.62, Math.max(0.42, hsl.l)));
  return c;
}

function hash(a: number, b: number): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be5ab, 0xc2b2ae35);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  return (h >>> 0) / 4294967296;
}

// ---------------------------------------------------------------------------------------------
// Static per-cell attributes
// ---------------------------------------------------------------------------------------------

let staticAttrs: { plane: Float32Array; lonLat: Float32Array } | null = null;
export function staticCellAttributes() {
  if (staticAttrs) return staticAttrs;
  const plane = new Float32Array(CELLS * 2);
  const lonLat = new Float32Array(CELLS * 2);
  for (let i = 0; i < CELLS; i++) {
    const [x, y] = planeOf(i);
    const [lon, lat] = lonLatOf(i);
    plane[i * 2] = x;
    plane[i * 2 + 1] = y;
    lonLat[i * 2] = lon;
    lonLat[i * 2 + 1] = lat;
  }
  staticAttrs = { plane, lonLat };
  return staticAttrs;
}

export interface WorldModel {
  grid: WorldGrid;
  layout: WorldLayout;
  /** nation id → texture index (1-based) */
  indexOf: Map<number, number>;
  nations: Map<number, NationSummary>;
  cellsOf: Map<number, number[]>;
  hex: { color: Float32Array; lift: Float32Array; glow: Float32Array; revealAt: Float32Array; nationIdx: Float32Array; border: Float32Array };
  lights: LightAttrs;
  structures: StructureAttrs;
  routes: RouteAttrs;
}

export interface LightAttrs {
  count: number;
  plane: Float32Array;
  lonLat: Float32Array;
  offset: Float32Array;
  size: Float32Array;
  phase: Float32Array;
  revealAt: Float32Array;
  nationIdx: Float32Array;
  color: Float32Array;
}

export interface StructureAttrs {
  count: number;
  plane: Float32Array;
  lonLat: Float32Array;
  offset: Float32Array;
  size: Float32Array;
  color: Float32Array;
  revealAt: Float32Array;
}

export interface RouteAttrs {
  count: number;
  planeA: Float32Array;
  planeB: Float32Array;
  lonLatA: Float32Array;
  lonLatB: Float32Array;
  t: Float32Array;
  color: Float32Array;
  kind: Float32Array;
}

const ROUTE_SEGMENTS = 48;

export function buildWorldModel(nations: NationSummary[], wars: WarSummary[], alliances: AllianceSummary[]): WorldModel {
  const grid = generateWorld();
  const sorted = [...nations].sort((a, b) => a.id - b.id);
  const layout = layoutWorld(
    grid,
    sorted.map((n) => ({ id: n.id, tokenAddress: n.token, territoryCells: n.territoryCells })),
  );
  const indexOf = new Map<number, number>();
  sorted.forEach((n, i) => indexOf.set(n.id, Math.min(i + 1, NATION_TEX_SIZE - 1)));
  const byId = new Map(sorted.map((n) => [n.id, n]));
  const byRank = [...sorted].sort((a, b) => (a.rank ?? 1e9) - (b.rank ?? 1e9) || b.civilizationScore - a.civilizationScore);
  const revealOf = new Map<number, number>();
  byRank.forEach((n, i) => revealOf.set(n.id, 0.08 + 0.82 * (byRank.length > 1 ? i / (byRank.length - 1) : 0)));
  const colorOf = new Map(sorted.map((n) => [n.id, nationThreeColor(n.emblem)]));

  const color = new Float32Array(CELLS * 3);
  const lift = new Float32Array(CELLS);
  const glow = new Float32Array(CELLS);
  const revealAt = new Float32Array(CELLS);
  const nationIdx = new Float32Array(CELLS);
  const border = new Float32Array(CELLS);
  const cellsOf = new Map<number, number[]>();
  const capitalCells = new Set(layout.capitals.values());

  for (let i = 0; i < CELLS; i++) {
    const owner = layout.owner[i]!;
    if (owner) {
      const n = byId.get(owner)!;
      const c = colorOf.get(owner)!;
      color.set([c.r, c.g, c.b], i * 3);
      lift[i] = 0.03 + n.tier * 0.012 + (capitalCells.has(i) ? 0.03 : 0);
      glow[i] = 0.08 + n.tier * 0.04 + (capitalCells.has(i) ? 0.55 : 0);
      revealAt[i] = revealOf.get(owner) ?? 0.5;
      nationIdx[i] = indexOf.get(owner) ?? 0;
      border[i] = isBorderCell(layout, i) ? 1 : 0;
      const list = cellsOf.get(owner) ?? [];
      list.push(i);
      cellsOf.set(owner, list);
    } else {
      const t = grid.terrain[i] as Terrain;
      const c = TERRAIN_COLORS[t];
      // subtle elevation shading so continents read without any nations
      const shade = t === Terrain.Land || t === Terrain.Highland ? 0.9 + (grid.elevation[i]! - 0.5) * 0.6 : 1;
      color.set([c.r * shade, c.g * shade, c.b * shade], i * 3);
      lift[i] = TERRAIN_LIFT[t];
    }
  }

  // City lights — density grows with tier, citizens and completed buildings.
  const lightList: { cell: number; nation: number; ox: number; oy: number; size: number; phase: number; color: THREE.Color }[] = [];
  const structList: { cell: number; nation: number; ox: number; oy: number; sx: number; sy: number; sz: number; color: THREE.Color }[] = [];
  const warm = new THREE.Color("#ffd9a0");
  const cool = new THREE.Color("#bcd6ff");
  for (const n of sorted) {
    const cells = cellsOf.get(n.id) ?? [];
    const capital = layout.capitals.get(n.id);
    if (capital === undefined || !cells.length) continue;
    const count = Math.min(cells.length * 3, Math.round(2 + n.tier * 4 + Math.log2(1 + n.citizens) * 1.6 + n.buildings.length * 1.5));
    const nc = colorOf.get(n.id)!;
    lightList.push({ cell: capital, nation: n.id, ox: 0, oy: 0, size: 5 + n.tier * 1.2, phase: hash(n.id, 0), color: new THREE.Color("#ffe7b0") });
    for (let k = 0; k < count; k++) {
      const r = hash(n.id, k + 1);
      const nearCapital = r < 0.35;
      const cell = nearCapital ? capital : cells[Math.floor(hash(n.id, k + 1000) * cells.length)]!;
      const ang = hash(n.id, k + 2000) * Math.PI * 2;
      const rad = Math.sqrt(hash(n.id, k + 3000)) * HEX_RADIUS * 0.7;
      lightList.push({
        cell,
        nation: n.id,
        ox: Math.cos(ang) * rad,
        oy: Math.sin(ang) * rad,
        size: 1.6 + hash(n.id, k + 4000) * 1.6 + n.tier * 0.25,
        phase: hash(n.id, k + 5000),
        color: hash(n.id, k + 6000) < 0.75 ? warm.clone().lerp(nc, 0.25) : cool,
      });
    }
    // Capital skyline: more and taller structures as the nation develops.
    const towers = Math.min(18, 1 + n.tier * 2 + n.buildings.length);
    const capitalArea = [capital, ...neighbors(capital).filter((c) => layout.owner[c] === n.id)];
    for (let k = 0; k < towers; k++) {
      const cell = capitalArea[k % capitalArea.length]!;
      const ang = hash(n.id, k + 7000) * Math.PI * 2;
      const rad = hash(n.id, k + 8000) * HEX_RADIUS * 0.55;
      const tall = k === 0 ? 1.6 : 1;
      const spaceport = n.buildings.includes(7) && k === 1;
      structList.push({
        cell,
        nation: n.id,
        ox: Math.cos(ang) * rad,
        oy: Math.sin(ang) * rad,
        sx: spaceport ? 0.025 : 0.035 + hash(n.id, k + 9000) * 0.035,
        sy: spaceport ? 0.025 : 0.035 + hash(n.id, k + 9500) * 0.035,
        sz: spaceport ? 0.55 + n.tier * 0.05 : (0.05 + n.tier * 0.045 + hash(n.id, k + 9900) * 0.08) * tall,
        color: new THREE.Color("#2a3245").lerp(nc, 0.35),
      });
    }
  }

  const { plane, lonLat } = staticCellAttributes();
  const L = lightList.length;
  const lights: LightAttrs = {
    count: L,
    plane: new Float32Array(L * 2),
    lonLat: new Float32Array(L * 2),
    offset: new Float32Array(L * 2),
    size: new Float32Array(L),
    phase: new Float32Array(L),
    revealAt: new Float32Array(L),
    nationIdx: new Float32Array(L),
    color: new Float32Array(L * 3),
  };
  lightList.forEach((l, i) => {
    lights.plane.set([plane[l.cell * 2]!, plane[l.cell * 2 + 1]!], i * 2);
    lights.lonLat.set([lonLat[l.cell * 2]!, lonLat[l.cell * 2 + 1]!], i * 2);
    lights.offset.set([l.ox, l.oy], i * 2);
    lights.size[i] = l.size;
    lights.phase[i] = l.phase;
    lights.revealAt[i] = (revealOf.get(l.nation) ?? 0.5) + 0.02;
    lights.nationIdx[i] = indexOf.get(l.nation) ?? 0;
    lights.color.set([l.color.r, l.color.g, l.color.b], i * 3);
  });

  const S = structList.length;
  const structures: StructureAttrs = {
    count: S,
    plane: new Float32Array(S * 2),
    lonLat: new Float32Array(S * 2),
    offset: new Float32Array(S * 2),
    size: new Float32Array(S * 3),
    color: new Float32Array(S * 3),
    revealAt: new Float32Array(S),
  };
  structList.forEach((s, i) => {
    structures.plane.set([plane[s.cell * 2]!, plane[s.cell * 2 + 1]!], i * 2);
    structures.lonLat.set([lonLat[s.cell * 2]!, lonLat[s.cell * 2 + 1]!], i * 2);
    structures.offset.set([s.ox, s.oy], i * 2);
    structures.size.set([s.sx, s.sy, s.sz], i * 3);
    structures.color.set([s.color.r, s.color.g, s.color.b], i * 3);
    structures.revealAt[i] = (revealOf.get(s.nation) ?? 0.5) + 0.03;
  });

  // Routes: alliance links (gold) and active wars (red).
  const pairs: { a: number; b: number; color: THREE.Color; kind: number }[] = [];
  const gold = new THREE.Color("#e8c47a");
  const red = new THREE.Color("#ff3b4e");
  for (const al of alliances) {
    if (!al.active) continue;
    for (const m of al.memberIds) if (m !== al.leaderId) pairs.push({ a: al.leaderId, b: m, color: gold, kind: 0 });
  }
  for (const w of wars) if (w.status === "active") pairs.push({ a: w.attackerId, b: w.defenderId, color: red, kind: 1 });
  const validPairs = pairs.filter((p) => layout.capitals.has(p.a) && layout.capitals.has(p.b));
  const V = validPairs.length * ROUTE_SEGMENTS * 2;
  const routes: RouteAttrs = {
    count: V,
    planeA: new Float32Array(V * 2),
    planeB: new Float32Array(V * 2),
    lonLatA: new Float32Array(V * 2),
    lonLatB: new Float32Array(V * 2),
    t: new Float32Array(V),
    color: new Float32Array(V * 3),
    kind: new Float32Array(V),
  };
  let v = 0;
  for (const p of validPairs) {
    const ca = layout.capitals.get(p.a)!;
    const cb = layout.capitals.get(p.b)!;
    for (let s = 0; s < ROUTE_SEGMENTS; s++) {
      for (const t of [s / ROUTE_SEGMENTS, (s + 1) / ROUTE_SEGMENTS]) {
        routes.planeA.set([plane[ca * 2]!, plane[ca * 2 + 1]!], v * 2);
        routes.planeB.set([plane[cb * 2]!, plane[cb * 2 + 1]!], v * 2);
        routes.lonLatA.set([lonLat[ca * 2]!, lonLat[ca * 2 + 1]!], v * 2);
        routes.lonLatB.set([lonLat[cb * 2]!, lonLat[cb * 2 + 1]!], v * 2);
        routes.t[v] = t;
        routes.color.set([p.color.r, p.color.g, p.color.b], v * 3);
        routes.kind[v] = p.kind;
        v++;
      }
    }
  }

  return {
    grid,
    layout,
    indexOf,
    nations: byId,
    cellsOf,
    hex: { color, lift, glow, revealAt, nationIdx, border },
    lights,
    structures,
    routes,
  };
}

export const STATUS_CODE: Record<string, number> = {
  GOLDEN_AGE: 1,
  ECONOMIC_CRISIS: 2,
  NATIONAL_EMERGENCY: 2,
  ECONOMIC_BOOM: 3,
  TRADE_FESTIVAL: 3,
  MARKET_CRASH: 4,
};

/** Highest-priority status of a nation for rendering. */
export function statusCode(n: NationSummary, now = Date.now() / 1000): number {
  let best = 0;
  for (const s of n.statuses) {
    if (s.until <= now) continue;
    const c = STATUS_CODE[s.type] ?? 0;
    if (c && (best === 0 || c < best)) best = c;
  }
  return best;
}

export { cellCol, cellRow };
