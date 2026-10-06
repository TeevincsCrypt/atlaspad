/**
 * Fire-and-forget visual effect bus. Realtime data (trades, events) is translated into effects here so the
 * world renderer can react without re-rendering React trees.
 */
export type WorldEffect =
  | { kind: "trade"; nationId: number; side: "buy" | "sell"; magnitude: number }
  | { kind: "cinematic"; type: "GOLDEN_AGE" | "ECONOMIC_CRISIS" | "WAR_DECLARED" | "WAR_ENDED" | "FOUNDED" | "GRADUATED"; nationId: number; targetId?: number | null; title: string; body: string }
  | { kind: "burst"; type: "GOLDEN_AGE" | "ECONOMIC_CRISIS" | "WAR_DECLARED" | "WAR_ENDED" | "FOUNDED" | "GRADUATED"; nationId: number; targetId?: number | null }
  | { kind: "focus"; nationId: number }
  | { kind: "founding-preview"; color: string };

type Listener = (e: WorldEffect) => void;
const listeners = new Set<Listener>();

export const effects = {
  emit(e: WorldEffect) {
    for (const l of listeners) l(e);
  },
  on(l: Listener) {
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  },
};
