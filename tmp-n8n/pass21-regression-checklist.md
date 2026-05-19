# Wave 9 Recovery — Pass-21 Regression Checklist

Generated: 2026-05-18T01:01:14.030Z
Scope: 21 workflows imported from PRE-Pass-21 git copies

## Summary

Detected 1 workflows with Pass-21 drift patterns.

### 5P-nemo-scenario-generator

- [ ] Missing Parse Search Videos + Parse Recent Videos title-scoring nodes (Pass 21 fix)


## Always-required manual checks (Pass 21 features that scanning can't fully verify)

- [ ] 5P/5Q YouTube search nodes use `sort=relevance` (NOT default `sort=top&t=year`)
- [ ] 5P Parse Search Videos + Parse Recent Videos have title-scoring code with: positive regex `(how to|the rules|tutorial|backtest|exact rules|playbook|template)` +2, negative regex `(why .* lose|warning|exposed|scam|reaction|podcast|q&a|news|vlog)` -3, duration 10-30min +1, cap 3
- [ ] Supadata URL is `api.supadata.ai/v1/youtube/transcript` (NOT `api.supadata.com/`)
- [ ] All backend POSTs use `={{ $env.TF_BACKEND_PUBLIC_URL }}` not `host.docker.internal:4000`
- [ ] 5R Parallel.ai task_spec.output_schema.items.properties has ≤5 keys per array element
- [ ] /scout-extract endpoint has chunked-extraction fallback for transcripts > 4000 chars
- [ ] Reddit calls use Reddit's own JSON API (NEVER Apify trudax/reddit-scraper-lite — returns r/SipsTea garbage)

## Per-workflow source classification

| Workflow | Source | Pass-21 risk |
|---|---|---|
| 5G-brave-search-scout | fresh-w9 | fresh — Pass-21 baked in |
| 3A-workflow-backup | fresh-w9 | fresh — Pass-21 baked in |
| 5H-reddit-scout | fresh-w9 | fresh — Pass-21 baked in |
| Nightly Strategy Research Loop | fresh-w9 | fresh — Pass-21 baked in |
| 10A-master-orchestration | fresh-may17 | fresh — Pass-21 baked in |
| 6D-compliance-gate | fresh-may17 | fresh — Pass-21 baked in |
| Macro Data Sync - Morning (7am Skip Classifier) | fresh-may17 | fresh — Pass-21 baked in |
| Weekly Strategy Hunt | fresh-may17 | fresh — Pass-21 baked in |
| 0A-health-monitor | git-stale | MANUAL CHECK REQUIRED |
| 11A-critic-optimization | git-stale | MANUAL CHECK REQUIRED |
| 5A-weekly-tournament | git-stale | MANUAL CHECK REQUIRED |
| 5P-nemo-scenario-generator | git-stale | MANUAL CHECK REQUIRED |
| 7A-auto-evolution | git-stale | MANUAL CHECK REQUIRED |
| 8A-idea-to-strategy | git-stale | MANUAL CHECK REQUIRED |
| 8B-source-quality-review | git-stale | MANUAL CHECK REQUIRED |
| 9A-nightly-self-critique | git-stale | MANUAL CHECK REQUIRED |
| Anti-Setup Refresh | git-stale | MANUAL CHECK REQUIRED |
| Daily Compliance Check | git-stale | MANUAL CHECK REQUIRED |
| Daily Portfolio Monitor | git-stale | MANUAL CHECK REQUIRED |
| Macro Data Sync - Evening (7pm Regime Summary) | git-stale | MANUAL CHECK REQUIRED |
| Monthly Robustness Check | git-stale | MANUAL CHECK REQUIRED |
| Nightly Self-Correction | git-stale | MANUAL CHECK REQUIRED |
| Post-Session Skip Review | git-stale | MANUAL CHECK REQUIRED |
| Pre-Session Compliance Gate | git-stale | MANUAL CHECK REQUIRED |
| Pre-Session Skip Check | git-stale | MANUAL CHECK REQUIRED |
| Strategy Deep Analysis Pipeline | git-stale | MANUAL CHECK REQUIRED |
| Strategy Generation Loop | git-stale | MANUAL CHECK REQUIRED |
| Strategy Tournament | git-stale | MANUAL CHECK REQUIRED |
| Weekly Compliance Re-Parse | git-stale | MANUAL CHECK REQUIRED |