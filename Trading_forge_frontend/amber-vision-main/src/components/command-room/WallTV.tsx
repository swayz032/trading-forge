/**
 * Reusable wall-mounted TV mesh.
 *
 * Built from primitives — no extra GLB load. The bezel is a thin black box,
 * the screen is a slightly inset plane that hosts an <Html transform> so the
 * caller can render any React content on it (live data feeds, charts, status
 * pills). Trading Forge brand strip on the chin so it reads as a corporate
 * monitor, not a TV.
 *
 * Performance: 3 meshes per TV (bezel back, bezel chin, screen plane) + the
 * Html overlay. Html re-renders only when its child state changes (React Query
 * caches handle this); the meshes themselves are static.
 */

import { Html } from "@react-three/drei";
import type { ReactNode } from "react";

interface WallTVProps {
  /** World position of the TV centre. */
  position: [number, number, number];
  /** Y-rotation in radians so the TV faces into the room. */
  rotationY?: number;
  /** Screen content. Renders at the TV's native pixel-equivalent. */
  children: ReactNode;
  /** Visible width in metres. Default 1.4m (≈65" diagonal). */
  width?: number;
  /** Visible height in metres. Default 0.82m. */
  height?: number;
  /** Html distanceFactor — lower = bigger apparent text. */
  distanceFactor?: number;
  /** Optional bottom-chin label (e.g. "TRADING FORGE · STRATEGY METRICS"). */
  label?: string;
}

export function WallTV({
  position,
  rotationY = 0,
  children,
  width = 1.4,
  height = 0.82,
  distanceFactor = 0.55,
  label,
}: WallTVProps) {
  const bezelW = width + 0.06;
  const bezelH = height + 0.06 + (label ? 0.08 : 0);
  const screenZ = 0.018;

  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      {/* Bezel back-plate / mount */}
      <mesh position={[0, 0, 0]}>
        <boxGeometry args={[bezelW, bezelH, 0.04]} />
        <meshStandardMaterial color="#0a0d12" metalness={0.6} roughness={0.4} />
      </mesh>

      {/* Screen — emissive plane so it self-illuminates a bit even in low light */}
      <mesh position={[0, label ? 0.04 : 0, screenZ]}>
        <planeGeometry args={[width, height]} />
        <meshStandardMaterial
          color="#06090d"
          emissive="#06121a"
          emissiveIntensity={0.6}
          metalness={0}
          roughness={0.4}
        />
      </mesh>

      {/* Brand chin — emerald accent strip below the screen */}
      {label && (
        <mesh position={[0, -height / 2 - 0.02, screenZ]}>
          <planeGeometry args={[width, 0.06]} />
          <meshStandardMaterial
            color="#10B981"
            emissive="#10B981"
            emissiveIntensity={1.1}
            metalness={0}
            roughness={0.6}
          />
        </mesh>
      )}

      {/* HTML content rendered onto the screen face */}
      <Html
        position={[0, label ? 0.04 : 0, screenZ + 0.001]}
        rotation={[0, 0, 0]}
        transform
        occlude
        distanceFactor={distanceFactor}
        style={{
          pointerEvents: "none",
          userSelect: "none",
          width: width / distanceFactor * 1000,
          height: height / distanceFactor * 1000,
        }}
      >
        <div
          style={{
            width: width / distanceFactor * 1000,
            height: height / distanceFactor * 1000,
            background:
              "linear-gradient(180deg, rgba(6,12,18,0.97) 0%, rgba(4,8,12,0.99) 100%)",
            border: "1px solid rgba(16,185,129,0.16)",
            color: "#e2e8f0",
            fontFamily: "Inter, system-ui, sans-serif",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            padding: "18px 22px",
          }}
        >
          {children}
        </div>
      </Html>

      {/* Tiny brand label printed on the chin */}
      {label && (
        <Html
          position={[0, -height / 2 - 0.02, screenZ + 0.002]}
          transform
          distanceFactor={distanceFactor}
          style={{ pointerEvents: "none", userSelect: "none" }}
        >
          <div
            style={{
              fontSize: 10,
              letterSpacing: "0.22em",
              fontWeight: 700,
              color: "#0a0d12",
              fontFamily: "Inter, system-ui, sans-serif",
              whiteSpace: "nowrap",
            }}
          >
            {label}
          </div>
        </Html>
      )}
    </group>
  );
}
