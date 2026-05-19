/**
 * First-person walk controls for the Command Room.
 *
 * Click the canvas to lock the pointer (mouse-look). WASD or arrow keys to walk.
 * Camera height is fixed at human eye-level (~1.65 m). Movement is clamped to a
 * rectangular floor envelope so the user can't walk through walls.
 *
 * Performance:
 *   - Movement runs inside useFrame; the parent <Canvas frameloop="demand"> is
 *     overridden to "always" only while a movement key is held — pressing W
 *     calls `invalidate()` on Three.js' default render loop. Hands-off (no key)
 *     means no re-render → near-zero GPU cost when the operator is reading.
 *   - PointerLockControls release on Esc or when the user changes route.
 */

import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { PointerLockControls } from "@react-three/drei";
import * as THREE from "three";

interface FirstPersonControlsProps {
  /** AABB bounds the camera is clamped to: [minX, minZ, maxX, maxZ]. */
  bounds?: [number, number, number, number];
  /** Eye height in metres. Default 1.65. */
  eyeHeight?: number;
  /** Walk speed (m/s). Default 3.2 (slightly faster than realistic, feels right in VR). */
  speed?: number;
}

const KEYS_FORWARD = ["KeyW", "ArrowUp"];
const KEYS_BACKWARD = ["KeyS", "ArrowDown"];
const KEYS_LEFT = ["KeyA", "ArrowLeft"];
const KEYS_RIGHT = ["KeyD", "ArrowRight"];

export function FirstPersonControls({
  bounds = [-15, -15, 15, 15],
  eyeHeight = 1.65,
  speed = 3.2,
}: FirstPersonControlsProps) {
  const { camera, invalidate } = useThree();
  const keys = useRef<Record<string, boolean>>({});
  const tmpDir = useRef(new THREE.Vector3());
  const tmpRight = useRef(new THREE.Vector3());

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      keys.current[e.code] = true;
      // Wake the demand-mode render loop so the camera position update applies.
      invalidate();
    };
    const up = (e: KeyboardEvent) => {
      keys.current[e.code] = false;
      invalidate();
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [invalidate]);

  useFrame((_, delta) => {
    const k = keys.current;
    const fwd = KEYS_FORWARD.some((c) => k[c]);
    const back = KEYS_BACKWARD.some((c) => k[c]);
    const left = KEYS_LEFT.some((c) => k[c]);
    const right = KEYS_RIGHT.some((c) => k[c]);

    if (!fwd && !back && !left && !right) return;

    // Forward direction is the camera's look-at on the XZ plane.
    camera.getWorldDirection(tmpDir.current);
    tmpDir.current.y = 0;
    tmpDir.current.normalize();

    // Right = forward × up.
    tmpRight.current.crossVectors(tmpDir.current, camera.up).normalize();

    const step = speed * delta;
    if (fwd) camera.position.addScaledVector(tmpDir.current, step);
    if (back) camera.position.addScaledVector(tmpDir.current, -step);
    if (right) camera.position.addScaledVector(tmpRight.current, step);
    if (left) camera.position.addScaledVector(tmpRight.current, -step);

    // Clamp to room bounds + keep eye height fixed.
    camera.position.x = Math.min(Math.max(camera.position.x, bounds[0]), bounds[2]);
    camera.position.z = Math.min(Math.max(camera.position.z, bounds[1]), bounds[3]);
    camera.position.y = eyeHeight;

    // Keep rendering while keys are held.
    invalidate();
  });

  return <PointerLockControls makeDefault />;
}
