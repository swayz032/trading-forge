#!/usr/bin/env python3
"""Credential-chain runner for the read-only MNQ v2.4 AWS audit.

Loads a project .env when python-dotenv is available, otherwise relies on boto3's
standard credential chain (environment, shared ~/.aws credentials/config, etc.).
No credential values are printed or written. The underlying audit remains
read-only and performs no strategy P&L.

This file is safe to execute directly as
`python research/current_mnq_strategy_v2_4_aws_audit_runner.py`: it inserts the
repository root into sys.path before importing the sibling research module.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

# Direct execution sets sys.path[0] to <repo>/research, which makes
# `from research import ...` fail. Add <repo> explicitly so both direct-file and
# `python -m research...` invocation work from any current directory.
REPO_ROOT = Path(__file__).resolve().parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))


def _load_project_dotenv() -> None:
    try:
        from dotenv import load_dotenv
    except ImportError:
        return

    # Prefer the repository .env, then fall back to cwd/parents in case the
    # user's local layout wraps the repository in another folder.
    candidates = [REPO_ROOT / ".env"]
    here = Path.cwd().resolve()
    candidates.extend(base / ".env" for base in (here, *here.parents))
    seen: set[Path] = set()
    for candidate in candidates:
        if candidate in seen:
            continue
        seen.add(candidate)
        if candidate.exists():
            load_dotenv(candidate, override=False)
            return


def _bridge_standard_boto3_credentials_into_process() -> str:
    import boto3

    _load_project_dotenv()
    session = boto3.Session(region_name=os.environ.get("AWS_REGION") or None)
    creds = session.get_credentials()
    if creds is None:
        raise RuntimeError(
            "AWS_CREDENTIALS_NOT_FOUND: boto3 could not find credentials in the current "
            "environment, project .env, or standard AWS shared credential/profile chain. "
            "Do not paste credentials into chat."
        )

    frozen = creds.get_frozen_credentials()
    os.environ.setdefault("AWS_ACCESS_KEY_ID", frozen.access_key)
    os.environ.setdefault("AWS_SECRET_ACCESS_KEY", frozen.secret_key)
    if frozen.token:
        os.environ.setdefault("AWS_SESSION_TOKEN", frozen.token)

    method = getattr(creds, "method", "unknown") or "unknown"
    return str(method)


def main() -> None:
    method = _bridge_standard_boto3_credentials_into_process()
    print(f"AWS credentials resolved safely via: {method}")
    from research import current_mnq_strategy_v2_4_aws_audit as audit
    audit.main()


if __name__ == "__main__":
    main()
