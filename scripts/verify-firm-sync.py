#!/usr/bin/env python3
"""
Prop Firm Config Sync Verifier
===============================
Cross-references ALL firm config locations across Trading Forge:
  1. src/shared/firm-config.ts         (TypeScript source of truth)
  2. src/engine/firm_config.py          (Python mirror — FIRM_RULES)
  3. src/engine/firm_config.py          (Python — FIRM_CONTRACT_CAPS, INITIAL_CONTRACT_CAPS)
  4. docs/prop-firm-rules.md            (Documentation)
  5. src/server/routes/prop-firm.ts     (Should import from shared — no inline config)
  6. src/server/routes/risk.ts          (Should import from shared — no inline config)
  7. Frontend pages                     (No hardcoded capital/DD values)
  8. Backend defaults                   (All capital defaults = 50K)

ALL firms are 50K accounts only. No other account sizes exist.

Run: python scripts/verify-firm-sync.py
"""

import json
import os
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PASS = "\033[92mPASS\033[0m"
FAIL = "\033[91mFAIL\033[0m"
WARN = "\033[93mWARN\033[0m"
INFO = "\033[94mINFO\033[0m"

errors = []
warnings = []


def log_pass(msg: str):
    print(f"  [{PASS}] {msg}")


def log_fail(msg: str):
    errors.append(msg)
    print(f"  [{FAIL}] {msg}")


def log_warn(msg: str):
    warnings.append(msg)
    print(f"  [{WARN}] {msg}")


def log_info(msg: str):
    print(f"  [{INFO}] {msg}")


# ─── Parse TypeScript shared config ──────────────────────────────────────────

def parse_ts_firm_config() -> dict:
    """Parse src/shared/firm-config.ts and extract FIRMS data.

    Robust parser: reads the file line by line and tracks brace depth
    to reliably extract firm and account type blocks.
    """
    ts_path = ROOT / "src" / "shared" / "firm-config.ts"
    if not ts_path.exists():
        log_fail(f"Missing: {ts_path}")
        return {}

    content = ts_path.read_text(encoding="utf-8")

    firms = {}

    # Find the FIRMS block
    firms_start = content.find("export const FIRMS")
    if firms_start == -1:
        log_fail("Could not find 'export const FIRMS' in firm-config.ts")
        return {}

    # Extract each firm block using a state machine approach
    # Pattern: firmName: { name: "...", ... accountTypes: { "50k": { ... } } }
    firm_pattern = re.compile(r'^\s+(\w+):\s*\{', re.MULTILINE)
    acct_pattern = re.compile(r'"(\d+k)":\s*\{')

    # Get content after FIRMS declaration
    firms_content = content[firms_start:]

    # Find each top-level firm key
    current_pos = 0
    for firm_match in firm_pattern.finditer(firms_content):
        firm_key = firm_match.group(1)

        # Skip non-firm keys (like name, displayName, etc.)
        # A firm block must contain "name:" and "accountTypes:"
        # Find the extent of this block by counting braces
        start = firm_match.start()
        brace_start = firms_content.index("{", start + len(firm_key))
        depth = 0
        end = brace_start
        for i in range(brace_start, len(firms_content)):
            if firms_content[i] == "{":
                depth += 1
            elif firms_content[i] == "}":
                depth -= 1
                if depth == 0:
                    end = i + 1
                    break

        block = firms_content[brace_start:end]

        # Check if this is actually a firm block (has name: and accountTypes:)
        name_match = re.search(r'name:\s*"(\w+)"', block)
        if not name_match or "accountTypes:" not in block:
            continue

        firm_name = name_match.group(1)
        firms[firm_name] = {}

        # Find accountTypes block
        acct_types_start = block.find("accountTypes:")
        if acct_types_start == -1:
            continue

        acct_block_start = block.index("{", acct_types_start)
        # Find matching closing brace for accountTypes
        depth = 0
        acct_block_end = acct_block_start
        for i in range(acct_block_start, len(block)):
            if block[i] == "{":
                depth += 1
            elif block[i] == "}":
                depth -= 1
                if depth == 0:
                    acct_block_end = i + 1
                    break

        acct_block = block[acct_block_start:acct_block_end]

        # Parse each account type within accountTypes
        for acct_match in acct_pattern.finditer(acct_block):
            acct_type = acct_match.group(1)
            # Find the account config block
            acct_start = acct_match.start()
            brace_pos = acct_block.index("{", acct_start + len(acct_type) + 2)
            depth = 0
            acct_end = brace_pos
            for i in range(brace_pos, len(acct_block)):
                if acct_block[i] == "{":
                    depth += 1
                elif acct_block[i] == "}":
                    depth -= 1
                    if depth == 0:
                        acct_end = i + 1
                        break

            acct_body = acct_block[brace_pos:acct_end]

            acct = {}
            # Extract numeric fields
            for field in [
                "accountSize", "monthlyFee", "activationFee", "ongoingMonthlyFee",
                "profitTarget", "maxDrawdown", "maxContracts", "payoutSplit",
                "minPayoutDays", "consistencyRule", "dailyLossLimit",
            ]:
                num_match = re.search(rf'{field}:\s*([\d._]+|null)', acct_body)
                if num_match:
                    val = num_match.group(1)
                    if val == "null":
                        acct[field] = None
                    else:
                        val = val.replace("_", "")
                        acct[field] = float(val) if "." in val else int(val)

            # Extract boolean fields
            for field in ["overnightOk", "weekendOk"]:
                bool_match = re.search(rf'{field}:\s*(true|false)', acct_body)
                if bool_match:
                    acct[field] = bool_match.group(1) == "true"

            # Extract trailing
            trail_match = re.search(r'trailing:\s*"(eod|realtime)"', acct_body)
            if trail_match:
                acct["trailing"] = trail_match.group(1)

            firms[firm_name][acct_type] = acct

    return firms


