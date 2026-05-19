/**
 * /command-room — the new Forge Factory.
 *
 * Phase 1 deliverable: 3D room (VR Study Room asset, Pikas CC BY 4.0), first-
 * person walk, static subsystem whiteboard, and a working red wall button that
 * hits the existing /api/admin/pipeline/{start,pause} endpoints.
 *
 * Performance posture:
 *   - The page is lazy-loaded by App.tsx — the FBX (~4MB) + textures (~100MB)
 *     are NEVER fetched unless the operator visits this route.
 *   - Canvas runs in `frameloop="demand"`. With no input the GPU is idle.
 *   - When the browser tab is hidden (visibilitychange), we never re-render.
 *   - dpr capped to [1, 1.5] — caps fragment-shader cost on 4K displays.
 */

import { useEffect, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { Loader } from "@react-three/drei";
import { CommandRoomScene } from "@/components/command-room/Scene";
import { MovementPad } from "@/components/command-room/MovementPad";
import { IncidentOverlay } from "@/components/command-room/IncidentOverlay";
import { usePipelineMode } from "@/hooks/usePipelineMode";

export default function CommandRoom() {
  const [hidden, setHidden] = useState(typeof document !== "undefined" && document.hidden);
  const { mode, isActive, isPaused, isVacation, isPending } = usePipelineMode();

  useEffect(() => {
    const onVis = () => setHidden(document.hidden);
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  const stateLabel = isPaused
    ? "PAUSED"
    : isVacation
    ? "VACATION"
    : isActive
    ? "ACTIVE"
    : mode;
  const stateColor = isPaused
    ? "#ef4444"
    : isVacation
    ? "#f59e0b"
    : "#10B981";

  return (
    <div className="relative h-[calc(100vh-72px)] -mx-6 -mt-6 bg-black overflow-hidden">
      {/* HUD — top bar */}
      <div className="absolute top-0 left-0 right-0 z-10 pointer-events-none">
        <div className="flex items-center justify-between px-6 py-3">
          <div className="flex items-center gap-4">
            <div className="text-[10px] tracking-[0.32em] text-emerald-400 font-bold">
              TRADING FORGE · COMMAND ROOM
            </div>
            <div className="h-4 w-px bg-white/10" />
            <div className="text-xs text-text-secondary">
              Walk: <span className="text-foreground font-mono">WASD</span> &nbsp;·&nbsp;
              Look: <span className="text-foreground font-mono">click + mouse</span> &nbsp;·&nbsp;
              Release: <span className="text-foreground font-mono">Esc</span>
            </div>
          </div>

          <div className="flex items-center gap-3 pointer-events-auto">
            <div
              className="flex items-center gap-2 px-3 py-1.5 rounded-full border text-[11px] tracking-[0.18em] font-semibold"
              style={{
                borderColor: `${stateColor}55`,
                background: `${stateColor}15`,
                color: stateColor,
              }}
            >
              <span
                className="inline-block h-2 w-2 rounded-full"
                style={{
                  backgroundColor: stateColor,
                  boxShadow: `0 0 8px ${stateColor}`,
                }}
              />
              {stateLabel}
              {isPending && <span className="opacity-60">…</span>}
            </div>
          </div>
        </div>
      </div>

      {/* The 3D canvas */}
      <Canvas
        gl={{
          antialias: true,
          powerPreference: "high-performance",
          // Stop WebGL preserveDrawingBuffer (saves memory)
          preserveDrawingBuffer: false,
        }}
        dpr={[1, 1.5]}
        frameloop={hidden ? "never" : "demand"}
        camera={{ fov: 72, near: 0.05, far: 80, position: [0, 1.65, -1.0] }}
      >
        <color attach="background" args={["#0c1218"]} />
        {/* No fog — the room is small (~14m) and fog was bleeding the back wall to black */}
        <CommandRoomScene />
      </Canvas>

      {/* On-screen movement pad — click/touch navigation alongside WASD */}
      <MovementPad />

      {/* SSE incident receiver — toasts on critical events (firm suspension,
          exchange outage, kill switch, drift, Windows reboot pending) */}
      <IncidentOverlay />

      {/* Asset attribution — CC BY 4.0 requires credit */}
      <div className="absolute bottom-3 right-4 z-10 text-[10px] text-text-muted/70 pointer-events-none select-none">
        Room asset: <span className="text-text-secondary">VR New Study Room</span> ·
        © Pikas, <a
          href="https://creativecommons.org/licenses/by/4.0/"
          className="underline pointer-events-auto"
          target="_blank"
          rel="noreferrer noopener"
        >CC BY 4.0</a>
      </div>

      {/* Drei loader — covers the FBX parse on first hit */}
      <Loader
        containerStyles={{ background: "rgba(5,8,12,0.92)" }}
        innerStyles={{ background: "#10B981" }}
        barStyles={{ background: "#10B981" }}
        dataStyles={{ color: "#94a3b8", fontFamily: "Inter, sans-serif", letterSpacing: "0.18em", fontSize: 11 }}
        dataInterpolation={(p) => `LOADING COMMAND ROOM · ${p.toFixed(0)}%`}
      />
    </div>
  );
}
