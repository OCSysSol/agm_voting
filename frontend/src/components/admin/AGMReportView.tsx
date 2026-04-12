import { useState } from "react";
import type { MotionDetail, OptionTallyEntry } from "../../api/admin";

function OutcomeBadge({ outcome }: { outcome: string | null | undefined }) {
  if (!outcome) return null;
  if (outcome === "pass") {
    return (
      <span
        className="outcome-badge outcome-badge--pass"
        aria-label="Outcome: Pass"
      >
        Pass
      </span>
    );
  }
  if (outcome === "fail") {
    return (
      <span
        className="outcome-badge outcome-badge--fail"
        aria-label="Outcome: Fail"
      >
        Fail
      </span>
    );
  }
  // tie
  return (
    <span
      className="outcome-badge outcome-badge--tie"
      aria-label="Outcome: Tie — admin review required"
    >
      Tie — admin review required
    </span>
  );
}

interface AGMReportViewProps {
  motions: MotionDetail[];
  agmTitle?: string;
  totalEntitlement?: number;
}

function formatEntitlementPct(sum: number, total: number): string {
  if (total === 0) return "—";
  const pct = (sum / total) * 100;
  return `${sum} (${pct.toFixed(1)}%)`;
}

const CATEGORY_LABELS: Record<string, string> = {
  yes: "For",
  no: "Against",
  abstained: "Abstained",
  absent: "Absent",
  not_eligible: "Not eligible",
};

const CATEGORY_COLORS: Record<string, string> = {
  yes: "var(--green)",
  no: "var(--red)",
  abstained: "var(--text-muted)",
  absent: "var(--text-muted)",
  not_eligible: "var(--text-muted)",
};

interface MultiChoiceOptionRowsProps {
  optTally: OptionTallyEntry;
  motion: MotionDetail;
  totalEntitlement: number;
  isWinner: boolean;
}

function MultiChoiceOptionRows({ optTally, motion, totalEntitlement, isWinner }: MultiChoiceOptionRowsProps) {
  const [expanded, setExpanded] = useState(false);

  const forVoters = motion.voter_lists.options_for?.[optTally.option_id] ?? motion.voter_lists.options?.[optTally.option_id] ?? [];
  const againstVoters = motion.voter_lists.options_against?.[optTally.option_id] ?? [];
  const abstainedVoters = motion.voter_lists.options_abstained?.[optTally.option_id] ?? [];

  const forVoterCount = optTally.for_voter_count ?? optTally.voter_count ?? 0;
  const forEntitlementSum = optTally.for_entitlement_sum ?? optTally.entitlement_sum ?? 0;
  const againstVoterCount = optTally.against_voter_count ?? 0;
  const againstEntitlementSum = optTally.against_entitlement_sum ?? 0;
  const abstainedVoterCount = optTally.abstained_voter_count ?? 0;
  const abstainedEntitlementSum = optTally.abstained_entitlement_sum ?? 0;

  return (
    <>
      {/* Fix 3 & 4: option header row now includes summary counts; highlight winning options */}
      <tr style={isWinner ? { borderLeft: "4px solid var(--green)", background: "var(--green-bg)" } : undefined}>
        <td colSpan={3} style={{ padding: "8px 10px", background: isWinner ? undefined : "var(--surface-raised, #f7f7f7)", borderBottom: "1px solid var(--border, #e0e0e0)" }}>
          <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 7, fontWeight: 600 }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--navy)", flexShrink: 0 }} />
              {optTally.option_text}
              <OutcomeBadge outcome={optTally.outcome} />
            </span>
            {/* Fix 3: summary counts visible in collapsed state */}
            <span style={{ fontSize: "0.75rem", color: "var(--text-muted)", display: "inline-flex", gap: 8 }}>
              <span style={{ color: "var(--green)" }}>{forVoterCount} For ({formatEntitlementPct(forEntitlementSum, totalEntitlement)})</span>
              <span style={{ color: "var(--red)" }}>{againstVoterCount} Against ({formatEntitlementPct(againstEntitlementSum, totalEntitlement)})</span>
              <span>{abstainedVoterCount} Abstained ({formatEntitlementPct(abstainedEntitlementSum, totalEntitlement)})</span>
            </span>
            <button
              type="button"
              aria-expanded={expanded}
              aria-label={`${expanded ? "Hide voters" : "Show voters"} for ${optTally.option_text}`}
              onClick={() => setExpanded((v) => !v)}
              style={{
                marginLeft: "auto",
                fontSize: "0.75rem",
                cursor: "pointer",
                background: "none",
                border: "1px solid var(--border, #ccc)",
                borderRadius: "var(--r-sm, 4px)",
                padding: "1px 6px",
                color: "var(--text-muted, #555)",
              }}
            >
              {expanded ? "▲ Hide voters" : "▶ Show voters"}
            </button>
          </div>
        </td>
      </tr>
      {/* Fix 3: expanded section shows voter list only (summary counts moved to header) */}
      {expanded && (
        <>
          {forVoters.length > 0 && (
            <tr>
              <td colSpan={3} style={{ paddingLeft: 24, fontSize: "0.8rem", color: "var(--text-muted)" }}>
                <span style={{ fontWeight: 600, color: "var(--green)", display: "block", marginBottom: 2 }}>For voters:</span>
                {forVoters.map((v) => (
                  <span key={`${v.lot_number}-for`} style={{ display: "block" }}>
                    Lot {v.lot_number} — {v.voter_email}{v.proxy_email ? " (proxy)" : ""} — {v.entitlement} UOE
                  </span>
                ))}
              </td>
            </tr>
          )}
          {againstVoters.length > 0 && (
            <tr>
              <td colSpan={3} style={{ paddingLeft: 24, fontSize: "0.8rem", color: "var(--text-muted)" }}>
                <span style={{ fontWeight: 600, color: "var(--red)", display: "block", marginBottom: 2 }}>Against voters:</span>
                {againstVoters.map((v) => (
                  <span key={`${v.lot_number}-against`} style={{ display: "block" }}>
                    Lot {v.lot_number} — {v.voter_email}{v.proxy_email ? " (proxy)" : ""} — {v.entitlement} UOE
                  </span>
                ))}
              </td>
            </tr>
          )}
          {abstainedVoters.length > 0 && (
            <tr>
              <td colSpan={3} style={{ paddingLeft: 24, fontSize: "0.8rem", color: "var(--text-muted)" }}>
                <span style={{ fontWeight: 600, display: "block", marginBottom: 2 }}>Abstained voters:</span>
                {abstainedVoters.map((v) => (
                  <span key={`${v.lot_number}-abs`} style={{ display: "block" }}>
                    Lot {v.lot_number} — {v.voter_email}{v.proxy_email ? " (proxy)" : ""} — {v.entitlement} UOE
                  </span>
                ))}
              </td>
            </tr>
          )}
        </>
      )}
    </>
  );
}

