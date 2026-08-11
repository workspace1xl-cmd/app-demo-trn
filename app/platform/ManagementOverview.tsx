"use client";

// ---------------------------------------------------------------------------
// Management → Overview
//
// The management-facing landing screen. It answers "how is the organisation
// doing?", "who needs attention?" and "where are the risks?" without the
// reader needing to know what an Enrollment, an Activity or a RACI row is.
//
// HONESTY RULE (design brief §17): every number here is either read directly
// from an existing endpoint or is a deterministic count over rows that
// endpoint returned. Nothing is estimated, projected or padded. Where a
// metric management might expect does NOT exist in the data — notably an
// org-wide rule-acknowledgement percentage, which no admin endpoint
// aggregates — it is omitted rather than approximated.
//
// This screen adds no backend: it reuses admin endpoints that already exist
// and are already guarded by the FastAPI `admin_user` dependency.
// ---------------------------------------------------------------------------

import { ReactNode, useEffect, useMemo, useState } from "react";
import styles from "./platform.module.css";
import { Icon, type IconName } from "./icons";
import { request, type AdminSection } from "./PlatformApp";

type Readiness = { score: number; components: { key: string; label: string; percent: number }[] };
type Analytics = {
  employees: number;
  training_completion: number;
  certificates: number;
  average_quiz_score: number;
  activities: number;
  open_feedback: number;
  readiness: Readiness;
};
type ExecDepartment = {
  id: string;
  name: string;
  employee_count: number;
  readiness_score: number | null;
  ownership_coverage: number | null;
  activity_count: number;
};
type Candidate = { id: string; status: string };
type RuleSuggestion = { id: string; status: string };
type AdminRule = { id: string; status: string; is_mandatory: boolean };
type Activity = { id: string; current_person: string };

// Matches the seed/placeholder the backend uses for an activity nobody owns
// yet (see `_capture_readiness_snapshot` / the exec ownership_coverage
// calculation, which compares against this same string).
const UNASSIGNED = "organisation to confirm";

