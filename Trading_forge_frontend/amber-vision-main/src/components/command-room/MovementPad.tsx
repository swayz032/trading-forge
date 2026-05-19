/**
 * On-screen movement pad — virtual d-pad for click/touch navigation.
 *
 * Press-and-hold any direction button and FirstPersonControls picks up the
 * synthesized KeyboardEvent. No new state plumbing — we dispatch real
 * `keydown`/`keyup` events on `window`, and the existing keyboard listener
 * handles them identically to a physical key press.
 *
 * Coexists with WASD — both inputs feed the same key-state ref.
 *
 * Mouse-look: the existing PointerLockControls owns mouse-look. To rotate
 * the camera without locking the pointer, drag the look-zone in the
 * bottom-right (drag = camera yaw/pitch). Useful on touch devices and demos.
 */

import { useEffect, useRef, useState } from "react";

const DIR_KEYS: Record<string, string> = {
  forward: "KeyW",
  backward: "KeyS",
  left: "KeyA",
  right: "KeyD",
};

function fireKey(code: string, type: "keydown" | "keyup") {
  window.dispatchEvent(new KeyboardEvent(type, { code, bubbles: true }));
}

interface DirButtonProps {
  dir: keyof typeof DIR_KEYS;
  label: string;
  style?: React.CSSProperties;
}

function DirButton({ dir, label, style }: DirButtonProps) {
  const heldRef = useRef(false);

  const press = () => {
    if (heldRef.current) return;
    heldRef.current = true;
    fireKey(DIR_KEYS[dir], "keydown");
  };
  const release = () => {
    if (!heldRef.current) return;
    heldRef.current = false;
    fireKey(DIR_KEYS[dir], "keyup");
  };

  // Release on unmount to avoid stuck keys
  useEffect(() => () => release(), []);

  return (
    <button
      type="button"
      aria-label={`Move ${dir}`}
      onMouseDown={press}
      onMouseUp={release}
      onMouseLeave={release}
      onTouchStart={(e) => { e.preventDefault(); press(); }}
      onTouchEnd={(e) => { e.preventDefault(); release(); }}
      onTouchCancel={release}
      style={{
        width: 56,
        height: 56,
        borderRadius: 12,
        background: "rgba(8,12,18,0.78)",
        border: "1px solid rgba(16,185,129,0.32)",
        color: "#10B981",
        fontSize: 22,
        fontWeight: 700,
        fontFamily: "Inter, system-ui, sans-serif",
        cursor: "pointer",
        userSelect: "none",
        backdropFilter: "blur(6px)",
        boxShadow: "0 8px 22px rgba(0,0,0,0.4), 0 0 0 1px rgba(16,185,129,0.04) inset",
        ...style,
      }}
    >
      {label}
    </button>
  );
}

export function MovementPad() {
  const [hidden, setHidden] = useState(false);

  return (
    <div
      style={{
        position: "absolute",
        left: 24,
        bottom: 28,
        zIndex: 20,
        display: hidden ? "none" : "grid",
        gridTemplateColumns: "repeat(3, 56px)",
        gridTemplateRows: "repeat(3, 56px)",
        gap: 6,
        pointerEvents: "auto",
      }}
    >
      {/* row 1 */}
      <div />
      <DirButton dir="forward" label="↑" />
      <div />

      {/* row 2 */}
      <DirButton dir="left" label="←" />
      <div
        style={{
          width: 56,
          height: 56,
          borderRadius: 12,
          background: "rgba(8,12,18,0.6)",
          border: "1px dashed rgba(16,185,129,0.18)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "rgba(16,185,129,0.6)",
          fontSize: 9,
          letterSpacing: "0.18em",
          fontWeight: 700,
          fontFamily: "Inter, system-ui, sans-serif",
        }}
        onClick={() => setHidden(true)}
        role="button"
        title="Hide pad — press any WASD key to bring back"
      >
        WALK
      </div>
      <DirButton dir="right" label="→" />

      {/* row 3 */}
      <div />
      <DirButton dir="backward" label="↓" />
      <div />
    </div>
  );
}
