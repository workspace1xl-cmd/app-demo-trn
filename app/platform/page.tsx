"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import styles from "./platform.module.css";
import AdminConsole from "./AdminConsole";
import OrgSignup from "./OrgSignup";
import QuizPlayer from "./QuizPlayer";

export const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

type Session = {
  access_token: string;
  user: { name: string; email: string; role: string; org_name?: string | null };
};
type View =
  | "dashboard"
  | "search"
  | "training"
  | "matrix"
  | "sops"
  | "certificates"
  | "admin";
export type AdminSection =
  | "overview"
  | "employees"
  | "departments"
  | "matrix"
  | "sops"
  | "training"
  | "assignments"
  | "content"
  | "feedback"
  | "audit";

type Activity = {
  id: string; name: string; department: string; responsible_role: string;
  current_person: string; backup_person: string; contact_details: string; sla: string;
  escalation_level_1: string; escalation_level_2: string; sop_link?: string; training_module_link?: string;
};
type DashboardData = { user: { name: string }; training: { percent: number; completed: number; total: number }; certificates: number; points: number; open_actions: number };
type SearchData = { query: string; confidence: number; answer: string; ai_used: boolean; activities: Activity[]; unresolved?: boolean };
type ModuleResource = { resource_type: string; title: string; kind: string; url: string | null };
type TrainingModule = { id: string; sequence: number; code: string; title: string; objective: string; duration_minutes: number; content_type: string; progress?: { status: string; percent?: number; progress_percent?: number; best_score?: number | null } | null; resources?: ModuleResource[] };

function youtubeEmbedUrl(url: string): string | null {
  const match = url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/))([\w-]{6,})/);
  return match ? `https://www.youtube.com/embed/${match[1]}` : null;
}

