/**
 * Deterministic Atlas world generation. Every client derives the same world:
 *  - a fixed procedural terrain (hex grid, seeded noise),
 *  - capitals placed from each nation's token address in founding order,
 *  - territories assigned by a weighted-distance rule from each nation's territory size.
 * Nothing here is market data; it only lays out real nations on the map.
 */

export const WORLD_WIDTH = 200;
export const WORLD_HEIGHT = 100;
export const WORLD_SEED = 0x41544c53; // "ATLS"
const LAND_FRACTION = 0.4;
const ICE_ROWS = 5;

export enum Terrain {
  Ocean = 0,
  Shallows = 1,
  Land = 2,
  Highland = 3,
  Ice = 4,
}

export interface WorldGrid {
  width: number;
  height: number;
  terrain: Uint8Array;
  elevation: Float32Array;
  landCells: Int32Array;
}

// ---------------------------------------------------------------------------------------------
// Noise
// ---------------------------------------------------------------------------------------------

function hash3(x: number, y: number, z: number, seed: number): number {
  let h = seed ^ Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1) ^ Math.imul(z, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const fade = (t: number) => t * t * (3 - 2 * t);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

function valueNoise3(x: number, y: number, z: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  const xf = fade(x - xi);
  const yf = fade(y - yi);
  const zf = fade(z - zi);
  const c = (dx: number, dy: number, dz: number) => hash3(xi + dx, yi + dy, zi + dz, seed);
  const x00 = lerp(c(0, 0, 0), c(1, 0, 0), xf);
  const x10 = lerp(c(0, 1, 0), c(1, 1, 0), xf);
  const x01 = lerp(c(0, 0, 1), c(1, 0, 1), xf);
  const x11 = lerp(c(0, 1, 1), c(1, 1, 1), xf);
  return lerp(lerp(x00, x10, yf), lerp(x01, x11, yf), zf);
}

function fbm(x: number, y: number, z: number, seed: number, octaves = 5): number {
  let amp = 0.5;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * valueNoise3(x * freq, y * freq, z * freq, seed + o * 1013);
    norm += amp;
    amp *= 0.5;
    freq *= 2.03;
  }
  return sum / norm;
}

// ---------------------------------------------------------------------------------------------
// Grid geometry (pointy-top hexes, odd-r offset, horizontally wrapping)
// ---------------------------------------------------------------------------------------------

export const HEX_SIZE = 1;
export const HEX_W = Math.sqrt(3) * HEX_SIZE;
export const HEX_ROW = 1.5 * HEX_SIZE;
export const MAP_WIDTH = WORLD_WIDTH * HEX_W;
export const MAP_HEIGHT = WORLD_HEIGHT * HEX_ROW;

export const cellIndex = (col: number, row: number) => row * WORLD_WIDTH + col;
export const cellCol = (i: number) => i % WORLD_WIDTH;
export const cellRow = (i: number) => Math.floor(i / WORLD_WIDTH);

/** Plane position (centered at origin, y up). */
export function cellPosition(i: number): { x: number; y: number } {
  const col = cellCol(i);
  const row = cellRow(i);
  const x = (col + 0.5 * (row & 1)) * HEX_W - MAP_WIDTH / 2 + HEX_W / 2;
  const y = MAP_HEIGHT / 2 - row * HEX_ROW - HEX_ROW / 2;
  return { x, y };
}

/** Longitude/latitude in radians for globe rendering. */
export function cellLonLat(i: number): { lon: number; lat: number } {
  const { x, y } = cellPosition(i);
  return { lon: (x / MAP_WIDTH) * Math.PI * 2, lat: (y / MAP_HEIGHT) * Math.PI * 0.92 };
}

const NEIGHBORS_EVEN = [
  [1, 0], [-1, 0], [0, -1], [-1, -1], [0, 1], [-1, 1],
] as const;
const NEIGHBORS_ODD = [
  [1, 0], [-1, 0], [1, -1], [0, -1], [1, 1], [0, 1],
] as const;

