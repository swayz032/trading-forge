# Slumdawg TP Reaction-Quality Acceptance

Status: **RESEARCH / PLATFORM-PARITY CONTRACT**  
Date: 2026-08-11  
Scope: NQ/MNQ LONG and SHORT Take Profit Zone discovery

## Operator rule

A Take Profit candidate is not qualified merely because it is close to the Entry Zone or because several small pivots/body turns cluster near the same price.

The TP pipeline is ordered as:

`ENTRY -> DIRECTIONAL REACTION CANDIDATES -> REACTION-STRENGTH GATE -> MULTI-TOUCH CLUSTER -> CANONICAL SHELF FUSION -> OUTWARD ORDERING -> INSIDE-ZONE TARGET`

**Distance is downstream of quality.** It may sequence already-qualified reaction shelves. It may not manufacture quality and may not promote a weak micro-cluster ahead of a stronger first reaction shelf.

## Reaction-strength gate

For a historical LONG destination (high-side supply/rejection zone), the candidate must show a measurable move **down and away from the zone's near/lower edge** after the historical interaction.

For a historical SHORT destination (low-side demand/reaction zone), the candidate must show a measurable move **up and away from the zone's near/upper edge** after the historical interaction.

Experimental platform builds may express this displacement relative to lane ATR over a bounded confirmation window. Both the ATR threshold and confirmation-window length are **CALIBRATION_REQUIRED**. They are software/research controls, not proven NQ/MNQ trading constants.

## Hard profit-side invariant

For LONG:

- the entire auto TP shelf must be above the LONG Entry Zone plus the required structural separation;
- the displayed target must be strictly above LONG Entry;
- if the active/displayed Entry reference later rolls above a proposed TP, that TP must not be rendered as an actionable forward destination.

For SHORT, mirror all three conditions below the SHORT Entry Zone.

A target on the wrong side of Entry is a fail-closed condition, never a valid TP.

## Inside-zone placement

Qualification selects a **reaction zone**, not a wick price.

- LONG continuation: target may use the zone midpoint when BIG DIRECTION and CURRENT MOVE agree.
- LONG pullback/countertrend: target uses the safer lower/near-middle portion.
- SHORT continuation: midpoint when aligned.
- SHORT pullback/countertrend: safer upper/near-middle portion.

The displayed TP must remain strictly inside the canonical zone by at least one valid price tick when the zone is wide enough. Too-narrow zones fail closed.

## Acceptance

A build passes this contract only if:

1. weak nearby micro-structure can be rejected before distance sorting;
2. the first surviving TP is a real reaction shelf with measured historical displacement;
3. same physical shelf across 5m/15m still consumes only one TP number;
4. LONG targets remain above LONG Entry and SHORT targets remain below SHORT Entry;
5. Pine and FX Replay expose the same quality-first semantics;
6. no numeric calibration value is labeled production-approved without separate research evidence.