// Renders the handful of Markdown constructs Claude's answers actually use
// (headings, **bold**, blank-line paragraphs) as real elements instead of
// literal # and ** characters. Deliberately not dangerouslySetInnerHTML —
// this text comes from an AI response, not from us, so it's built as React
// children rather than parsed as HTML.
function renderInlineMarkdown(text: string, keyPrefix: string) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g).filter(Boolean);
  return parts.map((part, index) =>
    part.startsWith("**") && part.endsWith("**") ? (
      <strong key={`${keyPrefix}-${index}`}>{part.slice(2, -2)}</strong>
    ) : (
      <span key={`${keyPrefix}-${index}`}>{part}</span>
    ),
  );
}
function renderMarkdownLite(text: string) {
  return text.split(/\n{2,}/).map((block, blockIndex) => {
    const heading = block.match(/^(#{1,3})\s+(.*)$/);
    if (heading) {
      const Tag = (["h3", "h4", "h5"] as const)[heading[1].length - 1] || "h5";
      return <Tag key={blockIndex}>{renderInlineMarkdown(heading[2], `b${blockIndex}`)}</Tag>;
    }
    return (
      <p key={blockIndex}>
        {block.split("\n").map((line, lineIndex, lines) => (
          <span key={lineIndex}>
            {renderInlineMarkdown(line, `b${blockIndex}-${lineIndex}`)}
            {lineIndex < lines.length - 1 && <br />}
          </span>
        ))}
      </p>
    );
  });
}
type Sop = { id: string; code: string; department: string; title: string; summary: string; version: string; status: string };
type Certificate = { id: string; module: string; certificate_number: string; issued_at: string; expires_at: string };
type AdminData = { employees: number; training_completion: number; certificates: number; average_quiz_score: number; activities: number; sops: number; open_feedback: number };
type PlatformData = DashboardData | SearchData | TrainingModule[] | Activity[] | Sop[] | Certificate[] | AdminData | null;

export async function request<T = PlatformData>(
  path: string,
  token?: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch(`${API}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });
  if (!response.ok)
    throw new Error(
      (await response.json().catch(() => ({}))).detail || "Request failed",
    );
  return response.json() as Promise<T>;
}

export default function WorkingPlatform() {
  const [session, setSession] = useState<Session | null>(null);
  const [view, setView] = useState<View>("dashboard");
  const [email, setEmail] = useState("employee@company.com");
  const [password, setPassword] = useState("Demo123!");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [data, setData] = useState<PlatformData>(null);
  const [query, setQuery] = useState("leave");
  const [toast, setToast] = useState("");
  const [adminSection, setAdminSection] = useState<AdminSection>("overview");
  const [showSignup, setShowSignup] = useState(false);
  const [activeQuizModule, setActiveQuizModule] = useState<string | null>(null);
  const [activeVideo, setActiveVideo] = useState<ModuleResource | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const saved = sessionStorage.getItem("onework-session");
    if (!saved) return;
    const timer = window.setTimeout(() => setSession(JSON.parse(saved) as Session), 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!session) return;
    const paths: Record<View, string> = {
      dashboard: "/api/v1/dashboard",
      search: `/api/v1/search`,
      training: "/api/v1/training/modules",
      matrix: "/api/v1/activities",
      sops: "/api/v1/sops",
      certificates: "/api/v1/certificates",
      admin: "/api/v1/admin/analytics",
    };
    if (view === "search") return;
    const timer = window.setTimeout(() => {
      setBusy(true);
      setError("");
      request<PlatformData>(paths[view], session.access_token)
        .then(setData)
        .catch((e: unknown) => setError(e instanceof Error ? e.message : "Request failed"))
        .finally(() => setBusy(false));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [session, view, reloadKey]);

  async function login(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const next = await request<Session>("/api/v1/auth/login", undefined, {
        method: "POST",
        body: JSON.stringify({
          email,
          password,
          organization: "example-organisation",
        }),
      });
      setSession(next);
      sessionStorage.setItem("onework-session", JSON.stringify(next));
      setView(next.user.role === "admin" ? "admin" : "dashboard");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Login failed");
    } finally {
      setBusy(false);
    }
  }

  async function search(event: FormEvent) {
    event.preventDefault();
    if (!session) return;
    setBusy(true);
    setError("");
    try {
      setData(
        await request("/api/v1/search", session.access_token, {
          method: "POST",
          body: JSON.stringify({ query }),
        }),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Search failed");
    } finally {
      setBusy(false);
    }
  }

  function handleQuizCompleted(result: { score: number; passed: boolean }) {
    setActiveQuizModule(null);
    setToast(
      `Assessment submitted: ${result.score}% · ${result.passed ? "Passed" : "Retake required"}`,
    );
    setTimeout(() => setToast(""), 3500);
    setReloadKey((k) => k + 1);
    if (result.passed) {
      setData(null);
      setView("certificates");
    }
  }

  if (!session && showSignup)
    return (
      <main className={styles.loginShell}>
        <section className={styles.loginArt}>
          <span>ONEWORK</span>
          <h1>
            Your own workspace,
            <br />
            <em>ready in seconds.</em>
          </h1>
          <p>
            A ready-made training programme, your own private workspace, and
            full control from day one — no setup required.
          </p>
          <div className={styles.liveStack}>
            <b>● Private &amp; secure</b>
            <b>● 22-module training programme</b>
            <b>● Full admin control</b>
          </div>
        </section>
        <OrgSignup
          onBack={() => setShowSignup(false)}
          onSignedUp={(next) => {
            setSession(next);
            sessionStorage.setItem("onework-session", JSON.stringify(next));
            setView("admin");
            setShowSignup(false);
          }}
        />
      </main>
    );

  if (!session)
    return (
      <main className={styles.loginShell}>
        <section className={styles.loginArt}>
          <span>ONEWORK</span>
          <h1>
            Every employee knows
            <br />
            <em>what to do next.</em>
          </h1>
          <p>
            Ask any question and get a verified answer, complete your
            training, and always know exactly who owns what — all in one
            place.
          </p>
          <div className={styles.liveStack}>
            <b>● Verified answers</b>
            <b>● Guided training</b>
            <b>● Real certificates</b>
          </div>
        </section>
        <form className={styles.loginCard} onSubmit={login}>
          <Link href="/">← Management demo</Link>
          <span className={styles.mark}>1</span>
          <h2>Sign in to OneWork</h2>
          <p>The local stack creates both accounts automatically.</p>
          <label>
            Email
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              type="email"
              required
            />
          </label>
          <label>
            Password
            <input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type="password"
              required
              minLength={6}
            />
          </label>
          {error && (
            <div className={styles.error}>
              {error}
            </div>
          )}
          <button disabled={busy}>
            {busy ? "Connecting…" : "Sign in securely →"}
          </button>
          <div className={styles.demoAccounts}>
            <button
              type="button"
              onClick={() => {
                setEmail("employee@company.com");
                setPassword("Demo123!");
              }}
            >
              Employee account
            </button>
            <button
              type="button"
              onClick={() => {
                setEmail("admin@company.com");
                setPassword("Admin123!");
              }}
            >
              Admin account
            </button>
          </div>
          <small>
            New organisation?{" "}
            <a href="#" onClick={(e) => { e.preventDefault(); setShowSignup(true); }}>
              Create your account →
            </a>
          </small>
        </form>
      </main>
    );

  const nav: [View, string, string][] = [
    ["dashboard", "⌂", "Dashboard"],
    ["search", "⌕", "Knowledge search"],
    ["training", "◈", "My learning"],
    ["matrix", "◎", "Who does what"],
    ["sops", "▤", "SOP repository"],
    ["certificates", "◇", "Certificates"],
    ...(session.user.role === "admin"
      ? [["admin", "⚙", "Admin analytics"] as [View, string, string]]
      : []),
  ];
  const dashboardData =
    view === "dashboard" && data && !Array.isArray(data) && "user" in data
      ? (data as DashboardData)
      : null;
  const searchData = view === "search" ? data as SearchData | null : null;
  const trainingData = view === "training" && Array.isArray(data) ? data as TrainingModule[] : null;
  const matrixData = view === "matrix" && Array.isArray(data) ? data as Activity[] : null;
  const sopData = view === "sops" && Array.isArray(data) ? data as Sop[] : null;
  const certificateData = view === "certificates" && Array.isArray(data) ? data as Certificate[] : null;
  const adminData = view === "admin" ? data as AdminData | null : null;
  return (
    <main className={styles.shell}>
      <aside>
        <Link className={styles.logo} href="/">
          <span>1</span>
          <b>
            OneWork<small>LIVE PLATFORM</small>
          </b>
        </Link>
        <nav>
          {nav.map(([id, icon, label]) => (
            <button
              className={view === id ? styles.active : ""}
              key={id}
              title={label}
              onClick={() => {
                setData(null);
                setView(id);
              }}
            >
              <span>{icon}</span>
              {label}
            </button>
          ))}
        </nav>
        <div className={styles.user}>
          <span>
            {session.user.name
              .split(" ")
              .map((x) => x[0])
              .join("")}
          </span>
          <div>
            <b>{session.user.name}</b>
            <small>{session.user.role}</small>
          </div>
        </div>
        <button
          className={styles.logout}
          onClick={() => {
            sessionStorage.removeItem("onework-session");
            setSession(null);
          }}
        >
          Sign out
        </button>
      </aside>
      <section className={styles.work}>
        <header>
          <div>
            <small>{(session.user.org_name || "YOUR ORGANISATION").toUpperCase()} · LIVE DATA</small>
            <h1>{nav.find((x) => x[0] === view)?.[2]}</h1>
          </div>
          <Link href="/">Open management blueprint ↗</Link>
        </header>
        <div className={styles.content}>
          {busy && (
            <div className={styles.loading}>Synchronising verified data…</div>
          )}
          {error && <div className={styles.error}>{error}</div>}
          {!busy && dashboardData && (
            <>
              <section className={styles.hero}>
                <div>
                  <span>GOOD MORNING</span>
                  <h2>Welcome back, {dashboardData.user.name}.</h2>
                  <p>
                    Your learning, trusted knowledge and official request
                    channels are connected.
                  </p>
                </div>
                <div className={styles.score}>
                  <b>{dashboardData.training.percent}%</b>
                  <small>training complete</small>
                </div>
              </section>
              <div className={styles.stats}>
                <Stat
                  label="COMPLETED MODULES"
                  value={`${dashboardData.training.completed}/${dashboardData.training.total}`}
                  note="Sequential induction path"
                />
                <Stat
                  label="CERTIFICATES"
                  value={dashboardData.certificates}
                  note="Verifiable learning evidence"
                />
                <Stat
                  label="REWARD POINTS"
                  value={dashboardData.points}
                  note="Based on assessment scores"
                />
                <Stat
                  label="OPEN ACTIONS"
                  value={dashboardData.open_actions}
                  note="Requires attention"
                />
              </div>
            </>
          )}
          {!busy && view === "search" && (
            <>
              <form className={styles.search} onSubmit={search}>
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Ask: How do I request leave?"
                />
                <button>Search verified knowledge →</button>
              </form>
              {searchData?.query && (
                <section className={styles.answer}>
                  <span className={searchData.unresolved ? styles.warnBadge : ""}>
                    {searchData.unresolved
                      ? "⚠ NO VERIFIED MATCH · ESCALATED FOR REVIEW"
                      : `✓ VERIFIED ORGANISATIONAL ANSWER · ${Math.round(searchData.confidence * 100)}% CONFIDENCE`}
                  </span>
                  <div className={styles.answerText}>{renderMarkdownLite(searchData.answer)}</div>
                  <p>
                    {searchData.unresolved
                      ? "This question didn't match verified organisational content. It's been logged for the knowledge team to review."
                      : searchData.ai_used
                        ? "Claude generated this answer only from verified tenant context."
                        : "Deterministic retrieval is active. Add ANTHROPIC_API_KEY to enable Claude synthesis."}
                  </p>
                  {searchData.activities?.map((a) => (
                    <article key={a.id}>
                      <div>
                        <b>{a.name}</b>
                        <small>
                          {a.department} · {a.responsible_role}
                        </small>
                      </div>
                      <span>
                        {a.contact_details}
                        <small>{a.sla}</small>
                      </span>
                      <em>
                        {a.escalation_level_1} → {a.escalation_level_2}
                      </em>
                    </article>
                  ))}
                </section>
              )}
            </>
          )}
          {!busy && trainingData && (
            <div className={styles.list}>
              {trainingData.map((m) => (
                <article key={m.id}>
                  <span className={styles.number}>
                    {m.progress?.status === "completed" ? "✓" : m.sequence}
                  </span>
                  <div>
                    <small>
                      {m.code} · {m.duration_minutes} MIN · {m.content_type}
                    </small>
                    <h3>{m.title}</h3>
                    <p>{m.objective}</p>
                    {m.resources && m.resources.length > 0 && (
                      <div className={styles.moduleResources}>
                        {m.resources.map((resource, index) =>
                          resource.kind === "video" && resource.url ? (
                            <button
                              key={index}
                              type="button"
                              className={styles.resourceChip}
                              onClick={() => setActiveVideo(resource)}
                            >
                              ▶ {resource.title}
                            </button>
                          ) : (
                            <a
                              key={index}
                              href={resource.url ?? "#"}
                              target="_blank"
                              rel="noopener noreferrer"
                              className={styles.resourceChip}
                              onClick={(e) => { if (!resource.url) e.preventDefault(); }}
                            >
                              📄 {resource.title}
                            </a>
                          ),
                        )}
                      </div>
                    )}
                    <i>
                      <b style={{ width: `${m.progress?.progress_percent ?? m.progress?.percent ?? 0}%` }} />
                    </i>
                  </div>
                  <div className={styles.end}>
                    <em>{m.progress?.status}</em>
                    <b>
                      {m.progress?.best_score == null
                        ? "—"
                        : `${m.progress.best_score}%`}
                    </b>
                    <button
                      disabled={m.progress?.status === "locked"}
                      onClick={() => setActiveQuizModule(m.id)}
                    >
                      {m.progress?.status === "completed"
                        ? "Retake quiz"
                        : "Open assessment"}
                    </button>
                  </div>
                </article>
              ))}
              {trainingData.length === 0 && <div className={styles.noRecords}>No records found.</div>}
            </div>
          )}
          {!busy && matrixData && (
            <div className={styles.table}>
              <div>
                <b>ACTIVITY</b>
                <b>DEPARTMENT / ROLE</b>
                <b>CONTACT / SLA</b>
                <b>ESCALATION</b>
                <b>LINKS</b>
              </div>
              {matrixData.map((a) => (
                <article key={a.id}>
                  <span>
                    <b>{a.name}</b>
                    <small>
                      {a.current_person} · Backup: {a.backup_person}
                    </small>
                  </span>
                  <span>
                    <b>{a.department}</b>
                    <small>{a.responsible_role}</small>
                  </span>
                  <span>
                    <b>{a.contact_details}</b>
                    <small>{a.sla}</small>
                  </span>
                  <span>
                    <b>{a.escalation_level_1}</b>
                    <small>{a.escalation_level_2}</small>
                  </span>
                  <span>
                    <b>{a.sop_link}</b>
                    <small>{a.training_module_link}</small>
                  </span>
                </article>
              ))}
              {matrixData.length === 0 && <div className={styles.noRecords}>No records found.</div>}
            </div>
          )}
          {!busy && sopData && (
            <div className={styles.cards}>
              {sopData.map((s) => (
                <article key={s.id}>
                  <span>{s.code}</span>
                  <small>{s.department}</small>
                  <h3>{s.title}</h3>
                  <p>{s.summary}</p>
                  <div>
                    <b>v{s.version}</b>
                    <em>{s.status}</em>
                  </div>
                </article>
              ))}
              {sopData.length === 0 && <div className={styles.noRecords}>No records found.</div>}
            </div>
          )}
          {!busy && certificateData && (
            <div className={styles.certificates}>
              {certificateData.map((c) => (
                <article key={c.id}>
                  <span>CERTIFICATE OF COMPLETION</span>
                  <h2>{c.module}</h2>
                  <p>
                    Awarded to <b>{session.user.name}</b>
                  </p>
                  <div>
                    <small>
                      NUMBER
                      <br />
                      <b>{c.certificate_number}</b>
                    </small>
                    <small>
                      ISSUED
                      <br />
                      <b>{c.issued_at}</b>
                    </small>
                    <small>
                      VALID UNTIL
                      <br />
                      <b>{c.expires_at}</b>
                    </small>
                  </div>
                </article>
              ))}
              {certificateData.length === 0 && (
                <div className={styles.noRecords}>
                  No records found. Certificates are issued automatically when you pass a module assessment.
                </div>
              )}
            </div>
          )}
          {view === "admin" && (
            <div className={styles.adminTabs}>
              {(
                [
                  ["overview", "Overview"],
                  ["employees", "Employees"],
                  ["departments", "Departments"],
                  ["matrix", "Responsibility Matrix"],
                  ["sops", "SOP Approval"],
                  ["training", "Training & Quiz Builder"],
                  ["assignments", "Assignments"],
                  ["content", "Content Library"],
                  ["feedback", "Feedback Queue"],
                  ["audit", "Audit Log"],
                ] as [AdminSection, string][]
              ).map(([id, label]) => (
                <button
                  key={id}
                  className={adminSection === id ? styles.adminTabActive : ""}
                  onClick={() => setAdminSection(id)}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
          {!busy && adminData && adminSection === "overview" && (
            <div className={styles.stats}>
              <Stat
                label="EMPLOYEES"
                value={adminData.employees}
                note="Tenant scoped"
              />
              <Stat
                label="COMPLETION"
                value={`${adminData.training_completion}%`}
                note="All assigned learning"
              />
              <Stat
                label="CERTIFICATES"
                value={adminData.certificates}
                note="Issued records"
              />
              <Stat
                label="AVERAGE SCORE"
                value={`${adminData.average_quiz_score}%`}
                note="All quiz attempts"
              />
              <Stat
                label="ACTIVITIES"
                value={adminData.activities}
                note="Responsibility records"
              />
              <Stat
                label="CONTROLLED SOPS"
                value={adminData.sops}
                note="Versioned procedures"
              />
              <Stat
                label="OPEN FEEDBACK"
                value={adminData.open_feedback}
                note="Governance queue"
              />
            </div>
          )}
          {view === "admin" && adminSection !== "overview" && (
            <AdminConsole token={session.access_token} section={adminSection} />
          )}
        </div>
      </section>
      {toast && <div className={styles.toast}>✓ {toast}</div>}
      {activeVideo && (
        <div className={styles.modalOverlay} onMouseDown={(e) => { if (e.target === e.currentTarget) setActiveVideo(null); }}>
          <div className={styles.modalPanel} data-wide="true">
            <div className={styles.modalHeader}>
              <h3>{activeVideo.title}</h3>
              <button type="button" onClick={() => setActiveVideo(null)} aria-label="Close">✕</button>
            </div>
            <div className={styles.videoFrame}>
              {activeVideo.url && youtubeEmbedUrl(activeVideo.url) ? (
                <iframe
                  src={youtubeEmbedUrl(activeVideo.url)!}
                  title={activeVideo.title}
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                />
              ) : (
                <video src={activeVideo.url ?? undefined} controls />
              )}
            </div>
          </div>
        </div>
      )}
      {activeQuizModule && (
        <QuizPlayer
          moduleId={activeQuizModule}
          token={session.access_token}
          onClose={() => setActiveQuizModule(null)}
          onCompleted={handleQuizCompleted}
        />
      )}
    </main>
  );
}

function Stat({
  label,
  value,
  note,
}: {
  label: string;
  value: string | number;
  note: string;
}) {
  return (
    <article>
      <small>{label}</small>
      <h3>{value}</h3>
      <p>{note}</p>
    </article>
  );
}
