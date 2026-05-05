import { Edges, OrbitControls } from "@react-three/drei";
import { Canvas, type ThreeEvent } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Tool } from "../depth";
import type { Doc } from "../parser";
import { selectTool, useStore } from "../store";
import { Board } from "./Board";
import { type BoardParams, buildSingleCutVolume } from "./cuts";

export function Scene() {
  const {
    doc,
    boardWidthMm,
    boardHeightMm,
    boardThicknessMm,
    bitId,
    customDiameterMm,
    speciesId,
    renderMode,
    debugCutVolumes,
    placement,
    placeMode,
    cutToolOverrides,
    highlightedCutIndex,
    defaultDepthMm,
    setPlacement,
    setPlaceMode,
  } = useStore();
  const tool = selectTool({ bitId, customDiameterMm });

  const [shiftHeld, setShiftHeld] = useState(false);
  const [previewPlacement, setPreviewPlacement] = useState<{ x: number; y: number } | null>(null);
  const isPlacing = placeMode || shiftHeld;

  const origin = useMemo(
    () => computeOrigin(doc, boardWidthMm, boardHeightMm, placement),
    [doc, boardWidthMm, boardHeightMm, placement],
  );
  const board = { widthMm: boardWidthMm, heightMm: boardHeightMm, thicknessMm: boardThicknessMm };

  // Window-level shift tracking. Keyup is unreliable when focus leaves the
  // page (e.g. user shift-tabs to another window), so reset on blur too.
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "Shift") setShiftHeld(true);
      if (e.key === "Escape") setPlaceMode(false);
    };
    const up = (e: KeyboardEvent) => {
      if (e.key === "Shift") setShiftHeld(false);
    };
    const blur = () => setShiftHeld(false);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, [setPlaceMode]);

  // Crosshair cursor while placing.
  useEffect(() => {
    if (!isPlacing) return;
    const prev = document.body.style.cursor;
    document.body.style.cursor = "crosshair";
    return () => {
      document.body.style.cursor = prev;
    };
  }, [isPlacing]);

  // Camera frames the whole board with some padding.
  const radius = Math.max(boardWidthMm, boardHeightMm) * 1.4;
  const camPos: [number, number, number] = [radius, radius * 0.85, radius];

  return (
    <Canvas camera={{ position: camPos, fov: 35, near: 1, far: radius * 8 }} shadows>
      <color attach="background" args={["#1a1a1a"]} />
      <fog attach="fog" args={["#1a1a1a", radius * 1.2, radius * 4]} />

      <ambientLight intensity={0.35} />
      <directionalLight
        position={[radius, radius * 1.5, radius * 0.7]}
        intensity={1.0}
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-left={-radius}
        shadow-camera-right={radius}
        shadow-camera-top={radius}
        shadow-camera-bottom={-radius}
      />
      <directionalLight position={[-radius, radius, -radius * 0.5]} intensity={0.25} />

      <Board
        doc={doc}
        board={board}
        tool={tool}
        speciesId={speciesId}
        renderMode={renderMode}
        origin={origin}
        cutOverrides={cutToolOverrides}
        defaultDepthMm={defaultDepthMm}
        debugCutVolumes={debugCutVolumes}
      />

      {isPlacing && doc && (
        <PlacementPlane
          board={board}
          onHover={setPreviewPlacement}
          onCommit={(p) => {
            setPlacement(p);
            // Button-triggered place mode is single-shot; shift-drag stays
            // active until shift release.
            if (placeMode) setPlaceMode(false);
          }}
        />
      )}

      {isPlacing && doc && previewPlacement && (
        <PlacementBBox
          doc={doc}
          boardWidthMm={boardWidthMm}
          boardHeightMm={boardHeightMm}
          placement={previewPlacement}
        />
      )}

      {doc && highlightedCutIndex != null && (
        <CutHighlight
          doc={doc}
          board={board}
          tool={tool}
          origin={origin}
          cutOverrides={cutToolOverrides}
          defaultDepthMm={defaultDepthMm}
          cutIndex={highlightedCutIndex}
        />
      )}

      <gridHelper
        args={[Math.max(boardWidthMm, boardHeightMm) * 2, 20, "#333", "#222"]}
        position={[0, -boardThicknessMm - 0.1, 0]}
      />

      <OrbitControls
        makeDefault
        enableDamping
        zoomSpeed={0.5}
        enableRotate={!isPlacing}
        enablePan={!isPlacing}
        target={[0, -boardThicknessMm / 2, 0]}
      />
    </Canvas>
  );
}

/**
 * Reference point in SVG-mm: doc.anchor when present, otherwise the SVG centre.
 * Placement is the board-mm location where this point lands.
 */
function referencePoint(doc: Doc): { x: number; y: number } {
  if (doc.anchor) return { x: doc.anchor[0], y: doc.anchor[1] };
  return { x: doc.widthMm / 2, y: doc.heightMm / 2 };
}

