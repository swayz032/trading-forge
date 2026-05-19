/**
 * Wall-mounted Trading Forge brand poster.
 *
 * Built from primitives: dark frame mesh + emerald accent strip + Html for
 * the readable wordmark/tagline. Several presets handle the most common
 * placements without each caller hand-crafting the inner content.
 */

import { Html } from "@react-three/drei";

type PosterVariant = "logo" | "mission" | "rules";

interface BrandPosterProps {
  position: [number, number, number];
  rotationY?: number;
  width?: number;
  height?: number;
  variant?: PosterVariant;
  distanceFactor?: number;
}

function PosterContent({ variant }: { variant: PosterVariant }) {
  if (variant === "logo") {
    return (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 12,
          textAlign: "center",
          padding: 24,
          color: "#e2e8f0",
          fontFamily: "Inter, system-ui, sans-serif",
        }}
      >
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 14,
          }}
        >
          {/* Flame mark */}
          <div
            style={{
              width: 64,
              height: 64,
              borderRadius: 16,
              background:
                "radial-gradient(circle at 30% 30%, #34d399 0%, #10B981 45%, #047857 100%)",
              boxShadow: "0 0 28px rgba(16,185,129,0.45)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 36,
              color: "#06090d",
              fontWeight: 800,
            }}
          >
            ▲
          </div>
          <div style={{ textAlign: "left" }}>
            <div style={{ fontSize: 38, fontWeight: 800, letterSpacing: "-0.02em", lineHeight: 1 }}>
              FORGE
            </div>
            <div style={{ fontSize: 11, letterSpacing: "0.32em", color: "#10B981", fontWeight: 700, marginTop: 4 }}>
              TRADING LAB
            </div>
          </div>
        </div>
        <div style={{ fontSize: 12, letterSpacing: "0.18em", color: "#64748b", marginTop: 10 }}>
          AUTONOMOUS · FUTURES · PROP
        </div>
      </div>
    );
  }

  if (variant === "mission") {
    return (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          textAlign: "center",
          padding: 28,
          fontFamily: "Inter, system-ui, sans-serif",
          color: "#e2e8f0",
        }}
      >
        <div style={{ fontSize: 11, letterSpacing: "0.32em", color: "#10B981", fontWeight: 700 }}>
          THE MISSION
        </div>
        <div style={{ fontSize: 56, fontWeight: 800, lineHeight: 1, marginTop: 14, letterSpacing: "-0.02em" }}>
          $10K
        </div>
        <div style={{ fontSize: 18, fontWeight: 600, marginTop: 4, color: "#94a3b8" }}>
          per month
        </div>
        <div
          style={{
            marginTop: 22,
            paddingTop: 18,
            borderTop: "1px solid rgba(16,185,129,0.32)",
            fontSize: 13,
            letterSpacing: "0.18em",
            color: "#cbd5e1",
            lineHeight: 1.7,
          }}
        >
          ONE STRATEGY<br />
          ONE 50K ACCOUNT<br />
          NO MULTI-ACCOUNT GAMES
        </div>
      </div>
    );
  }

  // rules variant — house rules / operating principles
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        padding: 24,
        fontFamily: "Inter, system-ui, sans-serif",
        color: "#e2e8f0",
      }}
    >
      <div style={{ fontSize: 11, letterSpacing: "0.32em", color: "#10B981", fontWeight: 700 }}>
        HOUSE RULES
      </div>
      <ul
        style={{
          listStyle: "none",
          margin: 0,
          marginTop: 14,
          padding: 0,
          display: "flex",
          flexDirection: "column",
          gap: 10,
          fontSize: 14,
          lineHeight: 1.4,
        }}
      >
        <li><span style={{ color: "#10B981", fontWeight: 700, marginRight: 8 }}>01</span>Max 5 parameters per strategy</li>
        <li><span style={{ color: "#10B981", fontWeight: 700, marginRight: 8 }}>02</span>The gates decide, not the method</li>
        <li><span style={{ color: "#10B981", fontWeight: 700, marginRight: 8 }}>03</span>Walk-forward or it doesn't ship</li>
        <li><span style={{ color: "#10B981", fontWeight: 700, marginRight: 8 }}>04</span>One account must be profitable</li>
        <li><span style={{ color: "#10B981", fontWeight: 700, marginRight: 8 }}>05</span>Robustness beats optimization</li>
        <li><span style={{ color: "#10B981", fontWeight: 700, marginRight: 8 }}>06</span>Compliance beats profit</li>
      </ul>
    </div>
  );
}

export function BrandPoster({
  position,
  rotationY = 0,
  width = 1.2,
  height = 1.6,
  variant = "logo",
  distanceFactor = 0.5,
}: BrandPosterProps) {
  const frameW = width + 0.06;
  const frameH = height + 0.06;

  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      {/* Frame */}
      <mesh position={[0, 0, 0]}>
        <boxGeometry args={[frameW, frameH, 0.03]} />
        <meshStandardMaterial color="#0a0d12" metalness={0.55} roughness={0.45} />
      </mesh>

      {/* Inner emerald accent ring */}
      <mesh position={[0, 0, 0.016]}>
        <planeGeometry args={[width + 0.005, height + 0.005]} />
        <meshStandardMaterial
          color="#10B981"
          emissive="#10B981"
          emissiveIntensity={0.65}
          metalness={0}
          roughness={0.6}
        />
      </mesh>

      {/* Poster face — slight emissive so it reads in dim light */}
      <mesh position={[0, 0, 0.018]}>
        <planeGeometry args={[width, height]} />
        <meshStandardMaterial
          color="#06090d"
          emissive="#06121a"
          emissiveIntensity={0.5}
          metalness={0}
          roughness={0.5}
        />
      </mesh>

      <Html
        position={[0, 0, 0.02]}
        transform
        distanceFactor={distanceFactor}
        occlude
        style={{ pointerEvents: "none", userSelect: "none" }}
      >
        <div
          style={{
            width: width / distanceFactor * 1000,
            height: height / distanceFactor * 1000,
          }}
        >
          <PosterContent variant={variant} />
        </div>
      </Html>
    </group>
  );
}
