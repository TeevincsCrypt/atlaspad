"use client";
import { useMemo } from "react";
import { useWorld } from "./api";

/** The on-chain nations of the world (`all` and `real` are the same list). */
export function useWorldNations() {
  const world = useWorld();
  const real = useMemo(() => world.data?.nations ?? [], [world.data]);
  return { world, real, all: real };
}
