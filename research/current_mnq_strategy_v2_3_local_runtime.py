#!/usr/bin/env python3
"""Runtime locality guard for TopstepX/ProjectX production operations.

Topstep's current API policy prohibits trading activity from VPS/VPN/remote
servers. Production order submission therefore fails closed when common hosted
CI/cloud environments are detected. Synthetic tests and offline research may run
in CI; credentialed broker/order operations may not.
"""
from __future__ import annotations

import os
import platform
from dataclasses import dataclass

REMOTE_ENV_VARS = (
    "GITHUB_ACTIONS",
    "GITLAB_CI",
    "CIRCLECI",
    "BUILDKITE",
    "JENKINS_URL",
    "CODESPACES",
    "RAILWAY_ENVIRONMENT",
    "RENDER",
    "FLY_APP_NAME",
    "DYNO",
    "AWS_EXECUTION_ENV",
    "K_SERVICE",
    "WEBSITE_INSTANCE_ID",
)


@dataclass(frozen=True)
class RuntimeLocality:
    remote_markers: tuple[str, ...]
    generic_ci: bool
    hostname: str
    os_name: str

    @property
    def personal_device_candidate(self) -> bool:
        return not self.remote_markers and not self.generic_ci


def inspect_runtime(env: dict[str, str] | None = None) -> RuntimeLocality:
    e = dict(os.environ if env is None else env)
    markers = tuple(sorted(k for k in REMOTE_ENV_VARS if str(e.get(k, "")).strip()))
    generic_ci = str(e.get("CI", "")).strip().lower() in {"1", "true", "yes", "on"}
    return RuntimeLocality(
        remote_markers=markers,
        generic_ci=generic_ci,
        hostname=platform.node(),
        os_name=platform.platform(),
    )


def require_personal_device(operation: str, env: dict[str, str] | None = None) -> RuntimeLocality:
    locality = inspect_runtime(env)
    if not locality.personal_device_candidate:
        details = ",".join(locality.remote_markers) or "CI"
        raise RuntimeError(f"REMOTE_RUNTIME_REFUSE:{operation}:{details}")
    return locality


def require_live_arming_phrase(env: dict[str, str] | None = None) -> None:
    e = os.environ if env is None else env
    if str(e.get("MNQ_V23_LIVE_ARM", "")) != "I_ACCEPT_LIVE_ORDER_RISK":
        raise RuntimeError("LIVE_ARMING_PHRASE_MISSING")
