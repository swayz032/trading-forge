/**
 * Big red wall button — READ-ONLY STATUS INDICATOR.
 *
 * ARCHITECTURE DECISION (operator, 2026-07-02, pinned): the Slumhouse Office
 * is the ONLY control room. This button no longer pauses or resumes anything —
 * it renders the live pipeline mode and points the operator at The Office
 * ("Bot Power" switch) for control. The pause/resume dispatch was removed in
 * the Layer-4 Office P0 pass.
 *
 * Visual states:
 *   - ACTIVE   → emerald LED ring lit, button cap dim (system running)
 *   - PAUSED   → red dome cap glowing, ring dim (system stopped)
 *   - VACATION → amber dome
 *   - UNKNOWN  → dim amber (fail-closed — never mistake for ACTIVE)
 */

import { useRef } from "react";
import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import * as THREE from "three";
import { usePipelineMode, type PipelineModeOrUnknown } from "@/hooks/usePipelineMode";

interface PauseButtonProps {
  /** World position of the button base centre. */
  position?: [number, number, number];
  /** Y-axis rotation (radians) so the button can face into the room. */
  rotationY?: number;
}

const STATE_COLOURS: Record<PipelineModeOrUnknown, { dome: string; ring: string; emit: number }> = {
  ACTIVE:   { dome: "#5b1212", ring: "#10B981", emit: 1.4 },
  PAUSED:   { dome: "#dc2626", ring: "#1f2937", emit: 2.4 },
  VACATION: { dome: "#f59e0b", ring: "#1f2937", emit: 1.8 },
  // UNKNOWN: dim amber. Fail-closed visual — operator must not mistake this
  // for ACTIVE. Matches the "STATUS UNKNOWN — RETRYING" pill convention.
  UNKNOWN:  { dome: "#78350f", ring: "#f59e0b", emit: 0.6 },
};

export function PauseButton({ position = [0, 1.4, -7.4], rotationY = 0 }: PauseButtonProps) {
  const { invalidate } = useThree();
  const { mode, isActive, isUnknown } = usePipelineMode();
  const domeRef = useRef<THREE.Mesh>(null!);
  const pressed = useRef(0);
  const colours = STATE_COLOURS[mode];

  useFrame(() => {
    if (!domeRef.current) return;
    const target = pressed.current > 0 ? -0.04 : 0;
    const cur = domeRef.current.position.y;
    const next = THREE.MathUtils.lerp(cur, target, 0.25);
    domeRef.current.position.y = next;
    if (Math.abs(next - target) > 0.001) invalidate();
    if (pressed.current > 0) pressed.current -= 1;
  });

  // Read-only: a click gives the tactile press animation but mutates NOTHING.
  // The label below tells the operator where the real switch lives.
  const onClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    pressed.current = 12; // ~12 frames of press animation
    invalidate();
  };

  const onOver = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    document.body.style.cursor = "pointer";
  };
  const onOut = () => {
    document.body.style.cursor = "default";
  };

  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      {/* Wall plate — brushed metal back-plate so the button sits on the wall, not floating */}
      <mesh position={[0, 0, -0.04]}>
        <boxGeometry args={[0.7, 0.7, 0.04]} />
        <meshStandardMaterial color="#0b1118" metalness={0.9} roughness={0.35} />
      </mesh>

      {/* Status ring — emerald when ACTIVE, dim otherwise */}
      <mesh position={[0, 0, -0.018]}>
        <ringGeometry args={[0.22, 0.27, 48]} />
        <meshStandardMaterial
          color={colours.ring}
          emissive={colours.ring}
          emissiveIntensity={isActive ? 1.6 : 0.05}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* Button base / collar */}
      <mesh position={[0, 0, 0.005]}>
        <cylinderGeometry args={[0.18, 0.2, 0.08, 32]} />
        <meshStandardMaterial color="#11181f" metalness={0.7} roughness={0.4} />
      </mesh>

      {/* Big red dome (the status cap) — press animation only, no control */}
      <mesh
        ref={domeRef}
        position={[0, 0, 0.05]}
        onClick={onClick}
        onPointerOver={onOver}
        onPointerOut={onOut}
      >
        <sphereGeometry args={[0.16, 32, 24, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshStandardMaterial
          color={colours.dome}
          emissive={colours.dome}
          emissiveIntensity={colours.emit}
          metalness={0.15}
          roughness={0.35}
        />
      </mesh>

      {/* Small text label below the button — uses Html so it stays sharp */}
      <Html
        position={[0, -0.45, 0]}
        transform
        occlude
        distanceFactor={3}
        style={{
          pointerEvents: "none",
          userSelect: "none",
          fontFamily: "Inter, system-ui, sans-serif",
          color: "#94a3b8",
          fontSize: "11px",
          letterSpacing: "0.18em",
          textAlign: "center",
          whiteSpace: "nowrap",
        }}
      >
        <div>
          <div
            style={{
              color: isUnknown
                ? "#f59e0b"
                : isActive
                  ? "#10B981"
                  : "#ef4444",
              fontWeight: 700,
            }}
          >
            {isUnknown
              ? "STATUS UNKNOWN"
              : mode === "PAUSED"
                ? "PAUSED"
                : mode === "VACATION"
                  ? "VACATION"
                  : "ACTIVE"}
          </div>
          <div>TRADING FORGE</div>
          <div style={{ marginTop: 2, opacity: 0.6 }}>
            {isUnknown ? "retrying…" : "read-only — controls live in The Office"}
          </div>
        </div>
      </Html>
    </group>
  );
}
