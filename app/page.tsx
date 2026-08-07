"use client";

import { useMemo, useState } from "react";
import {
  blueprintItems,
  curriculum,
  mistakeCategories,
  prioritySops,
  responsibilityRows,
} from "./demo-data";

type View =
  | "dashboard"
  | "knowledge"
  | "training"
  | "matrix"
  | "sops"
  | "certificates"
  | "analytics"
  | "admin"
  | "builder"
  | "blueprint";

const nav = [
  ["dashboard", "⌂", "Overview"],
  ["knowledge", "⌕", "Knowledge search"],
  ["training", "◈", "My learning"],
  ["matrix", "◎", "Responsibility Matrix"],
  ["sops", "▤", "SOP library"],
  ["certificates", "◇", "Certificates"],
  ["analytics", "◫", "Insights"],
  ["admin", "⚙", "Administration"],
  ["builder", "▦", "Course builder"],
  ["blueprint", "✦", "Management blueprint"],
] as const;

const activities = [
  {
    title: "Request annual leave",
    owner: "HR Operations",
    action: "Open HR portal",
    time: "Decision in 2 working days",
    color: "violet",
  },
  {
    title: "Report an IT incident",
    owner: "IT Service Desk",
    action: "Create priority ticket",
    time: "Response in 15 minutes",
    color: "cyan",
  },
  {
    title: "Claim an expense",
    owner: "Finance Operations",
    action: "Start reimbursement",
    time: "Next payment cycle",
    color: "amber",
  },
];

const learning = [
  {
    name: "Information Security & Confidentiality",
    meta: "TRN-05 · Mandatory",
    progress: 68,
    due: "Due 20 Aug",
    tone: "purple",
  },
  {
    name: "Communication & Workplace Etiquette",
    meta: "TRN-07 · Core",
    progress: 35,
    due: "Due 24 Aug",
    tone: "blue",
  },
  {
    name: "Ownership, Task Closure & Handover",
    meta: "TRN-19 · Core",
    progress: 0,
    due: "Due 28 Aug",
    tone: "green",
  },
];

const knowledgeCards = [
  {
    tag: "ACTIVITY",
    title: "Asset Request or Allocation",
    text: "Request an approved laptop, accessory or standard software asset.",
    owner: "IT Asset Manager",
    sla: "5 working days",
  },
  {
    tag: "SOP",
    title: "SOP-02 · Asset Request, Allocation and Return",
    text: "Approved procedure covering request, issue, transfer and return.",
    owner: "IT Operations",
    sla: "Reviewed 4 Aug",
  },
  {
    tag: "TRAINING",
    title: "TRN-11 · Assets and Acceptable Use",
    text: "Learn how to request, protect, transfer and return company assets.",
    owner: "Learning Team",
    sla: "25 minutes",
  },
];

function Sparkline() {
  return (
    <div className="spark" aria-label="Upward search success trend">
      <i />
      <i />
      <i />
      <i />
      <i />
      <i />
      <i />
      <i />
    </div>
  );
}

function Ring({ value, label }: { value: number; label: string }) {
  return (
    <div
      className="ring"
      style={{ "--p": `${value * 3.6}deg` } as React.CSSProperties}
    >
      <span>
        {value}%<small>{label}</small>
      </span>
    </div>
  );
}