/**
 * Compute where the SVG's (0, 0) lands on the board, in board-mm.
 *
 * `placement` is interpreted as "where the reference point lands" — so SVG (0, 0)
 * lands at `placement - reference`. When no manual placement is set, the
 * reference point auto-centres on the board.
 */
function computeOrigin(
  doc: Doc | null,
  boardWidthMm: number,
  boardHeightMm: number,
  placement: { x: number; y: number } | null,
): { x: number; y: number } {
  if (!doc) return { x: 0, y: 0 };
  const ref = referencePoint(doc);
  const target = placement ?? { x: boardWidthMm / 2, y: boardHeightMm / 2 };
  return { x: target.x - ref.x, y: target.y - ref.y };
}

/**
 * Invisible plane covering the board's top face. Catches pointer events while
 * the placement mode is active and reports the cursor's board-mm position.
 *
 * Click commits a single placement; drag (with the pointer captured) commits
 * continuously, which is what shift-drag wants.
 */
function PlacementPlane({
  board,
  onHover,
  onCommit,
}: {
  board: { widthMm: number; heightMm: number };
  onHover: (p: { x: number; y: number } | null) => void;
  onCommit: (p: { x: number; y: number }) => void;
}) {
  const dragging = useRef(false);

  function toBoardMm(e: ThreeEvent<PointerEvent>): { x: number; y: number } {
    return {
      x: e.point.x + board.widthMm / 2,
      y: e.point.z + board.heightMm / 2,
    };
  }

  return (
    <mesh
      // Slightly above the board's top so it raycasts before the board mesh.
      position={[0, 0.05, 0]}
      rotation={[-Math.PI / 2, 0, 0]}
      onPointerMove={(e) => {
        e.stopPropagation();
        const p = toBoardMm(e);
        onHover(p);
        if (dragging.current) onCommit(p);
      }}
      onPointerDown={(e) => {
        e.stopPropagation();
        dragging.current = true;
        (e.target as Element).setPointerCapture?.(e.pointerId);
        onCommit(toBoardMm(e));
      }}
      onPointerUp={(e) => {
        e.stopPropagation();
        dragging.current = false;
        (e.target as Element).releasePointerCapture?.(e.pointerId);
      }}
      onPointerOut={() => {
        if (!dragging.current) onHover(null);
      }}
    >
      <planeGeometry args={[board.widthMm, board.heightMm]} />
      <meshBasicMaterial transparent opacity={0} depthWrite={false} />
    </mesh>
  );
}

/**
 * Translucent overlay drawing the volume of a single cut on top of the board,
 * so the user can see which feature corresponds to a given sidebar row while
 * editing its tool diameter.
 */
function CutHighlight({
  doc,
  board,
  tool,
  origin,
  cutOverrides,
  defaultDepthMm,
  cutIndex,
}: {
  doc: Doc;
  board: BoardParams;
  tool: Tool;
  origin: { x: number; y: number };
  cutOverrides: Record<number, number>;
  defaultDepthMm: number;
  cutIndex: number;
}) {
  const volume = useMemo(() => {
    const cut = doc.cuts[cutIndex];
    if (!cut) return null;
    return buildSingleCutVolume(cut, board, tool, origin, cutOverrides[cutIndex], defaultDepthMm);
  }, [doc, board, tool, origin, cutOverrides, cutIndex, defaultDepthMm]);

  if (!volume) return null;
  return (
    <mesh rotation={[Math.PI / 2, 0, 0]} renderOrder={2}>
      <primitive attach="geometry" object={volume.geometry} />
      <meshBasicMaterial color="#fbbf24" transparent opacity={0.4} depthWrite={false} />
      <Edges color="#fbbf24" />
    </mesh>
  );
}

/**
 * Wireframe outline of where the SVG bounding box will land for the given
 * placement. Floats just above the board's top face so it stays visible.
 */
function PlacementBBox({
  doc,
  boardWidthMm,
  boardHeightMm,
  placement,
}: {
  doc: Doc;
  boardWidthMm: number;
  boardHeightMm: number;
  placement: { x: number; y: number };
}) {
  const ref = referencePoint(doc);
  // SVG (0, 0) in board-mm.
  const ox = placement.x - ref.x;
  const oy = placement.y - ref.y;
  // Bbox centre in world coords (board centred at origin).
  const cx = ox + doc.widthMm / 2 - boardWidthMm / 2;
  const cz = oy + doc.heightMm / 2 - boardHeightMm / 2;
  // Flat 1 mm-tall box so the user sees it as a hovering rectangle.
  const yCentre = 1;
  return (
    <mesh position={[cx, yCentre, cz]}>
      <boxGeometry args={[doc.widthMm, 0.2, doc.heightMm]} />
      <meshBasicMaterial color="#fbbf24" transparent opacity={0.12} depthWrite={false} />
      <Edges color="#fbbf24" />
    </mesh>
  );
}
