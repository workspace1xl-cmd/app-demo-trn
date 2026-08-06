"use client";

import { useMemo, useState } from "react";

type View =
  | "dashboard"
  | "knowledge"
  | "training"
  | "matrix"
  | "sops"
  | "certificates"
  | "analytics"
  | "admin";

const nav = [
  ["dashboard", "⌂", "Overview"],
  ["knowledge", "⌕", "Knowledge search"],
  ["training", "◈", "My learning"],
  ["matrix", "◎", "Responsibility Matrix"],
  ["sops", "▤", "SOP library"],
  ["certificates", "◇", "Certificates"],
  ["analytics", "◫", "Insights"],
  ["admin", "⚙", "Administration"],
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
            <b>Alex Morgan</b>
            <small>Product Operations</small>
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
                  Good morning, Alex.
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
                  <h3>68%</h3>
                  <p>8 of 12 core modules complete</p>
                </div>
                <Ring value={68} label="complete" />
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
                {learning.map((l, i) => (
                  <article className="module-row" key={l.name}>
                    <div className={`module-num ${l.tone}`}>
                      {String(i + 5).padStart(2, "0")}
                    </div>
                    <div className="module-copy">
                      <span>{l.meta}</span>
                      <h4>{l.name}</h4>
                      <div className="module-progress">
                        <i style={{ width: `${l.progress}%` }} />
                      </div>
                    </div>
                    <div className="module-end">
                      <small>{l.due}</small>
                      <b>{l.progress}%</b>
                      <button onClick={() => setModal("player")}>
                        {l.progress ? "Continue" : "Start"} →
                      </button>
                    </div>
                  </article>
                ))}
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
              <div className="matrix-table">
                <div className="matrix-head">
                  <span>ACTIVITY</span>
                  <span>DEPARTMENT</span>
                  <span>RESPONSIBLE OWNER</span>
                  <span>SLA</span>
                  <span>STATUS</span>
                  <span />
                </div>
                {[
                  [
                    "Leave Request",
                    "Human Resources",
                    "Priya Shah · HR Operations Lead",
                    "2 working days",
                    "Confirmed",
                  ],
                  [
                    "Asset Request or Allocation",
                    "Information Technology",
                    "Daniel Reed · IT Asset Manager",
                    "5 working days",
                    "Confirmed",
                  ],
                  [
                    "Expense Reimbursement",
                    "Finance",
                    "Maya Chen · AP Specialist",
                    "Next payment cycle",
                    "Confirmed",
                  ],
                  [
                    "Vendor Onboarding",
                    "Procurement",
                    "Noah Williams · Vendor Lead",
                    "10 working days",
                    "Review due",
                  ],
                  [
                    "Contract Approval",
                    "Legal / Compliance",
                    "Aisha Khan · Legal Counsel",
                    "7 working days",
                    "Confirmed",
                  ],
                ].map((r, i) => (
                  <button
                    className="matrix-row"
                    key={r[0]}
                    onClick={() => setModal(`activity-${i % 3}`)}
                  >
                    <span>
                      <i className={`dept-dot d${i}`} />
                      <b>{r[0]}</b>
                      <small>ACT-{String(i + 1).padStart(3, "0")}</small>
                    </span>
                    <span>{r[1]}</span>
                    <span>
                      <img
                        src={`https://i.pravatar.cc/60?img=${20 + i}`}
                        alt=""
                      />
                      <b>{r[2]}</b>
                      <small>Backup confirmed</small>
                    </span>
                    <span>{r[3]}</span>
                    <span>
                      <em className={r[4] === "Confirmed" ? "good" : "warn"}>
                        {r[4]}
                      </em>
                    </span>
                    <span>→</span>
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
              <button
                className="primary big"
                onClick={() => setModal("create")}
              >
                ＋ Create content
              </button>
            </section>
            <section className="admin-stats">
              {[
                ["Published content", "426", "+12 this month"],
                ["Active employees", "248", "97% activated"],
                ["Overdue reviews", "8", "Needs action"],
                ["Automation health", "99.8%", "1 retry queued"],
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