export default function Home() {
  const [view, setView] = useState<View>("dashboard");
  const [query, setQuery] = useState("");
  const [searched, setSearched] = useState(false);
  const [modal, setModal] = useState<string | null>(null);
  const [notifications, setNotifications] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [filter, setFilter] = useState("All");
  const [role, setRole] = useState<"employee" | "admin">("employee");
  const [blueprintTab, setBlueprintTab] = useState("01");

  const title = useMemo(
    () => nav.find((x) => x[0] === view)?.[2] ?? "Overview",
    [view],
  );
  const act = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(null), 2600);
  };
  const go = (next: View) => {
    setView(next);
    setSearched(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const runSearch = () => {
    if (!query.trim()) setQuery("Who approves a laptop request?");
    setSearched(true);
    setView("knowledge");
  };

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <button
          className="brand"
          onClick={() => go("dashboard")}
          aria-label="Go to overview"
        >
          <span className="brand-mark">
            <b>1</b>
          </span>
          <span>
            <strong>OneWork</strong>
            <small>Employee OS</small>
          </span>
        </button>
        <div className="org-switch">
          <span className="org-avatar">EX</span>
          <span>
            <b>Example Organisation</b>
            <small>Enterprise workspace</small>
          </span>
          <i>⌄</i>
        </div>
        <nav aria-label="Main navigation">
          <p className="nav-label">WORKSPACE</p>
          {nav.slice(0, 6).map(([id, icon, label]) => (
            <button
              key={id}
              className={view === id ? "active" : ""}
              onClick={() => go(id as View)}
            >
              <span>{icon}</span>
              {label}
              {id === "training" && <em>3</em>}
            </button>
          ))}
          <p className="nav-label">CONTROL CENTRE</p>
          {nav.slice(6).map(([id, icon, label]) => (
            <button
              key={id}
              className={view === id ? "active" : ""}
              onClick={() => go(id as View)}
            >
              <span>{icon}</span>
              {label}
            </button>
          ))}
        </nav>
        <div className="sidebar-card">
          <span className="pulse-dot" />
          <b>Platform health</b>
          <p>All services operational</p>
          <button onClick={() => act("System status opened")}>
            View status
          </button>
        </div>
        <button className="user-card" onClick={() => setModal("profile")}>
          <img src="https://i.pravatar.cc/96?img=12" alt="Employee profile" />
          <span>
            <b>{role === "employee" ? "Asha Sharma" : "Company Admin"}</b>
            <small>
              {role === "employee"
                ? "Operations · Pathfinder"
                : "Platform control centre"}
            </small>
          </span>
          <i>•••</i>
        </button>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <small>EXAMPLE ORGANISATION</small>
            <h1>{title}</h1>
          </div>
          <div className="top-actions">
            <a className="primary small" href="/platform">
              Open working platform
            </a>
            <label className="role-switch">
              <span>VIEWING AS</span>
              <select
                value={role}
                onChange={(e) => {
                  const next = e.target.value as "employee" | "admin";
                  setRole(next);
                  go(next === "admin" ? "admin" : "dashboard");
                  act(
                    next === "admin"
                      ? "Company Admin view enabled"
                      : "Employee view enabled",
                  );
                }}
                aria-label="Viewing as"
              >
                <option value="employee">Employee</option>
                <option value="admin">Company Admin</option>
              </select>
            </label>
            <button
              className="icon-btn"
              onClick={() => act("Help centre opened")}
              aria-label="Help"
            >
              ?
            </button>
            <div className="notification-wrap">
              <button
                className="icon-btn notification"
                onClick={() => setNotifications(!notifications)}
                aria-label="Notifications"
              >
                ♢<b>3</b>
              </button>
              {notifications && (
                <div className="notification-menu">
                  <h4>
                    Notifications <span>3 new</span>
                  </h4>
                  <button
                    onClick={() => {
                      go("training");
                      setNotifications(false);
                    }}
                  >
                    <i className="n-purple">◈</i>
                    <span>
                      <b>TRN-05 is due soon</b>
                      <small>Complete before 20 August</small>
                    </span>
                  </button>
                  <button onClick={() => act("Policy acknowledgement opened")}>
                    <i className="n-blue">▤</i>
                    <span>
                      <b>Leave Policy v3</b>
                      <small>Acknowledgement required</small>
                    </span>
                  </button>
                  <button onClick={() => go("certificates")}>
                    <i className="n-green">◇</i>
                    <span>
                      <b>Certificate reminder</b>
                      <small>Security expires in 60 days</small>
                    </span>
                  </button>
                </div>
              )}
            </div>
            <button className="primary small" onClick={() => setModal("ask")}>
              <span>✦</span> Ask OneWork
            </button>
          </div>
        </header>

        {view === "dashboard" && (
          <div className="page dashboard-page animate-in">
            <section className="hero-panel">
              <div className="hero-image" />
              <div className="hero-overlay" />
              <div className="hero-content">
                <span className="eyebrow">
                  <i /> YOUR WORKDAY, SIMPLIFIED
                </span>
                <h2>
                  Welcome back, Asha.
                  <br />
                  <em>What do you need to achieve?</em>
                </h2>
                <p>
                  Find an owner, process, document or training module from one
                  trusted workspace.
                </p>
                <div className="hero-search">
                  <span>⌕</span>
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && runSearch()}
                    placeholder="Ask: Who approves software access?"
                  />
                  <kbd>⌘ K</kbd>
                  <button onClick={runSearch}>
                    Search <b>→</b>
                  </button>
                </div>
                <div className="suggestions">
                  <small>TRY ASKING</small>
                  {[
                    "How do I request leave?",
                    "Who owns payroll?",
                    "Report a security incident",
                  ].map((q) => (
                    <button
                      key={q}
                      onClick={() => {
                        setQuery(q);
                        setTimeout(runSearch, 0);
                      }}
                    >
                      {q}
                      <span>↗</span>
                    </button>
                  ))}
                </div>
              </div>
              <div className="trust-chip">
                <span>✓</span>
                <div>
                  <b>Verified knowledge</b>
                  <small>Only approved sources</small>
                </div>
              </div>
            </section>

            <section className="stat-grid">
              <article className="stat-card accent">
                <div>
                  <span className="stat-icon">◈</span>
                  <small>LEARNING PROGRESS</small>
                  <h3>25%</h3>
                  <p>2 of 8 induction sessions complete</p>
                </div>
                <Ring value={25} label="complete" />
                <button onClick={() => go("training")}>
                  Continue learning <span>→</span>
                </button>
              </article>
              <article className="stat-card">
                <div className="stat-head">
                  <span className="stat-icon blue">◎</span>
                  <small>OWNERSHIP COVERAGE</small>
                  <b className="up">↑ 4.2%</b>
                </div>
                <h3>94%</h3>
                <p>216 of 230 activities have confirmed owners</p>
                <div className="mini-progress">
                  <i style={{ width: "94%" }} />
                </div>
                <button onClick={() => go("matrix")}>
                  View responsibility map <span>→</span>
                </button>
              </article>
              <article className="stat-card">
                <div className="stat-head">
                  <span className="stat-icon green">⌕</span>
                  <small>ANSWER SUCCESS</small>
                  <b className="up">↑ 8.7%</b>
                </div>
                <h3>87%</h3>
                <p>Questions resolved without support</p>
                <Sparkline />
                <button onClick={() => go("analytics")}>
                  Open insights <span>→</span>
                </button>
              </article>
            </section>

            <section className="reward-strip">
              <article>
                <span>◆</span>
                <div>
                  <small>REWARD POINTS</small>
                  <b>1,240</b>
                  <p>Level 3 · Pathfinder</p>
                </div>
              </article>
              <article>
                <span>🏅</span>
                <div>
                  <small>CERTIFICATES</small>
                  <b>1 active</b>
                  <p>Workplace Basics earned</p>
                </div>
              </article>
              <article className="leader-mini">
                <div>
                  <small>DEPARTMENT LEADERBOARD</small>
                  <b>#2 Asha Sharma</b>
                  <p>940 points to reach first place</p>
                </div>
                <button onClick={() => go("training")}>View learning →</button>
              </article>
            </section>

            <section className="split-grid">
              <article className="panel learning-panel">
                <div className="panel-title">
                  <div>
                    <small>YOUR PRIORITY</small>
                    <h3>Continue where you left off</h3>
                  </div>
                  <button onClick={() => go("training")}>
                    View learning plan
                  </button>
                </div>
                <div className="course-feature">
                  <div className="course-art">
                    <span>
                      SECURITY
                      <br />
                      <b>
                        STARTS
                        <br />
                        WITH YOU
                      </b>
                    </span>
                    <i>TRN—05</i>
                  </div>
                  <div className="course-info">
                    <span className="pill purple">MANDATORY</span>
                    <h4>
                      Information Security
                      <br />& Confidentiality
                    </h4>
                    <p>Chapter 4 of 6 · Recognise phishing</p>
                    <div className="course-bar">
                      <i style={{ width: "68%" }} />
                      <b>68%</b>
                    </div>
                    <button
                      className="primary"
                      onClick={() => setModal("player")}
                    >
                      <span>▶</span> Resume module
                    </button>
                  </div>
                </div>
              </article>
              <article className="panel actions-panel">
                <div className="panel-title">
                  <div>
                    <small>QUICK ACTIONS</small>
                    <h3>Start with the right process</h3>
                  </div>
                  <button onClick={() => go("matrix")}>View all</button>
                </div>
                {activities.map((a, i) => (
                  <button
                    className="activity-row"
                    key={a.title}
                    onClick={() => setModal(`activity-${i}`)}
                  >
                    <span className={`activity-icon ${a.color}`}>
                      {["↗", "⌁", "₹"][i]}
                    </span>
                    <span>
                      <b>{a.title}</b>
                      <small>
                        {a.owner} · {a.time}
                      </small>
                    </span>
                    <i>→</i>
                  </button>
                ))}
              </article>
            </section>

            <section className="insight-banner">
              <div>
                <span className="insight-icon">✦</span>
                <div>
                  <small>ONEWORK INSIGHT</small>
                  <h3>
                    7 employees searched for “work from home approval” this
                    week.
                  </h3>
                  <p>
                    No confirmed Activity currently exists. Route this gap to
                    the correct owner.
                  </p>
                </div>
              </div>
              <button onClick={() => setModal("insight")}>
                Review knowledge gap <span>→</span>
              </button>
            </section>
          </div>
        )}

        {view === "knowledge" && (
          <div className="page animate-in">
            <section className="search-stage">
              <span className="eyebrow dark">
                <i /> KNOWLEDGE SEARCH
              </span>
              <h2>
                One trusted answer.
                <br />
                <em>Every source visible.</em>
              </h2>
              <div className="main-search">
                <span>⌕</span>
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && runSearch()}
                  placeholder="Search a process, owner, policy or training module"
                />
                <button onClick={runSearch}>Search workspace</button>
              </div>
              <div className="filter-row">
                {["All", "Activities", "SOPs", "Policies", "Training"].map(
                  (f) => (
                    <button
                      key={f}
                      onClick={() => setFilter(f)}
                      className={filter === f ? "selected" : ""}
                    >
                      {f}
                    </button>
                  ),
                )}
              </div>
            </section>
            {searched || query ? (
              <section className="results-layout">
                <div className="answer-card">
                  <div className="answer-top">
                    <span>✦ CONFIRMED ANSWER</span>
                    <small>3 approved sources · reviewed 4 Aug 2026</small>
                  </div>
                  <h3>
                    To request a laptop, open the official IT service request.
                  </h3>
                  <p>
                    The IT Asset Manager owns standard asset requests. Your
                    recommended standard device is normally issued within{" "}
                    <b>5 working days</b> after approval.
                  </p>
                  <div className="answer-meta">
                    <div>
                      <small>RESPONSIBLE ROLE</small>
                      <b>IT Asset Manager</b>
                    </div>
                    <div>
                      <small>OFFICIAL CHANNEL</small>
                      <b>IT Service Portal</b>
                    </div>
                    <div>
                      <small>EXPECTED TIME</small>
                      <b>5 working days</b>
                    </div>
                    <div>
                      <small>ESCALATION</small>
                      <b>IT Service Desk Lead</b>
                    </div>
                  </div>
                  <div className="answer-actions">
                    <button
                      className="primary"
                      onClick={() =>
                        act("Official request opened in demo mode")
                      }
                    >
                      Open official request <span>↗</span>
                    </button>
                    <button onClick={() => setModal("activity-1")}>
                      View full Activity
                    </button>
                    <button
                      className="icon-btn"
                      onClick={() => act("Answer saved")}
                    >
                      ☆
                    </button>
                  </div>
                </div>
                <aside className="source-panel">
                  <h3>Evidence used</h3>
                  {knowledgeCards.map((c) => (
                    <button
                      key={c.title}
                      onClick={() => act(`${c.title} opened`)}
                    >
                      <span>{c.tag}</span>
                      <b>{c.title}</b>
                      <small>
                        {c.owner} · {c.sla}
                      </small>
                    </button>
                  ))}
                  <div className="safe-note">
                    <b>✓ Grounded answer</b>
                    <p>
                      Names, timing and escalation are read from the current
                      Responsibility Matrix.
                    </p>
                  </div>
                </aside>
              </section>
            ) : (
              <section className="empty-search">
                <div>⌕</div>
                <h3>Search across trusted organisational knowledge</h3>
                <p>
                  Try an Activity, policy name, department, owner or question in
                  natural language.
                </p>
              </section>
            )}
          </div>
        )}

        {view === "training" && (
          <div className="page animate-in">
            <section className="section-intro">
              <div>
                <span className="eyebrow dark">
                  <i /> LEARNING EXPERIENCE
                </span>
                <h2>
                  Build confidence.
                  <br />
                  <em>Prove understanding.</em>
                </h2>
                <p>
                  Your role-based plan connects essential knowledge to real
                  workplace processes.
                </p>
              </div>
              <div className="learning-score">
                <Ring value={68} label="core path" />
                <div>
                  <b>New Employee Core</b>
                  <small>8 of 12 modules complete</small>
                  <span>On track</span>
                </div>
              </div>
            </section>
            <section className="learning-layout">
              <div className="learning-list">
                <div className="panel-title">
                  <div>
                    <small>ASSIGNED PATH</small>
                    <h3>New Employee Core</h3>
                  </div>
                  <div className="tabs">
                    <button className="active">In progress</button>
                    <button>Completed</button>
                  </div>
                </div>
                {curriculum.slice(0, 8).map((l, i) => {
                  const complete = i < 2;
                  const current = i === 2;
                  return (
                    <article
                      className={`module-row ${!complete && !current ? "locked" : ""}`}
                      key={l[0]}
                    >
                      <div
                        className={`module-num ${["purple", "blue", "green"][i % 3]}`}
                      >
                        {complete ? "✓" : current ? "▶" : "⌁"}
                      </div>
                      <div className="module-copy">
                        <span>
                          {l[0]} ·{" "}
                          {i < 4
                            ? "MODULE 1 · COMPANY INTRODUCTION"
                            : "MODULE 2 · CORE CONDUCT"}
                        </span>
                        <h4>{l[1]}</h4>
                        <p>{l[2]}</p>
                        <div className="module-progress">
                          <i
                            style={{
                              width: complete ? "100%" : current ? "42%" : "0%",
                            }}
                          />
                        </div>
                      </div>
                      <div className="module-end">
                        <small>
                          {l[3]} ·{" "}
                          {complete
                            ? "Score recorded"
                            : current
                              ? "In progress"
                              : "Pass previous quiz"}
                        </small>
                        <b>
                          {complete
                            ? i
                              ? "85%"
                              : "90%"
                            : current
                              ? "42%"
                              : "Locked"}
                        </b>
                        <button
                          disabled={!complete && !current}
                          onClick={() => setModal(complete ? "quiz" : "player")}
                        >
                          {complete ? "Review" : current ? "Open" : "Locked"} →
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
              <aside className="learning-side">
                <div className="streak-card">
                  <small>LEARNING STREAK</small>
                  <h3>5 days</h3>
                  <div className="days">
                    {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => (
                      <span className={i < 5 ? "done" : ""} key={i}>
                        {d}
                      </span>
                    ))}
                  </div>
                  <p>Complete one activity tomorrow to keep your streak.</p>
                </div>
                <div className="mentor-card">
                  <img
                    src="https://images.unsplash.com/photo-1522071820081-009f0129c71c?auto=format&fit=crop&w=900&q=80"
                    alt="Colleagues collaborating in a modern workplace"
                  />
                  <div>
                    <span>NEED SUPPORT?</span>
                    <h4>Learning help is one click away.</h4>
                    <button onClick={() => setModal("support")}>
                      Talk to Learning Team →
                    </button>
                  </div>
                </div>
              </aside>
            </section>
          </div>
        )}

        {view === "matrix" && (
          <div className="page animate-in">
            <section className="section-intro compact">
              <div>
                <span className="eyebrow dark">
                  <i /> RESPONSIBILITY MATRIX
                </span>
                <h2>
                  Know the owner.
                  <br />
                  <em>Use the right channel.</em>
                </h2>
                <p>
                  Authoritative ownership, backup, SLA and escalation for every
                  operational activity.
                </p>
              </div>
              <div className="coverage-card">
                <small>COVERAGE HEALTH</small>
                <b>94%</b>
                <span>
                  <i style={{ width: "94%" }} />
                </span>
                <p>14 Activities require confirmation</p>
              </div>
            </section>
            <section className="matrix-panel">
              <div className="matrix-toolbar">
                <div className="compact-search">
                  ⌕ <input placeholder="Search 230 activities" />
                </div>
                <div className="filter-row">
                  <button className="selected">All departments</button>
                  <button>My department</button>
                  <button>Needs review</button>
                </div>
                <button
                  className="primary"
                  onClick={() => setModal("new-activity")}
                >
                  ＋ New Activity
                </button>
              </div>
              <div className="matrix-count">
                <b>{responsibilityRows.length} starter activities</b>
                <span>
                  All departments · reviewed 6 Aug 2026 · placeholders require
                  organisation confirmation
                </span>
              </div>
              <div className="matrix-scroll">
                <div className="full-matrix matrix-head">
                  <span>ACTIVITY</span>
                  <span>DEPARTMENT</span>
                  <span>RESPONSIBLE ROLE</span>
                  <span>CURRENT PERSON</span>
                  <span>BACKUP</span>
                  <span>CONTACT</span>
                  <span>SLA</span>
                  <span>ESCALATION L1</span>
                  <span>ESCALATION L2</span>
                  <span>SOP</span>
                  <span>TRAINING</span>
                </div>
                {responsibilityRows.map((r, i) => (
                  <button
                    className="full-matrix matrix-row"
                    key={r[0]}
                    onClick={() => setModal(`matrix-${i}`)}
                  >
                    <span>
                      <i className={`dept-dot d${i % 5}`} />
                      <b>{r[0]}</b>
                      <small>ACT-{String(i + 1).padStart(3, "0")}</small>
                    </span>
                    <span>{r[1]}</span>
                    <span>
                      <b>{r[2]}</b>
                    </span>
                    <span>{r[3]}</span>
                    <span>{r[4]}</span>
                    <span>{r[5]}</span>
                    <span>{r[6]}</span>
                    <span>{r[7]}</span>
                    <span>{r[8]}</span>
                    <span>
                      <em className="good">{r[9]}</em>
                    </span>
                    <span>
                      <em className="good">{r[10]}</em>
                    </span>
                  </button>
                ))}
              </div>
            </section>
          </div>
        )}

        {view === "sops" && (
          <div className="page animate-in">
            <section className="section-intro compact">
              <div>
                <span className="eyebrow dark">
                  <i /> CONTROLLED KNOWLEDGE
                </span>
                <h2>
                  Procedures people can
                  <br />
                  <em>actually follow.</em>
                </h2>
                <p>
                  Current SOPs, policies, forms and job aids—versioned, approved
                  and searchable.
                </p>
              </div>
              <button
                className="primary big"
                onClick={() => setModal("new-sop")}
              >
                ＋ Create controlled document
              </button>
            </section>
            <section className="library-grid">
              {[
                [
                  "SOP-03",
                  "IT Support & Incident Triage",
                  "Information Technology",
                  "Effective",
                  "Reviewed 2 Aug",
                  "violet",
                ],
                [
                  "SOP-01",
                  "Leave & Attendance",
                  "Human Resources",
                  "Effective",
                  "Reviewed 31 Jul",
                  "blue",
                ],
                [
                  "SOP-02",
                  "Asset Request, Allocation & Return",
                  "Information Technology",
                  "Effective",
                  "Reviewed 4 Aug",
                  "cyan",
                ],
                [
                  "SOP-07",
                  "Purchase & Finance Approval",
                  "Finance / Procurement",
                  "In review",
                  "Updated today",
                  "amber",
                ],
                [
                  "SOP-08",
                  "Vendor Onboarding & Changes",
                  "Procurement",
                  "Effective",
                  "Reviewed 28 Jul",
                  "green",
                ],
                [
                  "SOP-10",
                  "Expense Reimbursement",
                  "Finance",
                  "Effective",
                  "Reviewed 1 Aug",
                  "pink",
                ],
              ].map((s, i) => (
                <article className="doc-card" key={s[0]}>
                  <div className={`doc-cover ${s[5]}`}>
                    <span>
                      ONEWORK
                      <br />
                      <b>{s[0]}</b>
                    </span>
                    <i>{String(i + 1).padStart(2, "0")}</i>
                  </div>
                  <div className="doc-body">
                    <span>{s[2]}</span>
                    <h3>{s[1]}</h3>
                    <div>
                      <em className={s[3] === "Effective" ? "good" : "warn"}>
                        {s[3]}
                      </em>
                      <small>{s[4]}</small>
                    </div>
                    <button onClick={() => act(`${s[1]} opened`)}>
                      Open document <b>→</b>
                    </button>
                  </div>
                </article>
              ))}
            </section>
            <section className="repository-plan panel">
              <div className="panel-title">
                <div>
                  <small>INITIAL REPOSITORY PLAN</small>
                  <h3>First ten SOPs, prioritised by operational need</h3>
                </div>
                <button onClick={() => setModal("sop-template")}>
                  View standard SOP template →
                </button>
              </div>
              <div className="repository-layout">
                <div className="taxonomy">
                  <b>Taxonomy</b>
                  <span>Department → Activity → Content type → Status</span>
                  <p>
                    Every controlled document includes owner, approver, version,
                    effective date, purpose, scope, prerequisites, numbered
                    steps, controls, evidence, escalation, exceptions, related
                    records and review cadence.
                  </p>
                </div>
                <div className="sop-priority-list">
                  {prioritySops.map((s, i) => (
                    <button
                      key={s[0]}
                      onClick={() => act(`${s[0]} planning record opened`)}
                    >
                      <em>{i + 1}</em>
                      <span>
                        <b>
                          {s[0]} · {s[1]}
                        </b>
                        <small>
                          {s[2]} · {s[3]}
                        </small>
                      </span>
                      <i>→</i>
                    </button>
                  ))}
                </div>
              </div>
            </section>
          </div>
        )}

        {view === "certificates" && (
          <div className="page animate-in">
            <section className="section-intro">
              <div>
                <span className="eyebrow dark">
                  <i /> VERIFIED ACHIEVEMENT
                </span>
                <h2>
                  Your learning record,
                  <br />
                  <em>clear and portable.</em>
                </h2>
                <p>
                  Completed paths, active certificates, expiry and refresher
                  requirements.
                </p>
              </div>
              <div className="certificate-summary">
                <div>
                  <b>11</b>
                  <small>Modules complete</small>
                </div>
                <div>
                  <b>2</b>
                  <small>Active certificates</small>
                </div>
                <div>
                  <b>1</b>
                  <small>Expires this year</small>
                </div>
              </div>
            </section>
            <section className="certificate-grid">
              <article className="certificate-card feature">
                <div className="cert-pattern" />
                <span className="cert-kicker">CERTIFICATE OF COMPLETION</span>
                <div className="cert-mark">1</div>
                <h3>
                  Information Security
                  <br />& Confidentiality
                </h3>
                <p>
                  Awarded to <b>Alex Morgan</b>
                </p>
                <div className="cert-meta">
                  <span>
                    ISSUED
                    <br />
                    <b>22 Sep 2025</b>
                  </span>
                  <span>
                    VALID UNTIL
                    <br />
                    <b>22 Sep 2026</b>
                  </span>
                  <span>
                    ID
                    <br />
                    <b>OW-SEC-10824</b>
                  </span>
                </div>
                <button onClick={() => act("Certificate downloaded")}>
                  Download certificate ↓
                </button>
              </article>
              <aside className="cert-list">
                <h3>Learning evidence</h3>
                {[
                  ["New Employee Core", "In progress", "68%"],
                  ["Data Privacy & Compliance", "Active", "Valid to Mar 2027"],
                  ["Code of Ethics", "Active", "Valid to Jan 2027"],
                ].map((c, i) => (
                  <button
                    key={c[0]}
                    onClick={() => act(`${c[0]} record opened`)}
                  >
                    <span className={`cert-mini c${i}`}>◇</span>
                    <span>
                      <b>{c[0]}</b>
                      <small>{c[1]}</small>
                    </span>
                    <em>{c[2]}</em>
                    <i>→</i>
                  </button>
                ))}
              </aside>
            </section>
          </div>
        )}

        {view === "analytics" && (
          <div className="page animate-in">
            <section className="section-intro compact">
              <div>
                <span className="eyebrow dark">
                  <i /> ORGANISATIONAL INSIGHT
                </span>
                <h2>
                  See friction before it
                  <br />
                  <em>becomes failure.</em>
                </h2>
                <p>
                  Learning, search, ownership and content-health signals in one
                  operational view.
                </p>
              </div>
              <div className="date-filter">
                <button>Last 30 days⌄</button>
                <button onClick={() => act("Report exported")}>
                  Export report ↓
                </button>
              </div>
            </section>
            <section className="analytics-grid">
              <article className="chart-card wide">
                <div className="panel-title">
                  <div>
                    <small>SELF-SERVICE SUCCESS</small>
                    <h3>Employees are finding answers faster</h3>
                  </div>
                  <span className="metric-big">
                    87% <small>↑ 8.7%</small>
                  </span>
                </div>
                <div className="line-chart">
                  <div className="grid-lines" />
                  <div className="chart-area" />
                  <div className="chart-line" />
                  <span className="point p1" />
                  <span className="point p2" />
                  <span className="point p3" />
                  <span className="point p4" />
                  <div className="x-labels">
                    <span>W1</span>
                    <span>W2</span>
                    <span>W3</span>
                    <span>W4</span>
                    <span>W5</span>
                    <span>W6</span>
                  </div>
                </div>
              </article>
              <article className="chart-card">
                <small>CONTENT HEALTH</small>
                <h3>Review status</h3>
                <div className="donut">
                  <span>
                    <b>92%</b>
                    <small>current</small>
                  </span>
                </div>
                <div className="legend">
                  <span>
                    <i className="lg1" />
                    Current <b>426</b>
                  </span>
                  <span>
                    <i className="lg2" />
                    Due soon <b>29</b>
                  </span>
                  <span>
                    <i className="lg3" />
                    Overdue <b>8</b>
                  </span>
                </div>
              </article>
              <article className="chart-card">
                <small>TOP UNRESOLVED QUESTIONS</small>
                <h3>Knowledge opportunities</h3>
                {[
                  ["Work from home approval", 27],
                  ["International travel insurance", 18],
                  ["New vendor NDA process", 13],
                  ["Equipment for contractors", 9],
                ].map((q, i) => (
                  <button
                    className="query-bar"
                    key={q[0]}
                    onClick={() => setModal("insight")}
                  >
                    <span>
                      <b>{i + 1}</b>
                      {q[0]}
                    </span>
                    <em>{q[1]}</em>
                    <i style={{ width: `${Number(q[1]) * 3}%` }} />
                  </button>
                ))}
              </article>
              <article className="chart-card wide">
                <div className="panel-title">
                  <div>
                    <small>DEPARTMENT READINESS</small>
                    <h3>Ownership and content coverage</h3>
                  </div>
                  <button onClick={() => go("matrix")}>Open Matrix →</button>
                </div>
                <div className="dept-bars">
                  {[
                    ["Human Resources", 98],
                    ["Information Technology", 96],
                    ["Finance", 92],
                    ["Procurement", 88],
                    ["Administration", 91],
                  ].map((d, i) => (
                    <div key={d[0]}>
                      <span>{d[0]}</span>
                      <i>
                        <b style={{ width: `${d[1]}%` }} />
                      </i>
                      <em>{d[1]}%</em>
                    </div>
                  ))}
                </div>
              </article>
            </section>
          </div>
        )}

        {view === "admin" && (
          <div className="page animate-in">
            <section className="section-intro compact">
              <div>
                <span className="eyebrow dark">
                  <i /> ADMINISTRATION
                </span>
                <h2>
                  Control the system.
                  <br />
                  <em>Protect the truth.</em>
                </h2>
                <p>
                  Publishing, users, ownership, automation and audit—without
                  losing governance.
                </p>
              </div>
              <div className="intro-actions">
                <button onClick={() => go("builder")}>
                  Open course builder
                </button>
                <button
                  className="primary big"
                  onClick={() => setModal("create")}
                >
                  ＋ Create content
                </button>
              </div>
            </section>
            <section className="admin-stats">
              {[
                ["Total employees", "1,248", "Across 7 departments"],
                ["Training completion", "74%", "↑ 6% this month"],
                ["Certificates issued", "862", "This year"],
                ["Average quiz score", "81%", "Retake rate 14%"],
              ].map((s, i) => (
                <article key={s[0]}>
                  <span className={`admin-icon a${i}`}>
                    {["▤", "◉", "!", "⌁"][i]}
                  </span>
                  <small>{s[0]}</small>
                  <h3>{s[1]}</h3>
                  <p>{s[2]}</p>
                </article>
              ))}
            </section>
            <section className="admin-layout">
              <article className="panel">
                <div className="panel-title">
                  <div>
                    <small>PRIORITY QUEUE</small>
                    <h3>Needs your attention</h3>
                  </div>
                  <button onClick={() => act("Queue filtered")}>Filter⌄</button>
                </div>
                {[
                  [
                    "2 Activities missing backup",
                    "Responsibility Matrix",
                    "Blocks publish",
                    "Review",
                  ],
                  [
                    "Information Security v4",
                    "Training module",
                    "Approval due",
                    "Open",
                  ],
                  [
                    "SOP-02 link validation failed",
                    "Controlled document",
                    "High priority",
                    "Fix",
                  ],
                  [
                    "7 unresolved search questions",
                    "Knowledge feedback",
                    "Oldest: 3 days",
                    "Route",
                  ],
                ].map((q, i) => (
                  <button
                    className="queue-row"
                    key={q[0]}
                    onClick={() => act(`${q[3]} action opened`)}
                  >
                    <span className={`queue-icon q${i}`}>{i + 1}</span>
                    <span>
                      <b>{q[0]}</b>
                      <small>{q[1]}</small>
                    </span>
                    <em>{q[2]}</em>
                    <i>{q[3]} →</i>
                  </button>
                ))}
              </article>
              <aside className="audit-card">
                <div className="panel-title">
                  <div>
                    <small>LIVE GOVERNANCE</small>
                    <h3>Recent activity</h3>
                  </div>
                  <span className="live">
                    <i /> LIVE
                  </span>
                </div>
                {[
                  ["Priya Shah", "published Leave Policy v3", "4 min"],
                  ["Daniel Reed", "updated Asset Request owner", "18 min"],
                  ["Maya Chen", "approved SOP-10", "1 hr"],
                  ["System", "completed nightly link check", "2 hr"],
                ].map((a, i) => (
                  <div className="audit-row" key={a[1]}>
                    <img
                      src={`https://i.pravatar.cc/50?img=${30 + i}`}
                      alt=""
                    />
                    <span>
                      <b>{a[0]}</b>
                      <p>{a[1]}</p>
                    </span>
                    <small>{a[2]}</small>
                  </div>
                ))}
                <button
                  className="audit-link"
                  onClick={() => act("Audit log opened")}
                >
                  Open complete audit log →
                </button>
              </aside>
            </section>
          </div>
        )}

        {view === "builder" && (
          <div className="page animate-in">
            <section className="section-intro compact">
              <div>
                <span className="eyebrow dark">
                  <i /> NO-CODE COURSE BUILDER
                </span>
                <h2>
                  Turn knowledge into
                  <br />
                  <em>guided behaviour.</em>
                </h2>
                <p>
                  Reorder modules, add sessions, attach assessments and publish
                  controlled learning without writing code.
                </p>
              </div>
              <div className="intro-actions">
                <button onClick={() => act("Draft saved")}>Save draft</button>
                <button
                  className="primary big"
                  onClick={() => act("Curriculum published to pilot cohort")}
                >
                  Publish curriculum
                </button>
              </div>
            </section>
            <section className="builder-summary">
              <article>
                <small>CURRICULUM</small>
                <b>22 modules</b>
                <p>Core induction + operational pathways</p>
              </article>
              <article>
                <small>ASSESSMENT RULE</small>
                <b>80% pass</b>
                <p>Unlimited retakes · question analytics</p>
              </article>
              <article>
                <small>ESTIMATED TIME</small>
                <b>4h 28m</b>
                <p>Delivered in short, trackable sessions</p>
              </article>
              <article>
                <small>STATUS</small>
                <b>Draft v1.0</b>
                <p>Ready for owner validation</p>
              </article>
            </section>
            <section className="course-builder panel">
              {[
                "Organisation & Culture",
                "Conduct, Security & Communication",
                "People & Operational Processes",
                "Ownership, Development & FAQs",
              ].map((group, groupIndex) => (
                <article className="builder-module" key={group}>
                  <header>
                    <span>⠿</span>
                    <div>
                      <small>MODULE {groupIndex + 1}</small>
                      <h3>{group}</h3>
                    </div>
                    <button onClick={() => act(`Session added to ${group}`)}>
                      ＋ Add session
                    </button>
                  </header>
                  {curriculum
                    .slice(
                      groupIndex * 6,
                      Math.min(groupIndex * 6 + 6, curriculum.length),
                    )
                    .map((item, i) => (
                      <div className="builder-session" key={item[0]}>
                        <span>⠿</span>
                        <em>{item[0]}</em>
                        <div>
                          <b>{item[1]}</b>
                          <small>{item[2]}</small>
                        </div>
                        <i>{item[3]}</i>
                        <button onClick={() => setModal("quiz")}>Quiz</button>
                        <button onClick={() => act(`${item[1]} duplicated`)}>
                          ⧉
                        </button>
                        <button
                          onClick={() => act(`${item[1]} opened for editing`)}
                        >
                          Edit
                        </button>
                      </div>
                    ))}
                </article>
              ))}
              <button
                className="add-module"
                onClick={() => act("New module block added")}
              >
                ＋ Add curriculum module
              </button>
            </section>
          </div>
        )}

        {view === "blueprint" && (
          <div className="page blueprint-page animate-in">
            <section className="blueprint-hero">
              <div>
                <span className="eyebrow">
                  <i /> MANAGEMENT DELIVERY BLUEPRINT
                </span>
                <h2>
                  Every commitment in the email.
                  <br />
                  <em>One connected delivery system.</em>
                </h2>
                <p>
                  This prototype links the product experience to the complete
                  Phase-0 plan: content, ownership, architecture, implementation
                  and scale.
                </p>
                <div className="blueprint-hero-actions">
                  <button
                    className="primary"
                    onClick={() => act("Management summary prepared")}
                  >
                    Present executive summary →
                  </button>
                  <button onClick={() => setBlueprintTab("06")}>
                    View architecture
                  </button>
                </div>
              </div>
              <div className="delivery-score">
                <span>10/10</span>
                <b>Management deliverables represented</b>
                <p>Planning + content + prototype + roadmap</p>
              </div>
            </section>
            <section className="phase-line">
              {[
                ["NOW", "Phase 0", "Validate plan, content and prototype"],
                ["NEXT", "Phase 1", "Single-organisation MVP"],
                ["EXPAND", "Phase 2", "AI search, assessment and analytics"],
                ["SCALE", "Phase 3", "Multi-organisation rollout"],
              ].map((p, i) => (
                <article key={p[1]}>
                  <em>{String(i + 1).padStart(2, "0")}</em>
                  <small>{p[0]}</small>
                  <b>{p[1]}</b>
                  <p>{p[2]}</p>
                </article>
              ))}
            </section>
            <section className="blueprint-workspace">
              <aside className="blueprint-nav">
                {blueprintItems.map((item) => (
                  <button
                    key={item[0]}
                    className={blueprintTab === item[0] ? "active" : ""}
                    onClick={() => setBlueprintTab(item[0])}
                  >
                    <span>{item[0]}</span>
                    <div>
                      <b>{item[1]}</b>
                      <small>{item[2]}</small>
                    </div>
                  </button>
                ))}
              </aside>
              <article className="blueprint-detail">
                {blueprintItems
                  .filter((item) => item[0] === blueprintTab)
                  .map((item) => (
                    <header key={item[0]}>
                      <span>DELIVERABLE {item[0]}</span>
                      <h2>{item[1]}</h2>
                      <p>{item[2]}</p>
                      <b>{item[3]}</b>
                    </header>
                  ))}
                {blueprintTab === "01" && (
                  <div className="detail-grid four">
                    {[
                      [
                        "Phase 0",
                        "Plan, architecture, curriculum, content inventory and validated prototype",
                        "Management approval",
                      ],
                      [
                        "Phase 1",
                        "Tenant foundation, identity, knowledge, matrix, SOP and training MVP",
                        "Pilot readiness",
                      ],
                      [
                        "Phase 2",
                        "LangGraph AI search, assessments, certificates, analytics and n8n automation",
                        "Measured adoption",
                      ],
                      [
                        "Phase 3",
                        "Self-service organisation onboarding, controls, billing readiness and regional scale",
                        "100+ organisations",
                      ],
                    ].map((x) => (
                      <section key={x[0]}>
                        <small>{x[0]}</small>
                        <h3>{x[1]}</h3>
                        <p>
                          Gate: {x[2]} · Dependencies and owners confirmed
                          before start.
                        </p>
                      </section>
                    ))}
                  </div>
                )}
                {blueprintTab === "02" && (
                  <div className="curriculum-table">
                    <div>
                      <b>MODULE</b>
                      <b>LEARNING OBJECTIVE</b>
                      <b>DURATION</b>
                    </div>
                    {curriculum.map((c) => (
                      <button key={c[0]} onClick={() => go("builder")}>
                        <span>
                          <em>{c[0]}</em>
                          <b>{c[1]}</b>
                        </span>
                        <p>{c[2]}</p>
                        <i>{c[3]}</i>
                      </button>
                    ))}
                  </div>
                )}
                {blueprintTab === "03" && (
                  <>
                    <div className="mistake-total">
                      <b>127</b>
                      <span>
                        recurring mistakes catalogued
                        <br />
                        <small>
                          Every item maps to explicit training content
                        </small>
                      </span>
                    </div>
                    <div className="detail-grid">
                      {mistakeCategories.map((m) => (
                        <section key={m[0]}>
                          <small>{m[1]} MISTAKES</small>
                          <h3>{m[0]}</h3>
                          <p>{m[2]}</p>
                          <em>Training mapping required ✓</em>
                        </section>
                      ))}
                    </div>
                  </>
                )}
                {blueprintTab === "04" && (
                  <div className="feature-proof">
                    <div>
                      <b>22</b>
                      <span>starter activities</span>
                    </div>
                    <div>
                      <b>8</b>
                      <span>departments</span>
                    </div>
                    <div>
                      <b>11</b>
                      <span>required data fields</span>
                    </div>
                    <button className="primary" onClick={() => go("matrix")}>
                      Open complete matrix →
                    </button>
                  </div>
                )}
                {blueprintTab === "05" && (
                  <div className="priority-blueprint">
                    {prioritySops.map((s, i) => (
                      <div key={s[0]}>
                        <em>{i + 1}</em>
                        <span>
                          <b>
                            {s[0]} · {s[1]}
                          </b>
                          <small>
                            {s[2]} · {s[3]}
                          </small>
                        </span>
                      </div>
                    ))}
                  </div>
                )}
                {blueprintTab === "06" && (
                  <>
                    <div className="architecture-flow">
                      {[
                        [
                          "EXPERIENCE",
                          "Next.js web app",
                          "Employee · Manager · Admin",
                        ],
                        [
                          "APPLICATION",
                          "FastAPI services",
                          "RBAC · content · training · audit",
                        ],
                        [
                          "INTELLIGENCE",
                          "LangGraph agent",
                          "Intent · retrieval · confidence · citations",
                        ],
                        [
                          "DATA",
                          "PostgreSQL + pgvector",
                          "org_id · RLS · semantic index",
                        ],
                        [
                          "AUTOMATION",
                          "n8n on AWS",
                          "Reminders · routing · escalation",
                        ],
                      ].map((x, i) => (
                        <section key={x[0]}>
                          <small>{x[0]}</small>
                          <b>{x[1]}</b>
                          <p>{x[2]}</p>
                          {i < 4 && <i>→</i>}
                        </section>
                      ))}
                    </div>
                    <div className="query-flow">
                      <b>Employee question</b>
                      <span>→</span>
                      <b>Tenant scope</b>
                      <span>→</span>
                      <b>Semantic + matrix lookup</b>
                      <span>→</span>
                      <b>Verified answer with sources</b>
                      <span>→</span>
                      <b>Owner escalation if unresolved</b>
                    </div>
                  </>
                )}
                {blueprintTab === "07" && (
                  <div className="detail-grid">
                    {[
                      "Employee dashboard",
                      "Knowledge search",
                      "Activity detail",
                      "Responsibility Matrix",
                      "SOP repository",
                      "Training player",
                      "Quiz & assessment",
                      "Certificate tracker",
                      "Admin dashboard",
                      "Course builder",
                      "Analytics",
                      "Management blueprint",
                    ].map((x, i) => (
                      <section key={x}>
                        <small>SCREEN {String(i + 1).padStart(2, "0")}</small>
                        <h3>{x}</h3>
                        <p>
                          Responsive, role-aware and demonstrated in this
                          clickable prototype.
                        </p>
                      </section>
                    ))}
                  </div>
                )}
                {blueprintTab === "08" && (
                  <div className="assessment-flow">
                    {[
                      ["1", "Learn", "Video, text, scenario or document"],
                      ["2", "Check", "Question checks within each session"],
                      ["3", "Assess", "Quiz with 80% passing threshold"],
                      ["4", "Certify", "Issue verifiable certificate"],
                      [
                        "5",
                        "Refresh",
                        "Risk-based annual or policy-triggered cadence",
                      ],
                      [
                        "6",
                        "Improve",
                        "Results feed employee and admin analytics",
                      ],
                    ].map((x) => (
                      <section key={x[0]}>
                        <em>{x[0]}</em>
                        <b>{x[1]}</b>
                        <p>{x[2]}</p>
                      </section>
                    ))}
                  </div>
                )}
                {blueprintTab === "09" && (
                  <div className="roadmap-list">
                    {[
                      [
                        "01",
                        "Foundation",
                        "Tenant model, environments, CI/CD, identity and roles",
                      ],
                      [
                        "02",
                        "Knowledge core",
                        "Matrix, SOPs, documents, versioning and universal search",
                      ],
                      [
                        "03",
                        "Learning core",
                        "Curriculum, player, quizzes, results, certificates and reminders",
                      ],
                      [
                        "04",
                        "Admin & governance",
                        "Content workflow, users, ownership, audit and analytics",
                      ],
                      [
                        "05",
                        "Integrations",
                        "AWS services, Claude API, LangGraph and n8n automation",
                      ],
                      [
                        "06",
                        "Pilot & hardening",
                        "UAT, accessibility, security, performance, training and launch",
                      ],
                    ].map((x) => (
                      <div key={x[0]}>
                        <em>{x[0]}</em>
                        <span>
                          <b>{x[1]}</b>
                          <p>{x[2]}</p>
                        </span>
                        <i>Acceptance gate →</i>
                      </div>
                    ))}
                  </div>
                )}
                {blueprintTab === "10" && (
                  <div className="scale-grid">
                    {[
                      [
                        "Tenant isolation",
                        "org_id on every record + PostgreSQL RLS + tenant-aware cache and vector namespaces",
                      ],
                      [
                        "Organisation onboarding",
                        "Guided setup for branding, hierarchy, domains, roles, policies and content import",
                      ],
                      [
                        "Configuration limits",
                        "Theme, terminology, modules and workflows configurable without code forks",
                      ],
                      [
                        "Data & compliance",
                        "Auditability, encryption, retention, regional deployment and residency controls",
                      ],
                      [
                        "Commercial readiness",
                        "Plan entitlements, usage metering, subscription events and organisation lifecycle",
                      ],
                      [
                        "Operational scale",
                        "Observability, queues, rate limits, background jobs, support tiers and recovery objectives",
                      ],
                    ].map((x) => (
                      <section key={x[0]}>
                        <h3>{x[0]}</h3>
                        <p>{x[1]}</p>
                        <span>Designed from day one ✓</span>
                      </section>
                    ))}
                  </div>
                )}
              </article>
            </section>
          </div>
        )}
      </section>

      {modal && (
        <div className="modal-backdrop" onMouseDown={() => setModal(null)}>
          <section className="modal" onMouseDown={(e) => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setModal(null)}>
              ×
            </button>
            {modal === "player" ? (
              <>
                <div className="video-preview">
                  <div className="video-glow" />
                  <button onClick={() => act("Demo video played")}>▶</button>
                  <span>CHAPTER 4 · 06:42</span>
                </div>
                <span className="eyebrow dark">
                  <i /> TRAINING PLAYER
                </span>
                <h2>Recognise phishing before it becomes an incident.</h2>
                <p>
                  Learn the signals, verify through a separate channel and
                  report suspicious messages immediately.
                </p>
                <div className="modal-progress">
                  <i style={{ width: "68%" }} />
                  <b>68% complete</b>
                </div>
                <div className="modal-actions">
                  <button
                    className="primary"
                    onClick={() => act("Chapter continued")}
                  >
                    Continue chapter →
                  </button>
                  <button onClick={() => setModal(null)}>Save & exit</button>
                </div>
              </>
            ) : modal === "quiz" ? (
              <>
                <span className="eyebrow dark">
                  <i /> KNOWLEDGE CHECK · QUESTION 3 OF 5
                </span>
                <h2>
                  Which channel should Asha use to report an IT access issue?
                </h2>
                <p>
                  Select the answer that follows the organisation&apos;s
                  approved process. A score of 80% or above unlocks the next
                  session.
                </p>
                <div className="quiz-options">
                  {[
                    "Message a familiar IT colleague directly",
                    "Raise a ticket through the official IT service desk",
                    "Post the issue in a general WhatsApp group",
                    "Wait until the weekly team meeting",
                  ].map((answer, i) => (
                    <button
                      key={answer}
                      onClick={() =>
                        act(
                          i === 1
                            ? "Correct — the official service desk preserves ownership and SLA"
                            : "Try again — use the governed request channel",
                        )
                      }
                    >
                      <span>{String.fromCharCode(65 + i)}</span>
                      {answer}
                    </button>
                  ))}
                </div>
                <div className="quiz-rule">
                  <b>Passing rule</b>
                  <span>
                    80% minimum · unlimited retakes · result recorded in
                    employee and admin analytics
                  </span>
                </div>
                <div className="modal-actions">
                  <button
                    className="primary"
                    onClick={() => act("Answer submitted")}
                  >
                    Submit answer →
                  </button>
                  <button onClick={() => setModal(null)}>Save & exit</button>
                </div>
              </>
            ) : modal.startsWith("matrix-") ? (
              <>
                {(() => {
                  const row =
                    responsibilityRows[Number(modal.split("-")[1])] ??
                    responsibilityRows[0];
                  return (
                    <>
                      <span className="eyebrow dark">
                        <i /> VERIFIED RESPONSIBILITY RECORD
                      </span>
                      <h2>{row[0]}</h2>
                      <p>
                        Employees can see the exact owner, approved channel,
                        turnaround and escalation path without asking multiple
                        people.
                      </p>
                      <div className="modal-data matrix-modal">
                        <div>
                          <small>DEPARTMENT</small>
                          <b>{row[1]}</b>
                        </div>
                        <div>
                          <small>RESPONSIBLE ROLE</small>
                          <b>{row[2]}</b>
                        </div>
                        <div>
                          <small>CURRENT PERSON</small>
                          <b>{row[3]} · organisation to confirm</b>
                        </div>
                        <div>
                          <small>BACKUP</small>
                          <b>{row[4]}</b>
                        </div>
                        <div>
                          <small>CONTACT</small>
                          <b>{row[5]}</b>
                        </div>
                        <div>
                          <small>SLA</small>
                          <b>{row[6]}</b>
                        </div>
                        <div>
                          <small>ESCALATION LEVEL 1</small>
                          <b>{row[7]}</b>
                        </div>
                        <div>
                          <small>ESCALATION LEVEL 2</small>
                          <b>{row[8]}</b>
                        </div>
                        <div>
                          <small>RELATED SOP</small>
                          <b>{row[9]}</b>
                        </div>
                        <div>
                          <small>TRAINING MODULE</small>
                          <b>{row[10]}</b>
                        </div>
                      </div>
                      <div className="modal-actions">
                        <button
                          className="primary"
                          onClick={() => act("Official request channel opened")}
                        >
                          Open official channel ↗
                        </button>
                        <button
                          onClick={() => act("Responsibility record copied")}
                        >
                          Copy record
                        </button>
                      </div>
                    </>
                  );
                })()}
              </>
            ) : modal.startsWith("activity") ? (
              <>
                <span className="eyebrow dark">
                  <i /> CONFIRMED ACTIVITY
                </span>
                <h2>
                  {activities[Number(modal.split("-")[1])]?.title ||
                    "Official process"}
                </h2>
                <p>
                  Use the official route below. Ownership, timing and escalation
                  are governed by the Responsibility Matrix.
                </p>
                <div className="modal-data">
                  <div>
                    <small>OWNER</small>
                    <b>Responsible department lead</b>
                  </div>
                  <div>
                    <small>BACKUP</small>
                    <b>Trained service backup</b>
                  </div>
                  <div>
                    <small>EXPECTED TIME</small>
                    <b>Published service target</b>
                  </div>
                  <div>
                    <small>ESCALATION</small>
                    <b>Service lead → Department head</b>
                  </div>
                </div>
                <div className="modal-actions">
                  <button
                    className="primary"
                    onClick={() => act("Official channel opened in demo mode")}
                  >
                    Open official channel ↗
                  </button>
                  <button onClick={() => act("Activity link copied")}>
                    Copy link
                  </button>
                </div>
              </>
            ) : (
              <>
                <span className="eyebrow dark">
                  <i /> INTERACTIVE DEMO
                </span>
                <h2>
                  {modal === "insight"
                    ? "Route this knowledge gap to the correct owner."
                    : modal === "support"
                      ? "How can the Learning Team help?"
                      : "This action is ready for the production workflow."}
                </h2>
                <p>
                  This management prototype demonstrates the complete
                  interaction and decision flow. A production build will connect
                  this action to verified organisational data and services.
                </p>
                <div className="modal-form">
                  <label>
                    Demo note
                    <textarea placeholder="Add context for the responsible owner…" />
                  </label>
                </div>
                <div className="modal-actions">
                  <button
                    className="primary"
                    onClick={() => {
                      setModal(null);
                      act("Demo action submitted successfully");
                    }}
                  >
                    Submit demo action →
                  </button>
                  <button onClick={() => setModal(null)}>Cancel</button>
                </div>
              </>
            )}
          </section>
        </div>
      )}
      {toast && (
        <div className="toast">
          <span>✓</span>
          {toast}
        </div>
      )}
    </main>
  );
}
