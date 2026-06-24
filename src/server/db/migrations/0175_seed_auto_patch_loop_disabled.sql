-- 0175_seed_auto_patch_loop_disabled.sql
-- F-5 fix (Wave B): seed the auto_patch_loop_enabled kill-switch row with
-- current_value = 'false' (DISABLED).
--
-- The pattern aggregator is now FAIL-CLOSED: an absent row means disabled.
-- This migration ensures every environment (dev/staging/prod) starts with an
-- explicit row so operator intent is always queryable.
--
-- Idempotent: INSERT ... ON CONFLICT DO NOTHING — safe to run multiple times.
-- To enable the loop: UPDATE system_parameters SET current_value = 'true'
--   WHERE param_name = 'auto_patch_loop_enabled';
INSERT INTO system_parameters (id, param_name, current_value, description, domain, auto_tunable)
VALUES (
  gen_random_uuid(),
  'auto_patch_loop_enabled',
  'false',
  'Pattern aggregator + quantum-replay kill switch. Only the exact string ''true'' enables the LLM-mutation loop. Default: disabled (fail-closed). Set to ''true'' after validating the loop end-to-end.',
  'critic',
  false
)
ON CONFLICT (param_name) DO NOTHING;
