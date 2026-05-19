/**
 * NPC worker — stylized geometric figure at a desk.
 *
 * Deliberately abstract (capsule + sphere head + emerald accent strip on the
 * chest) instead of a photorealistic human — fits the command-center diorama
 * vibe without uncanny-valley risk and renders at trivial cost (~700 polys
 * per NPC, no skeletal animation, no skinning, no shadows).
 *
 * Each NPC represents a subsystem worker. Idle animation is a subtle bob +
 * head turn driven by useFrame at the parent <Canvas frameloop="demand">'s
 * cadence. We pulse the demand loop ourselves so the animation actually
 * runs without forcing the whole scene to render every frame.
 */

import { useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import * as THREE from "three";

interface NPCWorkerProps {
  /** Base world position. NPC will sit/stand here with desk pose. */
  position: [number, number, number];
  /** Y rotation in radians — face the desk / face the front of the room. */
  rotationY?: number;
  /** Subsystem this NPC represents (label above head). */
  role: string;
  /** Hex colour for the worker uniform accent. Default Forge emerald. */
  accent?: string;
  /** Phase offset so 4 NPCs don't bob in sync. */
  phase?: number;
  /** 0..1 — drives typing intensity, head focus, and accent strip glow.
   *  Caller computes from live system state (backtest running, incident fired,
   *  etc.) so the NPCs actually look like they're working on the pipeline. */
  activity?: number;
}

export function NPCWorker({
  position,
  rotationY = 0,
  role,
  accent = "#10B981",
  phase = 0,
  activity = 0.35,
}: NPCWorkerProps) {
  const { invalidate } = useThree();
  const groupRef = useRef<THREE.Group>(null!);
  const headRef = useRef<THREE.Mesh>(null!);
  const leftArmRef = useRef<THREE.Mesh>(null!);
  const rightArmRef = useRef<THREE.Mesh>(null!);
  const accentRef = useRef<THREE.Mesh>(null!);

  useFrame(({ clock }) => {
    if (!groupRef.current || !headRef.current) return;
    const t = clock.elapsedTime + phase;

    // Bob amplitude scales with activity (resting: ~1cm; active: ~3cm)
    const bobAmp = 0.01 + activity * 0.025;
    groupRef.current.position.y = position[1] + Math.sin(t * 1.9) * bobAmp;

    // Head focus — when active, head holds steady looking down at monitor
    // (small 0.3 rad forward tilt + tiny sway). When idle, head turns side
    // to side as if scanning the room.
    if (headRef.current) {
      if (activity > 0.5) {
        headRef.current.rotation.x = THREE.MathUtils.lerp(
          headRef.current.rotation.x,
          0.32,
          0.08,
        );
        headRef.current.rotation.y = Math.sin(t * 1.4) * 0.04;
      } else {
        headRef.current.rotation.x = THREE.MathUtils.lerp(
          headRef.current.rotation.x,
          0.05,
          0.08,
        );
        headRef.current.rotation.y = Math.sin(t * 0.95) * 0.13;
      }
    }

    // Typing motion — arms rock back and forth quickly when active.
    // Frequency ramps from ~3 Hz at low activity to ~9 Hz at high activity.
    const typingFreq = 3 + activity * 6;
    const typingAmp = 0.04 + activity * 0.12;
    if (leftArmRef.current) {
      leftArmRef.current.rotation.x = -1.1 + Math.sin(t * typingFreq) * typingAmp;
    }
    if (rightArmRef.current) {
      rightArmRef.current.rotation.x =
        -1.1 + Math.sin(t * typingFreq + Math.PI / 3) * typingAmp;
    }

    // Accent strip glow scales with activity
    if (accentRef.current) {
      const mat = accentRef.current.material as THREE.MeshStandardMaterial;
      mat.emissiveIntensity = 0.8 + activity * 1.6;
    }

    invalidate();
  });

  return (
    <group ref={groupRef} position={position} rotation={[0, rotationY, 0]}>
      {/* Body — capsule torso, leaning forward over the desk */}
      <mesh position={[0, 0.4, 0]} rotation={[0.18, 0, 0]}>
        <capsuleGeometry args={[0.18, 0.55, 4, 8]} />
        <meshStandardMaterial color="#1a2330" metalness={0.2} roughness={0.7} />
      </mesh>

      {/* Emerald uniform accent strip across the chest — glows with activity */}
      <mesh ref={accentRef} position={[0, 0.55, 0.18]} rotation={[0.18, 0, 0]}>
        <boxGeometry args={[0.28, 0.05, 0.02]} />
        <meshStandardMaterial
          color={accent}
          emissive={accent}
          emissiveIntensity={1.4}
          metalness={0}
          roughness={0.5}
        />
      </mesh>

      {/* Head — tilts forward when "focused" on the monitor */}
      <mesh ref={headRef} position={[0, 0.95, 0.06]}>
        <sphereGeometry args={[0.13, 24, 16]} />
        <meshStandardMaterial color="#2a3441" metalness={0.25} roughness={0.55} />
      </mesh>

      {/* Arms — capsules pivoting at the shoulder, hands forward in typing pose */}
      <mesh
        ref={leftArmRef}
        position={[-0.18, 0.6, 0.05]}
        rotation={[-1.1, 0, 0]}
      >
        <capsuleGeometry args={[0.05, 0.32, 4, 6]} />
        <meshStandardMaterial color="#1a2330" metalness={0.2} roughness={0.7} />
      </mesh>
      <mesh
        ref={rightArmRef}
        position={[0.18, 0.6, 0.05]}
        rotation={[-1.1, 0, 0]}
      >
        <capsuleGeometry args={[0.05, 0.32, 4, 6]} />
        <meshStandardMaterial color="#1a2330" metalness={0.2} roughness={0.7} />
      </mesh>

      {/* Tiny role tag above the head */}
      <Html
        position={[0, 1.32, 0]}
        center
        occlude
        distanceFactor={4}
        style={{
          pointerEvents: "none",
          userSelect: "none",
          fontFamily: "Inter, system-ui, sans-serif",
          fontSize: 11,
          color: "#94a3b8",
          letterSpacing: "0.18em",
          fontWeight: 700,
          background: "rgba(8,12,18,0.78)",
          padding: "3px 8px",
          borderRadius: 6,
          border: `1px solid ${accent}55`,
          whiteSpace: "nowrap",
          textTransform: "uppercase",
        }}
      >
        {role}
      </Html>
    </group>
  );
}