export function neighbors(i: number): number[] {
  const col = cellCol(i);
  const row = cellRow(i);
  const deltas = row & 1 ? NEIGHBORS_ODD : NEIGHBORS_EVEN;
  const out: number[] = [];
  for (const [dc, dr] of deltas) {
    const r = row + dr;
    if (r < 0 || r >= WORLD_HEIGHT) continue;
    const c = (col + dc + WORLD_WIDTH) % WORLD_WIDTH;
    out.push(cellIndex(c, r));
  }
  return out;
}

function toCube(col: number, row: number) {
  const x = col - (row - (row & 1)) / 2;
  const z = row;
  return { x, z, y: -x - z };
}

/** Hex distance on the horizontally wrapping grid. */
export function hexDistance(a: number, b: number): number {
  const ar = cellRow(a);
  const br = cellRow(b);
  const ac = toCube(cellCol(a), ar);
  let best = Infinity;
  for (const shift of [0, WORLD_WIDTH, -WORLD_WIDTH]) {
    const bc = toCube(cellCol(b) + shift, br);
    const d = Math.max(Math.abs(ac.x - bc.x), Math.abs(ac.y - bc.y), Math.abs(ac.z - bc.z));
    if (d < best) best = d;
  }
  return best;
}

// ---------------------------------------------------------------------------------------------
// Terrain
// ---------------------------------------------------------------------------------------------

let cachedGrid: WorldGrid | null = null;

export function generateWorld(seed = WORLD_SEED): WorldGrid {
  if (cachedGrid && seed === WORLD_SEED) return cachedGrid;
  const n = WORLD_WIDTH * WORLD_HEIGHT;
  const elevation = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const col = cellCol(i);
    const row = cellRow(i);
    // Sample on a cylinder so the map wraps seamlessly east-west.
    const theta = ((col + 0.5 * (row & 1)) / WORLD_WIDTH) * Math.PI * 2;
    const R = 2.2;
    const cx = Math.cos(theta) * R;
    const cz = Math.sin(theta) * R;
    const cy = (row / WORLD_HEIGHT) * 4.4;
    const warp = fbm(cx + 5.2, cy + 1.3, cz + 7.7, seed ^ 0x5bd1e995, 3);
    let e = fbm(cx + warp * 1.6, cy + warp * 1.6, cz + warp * 1.6, seed, 6);
    const lat = Math.abs(row / (WORLD_HEIGHT - 1) - 0.5) * 2; // 0 equator .. 1 pole
    e -= Math.pow(lat, 3) * 0.35;
    elevation[i] = e;
  }
  const sorted = Array.from(elevation).sort((a, b) => a - b);
  const sea = sorted[Math.floor(n * (1 - LAND_FRACTION))]!;
  const high = sorted[Math.floor(n * 0.93)]!;
  const shallow = sorted[Math.floor(n * (1 - LAND_FRACTION - 0.08))]!;
  const terrain = new Uint8Array(n);
  const land: number[] = [];
  for (let i = 0; i < n; i++) {
    const row = cellRow(i);
    const e = elevation[i]!;
    if (row < ICE_ROWS || row >= WORLD_HEIGHT - ICE_ROWS) terrain[i] = Terrain.Ice;
    else if (e >= high) terrain[i] = Terrain.Highland;
    else if (e >= sea) terrain[i] = Terrain.Land;
    else if (e >= shallow) terrain[i] = Terrain.Shallows;
    else terrain[i] = Terrain.Ocean;
    if (terrain[i] === Terrain.Land || terrain[i] === Terrain.Highland) land.push(i);
  }
  const grid = { width: WORLD_WIDTH, height: WORLD_HEIGHT, terrain, elevation, landCells: Int32Array.from(land) };
  if (seed === WORLD_SEED) cachedGrid = grid;
  return grid;
}