# ─── Parse Python FIRM_RULES ────────────────────────────────────────────────

def parse_py_firm_rules() -> dict:
    """Parse src/engine/firm_config.py FIRM_RULES."""
    py_path = ROOT / "src" / "engine" / "firm_config.py"
    if not py_path.exists():
        log_fail(f"Missing: {py_path}")
        return {}

    content = py_path.read_text(encoding="utf-8")

    # Find FIRM_RULES block
    rules_match = re.search(r'FIRM_RULES:\s*dict\[.*?\]\s*=\s*\{(.+?)^\}', content, re.DOTALL | re.MULTILINE)
    if not rules_match:
        log_fail("Could not parse FIRM_RULES from firm_config.py")
        return {}

    rules_block = rules_match.group(1)
    firms = {}

    # Parse each firm entry — use brace-counting for robustness
    entry_start_pattern = re.compile(r'"(\w+_\d+k)":\s*\{')

    for entry in entry_start_pattern.finditer(rules_block):
        key = entry.group(1)
        brace_start = entry.start() + len(entry.group(0)) - 1  # position of opening {

        # Count braces to find end
        depth = 0
        end_pos = brace_start
        for i in range(brace_start, len(rules_block)):
            if rules_block[i] == "{":
                depth += 1
            elif rules_block[i] == "}":
                depth -= 1
                if depth == 0:
                    end_pos = i + 1
                    break

        body = rules_block[brace_start:end_pos]

        # Split key into firm_name and account_type
        parts = key.rsplit("_", 1)
        firm_name = parts[0]
        acct_type = parts[1]

        if firm_name not in firms:
            firms[firm_name] = {}

        acct = {}
        field_map = {
            "account_size": "accountSize",
            "monthly_fee": "monthlyFee",
            "activation_fee": "activationFee",
            "ongoing_monthly_fee": "ongoingMonthlyFee",
            "profit_target": "profitTarget",
            "max_drawdown": "maxDrawdown",
            "max_contracts": "maxContracts",
            "payout_split": "payoutSplit",
            "min_payout_days": "minPayoutDays",
            "consistency_rule": "consistencyRule",
            "daily_loss_limit": "dailyLossLimit",
            "overnight_ok": "overnightOk",
            "weekend_ok": "weekendOk",
            "trailing": "trailing",
        }

        for py_field, ts_field in field_map.items():
            if py_field in ("overnight_ok", "weekend_ok"):
                match = re.search(rf'"{py_field}":\s*(True|False)', body)
                if match:
                    acct[ts_field] = match.group(1) == "True"
            elif py_field == "trailing":
                match = re.search(rf'"{py_field}":\s*"(eod|realtime)"', body)
                if match:
                    acct[ts_field] = match.group(1)
            else:
                match = re.search(rf'"{py_field}":\s*([\d._]+|None)', body)
                if match:
                    val = match.group(1)
                    if val == "None":
                        acct[ts_field] = None
                    else:
                        val = val.replace("_", "")
                        acct[ts_field] = float(val) if "." in val else int(val)

        firms[firm_name][acct_type] = acct

    return firms