/** Fix 10: Renders the expanded voter list for a binary motion */
function BinaryVoterList({ motion }: { motion: MotionDetail }) {
  const categories = ["yes", "no", "abstained", "absent", "not_eligible"] as const;
  return (
    <div style={{ padding: "12px 20px", borderTop: "1px solid var(--border-subtle)" }}>
      {categories.map((cat) => {
        const voters = motion.voter_lists[cat];
        if (!voters || voters.length === 0) return null;
        return (
          <div key={cat} style={{ marginBottom: 12 }}>
            <span
              style={{
                fontWeight: 600,
                fontSize: "0.75rem",
                textTransform: "uppercase",
                letterSpacing: "0.07em",
                color: CATEGORY_COLORS[cat],
                display: "block",
                marginBottom: 4,
              }}
            >
              {CATEGORY_LABELS[cat]}
            </span>
            {voters.map((v) => (
              <div
                key={`${cat}-${v.lot_number}-${v.voter_email}`}
                style={{ fontSize: "0.8rem", color: "var(--text-secondary)", marginBottom: 2 }}
              >
                Lot {v.lot_number} — {v.voter_email}
                {v.proxy_email ? " (proxy)" : ""} — {v.entitlement} UOE
                {v.submitted_by_admin ? " — Admin" : " — Voter"}
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

export default function AGMReportView({ motions, agmTitle, totalEntitlement = 0 }: AGMReportViewProps) {
  // Fix 10: per-motion expand/collapse state for binary motions
  const [expandedMotionIds, setExpandedMotionIds] = useState<Set<string>>(new Set());

  function toggleExpanded(id: string) {
    setExpandedMotionIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }
  function handleExportCSV() {
    const rows: string[] = ["Motion,Category,Lot Number,Entitlement (UOE),Voter Email,Submitted By"];
    for (const motion of motions) {
      const motionLabel = `${motion.motion_number?.trim() || String(motion.display_order)}. ${motion.title.replace(/"/g, '""')}`;
      if (motion.is_multi_choice === true) {
        // Per-option For/Against/Abstained rows for multi-choice
        for (const optTally of (motion.tally.options ?? [])) {
          const forVoters = motion.voter_lists.options_for?.[optTally.option_id] ?? motion.voter_lists.options?.[optTally.option_id] ?? [];
          const againstVoters = motion.voter_lists.options_against?.[optTally.option_id] ?? [];
          const abstainedVoters = motion.voter_lists.options_abstained?.[optTally.option_id] ?? [];
          for (const v of forVoters) {
            const emailCell = v.proxy_email
              ? `${v.voter_email || ""} (proxy)`
              : (v.voter_email || "");
            const submittedBy = v.submitted_by_admin ? "Admin" : "Voter";
            rows.push(`"${motionLabel}","Option: ${optTally.option_text.replace(/"/g, '""')} — For","${v.lot_number}",${v.entitlement},"${emailCell.replace(/"/g, '""')}","${submittedBy}"`);
          }
          for (const v of againstVoters) {
            const emailCell = v.proxy_email
              ? `${v.voter_email || ""} (proxy)`
              : (v.voter_email || "");
            const submittedBy = v.submitted_by_admin ? "Admin" : "Voter";
            rows.push(`"${motionLabel}","Option: ${optTally.option_text.replace(/"/g, '""')} — Against","${v.lot_number}",${v.entitlement},"${emailCell.replace(/"/g, '""')}","${submittedBy}"`);
          }
          for (const v of abstainedVoters) {
            const emailCell = v.proxy_email
              ? `${v.voter_email || ""} (proxy)`
              : (v.voter_email || "");
            const submittedBy = v.submitted_by_admin ? "Admin" : "Voter";
            rows.push(`"${motionLabel}","Option: ${optTally.option_text.replace(/"/g, '""')} — Abstained","${v.lot_number}",${v.entitlement},"${emailCell.replace(/"/g, '""')}","${submittedBy}"`);
          }
        }
        // Abstained / absent / not_eligible rows
        for (const cat of ["abstained", "absent", "not_eligible"] as const) {
          for (const v of motion.voter_lists[cat]) {
            const emailCell = v.proxy_email
              ? `${v.voter_email || ""} (proxy)`
              : (v.voter_email || "");
            const submittedBy = v.submitted_by_admin ? "Admin" : "Voter";
            rows.push(`"${motionLabel}","${CATEGORY_LABELS[cat]}","${v.lot_number}",${v.entitlement},"${emailCell.replace(/"/g, '""')}","${submittedBy}"`);
          }
        }
      } else {
        for (const cat of ["yes", "no", "abstained", "absent", "not_eligible"] as const) {
          for (const v of motion.voter_lists[cat]) {
            const emailCell = v.proxy_email
              ? `${v.voter_email || ""} (proxy)`
              : (v.voter_email || "");
            const submittedBy = v.submitted_by_admin ? "Admin" : "Voter";
            rows.push(`"${motionLabel}","${CATEGORY_LABELS[cat]}","${v.lot_number}",${v.entitlement},"${emailCell.replace(/"/g, '""')}","${submittedBy}"`);
          }
        }
      }
    }
    const blob = new Blob([rows.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = agmTitle ? `${agmTitle.replace(/[^a-z0-9]/gi, "_")}_results.csv` : "general_meeting_results.csv";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  if (motions.length === 0) {
    return <p className="state-message">No motions recorded.</p>;
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 16 }}>
        <button type="button" className="btn btn--secondary" onClick={handleExportCSV}>
          ↓ Export voter lists (CSV)
        </button>
      </div>

      {motions.map((motion) => {
        // Fix 4: compute winning rows/options before rendering
        let winningOptionIds: Set<string> | null = null;
        if (motion.is_multi_choice === true) {
          const options = motion.tally.options ?? [];
          const limit = motion.option_limit ?? 1;
          // Sort by descending for_entitlement_sum; top N are winners
          const sorted = [...options].sort(
            (a, b) =>
              (b.for_entitlement_sum ?? b.entitlement_sum ?? 0) -
              (a.for_entitlement_sum ?? a.entitlement_sum ?? 0)
          );
          winningOptionIds = new Set(sorted.slice(0, limit).map((o) => o.option_id));
        }

        // Fix 4: determine binary winner
        const yesSumBinary = motion.tally.yes.entitlement_sum;
        const noSumBinary = motion.tally.no.entitlement_sum;

        const isExpanded = expandedMotionIds.has(motion.id);
        return (
          <div key={motion.id} className="admin-card" style={{ marginBottom: 16 }}>
            <div className="admin-card__header">
              <h3 className="admin-card__title">
                {motion.motion_number?.trim() || String(motion.display_order)}. {motion.title}
              </h3>
              <span
                className={`motion-type-badge motion-type-badge--${motion.motion_type === "special" ? "special" : "general"}`}
                aria-label={`Motion type: ${motion.motion_type === "special" ? "Special" : "General"}`}
              >
                {motion.motion_type === "special" ? "Special" : "General"}
              </span>
              {motion.is_multi_choice === true && (
                <span className="motion-type-badge motion-type-badge--multi_choice" aria-label="Multi-choice motion">Multi-Choice</span>
              )}
              {!motion.is_visible && (
                <span className="motion-type-badge motion-type-badge--hidden" aria-label="Motion is hidden from voters">
                  Hidden
                </span>
              )}
              {/* Fix 10: per-binary-motion expand/collapse toggle */}
              {motion.is_multi_choice !== true && (
                <button
                  type="button"
                  aria-expanded={isExpanded}
                  aria-label={`${isExpanded ? "Collapse" : "Expand"} voter list for ${motion.title}`}
                  onClick={() => toggleExpanded(motion.id)}
                  style={{
                    marginLeft: "auto",
                    fontSize: "0.75rem",
                    cursor: "pointer",
                    background: "none",
                    border: "1px solid var(--border)",
                    borderRadius: "var(--r-sm)",
                    padding: "1px 6px",
                    color: "var(--text-muted)",
                  }}
                >
                  {isExpanded ? "▲ Hide voters" : "▶ Show voters"}
                </button>
              )}
            </div>
            {motion.description && (
              <p style={{ color: "var(--text-muted)", margin: "0 0 14px", fontSize: "0.875rem", padding: "0 20px" }}>
                {motion.description}
              </p>
            )}
            <div className="admin-table-wrapper">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Category</th>
                  <th>Voter Count</th>
                  <th>Entitlement Sum (UOE)</th>
                </tr>
              </thead>
              <tbody>
                {motion.is_multi_choice === true ? (
                  <>
                    {(motion.tally.options ?? []).map((optTally: OptionTallyEntry) => (
                      <MultiChoiceOptionRows
                        key={optTally.option_id}
                        optTally={optTally}
                        motion={motion}
                        totalEntitlement={totalEntitlement}
                        isWinner={winningOptionIds?.has(optTally.option_id) ?? false}
                      />
                    ))}
                    {(["absent", "not_eligible"] as const).map((cat) => (
                      <tr key={cat}>
                        <td>
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
                            <span style={{ width: 8, height: 8, borderRadius: "50%", background: CATEGORY_COLORS[cat], flexShrink: 0 }} />
                            {CATEGORY_LABELS[cat]}
                          </span>
                        </td>
                        <td style={{ fontFamily: "'Overpass Mono', monospace" }}>
                          {motion.tally[cat].voter_count}
                        </td>
                        <td style={{ fontFamily: "'Overpass Mono', monospace" }}>
                          {formatEntitlementPct(motion.tally[cat].entitlement_sum, totalEntitlement)}
                        </td>
                      </tr>
                    ))}
                  </>
                ) : (
                  (["yes", "no", "abstained", "absent", "not_eligible"] as const).map((cat) => {
                    // Fix 4: highlight winning binary row
                    const isWinnerYes = cat === "yes" && yesSumBinary > noSumBinary;
                    const isWinnerNo = cat === "no" && noSumBinary > yesSumBinary;
                    const rowStyle =
                      isWinnerYes
                        ? { borderLeft: "4px solid var(--green)", background: "var(--green-bg)" }
                        : isWinnerNo
                        ? { borderLeft: "4px solid var(--red)", background: "var(--red-bg)" }
                        : undefined;

                    return (
                      <tr key={cat} style={rowStyle}>
                        <td>
                          <span style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 7,
                            fontWeight: cat === "yes" || cat === "no" ? 600 : undefined,
                          }}>
                            <span style={{
                              width: 8,
                              height: 8,
                              borderRadius: "50%",
                              background: CATEGORY_COLORS[cat],
                              flexShrink: 0,
                            }} />
                            {CATEGORY_LABELS[cat]}
                          </span>
                        </td>
                        <td style={{ fontFamily: "'Overpass Mono', monospace" }}>
                          {motion.tally[cat].voter_count}
                        </td>
                        <td style={{ fontFamily: "'Overpass Mono', monospace" }}>
                          {formatEntitlementPct(motion.tally[cat].entitlement_sum, totalEntitlement)}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
            </div>
            {/* Fix 10: voter list for binary motions, expanded on demand */}
            {motion.is_multi_choice !== true && isExpanded && (
              <BinaryVoterList motion={motion} />
            )}
          </div>
        );
      })}
    </div>
  );
}
