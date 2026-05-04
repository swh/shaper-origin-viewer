import { create } from "zustand";
import { CUSTOM_BIT_ID, DEFAULT_BIT_ID, type Tool, bitById, bitToTool } from "./depth";
import { type Doc, parseSvg } from "./parser";

export type Units = "mm" | "in";

type State = {
  doc: Doc | null;
  svgName: string | null;
  boardWidthMm: number;
  boardHeightMm: number;
  boardThicknessMm: number;
  /** Selected bit id (catalogue entry or "custom"). */
  bitId: string;
  /** Diameter for the "custom" bit. Ignored when a catalogue bit is selected. */
  customDiameterMm: number;
  speciesId: string;
  units: Units;
  debugCutVolumes: boolean;

  loadSvg: (text: string, name: string) => void;
  setBoardWidth: (mm: number) => void;
  setBoardHeight: (mm: number) => void;
  setBoardThickness: (mm: number) => void;
  setBitId: (id: string) => void;
  setCustomDiameter: (mm: number) => void;
  setSpecies: (id: string) => void;
  setUnits: (u: Units) => void;
  setDebugCutVolumes: (v: boolean) => void;
};

export const useStore = create<State>((set) => ({
  doc: null,
  svgName: null,
  boardWidthMm: 300,
  boardHeightMm: 200,
  boardThicknessMm: 18,
  bitId: DEFAULT_BIT_ID,
  customDiameterMm: 6,
  speciesId: "oak",
  units: "mm",
  debugCutVolumes: false,

  loadSvg: (text, name) => {
    const doc = parseSvg(text);
    set({ doc, svgName: name });
  },
  setBoardWidth: (mm) => set({ boardWidthMm: mm }),
  setBoardHeight: (mm) => set({ boardHeightMm: mm }),
  setBoardThickness: (mm) => set({ boardThicknessMm: mm }),
  setBitId: (bitId) => set({ bitId }),
  setCustomDiameter: (customDiameterMm) => set({ customDiameterMm }),
  setSpecies: (speciesId) => set({ speciesId }),
  setUnits: (units) => set({ units }),
  setDebugCutVolumes: (debugCutVolumes) => set({ debugCutVolumes }),
}));

/** Derive the active Tool (diameter + profile) from store state. */
export function selectTool(s: Pick<State, "bitId" | "customDiameterMm">): Tool {
  if (s.bitId === CUSTOM_BIT_ID) {
    return { diameterMm: s.customDiameterMm, profile: "flat" };
  }
  const bit = bitById(s.bitId);
  return bit ? bitToTool(bit) : { diameterMm: 6, profile: "flat" };
}
