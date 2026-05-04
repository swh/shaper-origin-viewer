import { del, get, set as idbSet } from "idb-keyval";
import { create } from "zustand";
import { type StateStorage, createJSONStorage, persist } from "zustand/middleware";
import { CUSTOM_BIT_ID, DEFAULT_BIT_ID, type Tool, bitById, bitToTool } from "./depth";
import { type Doc, parseSvg } from "./parser";

export type Units = "mm" | "in";
export type RenderMode = "csg" | "heightmap";

type State = {
  doc: Doc | null;
  svgName: string | null;
  /**
   * Raw SVG text of the loaded design. Persisted across reloads so the doc can
   * be re-parsed on hydration without making the user re-open the file.
   */
  svgText: string | null;
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
  /**
   * Per-cut tool diameter overrides, keyed by cut index in `doc.cuts`. An
   * entry overrides both the SVG-supplied `cut.toolDiaMm` and the global
   * default tool. Reset on SVG load.
   */
  cutToolOverrides: Record<number, number>;
  /** Cut currently being hovered/focused in the sidebar; null = nothing highlighted. */
  highlightedCutIndex: number | null;
  /** Indices of cuts the user has explicitly selected. Empty = no selection. */
  selectedCutIndices: number[];

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
  setCutToolOverride: (cutIndex: number, diameterMm: number | null) => void;
  clearCutToolOverrides: () => void;
  setHighlightedCut: (index: number | null) => void;
  setCutSelection: (indices: number[]) => void;
};

const initialState: Omit<
  State,
  // exclude the action functions; they're added below
  | "loadSvg"
  | "setBoardWidth"
  | "setBoardHeight"
  | "setBoardThickness"
  | "setBitId"
  | "setCustomDiameter"
  | "setSpecies"
  | "setUnits"
  | "setRenderMode"
  | "setDebugCutVolumes"
  | "setPlacement"
  | "setPlaceMode"
  | "setCutToolOverride"
  | "clearCutToolOverrides"
  | "setHighlightedCut"
  | "setCutSelection"
> = {
  doc: null,
  svgName: null,
  svgText: null,
  boardWidthMm: 300,
  boardHeightMm: 200,
  boardThicknessMm: 18,
  bitId: DEFAULT_BIT_ID,
  customDiameterMm: 6,
  speciesId: "mdf",
  units: "mm",
  renderMode: "heightmap",
  debugCutVolumes: false,
  loadError: null,
  placement: null,
  placeMode: false,
  cutToolOverrides: {},
  highlightedCutIndex: null,
  selectedCutIndices: [],
};

// IndexedDB-backed storage so the persisted blob can hold a full SVG without
// hitting LocalStorage's ~5 MB ceiling.
const idbStorage: StateStorage = {
  getItem: async (name) => (await get<string>(name)) ?? null,
  setItem: async (name, value) => {
    await idbSet(name, value);
  },
  removeItem: async (name) => {
    await del(name);
  },
};

export const useStore = create<State>()(
  persist(
    (set) => ({
      ...initialState,

      loadSvg: (text, name) => {
        try {
          const doc = parseSvg(text);
          set({
            doc,
            svgText: text,
            svgName: name,
            loadError: null,
            placement: null,
            placeMode: false,
            cutToolOverrides: {},
            highlightedCutIndex: null,
            selectedCutIndices: [],
          });
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
      setCutToolOverride: (cutIndex, diameterMm) =>
        set((s) => {
          const next = { ...s.cutToolOverrides };
          if (diameterMm == null) delete next[cutIndex];
          else next[cutIndex] = diameterMm;
          return { cutToolOverrides: next };
        }),
      clearCutToolOverrides: () => set({ cutToolOverrides: {} }),
      setHighlightedCut: (highlightedCutIndex) => set({ highlightedCutIndex }),
      setCutSelection: (selectedCutIndices) => set({ selectedCutIndices }),
    }),
    {
      name: "shaper-viewer",
      version: 1,
      storage: createJSONStorage(() => idbStorage),
      // Persist the durable bits only. Transient interaction state (placeMode,
      // selection, highlight, parse error) and the parsed `doc` (re-derived
      // from svgText below) are excluded.
      partialize: (s) => ({
        svgText: s.svgText,
        svgName: s.svgName,
        boardWidthMm: s.boardWidthMm,
        boardHeightMm: s.boardHeightMm,
        boardThicknessMm: s.boardThicknessMm,
        bitId: s.bitId,
        customDiameterMm: s.customDiameterMm,
        speciesId: s.speciesId,
        units: s.units,
        renderMode: s.renderMode,
        debugCutVolumes: s.debugCutVolumes,
        placement: s.placement,
        cutToolOverrides: s.cutToolOverrides,
      }),
      // Re-parse svgText on hydration so `doc` is ready when the app mounts.
      // Keeping doc out of storage avoids serialising a large parsed tree, and
      // means parser improvements take effect on the next load.
      merge: (persisted, current) => {
        const merged = { ...current, ...(persisted as Partial<State>) };
        if (merged.svgText) {
          try {
            merged.doc = parseSvg(merged.svgText);
            merged.loadError = null;
          } catch (e) {
            merged.doc = null;
            merged.svgText = null;
            merged.svgName = null;
            merged.loadError = e instanceof Error ? e.message : "Failed to parse persisted SVG";
          }
        }
        return merged;
      },
    },
  ),
);

/** Derive the active Tool (diameter + profile) from store state. */
export function selectTool(s: Pick<State, "bitId" | "customDiameterMm">): Tool {
  if (s.bitId === CUSTOM_BIT_ID) {
    return { diameterMm: s.customDiameterMm, profile: "flat" };
  }
  const bit = bitById(s.bitId);
  return bit ? bitToTool(bit) : { diameterMm: 6, profile: "flat" };
}
