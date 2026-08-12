export const CINEMATIC_DURATION_MS: number;
export const STRATEGY_SLIDE_DURATION_MS: number;

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

export type StrategyCardGroup = {
  key: "trade_when" | "enter" | "protect" | "manage" | "avoid";
  label: string;
  direction: string | null;
  rules: Array<Record<string, unknown>>;
  additionalCount: number;
};

export function buildStrategyCardGroups(model: unknown): StrategyCardGroup[];

export function phaseAt(elapsedMs: number): "source" | "rupture" | "vortex" | "compression" | "shockwave" | "settled";

export function renderCompilerViewMarkup(model: unknown): string;

export function strategySlideAt(elapsedMs: number, slideCount?: number): number;

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
