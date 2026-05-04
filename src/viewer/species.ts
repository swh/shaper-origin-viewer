/**
 * Wood species → material parameters. Phase 3 ships solid-colour approximations
 * tuned to look plausible under the current lighting; phase 4 swaps to procedural
 * grain shaders or texture maps as the species picker UI lands.
 */
export type Species = {
  id: string;
  label: string;
  color: string; // hex
  roughness: number;
  metalness: number;
};

export const SPECIES: Species[] = [
  { id: "oak", label: "Oak", color: "#c8a878", roughness: 0.7, metalness: 0 },
  { id: "walnut", label: "Walnut", color: "#5a4030", roughness: 0.6, metalness: 0 },
  { id: "maple", label: "Maple", color: "#e8d2a8", roughness: 0.65, metalness: 0 },
  { id: "cherry", label: "Cherry", color: "#a05a3a", roughness: 0.55, metalness: 0 },
  { id: "pine", label: "Pine", color: "#dcb070", roughness: 0.75, metalness: 0 },
];

export function speciesById(id: string): Species {
  return SPECIES.find((s) => s.id === id) ?? SPECIES[0];
}
