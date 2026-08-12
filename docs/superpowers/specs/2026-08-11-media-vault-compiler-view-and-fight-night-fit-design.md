# Media Vault Compiler View and Fight Night Desktop Fit

Date: 2026-08-11

## Purpose

Harden two existing Slumhouse Office surfaces:

1. Make Paper Fight Night fully visible on a standard desktop viewport without page scrolling or clipped arena content.
2. Add a read-only Compiler View to the existing Media Evidence Vault so the operator can see how source evidence becomes a trading blueprint. This is a visualization of existing extraction and compiler receipts, not a new compiler, gate, or source of trading truth.

## Scope

### In scope

- A `Compiler View` action on the selected strategy card in the Vault right rail.
- Replacing the Vault main-left stage with a cinematic compiler visualization while preserving the right rail.
- A complete seven-second transformation every time Compiler View is clicked.
- A visually rich source-only placeholder for strategies with no compiler receipt.
- Per-video visual identity derived deterministically from the YouTube thumbnail/video identifier.
- Honest visual states for uncompiled, compiling, passed, refused, stale, and unavailable evidence.
- Desktop viewport fitting for both quiet and live Paper Fight Night states.
- Reduced-motion, WebGL failure, keyboard, and low-power fallbacks.

### Out of scope

- Changes to extraction, compilation, strategy rules, gates, lifecycle authority, or trading execution.
- Fabricated example rules, fake compilation progress, or inferred browser-side strategy logic.
- AI-generated background plates or externally hosted runtime assets.
- Editing or approving a strategy from the visualization.

## Experience

### Entry and mode switching

The selected strategy card in the right rail gains a compact `Compiler View` button aligned to the right of the strategy name. Activating it keeps the right rail in place and replaces the complete main-left stage. While active, the action becomes `Media View`; returning restores the existing video, provenance, linked receipts, and transcript view.

Every activation of Compiler View replays the complete cinematic sequence. The sequence targets seven seconds:

1. The selected video plane detaches from the media stage.
2. source-bound transcript fragments and timestamps stream into depth.
3. A per-video-colored compiler storm forms.
4. Seven rule chambers assemble: Context, Setup, Entry, Stop, Exit, Sizing, and Filters.
5. Evidence fragments resolve according to their real receipt state.
6. The scene settles into an interactive read-only blueprint or honest source-only placeholder.

### Visual identity

The environment is an infinite black compiler chamber rendered in real time. It uses procedural fog, perspective particles, a restrained reflective horizon, source planes, and disciplined lighting. It does not use an AI-generated background.

Each video receives a deterministic visual identity. The thumbnail/video seed controls the atmospheric primary and secondary colors, storm paths, particle rhythm, and subtle chamber arrangement. Status colors remain invariant:

- Lime: verified executable compiler binding.
- Amber: derived, inferred, or framework-supplied rule.
- Red: refused, contradictory, missing, or unsupported rule.
- Steel gray: unavailable or unbound.

Source colors may tint the environment but can never replace these semantic colors.

### Source-only placeholder

An uncompiled strategy receives a complete `Ghost Compile` experience, not a blank card. Real source material powers the scene: thumbnail, source title, transcript availability, transcript size, evidence seal, and linked-source state. Rule chambers assemble but remain labeled `UNBOUND`. The sequence ends with:

`SOURCE CAPTURED · BLUEPRINT NOT YET COMPILED`

No entry, stop, target, sizing, confidence, or progress value appears unless a durable receipt supplies it. If no transcript exists, the source plane and evidence seal still drive the scene while the transcript stream is explicitly marked unavailable.

### Compiled and failure states

- `compiling`: advance only from real stage receipts; do not advance on a browser timer.
- `passed`: lock verified chambers and illuminate real engine bindings.
- `refused`: fracture only the chambers named by persisted refusal reasons.
- `stale`: keep the last known blueprint visible with an unmistakable stale timestamp and treatment.
- `unavailable`: retain the source-only scene and say the compiler receipt cannot be read.

After the cinematic, selecting a chamber exposes its exact rule, provenance class, source quotation and timestamp when available, canonical engine expression, and warnings. The visualization is read-only.

