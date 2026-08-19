# Secure Development / Supply-Chain Profile

Purpose: make the indicator's engineering process compatible with enterprise secure-development expectations without pretending this document itself is a certification.

Baselines used as guidance:
- NIST SP 800-218 SSDF v1.1 (final baseline; newer revisions must be reviewed before adoption).
- OWASP ASVS 5.0.0 for any web/API/UI surfaces that expose indicator data or controls.
- SLSA v1.2 concepts for artifact/source provenance where build/deployment infrastructure supports attestations.
- GitHub native code scanning/CodeQL and secret scanning where enabled.

## 1. Source protection

Required:
- indicator changes occur on reviewed branches/PRs;
- no direct semantic/config production change without review evidence;
- protected release branch when the component approaches live-decision-support;
- CODEOWNERS/reviewer ownership before live promotion;
- commit/PR must identify whether change is code, semantics, calibration, fixture, or documentation.

## 2. CI permissions

GitHub Actions should use least privilege. The indicator verification workflow currently requires read-only repository contents. Do not grant write/token permissions without a concrete requirement.

Before release:
- review all workflow permissions;
- prefer pinned immutable action versions/SHAs where operationally practical;
- block untrusted pull-request code from receiving secrets;
- no trading credentials/data-provider secrets in indicator test workflows.

## 3. Static/security analysis

For the enclosing Trading Forge repo:
- CodeQL/code scanning where supported;
- secret scanning;
- dependency review/vulnerability scanning;
- lint/type/static-analysis gates appropriate to each language;
- explicit review of any third-party Pine/FXR snippets before inclusion.

Indicator-specific Python reference code should remain dependency-light so semantic tests do not depend on large mutable third-party stacks.

## 4. Dependency policy

- Every runtime dependency must have owner, purpose, version policy, and removal path.
- Research-only dependencies cannot silently become live-runtime dependencies.
- Lock/pin dependencies for reproducible research environments.
- Separate market-data/provider SDK versions from semantic spec versions.
- Vulnerability findings affecting indicator runtime are release-blocking according to severity and exploitability.

## 5. Secrets and sensitive data

- No broker/API credentials in source, fixtures, screenshots, or logs.
- Logs should use symbol/price/time/reason-code data only as needed for verification.
- If private account/order data is added later, minimize and access-control it separately from public market-data fixtures.

## 6. Provenance

Every research/release artifact should be traceable to:
- source commit SHA;
- spec version;
- calibration/config hash;
- dataset/provider fingerprint;
- build/test workflow identity;
- timestamp;
- platform/runtime version.

For distributable artifacts, add SLSA-style provenance/attestation when the enclosing build pipeline supports it.

## 7. Vulnerability/defect response

A defect capable of changing entry/target state is treated like a high-impact correctness vulnerability even when it is not a cybersecurity exploit.

Response:
1. disable affected release label if needed;
2. preserve reproducer/evidence;
3. root-cause analysis;
4. permanent regression + mutation test;
5. semantic/config impact assessment;
6. rebuild/retest from clean source;
7. versioned release note.

## 8. Release separation

Do not combine these silently:
- semantic-rule change;
- calibration change;
- data-provider change;
- Pine/FXR implementation change;
- UI-only change.

Each must be identifiable in the release manifest so research results remain attributable.

## 9. Security is not the edge test

Passing secure-development controls does not prove trading edge. Passing statistical edge tests does not prove secure software. Both are required before an enterprise-grade live-decision-support label.
