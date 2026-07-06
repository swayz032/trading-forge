"""Regression tests for deep-scan #21 Wave-2 MED: DuckDB S3-read native crash guard.

CERTIFIED FINDING: `load_ohlcv` -> `con.execute(sql).fetchdf()` (DuckDB reading a
remote S3 parquet via httpfs) can SEGFAULT / raise a Windows access violation when
S3 credentials are missing/bad — a native crash that a Python-level
`except Exception:` cannot catch, so the whole backtest subprocess previously died
uncontrolled instead of returning a structured error.

These tests prove the pre-flight guard (`_check_s3_read_config` /
`DataLoadConfigError`) converts the missing-credentials case into a clean,
catchable, diagnosable Python exception raised BEFORE DuckDB ever touches the
network — for both the primary consolidated-file read path and the
`load_ohlcv()` public entry point (no local_path, cache-miss forced via a fresh
tmp cache dir).

Residual (documented honestly, see module docstring in data_loader.py): a
truncated S3 object or a network drop mid-transfer DURING the DuckDB fetchdf()
call is NOT covered here — that failure occurs inside DuckDB's native C++ S3
client after this guard has already passed, and reproducing it would require real
flaky-S3 / corrupted-object test infrastructure that is out of scope for this fix.
"""

from __future__ import annotations

import pytest

from src.engine.data_loader import (
    DataLoadConfigError,
    _check_s3_read_config,
    load_ohlcv,
)


# ─── Unit tests: _check_s3_read_config is a pure, cheap, no-network guard ─────

class TestCheckS3ReadConfigNonS3Sources:
    """Non-S3 sources must be completely unaffected — no-op regardless of env."""

    def test_local_path_is_noop_even_with_no_creds(self, monkeypatch):
        monkeypatch.delenv("AWS_ACCESS_KEY_ID", raising=False)
        monkeypatch.delenv("AWS_SECRET_ACCESS_KEY", raising=False)
        # Should not raise — local files never touch DuckDB's S3 reader.
        _check_s3_read_config("/local/tmp/some_fixture.parquet")

    def test_cache_path_is_noop_even_with_no_creds(self, monkeypatch, tmp_path):
        monkeypatch.delenv("AWS_ACCESS_KEY_ID", raising=False)
        monkeypatch.delenv("AWS_SECRET_ACCESS_KEY", raising=False)
        cache_like_path = str(tmp_path / "ES" / "ratio_adj" / "5min.parquet")
        # Should not raise — warm local-cache reads never touch DuckDB's S3 reader.
        _check_s3_read_config(cache_like_path)


class TestCheckS3ReadConfigHappyPath:
    """S3 sources with both creds present must be a complete no-op (byte-identical
    happy path — the whole point of a pre-flight guard is to change NOTHING when
    the read would have succeeded anyway)."""

    def test_both_creds_present_does_not_raise(self, monkeypatch):
        monkeypatch.setenv("AWS_ACCESS_KEY_ID", "AKIAFAKEEXAMPLE")
        monkeypatch.setenv("AWS_SECRET_ACCESS_KEY", "fakesecretexample")
        # Should not raise.
        _check_s3_read_config("s3://trading-forge-data/futures/ES/consolidated/5min.parquet")


