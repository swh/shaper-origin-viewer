export type CutType = "outside" | "inside" | "pocket" | "online" | "guide" | "anchor";

export const CUT_TYPES: readonly CutType[] = [
  "outside",
  "inside",
  "pocket",
  "online",
  "guide",
  "anchor",
] as const;

export type Point = readonly [number, number];
export type Ring = Point[];

export type Geometry =
  | { kind: "polygon"; rings: Ring[] } // rings[0] = exterior, rest = holes
  | { kind: "linestring"; points: Ring };

export type Cut = {
  cutType: CutType;
  depthMm: number | null;
  offsetMm: number;
  toolDiaMm: number | null;
  geometry: Geometry;
  closed: boolean;
};

export type Doc = {
  widthMm: number;
  heightMm: number;
  cuts: Cut[];
  anchor: Point | null;
};
