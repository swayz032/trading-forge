/**
 * Command Room scene composition.
 *
 * Loads the VR Study Room GLB (Pikas, CC BY 4.0) and dresses it with:
 *   - HDR environment lighting (drei "city" preset) — proper IBL on PBR maps
 *   - Big red wall pause button (wired to /api/admin/pipeline/*)
 *   - Static whiteboard at the front of the room (subsystem map)
 *   - First-person walk controls (PointerLock + WASD)
 *
 * Performance budget:
 *   - frameloop="demand" on the parent <Canvas> — re-renders only on input
 *   - dpr capped to [1, 1.5]
 *   - No shadow maps in Phase 1
 *   - GLB is parsed once at module load via useGLTF caching + draco-aware
 *   - The whole component tree is lazy-imported by the page so it doesn't
 *     mount unless the user actually navigates to /command-room
 */

import { Suspense, useEffect, useMemo } from "react";
import { Environment, useGLTF } from "@react-three/drei";
import { useThree } from "@react-three/fiber";
import { FirstPersonControls } from "./FirstPersonControls";
import { PauseButton } from "./PauseButton";
import { Whiteboard } from "./Whiteboard";
import { LEDStrips } from "./LEDStrips";
import { WallTV } from "./WallTV";
import { BrandPoster } from "./BrandPoster";
import { IncidentLight } from "./IncidentLight";
import { WorkerStations } from "./WorkerStations";
import { StrategyMetricsScreen } from "./screens/StrategyMetricsScreen";
import { MonteCarloScreen } from "./screens/MonteCarloScreen";
import { PipelineActivityScreen } from "./screens/PipelineActivityScreen";
import { PropFirmTrustScreen } from "./screens/PropFirmTrustScreen";

const ROOM_GLB = "/models/command-room/scene.glb";

/** GLB is in metres. Asset's source bounds put it close to room scale already. */
const ROOM_SCALE = 1.0;
const ROOM_OFFSET: [number, number, number] = [0, 0, 0];

function RoomMesh() {
  const { scene } = useGLTF(ROOM_GLB);

  // Clone so the cached source isn't mutated. GLB ships PBR materials natively
  // (MeshStandardMaterial), so we don't override anything — IBL from the HDR
  // environment lights it correctly out of the box.
  const cloned = useMemo(() => scene.clone(true), [scene]);

  return <primitive object={cloned} scale={ROOM_SCALE} position={ROOM_OFFSET} />;
}

export function CommandRoomScene() {
  return (
    <Suspense fallback={null}>
      {/* HDR environment lights the PBR materials. "city" preset gives bright
          windowed-interior reflections matching the asset's preview. */}
      <Environment preset="city" />
      <ambientLight intensity={0.6} color="#ffffff" />
      <directionalLight position={[10, 12, 6]} intensity={1.4} color="#fff4d6" />
      <directionalLight position={[-8, 8, -4]} intensity={0.5} color="#dde7f4" />

      {/* The room itself */}
      <RoomMesh />

      {/* Emerald LED strips along the ceiling perimeter — trading-floor vibe */}
      <LEDStrips halfWidth={6.6} halfDepth={6.6} y={2.7} intensity={2.4} />

      {/* Big red wall-mounted pause button — front-right wall, eye level */}
      <PauseButton position={[3.4, 1.45, -7.2]} rotationY={0} />

      {/* Whiteboard / command screen — front wall, centre */}
      <Whiteboard position={[0, 1.85, -7.55]} rotationY={0} distanceFactor={1.55} />

      {/* Wall TVs — left wall (facing +X / into room) */}
      <WallTV
        position={[-6.95, 1.7, -3]}
        rotationY={Math.PI / 2}
        label="TRADING FORGE · STRATEGY METRICS"
      >
        <StrategyMetricsScreen />
      </WallTV>
      <WallTV
        position={[-6.95, 1.7, 1.5]}
        rotationY={Math.PI / 2}
        label="TRADING FORGE · MONTE CARLO"
      >
        <MonteCarloScreen />
      </WallTV>

      {/* Wall TVs — right wall (facing -X / into room) */}
      <WallTV
        position={[6.95, 1.7, -3]}
        rotationY={-Math.PI / 2}
        label="TRADING FORGE · PIPELINE ACTIVITY"
      >
        <PipelineActivityScreen />
      </WallTV>
      <WallTV
        position={[6.95, 1.7, 1.5]}
        rotationY={-Math.PI / 2}
        label="TRADING FORGE · PROP-FIRM TRUST"
      >
        <PropFirmTrustScreen />
      </WallTV>

      {/* Worker stations — 4 NPCs + their monitors, positioned at desks,
          activity driven by real Trading Forge system state. */}
      <WorkerStations />

      {/* Incident light — pulses red when an incident SSE event fires */}
      <IncidentLight position={[-6.7, 2.55, -6.7]} />

      {/* Brand posters — fill the empty wall sections */}
      {/* Front wall, left of the command TV — flame logo */}
      <BrandPoster
        position={[-4.5, 1.7, -7.55]}
        rotationY={0}
        variant="logo"
      />
      {/* Back wall — mission statement, the room's north star */}
      <BrandPoster
        position={[0, 1.85, 6.95]}
        rotationY={Math.PI}
        variant="mission"
        width={1.5}
        height={1.95}
      />
      {/* Back wall, left — house rules */}
      <BrandPoster
        position={[-3.5, 1.7, 6.95]}
        rotationY={Math.PI}
        variant="rules"
        width={1.2}
        height={1.6}
      />
      {/* Back wall, right — second logo for symmetry */}
      <BrandPoster
        position={[3.5, 1.7, 6.95]}
        rotationY={Math.PI}
        variant="logo"
        width={1.2}
        height={1.6}
      />

      {/* First-person camera + WASD (also driven by on-screen MovementPad) */}
      <FirstPersonControls
        bounds={[-7, -7, 7, 7]}
        eyeHeight={1.65}
        speed={3.2}
      />

      <CameraInit />
    </Suspense>
  );
}

/** Spawn the camera close to the front wall so the operator immediately sees
 *  the command TV + the red pause button + the wall TVs in peripheral vision. */
function CameraInit() {
  const { camera } = useThree();
  useEffect(() => {
    camera.position.set(0, 1.65, -1.0);
    camera.lookAt(0, 1.85, -7.55);
  }, [camera]);
  return null;
}

// Pre-fetch the GLB on first import so navigating to the room doesn't stall.
useGLTF.preload(ROOM_GLB);
