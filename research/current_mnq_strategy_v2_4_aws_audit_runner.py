#!/usr/bin/env python3
"""Credential-chain runner for the read-only MNQ v2.4 AWS audit.

Loads a project .env when python-dotenv is available, otherwise relies on boto3's
standard credential chain (environment, shared ~/.aws credentials/config, etc.).
No credential values are printed or written. The underlying audit remains
read-only and performs no strategy P&L.
"""
from __future__ import annotations

import os
from pathlib import Path


def _load_project_dotenv() -> None:
    try:
        from dotenv import load_dotenv
    except ImportError:
        return

    here = Path.cwd().resolve()
    for base in (here, *here.parents):
        candidate = base / ".env"
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