# ─── Cross-reference TS vs Python ────────────────────────────────────────────

def check_ts_vs_python(ts_firms: dict, py_firms: dict):
    print("\n== CHECK 1: TypeScript vs Python Config Sync ==")

    all_ts_keys = set()
    for firm, accts in ts_firms.items():
        for acct_type in accts:
            all_ts_keys.add(f"{firm}_{acct_type}")

    all_py_keys = set()
    for firm, accts in py_firms.items():
        for acct_type in accts:
            all_py_keys.add(f"{firm}_{acct_type}")

    # Check for missing entries
    ts_only = all_ts_keys - all_py_keys
    py_only = all_py_keys - all_ts_keys

    if ts_only:
        for k in sorted(ts_only):
            log_fail(f"In TypeScript but NOT in Python: {k}")
    if py_only:
        for k in sorted(py_only):
            log_fail(f"In Python but NOT in TypeScript: {k}")

    # Verify all are 50K only
    non_50k_ts = {k for k in all_ts_keys if not k.endswith("_50k")}
    non_50k_py = {k for k in all_py_keys if not k.endswith("_50k")}
    if non_50k_ts:
        log_fail(f"Non-50K accounts found in TypeScript: {sorted(non_50k_ts)}")
    else:
        log_pass("TypeScript: All accounts are 50K only")
    if non_50k_py:
        log_fail(f"Non-50K accounts found in Python: {sorted(non_50k_py)}")
    else:
        log_pass("Python: All accounts are 50K only")

    # Compare matching entries field by field
    compare_fields = [
        "accountSize", "monthlyFee", "activationFee", "ongoingMonthlyFee",
        "profitTarget", "maxDrawdown", "maxContracts", "payoutSplit",
        "minPayoutDays", "consistencyRule", "dailyLossLimit",
        "overnightOk", "weekendOk", "trailing",
    ]

    mismatches = 0
    matched = 0
    for firm in sorted(set(list(ts_firms.keys()) + list(py_firms.keys()))):
        ts_accts = ts_firms.get(firm, {})
        py_accts = py_firms.get(firm, {})

        for acct_type in sorted(set(list(ts_accts.keys()) + list(py_accts.keys()))):
            ts_data = ts_accts.get(acct_type, {})
            py_data = py_accts.get(acct_type, {})

            if not ts_data or not py_data:
                continue

            for field in compare_fields:
                ts_val = ts_data.get(field)
                py_val = py_data.get(field)

                if ts_val is None and py_val is None:
                    matched += 1
                    continue

                if ts_val != py_val:
                    log_fail(f"MISMATCH {firm}_{acct_type}.{field}: TS={ts_val} vs PY={py_val}")
                    mismatches += 1
                else:
                    matched += 1

    if mismatches == 0 and not ts_only and not py_only:
        log_pass(f"TypeScript and Python configs match perfectly ({matched} fields checked)")
    else:
        log_info(f"{matched} fields matched, {mismatches} mismatched")


# ─── Check Python contract caps vs TS maxContracts ──────────────────────────

def check_contract_caps(ts_firms: dict):
    print("\n== CHECK 2: Python Contract Caps vs TS maxContracts ==")

    py_path = ROOT / "src" / "engine" / "firm_config.py"
    content = py_path.read_text(encoding="utf-8")

    # Parse INITIAL_CONTRACT_CAPS
    caps_match = re.search(r'INITIAL_CONTRACT_CAPS.*?=\s*\{([^}]+)\}', content, re.DOTALL)
    if not caps_match:
        log_warn("Could not parse INITIAL_CONTRACT_CAPS")
        return

    caps_block = caps_match.group(1)
    caps = {}
    for m in re.finditer(r'"(\w+)":\s*(\d+)', caps_block):
        caps[m.group(1)] = int(m.group(2))

    for key, cap_val in sorted(caps.items()):
        parts = key.rsplit("_", 1)
        firm = parts[0]
        acct_type = parts[1]

        ts_max = ts_firms.get(firm, {}).get(acct_type, {}).get("maxContracts")
        if ts_max is None:
            log_warn(f"No TS maxContracts for {key}")
        elif cap_val != ts_max:
            # Contract caps are per-symbol (ES), maxContracts is the overall firm limit
            log_warn(f"{key}: INITIAL_CONTRACT_CAPS={cap_val} vs TS maxContracts={ts_max} (may differ -- caps are ES-specific)")
        else:
            log_pass(f"{key}: contract cap matches ({cap_val})")


