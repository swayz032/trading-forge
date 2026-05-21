/**
 * Big red wall pause button.
 *
 * Visual states:
 *   - ACTIVE   → emerald LED ring lit, button cap dim (system running)
 *   - PAUSED   → red dome cap glowing, ring dim (system stopped)
 *   - VACATION → amber dome (manual operator override; toggle returns to ACTIVE)
 *
 * Clicking toggles ACTIVE ↔ PAUSED via usePipelineMode. Vacation has to be set
 * elsewhere (operator dashboard) — the room button intentionally doesn't enter
 * vacation, only the binary run/stop toggle.
 *
 * Performance: the button is a few low-poly primitives. Animation is a single
 * y-position lerp on press. Materials use emissiveIntensity (no shader work).
 */

import { useRef, useState, useCallback } from "react";
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

/** Window (ms) within which a second click confirms the pause action.
 *  Long enough to let the operator read "CONFIRM PAUSE" but short enough that
 *  an accidental double-click cannot trip it. */
const CONFIRM_WINDOW_MS = 3000;

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
  const { mode, isPending, isActive, isUnknown, toggle } = usePipelineMode();
  const domeRef = useRef<THREE.Mesh>(null!);
  const pressed = useRef(0);
  const colours = STATE_COLOURS[mode];

  // 2-step confirmation gate. First click on an ACTIVE button arms the
  // confirmation state for CONFIRM_WINDOW_MS; second click within the window
  // actually pauses. Resume (PAUSED → ACTIVE) is one-click.
  const [armed, setArmed] = useState(false);
  const armTimer = useRef<number | null>(null);

  const clearArmTimer = useCallback(() => {
    if (armTimer.current !== null) {
      window.clearTimeout(armTimer.current);
      armTimer.current = null;
    }
  }, []);

  const disarm = useCallback(() => {
    clearArmTimer();
    setArmed(false);
  }, [clearArmTimer]);

  useFrame(() => {
    if (!domeRef.current) return;
    const target = pressed.current > 0 ? -0.04 : 0;
    const cur = domeRef.current.position.y;
    const next = THREE.MathUtils.lerp(cur, target, 0.25);
    domeRef.current.position.y = next;
    if (Math.abs(next - target) > 0.001) invalidate();
    if (pressed.current > 0) pressed.current -= 1;
  });

  const onClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    if (isPending || isUnknown) return;
    pressed.current = 12; // ~12 frames of press animation
    invalidate();

    if (isActive) {
      // Two-step pause: arm on first click, fire on second click within window.
      if (!armed) {
        setArmed(true);
        clearArmTimer();
        armTimer.current = window.setTimeout(() => {
          armTimer.current = null;
          setArmed(false);
          invalidate();
        }, CONFIRM_WINDOW_MS);
        return;
      }
      disarm();
      toggle();
      return;
    }

    // Resume (PAUSED → ACTIVE / VACATION → ACTIVE) is one-click; no confirm.
    disarm();
    toggle();
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

      {/* Big red dome (the actual button cap) — animated on press */}
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
              color: armed
                ? "#f59e0b"
                : isUnknown
                  ? "#f59e0b"
                  : isActive
                    ? "#10B981"
                    : "#ef4444",
              fontWeight: 700,
            }}
          >
            {armed
              ? "CONFIRM PAUSE"
              : isUnknown
                ? "STATUS UNKNOWN"
                : mode === "PAUSED"
                  ? "PAUSED"
                  : mode === "VACATION"
                    ? "VACATION"
                    : "ACTIVE"}
          </div>
          <div>TRADING FORGE</div>
          <div style={{ marginTop: 2, opacity: 0.6 }}>
            {armed
              ? `click again within ${Math.round(CONFIRM_WINDOW_MS / 1000)}s`
              : isUnknown
                ? "retrying…"
                : isActive
                  ? "click to pause"
                  : "click to resume"}
          </div>
        </div>
      </Html>
    </group>
  );
}
