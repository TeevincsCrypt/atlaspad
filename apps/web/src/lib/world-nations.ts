"use client";
import { useMemo } from "react";
import type { NationSummary } from "@atlaspad/shared";
import { useWorld } from "./api";
import { DEMO_ENABLED, DEMO_NATIONS } from "./demo-nations";
import { useUi } from "./store";

/** On-chain nations plus, when switched on, the labelled demo nations. World totals must use `real` only. */
export function useWorldNations() {
  const world = useWorld();
  const showDemo = useUi((s) => s.showDemo);
  const real = useMemo(() => world.data?.nations ?? [], [world.data]);
  const demo = useMemo<NationSummary[]>(() => (DEMO_ENABLED && showDemo ? DEMO_NATIONS : []), [showDemo]);
  const all = useMemo(() => [...real, ...demo], [real, demo]);
  return { world, real, demo, all };
}
