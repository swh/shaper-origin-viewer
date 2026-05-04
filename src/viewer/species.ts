/**
 * Wood species → procedural grain parameters. The viewer renders boards with
 * a fragment-shader wood-grain pattern (see `wood.ts`), so each species has
 * a base "light" colour, a "dark" streak colour, and a ring-spacing scale.
 *
 * The grain is computed in world-space, which means it carries naturally onto
 * the walls of cuts — material removed from the surface reveals the same wood
 * pattern beneath, making cut depth visually obvious without any extra cost
 * over a flat-coloured board.
 */
export type Species = {
  id: string;
  label: string;
  /** Base wood colour (between rings). */
  light: string;
  /** Darker grain colour (at ring peaks). */
  dark: string;
  /** Approximate ring spacing in mm. Lower = tighter grain. */
  ringScale: number;
  /**
   * High-frequency brightness wobble independent of the ring pattern. Useful
   * on the MDF species where there's no grain to give the eye a hand-hold;
   * 0 disables it.
   */
  stippleStrength?: number;
  roughness: number;
  metalness: number;
};

export const SPECIES: Species[] = [
  {
    id: "mdf",
    label: "MDF",
    // light == dark → ring pattern collapses to a constant colour. The
    // stipple below gives the eye some surface texture to lock onto when the
    // board is viewed straight-on.
    light: "#aeaeae",
    dark: "#aeaeae",
    ringScale: 1,
    stippleStrength: 0.16,
    roughness: 0.65,
    metalness: 0,
  },
  {
    id: "ash",
    label: "Ash",
    light: "#d8c498",
    dark: "#a48a5a",
    ringScale: 1.5,
    roughness: 0.7,
    metalness: 0,
  },
  {
    id: "beech",
    label: "Beech",
    light: "#d4b090",
    dark: "#b88e6a",
    ringScale: 2.5,
    roughness: 0.6,
    metalness: 0,
  },
  {
    id: "cherry",
    label: "Cherry",
    light: "#a86848",
    dark: "#864a30",
    ringScale: 2,
    roughness: 0.55,
    metalness: 0,
  },
  {
    id: "iroko",
    label: "Iroko",
    light: "#a37a48",
    dark: "#6e4f2a",
    ringScale: 2,
    roughness: 0.65,
    metalness: 0,
  },
  {
    id: "maple",
    label: "Maple",
    light: "#ecdcb8",
    dark: "#d4bf95",
    ringScale: 2.5,
    roughness: 0.65,
    metalness: 0,
  },
  {
    id: "oak",
    label: "Oak",
    light: "#d4b486",
    dark: "#b08858",
    ringScale: 1.5,
    roughness: 0.7,
    metalness: 0,
  },
  {
    id: "pine",
    label: "Pine",
    light: "#e2bd80",
    dark: "#c1955d",
    ringScale: 2,
    roughness: 0.75,
    metalness: 0,
  },
  {
    id: "teak",
    label: "Teak",
    light: "#b08854",
    dark: "#7e5c30",
    ringScale: 2,
    roughness: 0.55,
    metalness: 0,
  },
  {
    id: "walnut",
    label: "Walnut",
    light: "#6e4f3a",
    dark: "#4a3320",
    ringScale: 2,
    roughness: 0.6,
    metalness: 0,
  },
];

export function speciesById(id: string): Species {
  return SPECIES.find((s) => s.id === id) ?? SPECIES[0];
}
