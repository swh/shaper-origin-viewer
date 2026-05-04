import { create } from "zustand";
import { CUSTOM_BIT_ID, DEFAULT_BIT_ID, type Tool, bitById, bitToTool } from "./depth";
import { type Doc, parseSvg } from "./parser";

export type Units = "mm" | "in";
export type RenderMode = "csg" | "heightmap";

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
  renderMode: RenderMode;
  debugCutVolumes: boolean;
  /** Error from the most recent loadSvg call, or null on success. */
  loadError: string | null;
  /**
   * Where the SVG's (0, 0) lands on the board, in board-mm. null = auto-place
   * (centre the SVG on the board, or use the anchor when one is present).
   */
  placement: { x: number; y: number } | null;
  /** When true, the next click on the board sets the placement. */
  placeMode: boolean;

  loadSvg: (text: string, name: string) => void;
  setBoardWidth: (mm: number) => void;
  setBoardHeight: (mm: number) => void;
  setBoardThickness: (mm: number) => void;
  setBitId: (id: string) => void;
  setCustomDiameter: (mm: number) => void;
  setSpecies: (id: string) => void;
  setUnits: (u: Units) => void;
  setRenderMode: (m: RenderMode) => void;
  setDebugCutVolumes: (v: boolean) => void;
  setPlacement: (p: { x: number; y: number } | null) => void;
  setPlaceMode: (on: boolean) => void;
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
  renderMode: "heightmap",
  debugCutVolumes: false,
  loadError: null,
  placement: null,
  placeMode: false,

  loadSvg: (text, name) => {
    try {
      const doc = parseSvg(text);
      set({ doc, svgName: name, loadError: null, placement: null, placeMode: false });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to parse SVG";
      set({ loadError: msg });
    }
  },
  setBoardWidth: (mm) => set({ boardWidthMm: mm }),
  setBoardHeight: (mm) => set({ boardHeightMm: mm }),
  setBoardThickness: (mm) => set({ boardThicknessMm: mm }),
  setBitId: (bitId) => set({ bitId }),
  setCustomDiameter: (customDiameterMm) => set({ customDiameterMm }),
  setSpecies: (speciesId) => set({ speciesId }),
  setUnits: (units) => set({ units }),
  setRenderMode: (renderMode) => set({ renderMode }),
  setDebugCutVolumes: (debugCutVolumes) => set({ debugCutVolumes }),
  setPlacement: (placement) => set({ placement }),
  setPlaceMode: (placeMode) => set({ placeMode }),
}));

/** Derive the active Tool (diameter + profile) from store state. */
export function selectTool(s: Pick<State, "bitId" | "customDiameterMm">): Tool {
  if (s.bitId === CUSTOM_BIT_ID) {
    return { diameterMm: s.customDiameterMm, profile: "flat" };
  }
  const bit = bitById(s.bitId);
  return bit ? bitToTool(bit) : { diameterMm: 6, profile: "flat" };
}
