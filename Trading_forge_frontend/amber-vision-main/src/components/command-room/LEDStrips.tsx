/**
 * Emerald LED ambient strips along the ceiling perimeter.
 *
 * Four thin emissive bars forming a rectangle just below the ceiling. Adds
 * the "trading floor" atmosphere without needing a real light pass — the
 * emissive material self-illuminates and reflects off PBR floor/wall maps.
 *
 * Performance: 4 box meshes, no shaders, no shadows. Cost is negligible.
 */

interface LEDStripsProps {
  /** Half-width of the room (X axis). Default 6.6 — slightly inset from walls. */
  halfWidth?: number;
  /** Half-depth of the room (Z axis). Default 6.6. */
  halfDepth?: number;
  /** Vertical position of the strips. Default 2.7m (just below ceiling). */
  y?: number;
  /** Strip thickness. */
  thickness?: number;
  /** Hex colour. Trading Forge emerald by default. */
  color?: string;
  /** Emissive intensity. Default 2.4 — bright but not blinding. */
  intensity?: number;
}

export function LEDStrips({
  halfWidth = 6.6,
  halfDepth = 6.6,
  y = 2.7,
  thickness = 0.04,
  color = "#10B981",
  intensity = 2.4,
}: LEDStripsProps) {
  const len = thickness;
  const matKey = `led-mat-${color}`;
  return (
    <group>
      {/* Front strip */}
      <mesh position={[0, y, -halfDepth]}>
        <boxGeometry args={[halfWidth * 2, len, len]} />
        <meshStandardMaterial
          key={`${matKey}-1`}
          color={color}
          emissive={color}
          emissiveIntensity={intensity}
          metalness={0}
          roughness={0.4}
        />
      </mesh>
      {/* Back strip */}
      <mesh position={[0, y, halfDepth]}>
        <boxGeometry args={[halfWidth * 2, len, len]} />
        <meshStandardMaterial
          key={`${matKey}-2`}
          color={color}
          emissive={color}
          emissiveIntensity={intensity}
          metalness={0}
          roughness={0.4}
        />
      </mesh>
      {/* Left strip */}
      <mesh position={[-halfWidth, y, 0]}>
        <boxGeometry args={[len, len, halfDepth * 2]} />
        <meshStandardMaterial
          key={`${matKey}-3`}
          color={color}
          emissive={color}
          emissiveIntensity={intensity}
          metalness={0}
          roughness={0.4}
        />
      </mesh>
      {/* Right strip */}
      <mesh position={[halfWidth, y, 0]}>
        <boxGeometry args={[len, len, halfDepth * 2]} />
        <meshStandardMaterial
          key={`${matKey}-4`}
          color={color}
          emissive={color}
          emissiveIntensity={intensity}
          metalness={0}
          roughness={0.4}
        />
      </mesh>

      {/* Soft point lights co-located with each strip so the colour actually
          tints the surrounding surfaces (emissive alone doesn't illuminate). */}
      <pointLight position={[0, y - 0.3, -halfDepth + 0.2]} intensity={0.5} color={color} distance={8} decay={1.6} />
      <pointLight position={[0, y - 0.3, halfDepth - 0.2]} intensity={0.5} color={color} distance={8} decay={1.6} />
      <pointLight position={[-halfWidth + 0.2, y - 0.3, 0]} intensity={0.5} color={color} distance={8} decay={1.6} />
      <pointLight position={[halfWidth - 0.2, y - 0.3, 0]} intensity={0.5} color={color} distance={8} decay={1.6} />
    </group>
  );
}