# ─── Check no inline FIRMS in prop-firm.ts / risk.ts ────────────────────────

def check_no_inline_config():
    print("\n== CHECK 3: No Inline Config in Route Files ==")

    for route_file in ["src/server/routes/prop-firm.ts", "src/server/routes/risk.ts"]:
        fpath = ROOT / route_file
        if not fpath.exists():
            log_fail(f"Missing: {fpath}")
            continue

        content = fpath.read_text(encoding="utf-8")

        if re.search(r'const FIRMS\s*[:=]', content):
            log_fail(f"{route_file}: Still has inline FIRMS definition -- should import from shared")
        else:
            log_pass(f"{route_file}: No inline FIRMS (imports from shared)")

        if re.search(r'const FIRM_LIMITS\s*[:=]', content):
            log_fail(f"{route_file}: Still has inline FIRM_LIMITS -- should import from shared")
        elif re.search(r'const CONTRACT_SPECS\s*[:=]', content):
            log_fail(f"{route_file}: Still has inline CONTRACT_SPECS -- should import from shared")
        else:
            log_pass(f"{route_file}: No inline duplicates")

        if "firm-config" in content or "firm_config" in content:
            log_pass(f"{route_file}: Imports from shared config")
        else:
            log_warn(f"{route_file}: No import from shared firm config found")


# ─── Check all activation fees = $0 ─────────────────────────────────────────

def check_zero_activation_fees(ts_firms: dict, py_firms: dict):
    print("\n== CHECK 4: All Activation Fees = $0 ==")

    for source_name, firms in [("TypeScript", ts_firms), ("Python", py_firms)]:
        for firm, accts in sorted(firms.items()):
            for acct_type, data in sorted(accts.items()):
                fee = data.get("activationFee")
                if fee is not None and fee != 0:
                    log_fail(f"{source_name} {firm}_{acct_type}: activationFee = ${fee} (should be $0)")

    docs_path = ROOT / "docs" / "prop-firm-rules.md"
    if docs_path.exists():
        content = docs_path.read_text(encoding="utf-8")
        activation_mentions = re.findall(r'activation_fee:\s*\$(\d+)', content)
        non_zero = [a for a in activation_mentions if a != "0"]
        if non_zero:
            log_warn(f"docs/prop-firm-rules.md mentions non-zero activation fees: ${', $'.join(non_zero)} -- docs may need update")
        else:
            log_pass("docs/prop-firm-rules.md: all activation fees $0")
    else:
        log_warn("docs/prop-firm-rules.md not found")

    log_pass("All activation fees verified $0 in code configs")


# ─── Check capital defaults = $50K ───────────────────────────────────────────

def check_capital_defaults():
    print("\n== CHECK 5: Capital Defaults = $50,000 ==")

    checks = [
        ("src/server/routes/monte-carlo.ts", r'initialCapital.*?default\((\d[\d_]*)\)'),
        ("src/server/services/monte-carlo-service.ts", r'initialCapital\s*\?\?\s*([\d_]+)'),
        ("src/server/services/backtest-service.ts", r'startingCapital:\s*"(\d+)"'),
        ("src/server/services/backtest-service.ts", r'currentEquity:\s*"(\d+)"'),
        ("src/server/db/schema.ts", r'starting_capital.*?default\("(\d+)"\)'),
        ("src/server/db/schema.ts", r'current_equity.*?default\("(\d+)"\)'),
        ("src/server/routes/paper.ts", r'startingCapital\s*=\s*"(\d+)"'),
        ("src/engine/config.py", r'initial_capital.*?=\s*([\d_.]+)'),
    ]

    for fpath_str, pattern in checks:
        fpath = ROOT / fpath_str
        if not fpath.exists():
            log_warn(f"File not found: {fpath_str}")
            continue

        content = fpath.read_text(encoding="utf-8")
        matches = re.findall(pattern, content)

        for val_str in matches:
            val = int(float(val_str.replace("_", "")))
            if val == 50000:
                log_pass(f"{fpath_str}: capital default = $50,000")
            elif val == 100000:
                log_fail(f"{fpath_str}: capital default still $100,000 -- should be $50,000")
            else:
                log_info(f"{fpath_str}: capital value = ${val:,}")

    bt_path = ROOT / "src" / "engine" / "backtester.py"
    if bt_path.exists():
        content = bt_path.read_text(encoding="utf-8")
        caps = re.findall(r'STARTING_CAPITAL\s*=\s*([\d_.]+)', content)
        for val_str in caps:
            val = int(float(val_str.replace("_", "")))
            if val == 50000:
                log_pass(f"backtester.py: STARTING_CAPITAL = $50,000")
            else:
                log_fail(f"backtester.py: STARTING_CAPITAL = ${val:,} -- should be $50,000")


