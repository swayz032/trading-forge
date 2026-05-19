/**
 * Desk monitor — the computer the NPC is "controlling".
 *
 * Small flat-screen + stand on top of a desk. Emissive screen colour reflects
 * the subsystem state (emerald = healthy, amber = busy, red = incident).
 * Brightens with activity so it looks like the worker is actually doing
 * something on it.
 */

import { useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";

interface DeskMonitorProps {
  /** Position of the monitor base (sits on the desk surface). */
  position: [number, number, number];
  /** Y rotation — face the NPC who's "using" it. */
  rotationY?: number;
  /** Subsystem accent colour for the screen glow. */
  color?: string;
  /** 0..1 — brightens emissive + drives screen content pulse. */
  activity?: number;
}

export function DeskMonitor({
  position,
  rotationY = 0,
  color = "#10B981",
  activity = 0.4,
}: DeskMonitorProps) {
  const screenRef = useRef<THREE.Mesh>(null!);
  const { invalidate } = useThree();

  useFrame(({ clock }) => {
    if (!screenRef.current) return;
    const mat = screenRef.current.material as THREE.MeshStandardMaterial;
    // Subtle screen flicker — frequency ramps with activity
    const t = clock.elapsedTime;
    const flicker = 0.85 + 0.15 * Math.sin(t * (4 + activity * 6));
    mat.emissiveIntensity = (0.6 + activity * 1.8) * flicker;
    if (activity > 0.3) invalidate();
  });

  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      {/* Stand base — small puck */}
      <mesh position={[0, 0.01, 0]}>
        <cylinderGeometry args={[0.07, 0.08, 0.02, 16]} />
        <meshStandardMaterial color="#0a0d12" metalness={0.6} roughness={0.4} />
      </mesh>

      {/* Stand neck */}
      <mesh position={[0, 0.1, 0]}>
        <boxGeometry args={[0.025, 0.18, 0.04]} />
        <meshStandardMaterial color="#0a0d12" metalness={0.7} roughness={0.4} />
      </mesh>

      {/* Bezel back */}
      <mesh position={[0, 0.28, 0]}>
        <boxGeometry args={[0.42, 0.26, 0.04]} />
        <meshStandardMaterial color="#08090c" metalness={0.7} roughness={0.4} />
      </mesh>

      {/* Screen face — emissive, pulses with activity */}
      <mesh ref={screenRef} position={[0, 0.28, 0.022]}>
        <planeGeometry args={[0.38, 0.22]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={0.6 + activity * 1.4}
          metalness={0}
          roughness={0.4}
        />
      </mesh>

      {/* Tiny indicator LED on the chin — solid emerald = on */}
      <mesh position={[0.18, 0.16, 0.024]}>
        <boxGeometry args={[0.012, 0.012, 0.006]} />
        <meshStandardMaterial
          color="#10B981"
          emissive="#10B981"
          emissiveIntensity={2.4}
        />
      </mesh>
    </group>
  );
}
