# Skytech Warranty / Support Ticket — Recurring BSOD / Unexpected Reboots

**Date filed:** 2026-05-13
**Customer:** Tonio (tonioswayz32@gmail.com)
**System host name:** ASPIRE

---

## Build Information (auto-pulled from OS)

| Component | Detail |
|---|---|
| OS | Windows 11 Home 10.0.26200 |
| Motherboard | Gigabyte B650M C V3-Y1 (serial: "Default string" — please confirm physical SN) |
| BIOS | **F36d** (current). AGESA fixes for memory stability shipped in F37 and F38. |
| CPU | AMD Ryzen 7 7700 (8C/16T) |
| RAM | 2 x 16 GB DDR5-6000 CL38-48-48 (PNs ending `D5-6000`), SNs `00003211` + `00006032`, both in DIMM 1 row. Currently running at **4800 MT/s** (EXPO disabled to rule out memory training instability). |
| GPU | NVIDIA RTX 5060 (8 GB) |
| Primary NVMe | **WD Green SN3000 1TB** — SN `E823_8FA6_BF53_0001_001B_448B_4F65_6872`. SMART status reports Healthy, but this drive is the prime suspect (see below). |
| PSU | (please confirm wattage/model from chassis label) |

---

## Issue Summary

The system has experienced **10 unexpected reboots** (Windows Event ID 41 — Kernel-Power) between 2026-04-22 and 2026-05-13, with the crash rate **accelerating sharply on 2026-05-13** (5 reboots in a single 90-minute window).

All Event 41 records show `BugcheckCode = 0` because Windows was configured to auto-reboot on BSOD, stripping the bugcheck before it could be logged. **That has now been corrected** (AutoReboot disabled, small memory dumps enabled) so any future crash will leave a minidump.

### Timeline (Event 41, System log)

| Timestamp | Notes |
|---|---|
| 2026-04-22 22:10 | First observed crash |
| 2026-04-30 14:23 | |
| 2026-05-09 19:06 | |
| 2026-05-12 09:17 | |
| 2026-05-12 21:33 | |
| 2026-05-13 00:37 | KB5092762 + KB5087051 installed earlier same day |
| 2026-05-13 01:00 | |
| 2026-05-13 01:01 | |
| 2026-05-13 01:17 | |
| 2026-05-13 01:32 | Most recent |

### Prior diagnosis (handled in previous session)

Three correlating root causes were identified:

1. **WD Green SN3000 NVMe + a 96 GB auto-managed pagefile.** A previous bugcheck `arg1 = 0xC00002C4` (STATUS_INSUFFICIENT_NVRAM_RESOURCES) matches a documented WD SN3000-series firmware bug under heavy pagefile/swap pressure. The Green tier is DRAM-less and not intended as a system/boot drive under sustained write workloads.
2. **BIOS F36d on Gigabyte B650M C V3.** AGESA `1.2.0.2a` and later (F37 / F38 on this board) include explicit Ryzen 7000 memory-training and idle-power stability fixes. The system is currently below this revision.
3. **Windows updates KB5092762 and KB5087051**, both installed 2026-05-13, correlate with the same-day crash cluster.

---

## What we have already tried / changed

- Disabled EXPO in BIOS — RAM dropped from 6000 MT/s to 4800 MT/s default. Crashes continued.
- Restart cycles / clean shutdowns — no effect.
- **Today (2026-05-13):**
  - Reconfigured CrashControl: `AutoReboot = 0`, `CrashDumpEnabled = 3` (small dumps), MinidumpDir initialised. So the *next* crash will leave a usable dump.
  - Shrunk pagefile from auto-managed (~96 GB) to **fixed 8 GB on C:** to eliminate the WD Green pagefile attack surface.
  - Attempted to roll back KB5092762 / KB5087051 via `wusa /uninstall` and `DISM /remove-package`. Both refused (wusa exit 87, DISM reported them as non-removable / consolidated into the cumulative). They remain installed — the customer will use Windows Update "show or hide updates" if they re-trigger after a clean reinstall.
  - Installed a daily health-check scheduled task (`TowerHealthCheck` at 07:00 local) that watches for drift on all the above.

---

## What we are asking Skytech to confirm / action

1. **BIOS update.** Please confirm the recommended BIOS for the Gigabyte B650M C V3 paired with a Ryzen 7 7700 is **F38** (or newer if available). If F38 is in the support pipeline but not yet GA, please advise whether F37 is safe as an interim, and whether Skytech ships these systems with anything later than F36d today.
2. **WD Green SN3000 firmware / RMA.** Please check whether WD has issued a firmware update for the SN3000 1TB drive that ships in this configuration since 2026-Q1. If not, given this drive is the system/boot disk and we have a bugcheck signature matching the documented SN3000 NVRAM-pressure firmware issue, we would like to **RMA the WD Green for a DRAM-equipped drive** (WD Black SN770 / SN850X, or equivalent Samsung 990 Pro / Crucial T500). The Green tier should not be the boot drive on a build sold for trading / development workloads.
3. **RAM RMA contingency.** If we flash to F38, re-enable EXPO at 6000 MT/s, and the crashes return *with* a bugcheck implicating memory (e.g. 0x1A, 0x4E, 0x50, 0x1E with memory-related arg), we would like a pre-authorised RMA path for the two G.Skill / TeamGroup `CL38-48-48 DDR5-6000` modules (SNs `00003211` and `00006032`). Please confirm under-warranty replacement terms.
4. **Bench-test offer.** If the above three steps don't resolve, please advise on Skytech's in-house bench-test / return-for-service program for this chassis.

---

## Attachments / evidence we can supply on request

- Full Event 41 dump (PowerShell export available).
- Output of `Get-PhysicalDisk`, `Get-CimInstance Win32_PhysicalMemory`, `Get-CimInstance Win32_BIOS`.
- Daily `tower-health.log` showing post-fix state and any new minidumps as they arrive.

Thank you. Happy to schedule a phone call if it would speed this up.
