/**
 * Whiteboard / command screen at the front of the room.
 *
 * Phase 1: STATIC content. Shows the 7-stage Trading Forge pipeline plus the
 * always-on safety subsystems, each with its baby-level one-liner. Phase 2 will
 * bind live data (subsystem states, current strategy in flight, incident
 * markers).
 *
 * Rendered as <Html transform> so the text stays crisp and the operator can
 * read it from anywhere in the room. Trading Forge branded — emerald accents,
 * dark glass background, no marketing copy.
 */

import { Html } from "@react-three/drei";
import {
  STAGE_LABELS,
  STAGE_ORDER,
  STAGE_TAGLINES,
  subsystemsByStage,
} from "@/data/subsystem-explainers";

interface WhiteboardProps {
  /** World position of the TV centre. Default places it on the front wall. */
  position?: [number, number, number];
  /** Yaw rotation in radians. */
  rotationY?: number;
  /** distanceFactor for <Html transform>. Lower = larger apparent size in scene. */
  distanceFactor?: number;
  /** TV width in metres. Default 3.4m for the centerpiece. */
  width?: number;
  /** TV height in metres. Default 1.95m. */
  height?: number;
}

/**
 * Front Command TV — wall-mounted board showing the lifecycle pipeline in
 * plain English. Same bezel + chin pattern as WallTV but bigger and
 * centred on the front wall as the room's focal point.
 */