## Data Contract

The renderer consumes a strict view model assembled server-side from existing persisted facts:

```text
strategy identity
compiler state
video/source identity
source palette seed
transcript metadata and evidence seal
compiler stage receipts
rule chambers and binding states
source quotations/timestamps
canonical expressions
provenance classification
warnings/refusals/missing dependencies
receipt timestamp/hash
```

The browser renderer never parses transcript prose into rules and never decides whether a rule passed. Missing compiler data produces a deliberate source-only view model with zero compiled rules.

The first implementation may expose only source-only/uncompiled state if the existing Vault payload does not yet carry a durable compiler receipt. The UI contract must already support the other closed states without inventing them; wiring may consume an existing receipt source only when one is verified in the deployed data model.

## Rendering Architecture

- A dedicated local module owns the Compiler View lifecycle.
- A dependency-free WebGL2 layer renders the procedural storm, particles, depth, and source energy.
- Accessible DOM/CSS-3D elements render rule chambers, labels, receipts, controls, and fallback content.
- The module lazy-initializes on the first click and disposes GPU resources when the mode closes.
- Device pixel ratio is capped and particle density is quality-tiered.
- WebGL context loss switches to the same truthful blueprint in a static 2D presentation.
- `prefers-reduced-motion` skips vortex travel and crossfades directly into the settled scene.
- Every control is keyboard reachable; chamber details do not require pointer hover.
- No CDN, remote module, generated background, or hidden network dependency is introduced.

## Fight Night Desktop Fit

The current quiet state combines fixed minimum heights (`560px`, `520px`) with the immersive header, aggregate strip, navigation chrome, padding, and captions. That exceeds a 1080px desktop viewport and pushes the arena below the visible area.

Desktop Fight Night becomes a single viewport composition below the 62px Office chrome:

- The immersive screen height is bounded to the available dynamic viewport.
- Header, aggregate strip, panel gaps, and arena share a calculated vertical budget.
- The quiet arena uses `clamp()`/viewport-aware height instead of fixed desktop minimums.
- The arena image remains `object-fit: cover` with a protected focal point on the ring.
- Decorative caption/note content compacts into the available desktop budget rather than forcing overflow.
- Live fighter cards may scroll inside their results region when real data exceeds one screen; the overall Office page remains fixed.
- Mobile retains normal document scrolling and existing stacked behavior.
- Browser zoom and short desktop viewports receive a compact breakpoint rather than clipped content.

Target desktop checks include 1920x1080, 1600x900, 1440x900, and 1366x768 at 100% zoom. The complete quiet-state ring and status copy must be visible without scrolling.

## Error Handling and Honesty

- Missing source data produces labeled unavailable fields, not example content.
- Renderer exceptions restore Media View and display a compact read-only error state.
- WebGL context loss cannot hide compiler truth; the DOM fallback remains.
- Repeated clicks cancel the prior animation before replaying it.
- Switching strategies while Compiler View is active restarts the scene with the new strategy's deterministic seed and data.
- Stale or failed receipt requests never remain visually green.

## Verification

- Static UI contract tests pin the button, source-only honesty labels, mode restoration, semantic colors, reduced-motion path, and local-only rendering contract.
- View-model tests prove that missing compiler receipts emit no compiled rule values.
- Browser tests cover repeated replay, strategy switching, keyboard operation, WebGL fallback, and returning to Media View.
- Viewport screenshots verify Fight Night at the four desktop targets without page scroll or ring clipping.
- Existing evidence-vault, reporting-room honesty, authentication, and route tests remain green.
- Full repository completion checks run before landing: TypeScript, relevant Vitest and pytest suites, production isolation, 2026 compliance, and system map check.

## Success Criteria

- Every Compiler View click delivers the complete cinematic sequence.
- Uncompiled strategies produce a distinctive per-video `Ghost Compile` with no fabricated trading data.
- Compiled/refused/stale states can only be driven by persisted receipts.
- The visualization remains useful and readable after the cinematic ends.
- No generated background or remote rendering dependency is required.
- Fight Night's quiet desktop state fits entirely within the available viewport without scrolling.
- Existing user/session edits in other worktrees remain untouched.