function greetingFor(hour: number) {
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

export default function ManagementOverview({
  token,
  analytics,
  onNavigate,
  readinessSlot,
  viewerName,
}: {
  token: string;
  analytics: Analytics | null;
  onNavigate: (section: AdminSection) => void;
  readinessSlot: ReactNode;
  viewerName: string;
}) {
  // Safe as a lazy initializer rather than an effect: this component only
  // ever mounts client-side (PlatformApp returns the sign-in screen until a
  // session exists, and a session is only restored from sessionStorage in an
  // effect), so there is no server render of this subtree to mismatch.
  const [greeting] = useState(() => greetingFor(new Date().getHours()));

  const [departments, setDepartments] = useState<ExecDepartment[] | null>(null);
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [suggestions, setSuggestions] = useState<RuleSuggestion[] | null>(null);
  const [rules, setRules] = useState<AdminRule[] | null>(null);
  const [activities, setActivities] = useState<Activity[] | null>(null);

  // Each fetch settles independently. A single failing endpoint must degrade
  // only its own card — not blank the whole management landing page — so
  // every card below renders from `null` (still loading / unavailable) as a
  // first-class state rather than assuming data arrived.
  useEffect(() => {
    let live = true;

    request<{ departments: ExecDepartment[] }>("/api/v1/admin/exec", token)
      .then((res) => live && setDepartments(res.departments))
      .catch(() => live && setDepartments([]));
    request<Candidate[]>("/api/v1/admin/candidates", token)
      .then((res) => live && setCandidates(res))
      .catch(() => live && setCandidates([]));
    request<RuleSuggestion[]>("/api/v1/admin/rule-suggestions?status=submitted", token)
      .then((res) => live && setSuggestions(res))
      .catch(() => live && setSuggestions([]));
    request<AdminRule[]>("/api/v1/admin/rules", token)
      .then((res) => live && setRules(res))
      .catch(() => live && setRules([]));
    request<Activity[]>("/api/v1/activities", token)
      .then((res) => live && setActivities(res))
      .catch(() => live && setActivities([]));

    return () => { live = false; };
  }, [token]);

  // --- Derived signals. Each one is a plain count over real rows. ---------
  const pipelineCandidates = useMemo(
    () => (candidates ? candidates.filter((c) => c.status !== "joined").length : null),
    [candidates],
  );
  const pendingSuggestions = suggestions?.length ?? null;
  const unassignedActivities = useMemo(
    () =>
      activities
        ? activities.filter((a) => (a.current_person || "").trim().toLowerCase() === UNASSIGNED).length
        : null,
    [activities],
  );

  const attention = useMemo(() => {
    const items: { key: string; icon: IconName; label: string; detail: string; section: AdminSection; count: number }[] = [];
    if (analytics && analytics.open_feedback > 0)
      items.push({
        key: "feedback", icon: "feedback", count: analytics.open_feedback, section: "feedback",
        label: `${analytics.open_feedback} feedback item${analytics.open_feedback === 1 ? "" : "s"} awaiting review`,
        detail: "Questions employees asked that had no verified answer.",
      });
    if (pendingSuggestions)
      items.push({
        key: "suggestions", icon: "compliance", count: pendingSuggestions, section: "rules",
        label: `${pendingSuggestions} suggested policy change${pendingSuggestions === 1 ? "" : "s"} to review`,
        detail: "Employees have proposed changes to existing rules.",
      });
    if (unassignedActivities)
      items.push({
        key: "owners", icon: "responsibilities", count: unassignedActivities, section: "matrix",
        label: `${unassignedActivities} responsibilit${unassignedActivities === 1 ? "y has" : "ies have"} no named owner`,
        detail: "Nobody is currently accountable for these.",
      });
    if (pipelineCandidates)
      items.push({
        key: "candidates", icon: "candidate", count: pipelineCandidates, section: "candidates",
        label: `${pipelineCandidates} candidate${pipelineCandidates === 1 ? "" : "s"} yet to join`,
        detail: "Invited or acknowledged, but not started yet.",
      });
    return items;
  }, [analytics, pendingSuggestions, unassignedActivities, pipelineCandidates]);

  const everythingLoaded = candidates !== null && suggestions !== null && activities !== null;

  return (
    <div className={styles.mgmtOverview}>
      <section className={styles.mgmtHero}>
        <div>
          <span>MANAGEMENT OVERVIEW</span>
          <h2>{greeting}, {viewerName.split(" ")[0]}.</h2>
          <p>
            Here is how the organisation is doing right now — the workforce, learning
            progress, compliance and anything waiting on a decision.
          </p>
        </div>
        {readinessSlot}
      </section>

      {/* --- Top KPI row ------------------------------------------------ */}
      <div className={styles.mgmtKpis}>
        <Kpi icon="people" label="Employees" value={analytics?.employees} note="People in this organisation"
             onClick={() => onNavigate("employees")} />
        <Kpi icon="learning" label="Training completion" value={analytics ? `${analytics.training_completion}%` : undefined}
             note="Across all assigned learning" tone={analytics && analytics.training_completion >= 70 ? "good" : "warn"}
             onClick={() => onNavigate("assignments")} />
        <Kpi icon="certificate" label="Certificates issued" value={analytics?.certificates} note="Verified learning evidence"
             onClick={() => onNavigate("employees")} />
        <Kpi icon="candidate" label="Candidates joining" value={pipelineCandidates ?? undefined} note="Invited, not yet started"
             onClick={() => onNavigate("candidates")} />
        <Kpi icon="feedback" label="Open feedback" value={analytics?.open_feedback} note="Raised by employees"
             tone={analytics && analytics.open_feedback > 0 ? "warn" : "good"} onClick={() => onNavigate("feedback")} />
        <Kpi icon="alert" label="Needs attention" value={everythingLoaded ? attention.reduce((n, a) => n + a.count, 0) : undefined}
             note="Items across all areas" tone={attention.length ? "warn" : "good"} />
      </div>

      {/* --- Needs Attention -------------------------------------------- */}
      <section className={styles.mgmtCard}>
        <header>
          <h3><Icon name="alert" size={16} /> Needs attention</h3>
          <p>Everything currently waiting on a management decision.</p>
        </header>
        {!everythingLoaded && <div className={styles.mgmtQuiet}>Checking for outstanding items…</div>}
        {everythingLoaded && attention.length === 0 && (
          <div className={styles.mgmtEmpty}>
            <Icon name="check" size={22} />
            <b>Nothing needs your attention</b>
            <span>No outstanding feedback, policy reviews, unowned responsibilities or pending joiners.</span>
          </div>
        )}
        {everythingLoaded && attention.length > 0 && (
          <ul className={styles.mgmtAttention}>
            {attention.map((item) => (
              <li key={item.key}>
                <span className={styles.mgmtAttentionIcon}><Icon name={item.icon} size={16} /></span>
                <div>
                  <b>{item.label}</b>
                  <small>{item.detail}</small>
                </div>
                <button type="button" onClick={() => onNavigate(item.section)}>
                  Review →
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className={styles.mgmtSplit}>
        {/* --- Workforce snapshot --------------------------------------- */}
        <section className={styles.mgmtCard}>
          <header>
            <h3><Icon name="people" size={16} /> Workforce snapshot</h3>
            <p>Headcount and learning progress by department.</p>
          </header>
          {departments === null && <div className={styles.mgmtQuiet}>Loading departments…</div>}
          {departments !== null && departments.length === 0 && (
            <div className={styles.mgmtEmpty}>
              <Icon name="department" size={22} />
              <b>No departments set up yet</b>
              <span>Add departments to see how the workforce is distributed.</span>
              <button type="button" onClick={() => onNavigate("departments")}>Add a department →</button>
            </div>
          )}
          {departments !== null && departments.length > 0 && (
            <ul className={styles.mgmtDeptList}>
              {departments.map((d) => (
                <li key={d.id}>
                  <div className={styles.mgmtDeptHead}>
                    <b>{d.name}</b>
                    <small>
                      {d.employee_count} {d.employee_count === 1 ? "person" : "people"}
                      {d.readiness_score !== null && <em>{d.readiness_score}%</em>}
                    </small>
                  </div>
                  {d.readiness_score === null ? (
                    // Deliberately not "0%" — no assigned learning is a
                    // different fact from learning that nobody finished.
                    <small className={styles.mgmtNoData}>No learning assigned yet</small>
                  ) : (
                    <div className={styles.mgmtBar} title={`${d.readiness_score}% of assigned learning completed`}>
                      <b style={{ width: `${d.readiness_score}%` }} data-tone={d.readiness_score >= 70 ? "good" : "warn"} />
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* --- Compliance snapshot -------------------------------------- */}
        <section className={styles.mgmtCard}>
          <header>
            <h3><Icon name="compliance" size={16} /> Compliance snapshot</h3>
            <p>Policies in force and changes awaiting review.</p>
          </header>
          {rules === null && <div className={styles.mgmtQuiet}>Loading policies…</div>}
          {rules !== null && rules.length === 0 && (
            <div className={styles.mgmtEmpty}>
              <Icon name="compliance" size={22} />
              <b>No policies published yet</b>
              <span>Rules you publish here become mandatory reading for the people they apply to.</span>
              <button type="button" onClick={() => onNavigate("rules")}>Add a policy →</button>
            </div>
          )}
          {rules !== null && rules.length > 0 && (
            <>
              {/* A rule's status is "active" or "archived" — there is no
                  "published" state, so counting one would have shown a
                  confident 0 next to a non-zero total. "Mandatory" is
                  counted among ACTIVE rules only: a mandatory rule that has
                  been archived isn't binding on anyone. */}
              <div className={styles.mgmtFacts}>
                <div><b>{rules.filter((r) => r.status === "active").length}</b><small>Active policies</small></div>
                <div><b>{rules.filter((r) => r.status === "active" && r.is_mandatory).length}</b><small>Mandatory</small></div>
                <div><b>{rules.filter((r) => r.status === "archived").length}</b><small>Archived</small></div>
                <div data-tone={pendingSuggestions ? "warn" : undefined}>
                  <b>{pendingSuggestions ?? "—"}</b><small>Changes to review</small>
                </div>
              </div>
              <button type="button" className={styles.mgmtCardLink} onClick={() => onNavigate("rules")}>
                Open Compliance →
              </button>
            </>
          )}
        </section>
      </div>
    </div>
  );
}

function Kpi({
  icon, label, value, note, tone, onClick,
}: {
  icon: IconName;
  label: string;
  value?: string | number;
  note: string;
  tone?: "good" | "warn";
  onClick?: () => void;
}) {
  // An undefined value means "not loaded yet" — shown as a muted placeholder
  // rather than a 0, which would read as a real measurement of zero.
  const body = (
    <>
      <span className={styles.mgmtKpiIcon}><Icon name={icon} size={16} /></span>
      <small>{label}</small>
      <h3 data-pending={value === undefined ? "true" : undefined}>{value === undefined ? "—" : value}</h3>
      <p>{note}</p>
    </>
  );
  if (!onClick) return <article className={styles.mgmtKpi} data-tone={tone}>{body}</article>;
  return (
    <button
      type="button"
      className={styles.mgmtKpi}
      data-tone={tone}
      data-clickable="true"
      // Without this the accessible name is the tile's raw text run
      // ("Employees 7 People in this organisation"), which reads as a
      // statement rather than somewhere you can go.
      aria-label={`${label}: ${value === undefined ? "loading" : value}. Open details.`}
      onClick={onClick}
    >
      {body}
    </button>
  );
}
