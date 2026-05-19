/**
 * 3D incident light — emissive sphere mounted high on a wall corner. Pulses
 * red when one or more incidents are active. Idle: dim grey.
 *
 * Reads from the same `useIncidents()` store the IncidentOverlay HUD uses,
 * so the 3D world and the HUD agree without two SSE listeners.
 */

import { useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { useIncidents } from "./IncidentOverlay";

interface IncidentLightProps {
  position?: [number, number, number];
}

export function IncidentLight({ position = [-6.7, 2.6, -6.7] }: IncidentLightProps) {
  const incidents = useIncidents();
  const meshRef = useRef<THREE.Mesh>(null!);
  const lightRef = useRef<THREE.PointLight>(null!);
  const { invalidate } = useThree();

  const active = incidents.length > 0;

  useFrame(({ clock }) => {
    if (!meshRef.current) return;
    const mat = meshRef.current.material as THREE.MeshStandardMaterial;
    if (active) {
      // Pulse emissive intensity 0.5 ↔ 4.0 at ~1.5 Hz
      const pulse = 2.2 + Math.sin(clock.elapsedTime * 9.4) * 1.8;
      mat.emissiveIntensity = pulse;
      if (lightRef.current) lightRef.current.intensity = 0.6 + Math.sin(clock.elapsedTime * 9.4) * 0.5;
      invalidate();
    } else {
      // Idle: dim grey, no point light
      mat.emissiveIntensity = 0.05;
      if (lightRef.current) lightRef.current.intensity = 0;
    }
  });

  return (
    <group position={position}>
      {/* Mounting plate */}
      <mesh position={[0, 0, 0.04]}>
        <boxGeometry args={[0.18, 0.18, 0.04]} />
        <meshStandardMaterial color="#0a0d12" metalness={0.7} roughness={0.4} />
      </mesh>
      {/* The dome */}
      <mesh ref={meshRef} position={[0, 0, 0.1]}>
        <sphereGeometry args={[0.09, 24, 16, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshStandardMaterial
          color={active ? "#ef4444" : "#3a4452"}
          emissive={active ? "#ef4444" : "#3a4452"}
          emissiveIntensity={active ? 2.2 : 0.05}
          metalness={0.1}
          roughness={0.35}
        />
      </mesh>
      <pointLight ref={lightRef} position={[0, 0, 0.3]} color="#ef4444" intensity={0} distance={6} decay={1.6} />
    </group>
  );
}