export const isLand = (g: WorldGrid, i: number) => g.terrain[i] === Terrain.Land || g.terrain[i] === Terrain.Highland;

// ---------------------------------------------------------------------------------------------
// Nations
// ---------------------------------------------------------------------------------------------

export interface PlacementInput {
  /** Stable id (nation id). Placement order is ascending id. */
  id: number;
  tokenAddress: string;
  territoryCells: number;
}

export interface WorldLayout {
  capitals: Map<number, number>;
  /** Owning nation id per cell, or 0 for unclaimed. */
  owner: Int32Array;
  cellCount: Map<number, number>;
}

function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Capital cell for each nation, in founding order. Stable: later nations never move earlier capitals. */
export function placeCapitals(g: WorldGrid, nations: readonly PlacementInput[]): Map<number, number> {
  const ordered = [...nations].sort((a, b) => a.id - b.id);
  const capitals = new Map<number, number>();
  const taken: number[] = [];
  const landCount = g.landCells.length;
  for (const nation of ordered) {
    let state = fnv1a(nation.tokenAddress.toLowerCase()) || 1;
    const next = () => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state;
    };
    let chosen = -1;
    for (let minDist = 7; minDist >= 0 && chosen < 0; minDist--) {
      for (let attempt = 0; attempt < 96; attempt++) {
        const cell = g.landCells[next() % landCount]!;
        if (taken.every((t) => t !== cell && hexDistance(t, cell) >= minDist)) {
          chosen = cell;
          break;
        }
      }
    }
    if (chosen < 0) chosen = g.landCells[next() % landCount]!; // world saturated; share a capital cell
    capitals.set(nation.id, chosen);
    taken.push(chosen);
  }
  return capitals;
}

/** Radius (in hex rings) whose hexagon contains at least `cells` cells: 3r² + 3r + 1 ≥ cells. */
export function radiusForCells(cells: number): number {
  return Math.max(0, Math.ceil((-3 + Math.sqrt(9 - 12 * (1 - Math.max(1, cells)))) / 6));
}

export function layoutWorld(g: WorldGrid, nations: readonly PlacementInput[]): WorldLayout {
  const capitals = placeCapitals(g, nations);
  const n = g.width * g.height;
  const owner = new Int32Array(n);
  const bestScore = new Float32Array(n).fill(Infinity);
  const visit = new Int32Array(n).fill(-1);
  const dist = new Int32Array(n);

  for (const nation of [...nations].sort((a, b) => a.id - b.id)) {
    const cap = capitals.get(nation.id)!;
    const radius = Math.max(1, radiusForCells(nation.territoryCells));
    const weight = radius + 0.5;
    const queue = [cap];
    visit[cap] = nation.id;
    dist[cap] = 0;
    for (let qi = 0; qi < queue.length; qi++) {
      const c = queue[qi]!;
      const d = dist[c]!;
      const score = d / weight;
      if (score < bestScore[c]!) {
        bestScore[c] = score;
        owner[c] = nation.id;
      }
      if (d >= radius) continue;
      for (const nb of neighbors(c)) {
        if (visit[nb] === nation.id || !isLand(g, nb)) continue;
        visit[nb] = nation.id;
        dist[nb] = d + 1;
        queue.push(nb);
      }
    }
  }
  // Capitals always belong to their nation.
  for (const [id, cap] of capitals) owner[cap] = id;
  const cellCount = new Map<number, number>();
  for (let i = 0; i < n; i++) {
    const o = owner[i]!;
    if (o) cellCount.set(o, (cellCount.get(o) ?? 0) + 1);
  }
  return { capitals, owner, cellCount };
}

/** True if a claimed cell touches a cell with a different owner (used to draw borders). */
export function isBorderCell(layout: WorldLayout, i: number): boolean {
  const o = layout.owner[i]!;
  if (!o) return false;
  return neighbors(i).some((nb) => layout.owner[nb] !== o);
}