export function Whiteboard({
  position = [0, 1.85, -7.55],
  rotationY = 0,
  distanceFactor = 1.55,
  width = 3.4,
  height = 1.95,
}: WhiteboardProps) {
  const bezelW = width + 0.1;
  const bezelH = height + 0.18;
  const chinH = 0.1;

  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      {/* Mounting arm — short bar between wall and TV back */}
      <mesh position={[0, 0, -0.08]}>
        <boxGeometry args={[0.5, 0.4, 0.08]} />
        <meshStandardMaterial color="#0a0d12" metalness={0.85} roughness={0.35} />
      </mesh>

      {/* Bezel back-plate */}
      <mesh position={[0, 0, -0.025]}>
        <boxGeometry args={[bezelW, bezelH, 0.06]} />
        <meshStandardMaterial color="#080b10" metalness={0.7} roughness={0.4} />
      </mesh>

      {/* Screen — emissive plane so it self-illuminates */}
      <mesh position={[0, chinH / 2, 0.012]}>
        <planeGeometry args={[width, height]} />
        <meshStandardMaterial
          color="#06090d"
          emissive="#06121a"
          emissiveIntensity={0.6}
          metalness={0}
          roughness={0.4}
        />
      </mesh>

      {/* Emerald chin strip with brand mark */}
      <mesh position={[0, -height / 2 + chinH / 2, 0.014]}>
        <planeGeometry args={[width, chinH]} />
        <meshStandardMaterial
          color="#10B981"
          emissive="#10B981"
          emissiveIntensity={1.2}
          metalness={0}
          roughness={0.6}
        />
      </mesh>

      {/* Brand label printed on the chin */}
      <Html
        position={[0, -height / 2 + chinH / 2, 0.016]}
        transform
        distanceFactor={distanceFactor}
        style={{ pointerEvents: "none", userSelect: "none" }}
      >
        <div
          style={{
            fontSize: 18,
            letterSpacing: "0.32em",
            fontWeight: 800,
            color: "#06090d",
            fontFamily: "Inter, system-ui, sans-serif",
            whiteSpace: "nowrap",
          }}
        >
          TRADING FORGE · COMMAND BOARD
        </div>
      </Html>

      {/* Screen content — multi-card subsystem map */}
      <Html
        position={[0, chinH / 2, 0.014]}
        transform
        distanceFactor={distanceFactor}
        occlude
        style={{
          pointerEvents: "none",
          userSelect: "none",
          fontFamily: "Inter, system-ui, sans-serif",
        }}
      >
      <div
        style={{
          width: 1100,
          padding: "28px 36px",
          background:
            "linear-gradient(180deg, rgba(8,12,18,0.94) 0%, rgba(6,10,14,0.97) 100%)",
          border: "1px solid rgba(16,185,129,0.28)",
          borderRadius: 14,
          boxShadow:
            "0 0 0 1px rgba(16,185,129,0.06) inset, 0 24px 64px rgba(0,0,0,0.6)",
          color: "#e2e8f0",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            paddingBottom: 14,
            borderBottom: "1px solid rgba(255,255,255,0.06)",
          }}
        >
          <div>
            <div
              style={{
                fontSize: 11,
                letterSpacing: "0.32em",
                color: "#10B981",
                fontWeight: 700,
              }}
            >
              TRADING FORGE · COMMAND BOARD
            </div>
            <div
              style={{
                fontSize: 26,
                fontWeight: 600,
                marginTop: 4,
                letterSpacing: "-0.01em",
              }}
            >
              The pipeline, in plain English
            </div>
          </div>
          <div
            style={{
              fontSize: 11,
              letterSpacing: "0.18em",
              color: "#64748b",
              textAlign: "right",
            }}
          >
            ONE STRATEGY · ONE 50K ACCOUNT
            <br />
            <span style={{ color: "#10B981" }}>$10,000 / month target</span>
          </div>
        </div>

        {/* Stage grid */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(4, 1fr)",
            gap: 12,
            marginTop: 16,
          }}
        >
          {STAGE_ORDER.filter((s) => s !== "safety").map((stage) => {
            const items = subsystemsByStage(stage);
            return (
              <div
                key={stage}
                style={{
                  background: "rgba(11,17,24,0.72)",
                  border: "1px solid rgba(16,185,129,0.18)",
                  borderRadius: 10,
                  padding: "12px 14px",
                  minHeight: 168,
                }}
              >
                <div
                  style={{
                    fontSize: 11,
                    letterSpacing: "0.16em",
                    color: "#10B981",
                    fontWeight: 700,
                  }}
                >
                  {STAGE_LABELS[stage].toUpperCase()}
                </div>
                <div
                  style={{
                    fontSize: 12,
                    color: "#94a3b8",
                    marginTop: 4,
                    marginBottom: 10,
                    lineHeight: 1.35,
                  }}
                >
                  {STAGE_TAGLINES[stage]}
                </div>
                <ul
                  style={{
                    listStyle: "none",
                    padding: 0,
                    margin: 0,
                    display: "flex",
                    flexDirection: "column",
                    gap: 6,
                  }}
                >
                  {items.slice(0, 4).map((s) => (
                    <li key={s.id}>
                      <div
                        style={{
                          fontSize: 13,
                          color: "#e2e8f0",
                          fontWeight: 500,
                        }}
                      >
                        {s.name}
                      </div>
                      <div
                        style={{
                          fontSize: 11,
                          color: "#64748b",
                          lineHeight: 1.4,
                        }}
                      >
                        {s.oneLiner}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>

        {/* Safety strip */}
        <div
          style={{
            marginTop: 14,
            padding: "12px 14px",
            background: "rgba(127,29,29,0.16)",
            border: "1px solid rgba(220,38,38,0.32)",
            borderRadius: 10,
          }}
        >
          <div
            style={{
              fontSize: 11,
              letterSpacing: "0.18em",
              color: "#fca5a5",
              fontWeight: 700,
              marginBottom: 8,
            }}
          >
            ALWAYS-ON SAFETY · {STAGE_TAGLINES.safety}
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(5, 1fr)",
              gap: 10,
              fontSize: 11,
              color: "#cbd5e1",
            }}
          >
            {subsystemsByStage("safety").map((s) => (
              <div key={s.id}>
                <div style={{ fontWeight: 600, color: "#f1f5f9" }}>{s.name}</div>
                <div style={{ color: "#94a3b8", lineHeight: 1.4, marginTop: 2 }}>
                  {s.oneLiner}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginTop: 14,
            fontSize: 10,
            color: "#475569",
            letterSpacing: "0.14em",
          }}
        >
          <span>WALK · WASD &nbsp;·&nbsp; LOOK · MOUSE &nbsp;·&nbsp; CLICK · INTERACT</span>
          <span>RED BUTTON ON FRONT-RIGHT WALL · HARD-PAUSE THE FORGE</span>
        </div>
      </div>
      </Html>
    </group>
  );
}