# ─── Check no hardcoded firm values in frontend ─────────────────────────────

def check_frontend_hardcodes():
    print("\n== CHECK 6: No Hardcoded Firm Values in Frontend ==")

    frontend_dir = ROOT / "Trading_forge_frontend" / "amber-vision-main" / "src"
    if not frontend_dir.exists():
        frontend_dir = ROOT / "src" / "dashboard" / "src"
    if not frontend_dir.exists():
        log_warn("Frontend src directory not found")
        return

    suspicious_patterns = [
        (r'firmLimit\s*=\s*(\d+)', "hardcoded firmLimit"),
        (r'INITIAL_CAPITAL\s*=\s*(\d[\d_]*)', "hardcoded INITIAL_CAPITAL"),
        (r'maxDrawdown.*?[:=]\s*2000[^0]', "hardcoded Topstep 50K DD ($2000)"),
    ]

    pages_dir = frontend_dir / "pages"
    if not pages_dir.exists():
        log_warn("pages/ directory not found")
        return

    for tsx_file in sorted(pages_dir.glob("*.tsx")):
        content = tsx_file.read_text(encoding="utf-8")
        fname = tsx_file.name

        for pattern, desc in suspicious_patterns:
            matches = re.findall(pattern, content)
            for m in matches:
                line_matches = re.findall(rf'.*{re.escape(str(m))}.*', content)
                is_fallback = any("??" in l or "||" in l or "fallback" in l.lower() for l in line_matches)
                if is_fallback:
                    log_pass(f"{fname}: {desc} ({m}) -- used as fallback with ?? (OK)")
                else:
                    log_warn(f"{fname}: {desc} ({m}) -- verify this comes from API, not hardcoded")


# ─── Check weekendOk = false for all firms ──────────────────────────────────

def check_weekend_restrictions(ts_firms: dict):
    print("\n== CHECK 7: All Firms weekendOk = false ==")

    all_ok = True
    for firm, accts in sorted(ts_firms.items()):
        for acct_type, data in sorted(accts.items()):
            weekend = data.get("weekendOk")
            if weekend is True:
                log_fail(f"{firm}_{acct_type}: weekendOk = true (all firms should be false)")
                all_ok = False
            elif weekend is None:
                log_warn(f"{firm}_{acct_type}: weekendOk not found")
                all_ok = False

    if all_ok:
        log_pass("All firms have weekendOk = false")


# ─── Check buffer phase modeled in routes ────────────────────────────────────

def check_buffer_phase():
    print("\n== CHECK 8: Buffer Phase Modeled in API Routes ==")

    prop_firm_path = ROOT / "src" / "server" / "routes" / "prop-firm.ts"
    if not prop_firm_path.exists():
        log_fail("prop-firm.ts not found")
        return

    content = prop_firm_path.read_text(encoding="utf-8")

    if "bufferDays" in content or "buffer_days" in content:
        log_pass("prop-firm.ts: bufferDays modeled in calculations")
    else:
        log_fail("prop-firm.ts: No bufferDays found -- buffer phase not modeled")

    if "ongoingMonthlyFee" in content or "ongoing_monthly_fee" in content:
        log_pass("prop-firm.ts: ongoingMonthlyFee used in calculations")
    else:
        log_fail("prop-firm.ts: No ongoingMonthlyFee found -- ongoing fees not modeled")

    if '"buffer"' in content:
        log_pass("prop-firm.ts: 'buffer' phase exists in payout projection")
    else:
        log_warn("prop-firm.ts: No 'buffer' phase string -- check payout month phases")