class TestCheckS3ReadConfigMissingCreds:
    """The certified crash-repro case: missing AWS credentials on an S3 read must
    now raise a clean DataLoadConfigError instead of ever reaching DuckDB."""

    def test_missing_both_creds_raises_data_load_config_error(self, monkeypatch):
        monkeypatch.delenv("AWS_ACCESS_KEY_ID", raising=False)
        monkeypatch.delenv("AWS_SECRET_ACCESS_KEY", raising=False)
        with pytest.raises(DataLoadConfigError, match="AWS_ACCESS_KEY_ID"):
            _check_s3_read_config("s3://trading-forge-data/futures/ES/consolidated/5min.parquet")

    def test_missing_access_key_only_names_it_in_message(self, monkeypatch):
        monkeypatch.delenv("AWS_ACCESS_KEY_ID", raising=False)
        monkeypatch.setenv("AWS_SECRET_ACCESS_KEY", "fakesecretexample")
        with pytest.raises(DataLoadConfigError) as excinfo:
            _check_s3_read_config("s3://trading-forge-data/futures/NQ/consolidated/1hour.parquet")
        assert "AWS_ACCESS_KEY_ID" in str(excinfo.value)
        assert "AWS_SECRET_ACCESS_KEY" not in str(excinfo.value)

    def test_missing_secret_key_only_names_it_in_message(self, monkeypatch):
        monkeypatch.setenv("AWS_ACCESS_KEY_ID", "AKIAFAKEEXAMPLE")
        monkeypatch.delenv("AWS_SECRET_ACCESS_KEY", raising=False)
        with pytest.raises(DataLoadConfigError) as excinfo:
            _check_s3_read_config("s3://trading-forge-data/futures/CL/consolidated/daily.parquet")
        assert "AWS_SECRET_ACCESS_KEY" in str(excinfo.value)
        assert "AWS_ACCESS_KEY_ID" not in str(excinfo.value)

    def test_error_message_names_the_s3_path(self, monkeypatch):
        """Diagnosability: the operator must be able to see WHICH S3 path failed."""
        monkeypatch.delenv("AWS_ACCESS_KEY_ID", raising=False)
        monkeypatch.delenv("AWS_SECRET_ACCESS_KEY", raising=False)
        path = "s3://trading-forge-data/futures/MES/consolidated/15min.parquet"
        with pytest.raises(DataLoadConfigError, match="MES/consolidated/15min.parquet"):
            _check_s3_read_config(path)

    def test_empty_string_env_vars_treated_as_missing(self, monkeypatch):
        """An empty-string env var (e.g. a blank .env line) must not be treated as
        'present' — that would let a misconfigured-but-set variable slip through."""
        monkeypatch.setenv("AWS_ACCESS_KEY_ID", "")
        monkeypatch.setenv("AWS_SECRET_ACCESS_KEY", "")
        with pytest.raises(DataLoadConfigError):
            _check_s3_read_config("s3://trading-forge-data/futures/ES/consolidated/daily.parquet")

    def test_is_a_runtime_error_subclass(self):
        """DataLoadConfigError must remain catchable by generic `except Exception`
        handlers elsewhere in the codebase (it's a RuntimeError subclass) — it's a
        clean, typed exception, not an escape from the normal exception hierarchy."""
        assert issubclass(DataLoadConfigError, RuntimeError)


# ─── Integration test: load_ohlcv() itself must raise cleanly, never crash ────

class TestLoadOhlcvRefusesS3ReadWithoutCreds:
    """End-to-end: calling load_ohlcv() with no local_path, no warm cache, and no
    AWS credentials must raise DataLoadConfigError BEFORE any DuckDB S3 call is
    attempted — proving the guard is actually wired into the real code path that
    the deep-scan #21 finding identified (~data_loader.py load_ohlcv, the
    con.execute(sql).fetchdf() call), not just a standalone unit that isn't used.
    """

    def test_load_ohlcv_raises_data_load_config_error_not_a_crash(self, monkeypatch, tmp_path):
        import src.engine.data_loader as data_loader_module

        # Force a cache-miss (fresh empty cache dir) so load_ohlcv falls through to
        # the S3-consolidated-file branch instead of serving from an existing
        # developer-machine cache.
        monkeypatch.setattr(data_loader_module, "CACHE_DIR", tmp_path / "empty_cache")
        monkeypatch.delenv("AWS_ACCESS_KEY_ID", raising=False)
        monkeypatch.delenv("AWS_SECRET_ACCESS_KEY", raising=False)

        with pytest.raises(DataLoadConfigError, match="AWS_ACCESS_KEY_ID"):
            load_ohlcv(
                symbol="ES",
                timeframe="5min",
                start="2024-01-01",
                end="2024-01-31",
                # No local_path — forces the S3 code path this finding is about.
            )
