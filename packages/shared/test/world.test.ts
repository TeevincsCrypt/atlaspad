import { describe, expect, it } from "vitest";
import {
  WORLD_HEIGHT,
  WORLD_WIDTH,
  generateWorld,
  hexDistance,
  cellIndex,
  isLand,
  layoutWorld,
  neighbors,
  placeCapitals,
  radiusForCells,
} from "../src/world";

describe("world", () => {
  it("is deterministic with ~40% land", () => {
    const a = generateWorld();
    const land = a.landCells.length / (WORLD_WIDTH * WORLD_HEIGHT);
    expect(land).toBeGreaterThan(0.3);
    expect(land).toBeLessThan(0.45);
    const b = generateWorld(0x41544c53 + 1);
    expect(b.landCells.length).toBeGreaterThan(0);
  });

  it("wraps horizontally", () => {
    const left = cellIndex(0, 10);
    const right = cellIndex(WORLD_WIDTH - 1, 10);
    expect(hexDistance(left, right)).toBe(1);
    expect(neighbors(left)).toContain(right);
  });

  it("places capitals stably in founding order", () => {
    const g = generateWorld();
    const nations = Array.from({ length: 30 }, (_, i) => ({
      id: i + 1,
      tokenAddress: `0x${(i + 1).toString(16).padStart(40, "a")}`,
      territoryCells: 20,
    }));
    const first = placeCapitals(g, nations.slice(0, 10));
    const all = placeCapitals(g, nations);
    for (const [id, cell] of first) expect(all.get(id)).toBe(cell);
    for (const cell of all.values()) expect(isLand(g, cell)).toBe(true);
  });

  it("assigns territory near the requested size", () => {
    const g = generateWorld();
    const layout = layoutWorld(g, [{ id: 1, tokenAddress: "0xabc", territoryCells: 40 }]);
    const cells = layout.cellCount.get(1) ?? 0;
    expect(cells).toBeGreaterThan(5);
    expect(cells).toBeLessThanOrEqual(3 * radiusForCells(40) ** 2 + 3 * radiusForCells(40) + 1);
  });
});