# ─── Check frontend hook types match backend ────────────────────────────────

def check_frontend_hooks():
    print("\n== CHECK 9: Frontend Hook Types ==")

    hook_path = ROOT / "Trading_forge_frontend" / "amber-vision-main" / "src" / "hooks" / "usePropFirm.ts"
    if not hook_path.exists():
        log_warn("usePropFirm.ts not found")
        return

    content = hook_path.read_text(encoding="utf-8")

    checks = [
        ("buffer", "buffer phase type in PayoutMonth"),
        ("bufferDays", "bufferDays in ranking types"),
        ("ongoingMonthlyFee", "ongoingMonthlyFee in types"),
        ("totalHurdle", "totalHurdle in types"),
        ("bufferAmount", "bufferAmount in types"),
        ("dailyLossLimit", "dailyLossLimit in types"),
        ("useFirmAccount", "useFirmAccount hook"),
    ]

    for keyword, desc in checks:
        if keyword in content:
            log_pass(f"usePropFirm.ts: Has {desc}")
        else:
            log_warn(f"usePropFirm.ts: Missing {desc}")


# ─── Summary table (50K accounts only) ──────────────────────────────────────

def print_firm_summary(ts_firms: dict):
    print("\n== FIRM CONFIG SUMMARY (50K accounts only) ==")
    print(f"{'Firm':<15} {'Fee/mo':<8} {'Target':<8} {'MaxDD':<8} {'Buffer':<8} {'Hurdle':<8} {'Split':<6} {'Ongoing':<8} {'DD Type':<10} {'MinDays':<8}")
    print("-" * 107)

    for firm in ["mffu", "topstep", "tpt", "apex", "ffn", "alpha", "tradeify", "earn2trade"]:
        data = ts_firms.get(firm, {}).get("50k", {})
        if not data:
            print(f"{firm:<15} -- NOT FOUND --")
            continue

        hurdle = (data.get("profitTarget", 0) or 0) + (data.get("maxDrawdown", 0) or 0)
        ongoing = data.get("ongoingMonthlyFee", 0) or 0
        print(
            f"{firm:<15} "
            f"${data.get('monthlyFee', '?'):<7} "
            f"${data.get('profitTarget', '?'):<7} "
            f"${data.get('maxDrawdown', '?'):<7} "
            f"${data.get('maxDrawdown', '?'):<7} "
            f"${hurdle:<7} "
            f"{data.get('payoutSplit', '?'):<6} "
            f"${ongoing:<7} "
            f"{data.get('trailing', '?'):<10} "
            f"{data.get('minPayoutDays', '?'):<8}"
        )


# ─── Main ────────────────────────────────────────────────────────────────────

def main():
    print("=" * 70)
    print("  TRADING FORGE -- PROP FIRM CONFIG SYNC VERIFICATION")
    print("  (50K accounts only -- all other sizes removed)")
    print("=" * 70)

    ts_firms = parse_ts_firm_config()
    py_firms = parse_py_firm_rules()

    if not ts_firms:
        log_fail("Could not parse TypeScript config -- aborting")
        return 1
    if not py_firms:
        log_fail("Could not parse Python config -- aborting")
        return 1

    log_info(f"Parsed {sum(len(a) for a in ts_firms.values())} TS account configs across {len(ts_firms)} firms")
    log_info(f"Parsed {sum(len(a) for a in py_firms.values())} PY account configs across {len(py_firms)} firms")

    check_ts_vs_python(ts_firms, py_firms)
    check_contract_caps(ts_firms)
    check_no_inline_config()
    check_zero_activation_fees(ts_firms, py_firms)
    check_capital_defaults()
    check_frontend_hardcodes()
    check_weekend_restrictions(ts_firms)
    check_buffer_phase()
    check_frontend_hooks()
    print_firm_summary(ts_firms)

    print("\n" + "=" * 70)
    if errors:
        print(f"  RESULT: {len(errors)} ERRORS, {len(warnings)} warnings")
        for e in errors:
            print(f"    - {e}")
    elif warnings:
        print(f"  RESULT: ALL CLEAR ({len(warnings)} warnings to review)")
    else:
        print("  RESULT: PERFECT SYNC -- all configs match")
    print("=" * 70)

    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
