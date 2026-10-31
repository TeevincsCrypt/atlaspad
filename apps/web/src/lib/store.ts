"use client";
import { create } from "zustand";
import { persist } from "zustand/middleware";

export type MapFilterKey = "all" | "marketCap" | "population" | "activity" | "age" | "growth" | "wars" | "events";

interface UiState {
  soundOn: boolean;
  setSoundOn: (on: boolean) => void;
  introSeen: boolean;
  setIntroSeen: (seen: boolean) => void;
  walletModalOpen: boolean;
  setWalletModalOpen: (open: boolean) => void;
  searchOpen: boolean;
  setSearchOpen: (open: boolean) => void;
  hoveredNation: number | null;
  setHoveredNation: (id: number | null) => void;
  selectedNation: number | null;
  setSelectedNation: (id: number | null) => void;
  mapFilter: MapFilterKey;
  setMapFilter: (f: MapFilterKey) => void;
  mapQuery: string;
  setMapQuery: (q: string) => void;
  realtime: "connecting" | "live" | "offline" | "disabled";
  setRealtime: (s: UiState["realtime"]) => void;
  lastHeartbeatBlock: number | null;
  setLastHeartbeatBlock: (b: number | null) => void;
  seenAchievements: string[];
  markAchievementsSeen: (codes: string[]) => void;
  cinematicsOn: boolean;
  setCinematicsOn: (on: boolean) => void;
  hoverPos: { x: number; y: number };
  setHover: (id: number | null, x: number, y: number) => void;
  activeCinematic: { type: string; nationId: number; targetId?: number | null; title: string; body: string } | null;
  setActiveCinematic: (c: UiState["activeCinematic"]) => void;
  introPlaying: boolean;
  setIntroPlaying: (p: boolean) => void;
  /** Show the clearly-labelled demo nations on the world map and list. */
  showDemo: boolean;
  setShowDemo: (on: boolean) => void;
  /** Nations the visitor starred (stored in this browser only). */
  watchlist: number[];
  toggleWatch: (id: number) => void;
}

export const useUi = create<UiState>()(
  persist(
    (set) => ({
      soundOn: false,
      setSoundOn: (soundOn) => set({ soundOn }),
      introSeen: false,
      setIntroSeen: (introSeen) => set({ introSeen }),
      walletModalOpen: false,
      setWalletModalOpen: (walletModalOpen) => set({ walletModalOpen }),
      searchOpen: false,
      setSearchOpen: (searchOpen) => set({ searchOpen }),
      hoveredNation: null,
      setHoveredNation: (hoveredNation) => set({ hoveredNation }),
      selectedNation: null,
      setSelectedNation: (selectedNation) => set({ selectedNation }),
      mapFilter: "all",
      setMapFilter: (mapFilter) => set({ mapFilter }),
      mapQuery: "",
      setMapQuery: (mapQuery) => set({ mapQuery }),
      realtime: "connecting",
      setRealtime: (realtime) => set({ realtime }),
      lastHeartbeatBlock: null,
      setLastHeartbeatBlock: (lastHeartbeatBlock) => set({ lastHeartbeatBlock }),
      seenAchievements: [],
      markAchievementsSeen: (codes) => set((s) => ({ seenAchievements: [...new Set([...s.seenAchievements, ...codes])] })),
      cinematicsOn: true,
      setCinematicsOn: (cinematicsOn) => set({ cinematicsOn }),
      hoverPos: { x: 0, y: 0 },
      setHover: (hoveredNation, x, y) => set({ hoveredNation, hoverPos: { x, y } }),
      activeCinematic: null,
      setActiveCinematic: (activeCinematic) => set({ activeCinematic }),
      introPlaying: false,
      setIntroPlaying: (introPlaying) => set({ introPlaying }),
      showDemo: true,
      setShowDemo: (showDemo) => set({ showDemo }),
      watchlist: [],
      toggleWatch: (id) => set((s) => ({ watchlist: s.watchlist.includes(id) ? s.watchlist.filter((x) => x !== id) : [...s.watchlist, id] })),
    }),
    {
      name: "atlaspad-ui",
      partialize: (s) => ({
        soundOn: s.soundOn,
        introSeen: s.introSeen,
        seenAchievements: s.seenAchievements,
        cinematicsOn: s.cinematicsOn,
        mapFilter: s.mapFilter,
        showDemo: s.showDemo,
        watchlist: s.watchlist,
      }),
    },
  ),
);
