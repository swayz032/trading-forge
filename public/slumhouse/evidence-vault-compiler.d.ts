export const CINEMATIC_DURATION_MS: number;

export type CompilerRenderProfile = {
  mode: "webgl" | "static";
  dpr: number;
  particles: number;
  durationMs: number;
};

export function deriveCompilerIdentity(seed: string): {
  seed: number;
  primary: string;
  secondary: string;
  primaryHue: number;
  secondaryHue: number;
  semantic: Record<"verified" | "inferred" | "refused" | "unbound", string>;
};

export function buildCompilerSceneModel(input: unknown): any;

export function phaseAt(elapsedMs: number): "source" | "transcript" | "storm" | "assembly" | "seal" | "settled";

export function chooseRenderProfile(input: {
  webgl2: boolean;
  reducedMotion: boolean;
  devicePixelRatio: number;
  width: number;
  hardwareConcurrency: number;
}): CompilerRenderProfile;

export function mountCompilerView(
  host: Element,
  input: unknown,
  options?: { autoplay?: boolean },
): { model: unknown; replay: () => void; destroy: () => void };
