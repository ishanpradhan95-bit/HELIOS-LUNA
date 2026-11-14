export type SiteId = "shackleton" | "connecting_ridge" | "nobile" | "malapert";

export interface LunarSite {
  id: SiteId;
  name: string;
  lat: number;
  lon: number;
  elevation: number;
  illumination: number;
  temperature: number;
  shadowed: boolean;
  description: string;
  centerX: number;
  centerY: number;
  ridgeHeight: number;
}

export interface MissionState {
  selectedSite: SiteId;
  date: string;
  powerKw: number;
  antennaM: number;
  radiatorM2: number;
  mastHeightM: number;
  earthCompare: boolean;
  audience: "PRO" | "PUBLIC";
  simulationRunning: boolean;
}

export interface MissionMetrics {
  sunVisibility: number;
  linkMargin: number;
  thermalMargin: number;
  survivalDays: number;
  energyBalance: number;
}

export const SITES: LunarSite[] = [
  { id: "shackleton", name: "Shackleton Connecting Ridge", lat: -89.54, lon: 222, elevation: 2150, illumination: 0.86, temperature: 218, shadowed: false, description: "Narrow ridge separating Shackleton and de Gerlache crater PSR traps.", centerX: -9310, centerY: -10340, ridgeHeight: 2150 },
  { id: "connecting_ridge", name: "Peak Near Shackleton", lat: -89.78, lon: 203.5, elevation: 2420, illumination: 0.91, temperature: 224, shadowed: false, description: "Prominent illuminated massif with steep permanent-shadow drop-offs.", centerX: -10150, centerY: -15450, ridgeHeight: 2420 },
  { id: "nobile", name: "Nobile Rim 1", lat: -85.2, lon: 53.5, elevation: 1650, illumination: 0.68, temperature: 142, shadowed: true, description: "Hummocky plateau with distributed secondary cold traps.", centerX: 17500, centerY: 6200, ridgeHeight: 1650 },
  { id: "malapert", name: "Malapert Massif", lat: -85.95, lon: 0.5, elevation: 4800, illumination: 0.78, temperature: 205, shadowed: false, description: "High massif with long southern shadows and direct Earth visibility.", centerX: 1200, centerY: -39000, ridgeHeight: 4800 },
];
