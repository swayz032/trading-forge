import { Suspense, useMemo, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import {
  OrbitControls,
  Text,
  Float,
  Environment,
  ContactShadows,
  MeshReflectorMaterial,
  Sparkles,
  Billboard,
  Capsule,
  Cylinder,
  Sphere,
} from "@react-three/drei";
import { EffectComposer, Bloom, SSAO, Vignette, DepthOfField } from "@react-three/postprocessing";
import { BlendFunction } from "postprocessing";
import * as THREE from "three";
import { useStrategies } from "@/hooks/useStrategies";

// ─────────────────────────────────────────────────────────────────────────
// Pipeline stations — each adds a part to the strategy bot
// ─────────────────────────────────────────────────────────────────────────

interface StationDef {
  id: string;
  label: string;
  sub: string;
  installs: "core" | "head" | "chest" | "rightArm" | "leftArm" | "rightLeg" | "leftLeg" | "halo" | "shield" | "polish";
  color: string;
  glow: string;
  quantum?: boolean;
}

const STATIONS: StationDef[] = [
  { id: "scout",        label: "SCOUT",          sub: "web research → idea",     installs: "core",     color: "#3B82F6", glow: "#60A5FA" },
  { id: "compile",      label: "COMPILE",        sub: "DSL → Python brain",      installs: "head",     color: "#10B981", glow: "#34D399" },
  { id: "diversity",    label: "DIVERSITY",      sub: "C9 anti-clone gate",      installs: "chest",    color: "#10B981", glow: "#34D399" },
  { id: "backtest",     label: "BACKTEST",       sub: "vectorbt arms",           installs: "rightArm", color: "#10B981", glow: "#34D399" },
  { id: "walkforward",  label: "WALK-FORWARD",   sub: "OOS legs",                installs: "rightLeg", color: "#10B981", glow: "#34D399" },
  { id: "montecarlo",   label: "MONTE CARLO",    sub: "1,000-path simulation",   installs: "leftLeg",  color: "#10B981", glow: "#34D399" },
  { id: "quantum",      label: "QUANTUM LAB",    sub: "challenger advisory",     installs: "halo",     color: "#A855F7", glow: "#C084FC", quantum: true },
  { id: "critic",       label: "CRITIC",         sub: "evolution polish",        installs: "polish",   color: "#10B981", glow: "#34D399" },
  { id: "frankenstein", label: "FRANKENSTEIN",   sub: "A4 randomization gate",   installs: "leftArm",  color: "#10B981", glow: "#34D399" },
  { id: "paper",        label: "PAPER",          sub: "live training arena",     installs: "shield",   color: "#22C55E", glow: "#4ADE80" },
  { id: "promote",      label: "PROMOTE",        sub: "A7 + B5 + B10 gates",     installs: "polish",   color: "#22C55E", glow: "#4ADE80" },
  { id: "deployed",     label: "DEPLOYED",       sub: "Tier 1 strategy live",    installs: "polish",   color: "#FACC15", glow: "#FDE047" },
];

// Layout
const FLOOR_W = 70;
const FLOOR_D = 32;
const LINE_LEN = 50;
const LINE_Y = 0.6;
const BUILDING_H = 22;

const STATION_TRAVEL_TIME = 2.2;
const STATION_DOCK_TIME = 2.4;
const TOTAL_PER_STATION = STATION_TRAVEL_TIME + STATION_DOCK_TIME;
const TOTAL_CYCLE = STATIONS.length * TOTAL_PER_STATION;

// Station x position evenly along line
function stationX(idx: number): number {
  const t = STATIONS.length > 1 ? idx / (STATIONS.length - 1) : 0.5;
  return -LINE_LEN / 2 + t * LINE_LEN;
}

// Map "installs" → bot state index where it becomes installed
const INSTALL_AT_STATION: Record<StationDef["installs"], number> = {} as any;
STATIONS.forEach((s, i) => {
  if (!(s.installs in INSTALL_AT_STATION)) INSTALL_AT_STATION[s.installs] = i;
});

// ─────────────────────────────────────────────────────────────────────────
// Background scenery
// ─────────────────────────────────────────────────────────────────────────

function Mountains() {
  const peaks = useMemo(() => {
    const arr: { x: number; h: number; w: number; z: number }[] = [];
    let seed = 7;
    const r = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    for (let i = 0; i < 18; i += 1) {
      arr.push({
        x: -160 + i * 18 + r() * 6 - 3,
        h: 22 + r() * 38,
        w: 28 + r() * 14,
        z: -110 - r() * 30,
      });
    }
    return arr;
  }, []);

  return (
    <group>
      {peaks.map((p, i) => (
        <mesh key={i} position={[p.x, p.h / 2, p.z]}>
          <coneGeometry args={[p.w, p.h, 5]} />
          <meshStandardMaterial color={i % 2 === 0 ? "#1a232f" : "#0f1820"} roughness={1} metalness={0} />
        </mesh>
      ))}
      {peaks.map((p, i) => (
        <mesh key={`s-${i}`} position={[p.x, p.h * 0.85, p.z + 0.3]}>
          <coneGeometry args={[p.w * 0.45, p.h * 0.3, 5]} />
          <meshStandardMaterial color="#E5E7EB" roughness={1} metalness={0} />
        </mesh>
      ))}
    </group>
  );
}

function ReflectingPool() {
  return (
    <group position={[0, -0.05, FLOOR_D / 2 + 10]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[FLOOR_W * 1.4, 18]} />
        <MeshReflectorMaterial
          mirror={0.85}
          blur={[400, 100]}
          resolution={1024}
          mixBlur={1.4}
          mixStrength={1.4}
          roughness={0.3}
          depthScale={0.8}
          minDepthThreshold={0.85}
          maxDepthThreshold={1}
          color="#0a1820"
          metalness={0.7}
        />
      </mesh>
    </group>
  );
}

function PalmTree({ position }: { position: [number, number, number] }) {
  return (
    <group position={position}>
      <Cylinder args={[0.18, 0.26, 5, 14]} position={[0, 2.5, 0]} castShadow>
        <meshStandardMaterial color="#3a2a18" roughness={0.95} />
      </Cylinder>
      {Array.from({ length: 10 }).map((_, i) => {
        const angle = (i / 10) * Math.PI * 2;
        const x = Math.cos(angle) * 1.4;
        const z = Math.sin(angle) * 1.4;
        return (
          <mesh key={i} position={[x, 5, z]} rotation={[0.3, angle, 0.4]} castShadow>
            <boxGeometry args={[2.2, 0.05, 0.5]} />
            <meshStandardMaterial color="#1a4a2a" roughness={0.9} />
          </mesh>
        );
      })}
    </group>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Building — luxury glass tower with banded floors
// ─────────────────────────────────────────────────────────────────────────

function Building() {
  const FLOORS = 4; // visual floor bands inside the tall building (the actual interior is one big space)
  return (
    <group>
      {/* Concrete plinth */}
      <mesh position={[0, -0.3, 0]} receiveShadow>
        <boxGeometry args={[FLOOR_W + 4, 0.6, FLOOR_D + 4]} />
        <meshStandardMaterial color="#1a1f24" roughness={0.85} metalness={0.2} />
      </mesh>

      {/* Steel column accents at corners */}
      {([
        [-FLOOR_W / 2, 0, -FLOOR_D / 2],
        [FLOOR_W / 2, 0, -FLOOR_D / 2],
        [-FLOOR_W / 2, 0, FLOOR_D / 2],
        [FLOOR_W / 2, 0, FLOOR_D / 2],
      ] as [number, number, number][]).map((p, i) => (
        <mesh key={i} position={[p[0], BUILDING_H / 2, p[2]]} castShadow>
          <boxGeometry args={[0.6, BUILDING_H, 0.6]} />
          <meshStandardMaterial color="#2a2f37" roughness={0.4} metalness={0.92} />
        </mesh>
      ))}

      {/* Front glass facade with banded floors */}
      {Array.from({ length: FLOORS }).map((_, f) => (
        <mesh
          key={`front-${f}`}
          position={[0, (BUILDING_H / FLOORS) * (f + 0.5), FLOOR_D / 2]}
        >
          <boxGeometry args={[FLOOR_W - 1, BUILDING_H / FLOORS - 0.3, 0.18]} />
          <meshPhysicalMaterial
            color="#0a1f1a"
            metalness={0.6}
            roughness={0.04}
            transmission={0.92}
            thickness={0.5}
            ior={1.45}
            transparent
            opacity={0.55}
            attenuationColor="#10B981"
            attenuationDistance={6}
          />
        </mesh>
      ))}
      {/* Floor band dividers (steel) */}
      {Array.from({ length: FLOORS + 1 }).map((_, f) => (
        <mesh key={`band-${f}`} position={[0, (BUILDING_H / FLOORS) * f, FLOOR_D / 2 + 0.05]}>
          <boxGeometry args={[FLOOR_W - 0.6, 0.18, 0.12]} />
          <meshStandardMaterial color="#2a2f37" roughness={0.3} metalness={0.95} />
        </mesh>
      ))}

      {/* Side glass walls */}
      <mesh position={[-FLOOR_W / 2, BUILDING_H / 2, 0]} rotation={[0, Math.PI / 2, 0]}>
        <boxGeometry args={[FLOOR_D, BUILDING_H, 0.18]} />
        <meshPhysicalMaterial
          color="#0a1f1a"
          metalness={0.5}
          roughness={0.06}
          transmission={0.85}
          thickness={0.5}
          ior={1.45}
          transparent
          opacity={0.55}
        />
      </mesh>
      <mesh position={[FLOOR_W / 2, BUILDING_H / 2, 0]} rotation={[0, -Math.PI / 2, 0]}>
        <boxGeometry args={[FLOOR_D, BUILDING_H, 0.18]} />
        <meshPhysicalMaterial
          color="#0a1f1a"
          metalness={0.5}
          roughness={0.06}
          transmission={0.85}
          thickness={0.5}
          ior={1.45}
          transparent
          opacity={0.55}
        />
      </mesh>
      {/* Solid back wall (acts as visual anchor for sign) */}
      <mesh position={[0, BUILDING_H / 2, -FLOOR_D / 2]}>
        <boxGeometry args={[FLOOR_W, BUILDING_H, 0.3]} />
        <meshStandardMaterial color="#0d1116" roughness={0.7} metalness={0.5} />
      </mesh>

      {/* Flat roof */}
      <mesh position={[0, BUILDING_H, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <planeGeometry args={[FLOOR_W, FLOOR_D]} />
        <meshStandardMaterial color="#0d1116" roughness={0.7} metalness={0.4} />
      </mesh>

      {/* Emerald rim accent at roof line */}
      {[FLOOR_W / 2, -FLOOR_W / 2].map((x, i) => (
        <mesh key={`rim-side-${i}`} position={[x, BUILDING_H, 0]}>
          <boxGeometry args={[0.3, 0.3, FLOOR_D]} />
          <meshStandardMaterial color="#10B981" emissive="#10B981" emissiveIntensity={2.4} toneMapped={false} />
        </mesh>
      ))}
      {[FLOOR_D / 2, -FLOOR_D / 2].map((z, i) => (
        <mesh key={`rim-fb-${i}`} position={[0, BUILDING_H, z]}>
          <boxGeometry args={[FLOOR_W, 0.3, 0.3]} />
          <meshStandardMaterial color="#10B981" emissive="#10B981" emissiveIntensity={2.4} toneMapped={false} />
        </mesh>
      ))}

      {/* TRADING FORGE rooftop signage */}
      <Float speed={0.4} rotationIntensity={0} floatIntensity={0.18}>
        <Text
          position={[0, BUILDING_H + 3.0, FLOOR_D / 2 + 0.3]}
          fontSize={2.2}
          color="#34D399"
          letterSpacing={0.18}
          anchorX="center"
          anchorY="middle"
          outlineWidth={0.05}
          outlineColor="#000"
          toneMapped={false}
        >
          TRADING FORGE
        </Text>
        <Text
          position={[0, BUILDING_H + 1.2, FLOOR_D / 2 + 0.3]}
          fontSize={0.5}
          color="#9FA3AB"
          letterSpacing={0.6}
          anchorX="center"
          anchorY="middle"
        >
          STRATEGY ASSEMBLY FACILITY
        </Text>
      </Float>

      {/* Plaza signage panels on the front facade */}
      <mesh position={[FLOOR_W / 2 - 0.1, 6, FLOOR_D / 2 + 0.2]} rotation={[0, 0, 0]}>
        <planeGeometry args={[6, 2]} />
        <meshStandardMaterial color="#0a0c10" emissive="#10B981" emissiveIntensity={0.4} />
      </mesh>
      <Text
        position={[FLOOR_W / 2 - 0.1, 6.3, FLOOR_D / 2 + 0.21]}
        fontSize={0.45}
        color="#34D399"
        anchorX="center"
        anchorY="middle"
        toneMapped={false}
      >
        FORGE
      </Text>
      <Text
        position={[FLOOR_W / 2 - 0.1, 5.7, FLOOR_D / 2 + 0.21]}
        fontSize={0.18}
        color="#9FA3AB"
        letterSpacing={0.4}
        anchorX="center"
        anchorY="middle"
      >
        STRATEGY ASSEMBLY · LIVE
      </Text>
    </group>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Floor — polished concrete with reflective finish
// ─────────────────────────────────────────────────────────────────────────

function FactoryFloor() {
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.001, 0]} receiveShadow>
        <planeGeometry args={[FLOOR_W, FLOOR_D]} />
        <MeshReflectorMaterial
          mirror={0.5}
          blur={[400, 100]}
          resolution={1024}
          mixBlur={1.5}
          mixStrength={0.85}
          roughness={0.5}
          depthScale={0.5}
          minDepthThreshold={0.88}
          maxDepthThreshold={1}
          color="#191e26"
          metalness={0.5}
        />
      </mesh>

      {/* Emerald guideline stripes */}
      {[-1.8, 1.8].map((z, i) => (
        <mesh key={i} position={[0, 0.005, z]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[LINE_LEN, 0.1]} />
          <meshStandardMaterial color="#10B981" emissive="#10B981" emissiveIntensity={1.6} toneMapped={false} />
        </mesh>
      ))}

      {/* Hazard chevrons at start/end */}
      {[-LINE_LEN / 2 - 1.5, LINE_LEN / 2 + 1.5].map((x, i) => (
        <mesh key={i} position={[x, 0.005, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[1.5, 4]} />
          <meshStandardMaterial color="#FACC15" emissive="#CA8A04" emissiveIntensity={0.6} />
        </mesh>
      ))}
    </group>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Conveyor belt with rotating rollers + side rails
// ─────────────────────────────────────────────────────────────────────────

function ConveyorBelt() {
  const NUM_ROLLERS = 26;
  const rollerRefs = useRef<THREE.Mesh[]>([]);

  useFrame((_, dt) => {
    for (const r of rollerRefs.current) {
      if (r) r.rotation.x += dt * 1.4;
    }
  });

  return (
    <group position={[0, LINE_Y - 0.45, 0]}>
      <mesh position={[0, -0.12, 0]} castShadow>
        <boxGeometry args={[LINE_LEN, 0.12, 2.6]} />
        <meshStandardMaterial color="#3a3f47" roughness={0.5} metalness={0.85} />
      </mesh>
      <mesh position={[0, 0.06, 0]} receiveShadow>
        <boxGeometry args={[LINE_LEN, 0.05, 2.0]} />
        <meshStandardMaterial color="#0a0c10" roughness={0.7} metalness={0.3} />
      </mesh>
      {[-1.15, 1.15].map((z, i) => (
        <mesh key={i} position={[0, 0.05, z]}>
          <boxGeometry args={[LINE_LEN, 0.18, 0.18]} />
          <meshStandardMaterial color="#52555c" roughness={0.4} metalness={0.95} />
        </mesh>
      ))}
      {Array.from({ length: NUM_ROLLERS }).map((_, i) => {
        const x = -LINE_LEN / 2 + (i / (NUM_ROLLERS - 1)) * LINE_LEN;
        return (
          <mesh
            key={i}
            ref={(el) => {
              if (el) rollerRefs.current[i] = el;
            }}
            position={[x, 0, 0]}
            rotation={[0, 0, Math.PI / 2]}
            castShadow
          >
            <cylinderGeometry args={[0.1, 0.1, 1.9, 14]} />
            <meshStandardMaterial color="#9ca3af" roughness={0.3} metalness={0.95} />
          </mesh>
        );
      })}
      {/* Hazard stripes on rails */}
      {Array.from({ length: 36 }).map((_, i) => {
        const x = -LINE_LEN / 2 + (i / 35) * LINE_LEN;
        const yellow = i % 2 === 0;
        return (
          <mesh key={`hz-${i}`} position={[x, 0.16, 1.15]}>
            <boxGeometry args={[LINE_LEN / 36, 0.04, 0.19]} />
            <meshStandardMaterial color={yellow ? "#FACC15" : "#0a0c10"} />
          </mesh>
        );
      })}
    </group>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Machine with robotic arm and big floating billboard label
// ─────────────────────────────────────────────────────────────────────────

interface MachineRefs {
  armBase: THREE.Group | null;
  armUpper: THREE.Group | null;
  armForearm: THREE.Group | null;
}

function Machine({
  def,
  position,
  active,
}: {
  def: StationDef;
  position: [number, number, number];
  active: boolean;
}) {
  const screenRef = useRef<THREE.Mesh>(null);
  const haloRef = useRef<THREE.Mesh>(null);
  const refs = useRef<MachineRefs>({ armBase: null, armUpper: null, armForearm: null });

  // Side of conveyor: alternating + quantum special placement
  const idx = STATIONS.findIndex((s) => s.id === def.id);
  const sideZ = def.quantum ? -3.6 : (idx % 2 === 0 ? -2.6 : 2.6);
  const facing = sideZ > 0 ? Math.PI : 0;

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    if (screenRef.current) {
      const m = screenRef.current.material as THREE.MeshStandardMaterial;
      m.emissiveIntensity = 1.0 + Math.sin(t * 2 + position[0]) * 0.4;
    }
    if (haloRef.current) {
      haloRef.current.rotation.y = t * (def.quantum ? 1.2 : 0.6);
    }

    // Robotic arm: when active, swing down and "install" rhythmically; when idle, idle motion
    if (refs.current.armBase && refs.current.armUpper && refs.current.armForearm) {
      const targetActivity = active ? 1 : 0;
      // Eased value tracking (smooth on/off)
      const a = targetActivity;
      const wobble = Math.sin(t * 6) * 0.08;
      refs.current.armBase.rotation.y = Math.sin(t * 0.7) * 0.2 * (1 - a);
      refs.current.armUpper.rotation.x = -0.4 + (a ? 0.9 + wobble : Math.sin(t * 1.2) * 0.2);
      refs.current.armForearm.rotation.x = -0.3 + (a ? 1.2 + Math.sin(t * 7) * 0.15 : Math.sin(t * 1.5) * 0.3);
    }
  });

  return (
    <group position={[position[0], 0, sideZ]} rotation={[0, facing, 0]}>
      {/* Cabinet */}
      <mesh position={[0, 1.4, 0]} castShadow receiveShadow>
        <boxGeometry args={[2.6, 2.8, 1.6]} />
        <meshStandardMaterial color="#2a2f37" roughness={0.3} metalness={0.92} />
      </mesh>

      {/* Hazard stripe at base */}
      <mesh position={[0, 0.14, 0.81]}>
        <planeGeometry args={[2.4, 0.22]} />
        <meshStandardMaterial color="#FACC15" />
      </mesh>

      {/* Display */}
      <mesh ref={screenRef} position={[0, 2.0, 0.81]}>
        <planeGeometry args={[1.8, 0.85]} />
        <meshStandardMaterial color="#000" emissive={def.glow} emissiveIntensity={1.4} toneMapped={false} />
      </mesh>
      <Text
        position={[0, 2.1, 0.82]}
        fontSize={0.18}
        color="#000"
        anchorX="center"
        anchorY="middle"
        fontWeight={700 as any}
        maxWidth={1.6}
      >
        {def.label}
      </Text>
      <Text
        position={[0, 1.85, 0.82]}
        fontSize={0.1}
        color="#000"
        anchorX="center"
        anchorY="middle"
        maxWidth={1.6}
      >
        {def.sub}
      </Text>

      {/* Pipes */}
      <mesh position={[-0.85, 3.1, 0]} castShadow>
        <cylinderGeometry args={[0.12, 0.12, 1.0, 12]} />
        <meshStandardMaterial color="#52555c" roughness={0.3} metalness={0.95} />
      </mesh>
      <mesh position={[0.85, 3.1, 0]} castShadow>
        <cylinderGeometry args={[0.12, 0.12, 1.0, 12]} />
        <meshStandardMaterial color="#52555c" roughness={0.3} metalness={0.95} />
      </mesh>

      {/* Halo above */}
      <mesh ref={haloRef} position={[0, 3.9, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.7, 0.05, 8, 32]} />
        <meshStandardMaterial color={def.glow} emissive={def.glow} emissiveIntensity={1.8} toneMapped={false} />
      </mesh>

      {/* Robotic arm */}
      <group ref={(el) => { refs.current.armBase = el; }} position={[0, 2.8, sideZ > 0 ? -0.7 : 0.7]}>
        <mesh>
          <cylinderGeometry args={[0.22, 0.26, 0.22, 14]} />
          <meshStandardMaterial color="#FACC15" roughness={0.4} metalness={0.7} />
        </mesh>
        <group ref={(el) => { refs.current.armUpper = el; }} position={[0, 0.12, 0]}>
          <mesh position={[0, 0.6, 0]}>
            <boxGeometry args={[0.22, 1.2, 0.22]} />
            <meshStandardMaterial color="#FACC15" roughness={0.3} metalness={0.7} />
          </mesh>
          <group ref={(el) => { refs.current.armForearm = el; }} position={[0, 1.2, 0]}>
            <mesh>
              <sphereGeometry args={[0.16, 16, 16]} />
              <meshStandardMaterial color="#52555c" roughness={0.3} metalness={0.95} />
            </mesh>
            <mesh position={[0, 0.55, 0]} rotation={[0.5, 0, 0]}>
              <boxGeometry args={[0.18, 1.1, 0.18]} />
              <meshStandardMaterial color="#FACC15" roughness={0.3} metalness={0.7} />
            </mesh>
            <mesh position={[0, 1.15, 0.45]}>
              <coneGeometry args={[0.1, 0.3, 8]} />
              <meshStandardMaterial
                color={def.glow}
                emissive={def.glow}
                emissiveIntensity={active ? 3.5 : 1.5}
                toneMapped={false}
              />
            </mesh>
          </group>
        </group>
      </group>

      {/* Active sparks during install */}
      {active && (
        <Sparkles
          count={28}
          scale={[1.5, 1.5, 1.5]}
          position={[0, 1, sideZ > 0 ? -1.5 : 1.5]}
          size={3.5}
          speed={1.2}
          opacity={1}
          color={def.glow}
        />
      )}

      {/* BIG FLOATING BILLBOARD with station name */}
      <Billboard position={[0, 5.3, 0]}>
        <mesh>
          <planeGeometry args={[3.2, 1.0]} />
          <meshStandardMaterial color="#000" transparent opacity={0.65} />
        </mesh>
        <mesh position={[0, 0, 0.001]}>
          <planeGeometry args={[3.2, 1.0]} />
          <meshBasicMaterial color={def.glow} transparent opacity={0.18} toneMapped={false} />
        </mesh>
        <Text
          position={[0, 0.18, 0.01]}
          fontSize={0.4}
          color={def.glow}
          anchorX="center"
          anchorY="middle"
          letterSpacing={0.18}
          outlineWidth={0.025}
          outlineColor="#000"
          toneMapped={false}
        >
          {def.label}
        </Text>
        <Text
          position={[0, -0.22, 0.01]}
          fontSize={0.16}
          color="#9FA3AB"
          anchorX="center"
          anchorY="middle"
          letterSpacing={0.05}
          outlineWidth={0.012}
          outlineColor="#000"
        >
          {def.sub}
        </Text>
      </Billboard>

      {/* Atmospheric machine light */}
      <pointLight position={[0, 2.2, 0]} intensity={active ? 3.2 : 1.6} distance={9} color={def.glow} />
    </group>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// THE STRATEGY BOT — humanoid, capsule limbs, pause-and-assemble flow
// ─────────────────────────────────────────────────────────────────────────

function StrategyBot({ onStationChange }: { onStationChange: (idx: number, docked: boolean) => void }) {
  const groupRef = useRef<THREE.Group>(null);
  const headRef = useRef<THREE.Group>(null);
  const chestRef = useRef<THREE.Group>(null);
  const rightArmRef = useRef<THREE.Group>(null);
  const leftArmRef = useRef<THREE.Group>(null);
  const rightLegRef = useRef<THREE.Group>(null);
  const leftLegRef = useRef<THREE.Group>(null);
  const haloRef = useRef<THREE.Mesh>(null);
  const shieldRef = useRef<THREE.Group>(null);

  // Track previous emit so we only call onStationChange on actual changes
  const lastStateRef = useRef<{ idx: number; docked: boolean }>({ idx: -1, docked: false });

  useFrame(({ clock }) => {
    if (!groupRef.current) return;
    const elapsed = clock.getElapsedTime() % TOTAL_CYCLE;
    const stationIdx = Math.floor(elapsed / TOTAL_PER_STATION);
    const localT = elapsed - stationIdx * TOTAL_PER_STATION;
    const traveling = localT < STATION_TRAVEL_TIME;

    // Position
    const prevX = stationIdx === 0 ? -LINE_LEN / 2 - 4 : stationX(stationIdx - 1);
    const currX = stationX(stationIdx);
    const easeInOut = (t: number) => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    const tt = traveling ? easeInOut(localT / STATION_TRAVEL_TIME) : 1;
    const x = traveling ? prevX + (currX - prevX) * tt : currX;

    groupRef.current.position.x = x;
    groupRef.current.position.y = LINE_Y + 0.18 + Math.sin(elapsed * 6) * 0.02;
    groupRef.current.position.z = 0;

    // Notify parent of station change for Machine "active" state
    const docked = !traveling;
    if (
      lastStateRef.current.idx !== stationIdx ||
      lastStateRef.current.docked !== docked
    ) {
      lastStateRef.current = { idx: stationIdx, docked };
      onStationChange(stationIdx, docked);
    }

    // Parts visibility — each part appears at its install station
    function partVisible(installs: StationDef["installs"]): number {
      const installStation = INSTALL_AT_STATION[installs];
      if (installStation == null) return 0;
      // Visible from the moment we DOCK at the install station onward
      if (stationIdx > installStation) return 1;
      if (stationIdx === installStation && !traveling) {
        // During the dock at install station, fade in
        return Math.min(1, localT - STATION_TRAVEL_TIME) / 0.5;
      }
      return 0;
    }

    const apply = (mesh: THREE.Object3D | null, v: number) => {
      if (!mesh) return;
      mesh.visible = v > 0.001;
      mesh.scale.setScalar(v);
    };

    apply(headRef.current, partVisible("head"));
    apply(chestRef.current, partVisible("chest"));
    apply(rightArmRef.current, partVisible("rightArm"));
    apply(leftArmRef.current, partVisible("leftArm"));
    apply(rightLegRef.current, partVisible("rightLeg"));
    apply(leftLegRef.current, partVisible("leftLeg"));
    apply(haloRef.current, partVisible("halo"));
    apply(shieldRef.current, partVisible("shield"));

    if (haloRef.current && haloRef.current.visible) {
      haloRef.current.rotation.y = elapsed * 1.5;
    }
  });

  // Material presets
  const matSteel = useMemo(
    () => new THREE.MeshStandardMaterial({ color: "#3a3f47", metalness: 0.92, roughness: 0.22 }),
    []
  );
  const matChassis = useMemo(
    () => new THREE.MeshStandardMaterial({ color: "#0a0c10", metalness: 0.85, roughness: 0.18 }),
    []
  );
  const matEmerald = useMemo(
    () => new THREE.MeshStandardMaterial({
      color: "#10B981",
      emissive: "#10B981",
      emissiveIntensity: 0.9,
      metalness: 0.3,
      roughness: 0.25,
      toneMapped: false,
    }),
    []
  );
  const matVisor = useMemo(
    () => new THREE.MeshStandardMaterial({
      color: "#34D399",
      emissive: "#34D399",
      emissiveIntensity: 2.4,
      toneMapped: false,
    }),
    []
  );

  return (
    <group ref={groupRef} scale={1.7}>
      {/* Core / floating disc — always present */}
      <mesh position={[0, 0, 0]} material={matEmerald}>
        <cylinderGeometry args={[0.36, 0.42, 0.1, 20]} />
      </mesh>

      {/* Right leg (capsule) */}
      <group ref={rightLegRef} position={[0.13, 0.05, 0]}>
        <Capsule args={[0.07, 0.55, 4, 12]} position={[0, 0.34, 0]} material={matSteel} castShadow />
        <mesh position={[0, 0.04, 0.06]} material={matEmerald}>
          <boxGeometry args={[0.18, 0.08, 0.22]} />
        </mesh>
      </group>

      {/* Left leg */}
      <group ref={leftLegRef} position={[-0.13, 0.05, 0]}>
        <Capsule args={[0.07, 0.55, 4, 12]} position={[0, 0.34, 0]} material={matSteel} castShadow />
        <mesh position={[0, 0.04, 0.06]} material={matEmerald}>
          <boxGeometry args={[0.18, 0.08, 0.22]} />
        </mesh>
      </group>

      {/* Chest */}
      <group ref={chestRef} position={[0, 0.95, 0]}>
        <mesh material={matChassis} castShadow>
          <boxGeometry args={[0.5, 0.55, 0.34]} />
        </mesh>
        {/* Chest plate Forge logo glow */}
        <mesh position={[0, 0, 0.18]} material={matEmerald}>
          <planeGeometry args={[0.32, 0.32]} />
        </mesh>
        <Text
          position={[0, 0, 0.181]}
          fontSize={0.16}
          color="#000"
          anchorX="center"
          anchorY="middle"
          fontWeight={700 as any}
        >
          ◢F
        </Text>
      </group>

      {/* Right arm — capsule upper + sphere shoulder */}
      <group ref={rightArmRef} position={[0.32, 0.95, 0]}>
        <Sphere args={[0.085, 16, 16]} material={matSteel} castShadow />
        <Capsule args={[0.06, 0.42, 4, 12]} position={[0.06, -0.22, 0]} rotation={[0, 0, 0.18]} material={matSteel} castShadow />
        <mesh position={[0.1, -0.5, 0]} material={matEmerald}>
          <sphereGeometry args={[0.08, 16, 16]} />
        </mesh>
      </group>
      {/* Left arm */}
      <group ref={leftArmRef} position={[-0.32, 0.95, 0]}>
        <Sphere args={[0.085, 16, 16]} material={matSteel} castShadow />
        <Capsule args={[0.06, 0.42, 4, 12]} position={[-0.06, -0.22, 0]} rotation={[0, 0, -0.18]} material={matSteel} castShadow />
        <mesh position={[-0.1, -0.5, 0]} material={matEmerald}>
          <sphereGeometry args={[0.08, 16, 16]} />
        </mesh>
      </group>

      {/* Head */}
      <group ref={headRef} position={[0, 1.42, 0]}>
        <Capsule args={[0.16, 0.16, 4, 16]} material={matChassis} castShadow />
        <mesh position={[0, 0.02, 0.165]} material={matVisor}>
          <planeGeometry args={[0.27, 0.11]} />
        </mesh>
      </group>

      {/* Quantum halo (advisory) */}
      <mesh ref={haloRef} position={[0, 1.78, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.3, 0.024, 10, 32]} />
        <meshStandardMaterial color="#A855F7" emissive="#C084FC" emissiveIntensity={2.4} toneMapped={false} />
      </mesh>

      {/* Paper shield */}
      <group ref={shieldRef} position={[0.42, 0.95, 0.18]} rotation={[0, 0.3, 0]}>
        <mesh>
          <boxGeometry args={[0.18, 0.42, 0.04]} />
          <meshStandardMaterial color="#22C55E" emissive="#4ADE80" emissiveIntensity={1.2} toneMapped={false} />
        </mesh>
      </group>

      {/* Soft glow under the bot */}
      <pointLight position={[0, 0.5, 0]} intensity={1.0} distance={4} color="#10B981" />
    </group>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Ceiling lights
// ─────────────────────────────────────────────────────────────────────────

function CeilingLights() {
  const positions: [number, number, number][] = [];
  for (let i = 0; i < 6; i += 1) {
    const x = -22 + i * 9;
    positions.push([x, BUILDING_H - 1.5, -10]);
    positions.push([x, BUILDING_H - 1.5, 10]);
  }
  return (
    <group>
      {positions.map((p, i) => (
        <group key={i} position={p}>
          <mesh position={[0, 0.6, 0]}>
            <cylinderGeometry args={[0.025, 0.025, 1.2, 6]} />
            <meshStandardMaterial color="#52555c" />
          </mesh>
          <mesh>
            <coneGeometry args={[0.45, 0.55, 16, 1, true]} />
            <meshStandardMaterial color="#1a1f24" side={THREE.DoubleSide} roughness={0.6} metalness={0.6} />
          </mesh>
          <mesh position={[0, -0.2, 0]}>
            <sphereGeometry args={[0.2, 16, 16]} />
            <meshStandardMaterial color="#FBBF24" emissive="#FCD34D" emissiveIntensity={3.0} toneMapped={false} />
          </mesh>
          <pointLight intensity={1.5} distance={16} color="#FCD34D" />
        </group>
      ))}
    </group>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// SCENE
// ─────────────────────────────────────────────────────────────────────────

function FactoryScene() {
  // Track which station is currently active (bot is docked there)
  const activeStationRef = useRef<{ idx: number; docked: boolean }>({ idx: -1, docked: false });
  const machinesRef = useRef<{ [id: string]: boolean }>({});

  const stations = useMemo(
    () =>
      STATIONS.map((def, i) => ({
        def,
        position: [stationX(i), 0, 0] as [number, number, number],
      })),
    []
  );

  return (
    <>
      {/* Sunset HDR — drives realistic ambient lighting + reflections + sky background */}
      <Environment files="/factory-assets/hdri/sunset.hdr" background />

      {/* Sun direction key light */}
      <directionalLight
        position={[24, 32, 18]}
        intensity={1.2}
        color="#fff5e6"
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-left={-40}
        shadow-camera-right={40}
        shadow-camera-top={40}
        shadow-camera-bottom={-40}
      />
      <hemisphereLight args={["#86EFAC", "#0a0c10", 0.5]} />

      {/* Atmospheric fog */}
      <fog attach="fog" args={["#1a2530", 80, 220]} />

      {/* Outdoor ground beyond building */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.001, 0]} receiveShadow>
        <planeGeometry args={[260, 260]} />
        <meshStandardMaterial color="#15191e" roughness={0.95} metalness={0.05} />
      </mesh>

      <Mountains />
      <ReflectingPool />
      <PalmTree position={[-26, 0, FLOOR_D / 2 + 5]} />
      <PalmTree position={[26, 0, FLOOR_D / 2 + 5]} />
      <PalmTree position={[-32, 0, FLOOR_D / 2 + 16]} />
      <PalmTree position={[32, 0, FLOOR_D / 2 + 16]} />

      <Building />
      <FactoryFloor />
      <ConveyorBelt />
      <CeilingLights />

      {stations.map(({ def, position }, i) => (
        <Machine
          key={def.id}
          def={def}
          position={position}
          active={activeStationRef.current.idx === i && activeStationRef.current.docked}
        />
      ))}

      {/* The bot — drives station-active state */}
      <StrategyBot
        onStationChange={(idx, docked) => {
          activeStationRef.current = { idx, docked };
          // Force re-render of machines via a counter or signal — handled via state in parent
          machinesRef.current[STATIONS[idx]?.id ?? "_"] = docked;
        }}
      />

      {/* Atmospheric dust */}
      <Sparkles
        count={150}
        scale={[FLOOR_W, BUILDING_H, FLOOR_D]}
        position={[0, BUILDING_H / 2, 0]}
        size={2}
        speed={0.4}
        opacity={0.45}
        color="#34D399"
      />

      <ContactShadows
        position={[0, 0.005, 0]}
        opacity={0.6}
        scale={LINE_LEN + 8}
        blur={2.4}
        far={6}
      />

      {/* Post-processing — SSAO for depth shadows + bloom for glow + DoF for cinematic look */}
      <EffectComposer multisampling={2}>
        <SSAO
          blendFunction={BlendFunction.MULTIPLY}
          samples={16}
          rings={4}
          distanceThreshold={1.0}
          distanceFalloff={0.0}
          rangeThreshold={0.5}
          rangeFalloff={0.1}
          luminanceInfluence={0.7}
          radius={20}
          bias={0.5}
          intensity={1.5}
          worldDistanceThreshold={0.5}
          worldDistanceFalloff={0.1}
          worldProximityThreshold={0.5}
          worldProximityFalloff={0.1}
        />
        <Bloom
          intensity={0.95}
          luminanceThreshold={0.5}
          luminanceSmoothing={0.45}
          mipmapBlur
        />
        <DepthOfField focusDistance={0.012} focalLength={0.04} bokehScale={2.0} />
        <Vignette eskil={false} offset={0.3} darkness={0.65} />
      </EffectComposer>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Wrapper that provides station-active state to Machines via React state
// (Machines re-render when active station changes.)
// ─────────────────────────────────────────────────────────────────────────

import { useState, useEffect } from "react";

function FactorySceneStateful() {
  const [activeStation, setActiveStation] = useState<{ idx: number; docked: boolean }>({ idx: -1, docked: false });

  // Derive station positions
  const stations = useMemo(
    () =>
      STATIONS.map((def, i) => ({
        def,
        position: [stationX(i), 0, 0] as [number, number, number],
      })),
    []
  );

  return (
    <>
      <Environment files="/factory-assets/hdri/sunset.hdr" background />
      <directionalLight
        position={[24, 32, 18]}
        intensity={1.2}
        color="#fff5e6"
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-left={-40}
        shadow-camera-right={40}
        shadow-camera-top={40}
        shadow-camera-bottom={-40}
      />
      <hemisphereLight args={["#86EFAC", "#0a0c10", 0.5]} />
      <fog attach="fog" args={["#1a2530", 80, 220]} />

      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.001, 0]} receiveShadow>
        <planeGeometry args={[260, 260]} />
        <meshStandardMaterial color="#15191e" roughness={0.95} metalness={0.05} />
      </mesh>

      <Mountains />
      <ReflectingPool />
      <PalmTree position={[-26, 0, FLOOR_D / 2 + 5]} />
      <PalmTree position={[26, 0, FLOOR_D / 2 + 5]} />
      <PalmTree position={[-32, 0, FLOOR_D / 2 + 16]} />
      <PalmTree position={[32, 0, FLOOR_D / 2 + 16]} />

      <Building />
      <FactoryFloor />
      <ConveyorBelt />
      <CeilingLights />

      {stations.map(({ def, position }, i) => (
        <Machine
          key={def.id}
          def={def}
          position={position}
          active={activeStation.idx === i && activeStation.docked}
        />
      ))}

      <StrategyBot
        onStationChange={(idx, docked) => {
          setActiveStation({ idx, docked });
        }}
      />

      <Sparkles
        count={150}
        scale={[FLOOR_W, BUILDING_H, FLOOR_D]}
        position={[0, BUILDING_H / 2, 0]}
        size={2}
        speed={0.4}
        opacity={0.45}
        color="#34D399"
      />

      <ContactShadows
        position={[0, 0.005, 0]}
        opacity={0.6}
        scale={LINE_LEN + 8}
        blur={2.4}
        far={6}
      />

      <EffectComposer multisampling={2}>
        <SSAO
          blendFunction={BlendFunction.MULTIPLY}
          samples={16}
          rings={4}
          distanceThreshold={1.0}
          distanceFalloff={0.0}
          rangeThreshold={0.5}
          rangeFalloff={0.1}
          luminanceInfluence={0.7}
          radius={20}
          bias={0.5}
          intensity={1.5}
          worldDistanceThreshold={0.5}
          worldDistanceFalloff={0.1}
          worldProximityThreshold={0.5}
          worldProximityFalloff={0.1}
        />
        <Bloom intensity={0.85} luminanceThreshold={0.55} luminanceSmoothing={0.45} mipmapBlur />
        <Vignette eskil={false} offset={0.3} darkness={0.6} />
      </EffectComposer>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// PAGE
// ─────────────────────────────────────────────────────────────────────────

export default function ForgeFactory() {
  useStrategies();

  return (
    <div
      className="-mx-6 -mt-2 -mb-10"
      style={{ height: "calc(100vh - 80px)", position: "relative" }}
    >
      <Canvas
        shadows
        dpr={[1, 2]}
        camera={{ position: [22, 14, 50], fov: 48 }}
        gl={{ antialias: true, alpha: false, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.0 }}
      >
        <Suspense fallback={null}>
          <FactorySceneStateful />
        </Suspense>
        <OrbitControls
          enablePan={false}
          minDistance={18}
          maxDistance={90}
          minPolarAngle={0.15}
          maxPolarAngle={Math.PI / 2 - 0.05}
          autoRotate
          autoRotateSpeed={0.25}
          target={[0, 5, 0]}
        />
      </Canvas>
    </div>
  );
}
