import { OrbitControls } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import { selectTool, useStore } from "../store";
import { Board } from "./Board";

export function Scene() {
  const {
    doc,
    boardWidthMm,
    boardHeightMm,
    boardThicknessMm,
    bitId,
    customDiameterMm,
    speciesId,
    debugCutVolumes,
  } = useStore();
  const tool = selectTool({ bitId, customDiameterMm });

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
        board={{
          widthMm: boardWidthMm,
          heightMm: boardHeightMm,
          thicknessMm: boardThicknessMm,
        }}
        tool={tool}
        speciesId={speciesId}
        debugCutVolumes={debugCutVolumes}
      />

      <gridHelper
        args={[Math.max(boardWidthMm, boardHeightMm) * 2, 20, "#333", "#222"]}
        position={[0, -boardThicknessMm - 0.1, 0]}
      />

      <OrbitControls makeDefault enableDamping target={[0, -boardThicknessMm / 2, 0]} />
    </Canvas>
  );
}
