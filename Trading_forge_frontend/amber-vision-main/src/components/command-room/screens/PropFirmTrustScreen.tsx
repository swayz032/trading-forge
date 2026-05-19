/**
 * Prop-Firm Trust screen — best firm to deploy to right now per B14 survival twin.
 *
 * Baby jargon:
 *   - "Safest firm" replaces "Highest survival probability"
 *   - "Will pay you" replaces "won't ban or freeze"
 *   - "How long they'll keep your account alive (best guess)" replaces "180-day survival"
 */

import { useFirms, useAllFirmAccounts } from "@/hooks/usePropFirm";
import { useMemo } from "react";

export function PropFirmTrustScreen() {
  const { data: firms } = useFirms();
  const { data: accounts } = useAllFirmAccounts();

  // Group accounts by firm so we can show "biggest active account" per firm
  // as a Phase-0 stand-in for the B14 trust score (the full survival surface
  // lives on /prop-firm; this TV is a glance summary).
  const ranked = useMemo(() => {
    if (!accounts?.length) return [];
    const byFirm = new Map<string, { displayName: string; accountSize: number }>();
    for (const a of accounts) {
      const cur = byFirm.get(a.firm);
      const size = a.config?.accountSize ?? 0;
      if (!cur || size > cur.accountSize) {
        byFirm.set(a.firm, { displayName: a.displayName, accountSize: size });
      }
    }
    return [...byFirm.entries()]
      .map(([firmId, v]) => ({ firmId, ...v }))
      .sort((a, b) => b.accountSize - a.accountSize)
      .slice(0, 4);
  }, [accounts]);

  const totalAccounts = accounts?.length ?? 0;

  return (
    <>
      <div style={{ fontSize: 12, letterSpacing: "0.32em", color: "#10B981", fontWeight: 700 }}>
        WHO WILL PAY YOU
      </div>
      <div style={{ fontSize: 13, color: "#94a3b8", marginTop: 6 }}>
        {firms?.length ?? 0} firms watched · {totalAccounts} accounts active
      </div>

      <div style={{ marginTop: 18, display: "flex", flexDirection: "column", gap: 8 }}>
        {ranked.length === 0 && (
          <div style={{ fontSize: 13, color: "#64748b" }}>No firm data yet — connect an account to see trust scores.</div>
        )}
        {ranked.map((f, i) => (
          <div
            key={f.firmId}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "8px 12px",
              background: "rgba(11,17,24,0.7)",
              border: "1px solid rgba(16,185,129,0.18)",
              borderRadius: 8,
            }}
          >
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, color: "#e2e8f0" }}>
                {f.displayName}
              </div>
              <div style={{ fontSize: 10, color: "#64748b" }}>
                {f.accountSize ? `$${f.accountSize.toLocaleString()} account` : "—"}
              </div>
            </div>
            <div
              style={{
                fontSize: 11,
                letterSpacing: "0.16em",
                fontWeight: 700,
                color: i === 0 ? "#10B981" : "#94a3b8",
              }}
            >
              {i === 0 ? "TOP PICK" : `#${i + 1}`}
            </div>
          </div>
        ))}
      </div>

      <div style={{ marginTop: "auto", paddingTop: 14, borderTop: "1px solid rgba(255,255,255,0.06)", fontSize: 10, color: "#64748b", lineHeight: 1.4 }}>
        Open <span style={{ color: "#10B981" }}>/prop-firm</span> for full Trust Score detail (B14 advisory · Phase 0).
      </div>
    </>
  );
}
