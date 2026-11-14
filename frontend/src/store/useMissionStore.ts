import { create } from "zustand";
import type { MissionState, SiteId } from "../types/mission";
interface MissionActions {
  selectSite: (selectedSite: SiteId) => void;
  setMastHeight: (mastHeightM: number) => void;
  setEarthCompare: (earthCompare: boolean) => void;
  setAudience: (audience: "PRO" | "PUBLIC") => void;
  setPower: (powerKw: number) => void;
  setAntenna: (antennaM: number) => void;
  setRadiator: (radiatorM2: number) => void;
  toggleSimulation: () => void;
}
export const useMissionStore = create<MissionState & MissionActions>((set) => ({
  selectedSite: "shackleton", date: new Date().toISOString(), powerKw: 18, antennaM: 2.4, radiatorM2: 36, mastHeightM: 12, earthCompare: false, audience: "PRO", simulationRunning: true,
  selectSite: (selectedSite) => set({ selectedSite }),
  setMastHeight: (mastHeightM) => set({ mastHeightM }),
  setEarthCompare: (earthCompare) => set({ earthCompare }),
  setAudience: (audience) => set({ audience }),
  setPower: (powerKw) => set({ powerKw }),
  setAntenna: (antennaM) => set({ antennaM }),
  setRadiator: (radiatorM2) => set({ radiatorM2 }),
  toggleSimulation: () => set((state) => ({ simulationRunning: !state.simulationRunning })),
}));
