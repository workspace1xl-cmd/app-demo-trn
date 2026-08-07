"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import styles from "./platform.module.css";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

type Session = {
  access_token: string;
  user: { name: string; email: string; role: string };
};
type View =
  | "dashboard"
  | "search"
  | "training"
  | "matrix"
  | "sops"
  | "certificates"
  | "admin";

type Activity = {
  id: string; name: string; department: string; responsible_role: string;
  current_person: string; backup_person: string; contact_details: string; sla: string;
  escalation_level_1: string; escalation_level_2: string; sop_link?: string; training_module_link?: string;
};
type DashboardData = { user: { name: string }; training: { percent: number; completed: number; total: number }; certificates: number; points: number; open_actions: number };
type SearchData = { query: string; confidence: number; answer: string; ai_used: boolean; activities: Activity[] };
type TrainingModule = { id: string; sequence: number; code: string; title: string; objective: string; duration_minutes: number; content_type: string; progress?: { status: string; percent?: number; progress_percent?: number; best_score?: number | null } | null };
type Sop = { id: string; code: string; department: string; title: string; summary: string; version: string; status: string };
type Certificate = { id: string; module: string; certificate_number: string; issued_at: string; expires_at: string };
type AdminData = { employees: number; training_completion: number; certificates: number; average_quiz_score: number; activities: number; sops: number; open_feedback: number };
type PlatformData = DashboardData | SearchData | TrainingModule[] | Activity[] | Sop[] | Certificate[] | AdminData | null;

async function request<T = PlatformData>(
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
  }, [session, view]);

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

  async function takeQuiz(moduleId: string) {
    if (!session) return;
    setBusy(true);
    try {
      const quiz = await request<{ questions: { id: string }[] }>(
        `/api/v1/training/modules/${moduleId}/quiz`,
        session.access_token,
      );
      const result = await request<{ score: number; passed: boolean }>(
        `/api/v1/training/modules/${moduleId}/attempt`,
        session.access_token,
        {
          method: "POST",
          body: JSON.stringify({ answers: quiz.questions.map(() => 0) }),
        },
      );
      setToast(
        `Assessment submitted: ${result.score}% · ${result.passed ? "Passed" : "Retake required"}`,
      );
      setTimeout(() => setToast(""), 3500);
      setView("certificates");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Assessment failed");
    } finally {
      setBusy(false);
    }
  }

  if (!session)
    return (
      <main className={styles.loginShell}>
        <section className={styles.loginArt}>
          <span>ONEWORK · PRODUCTION MODE</span>
          <h1>
            Every employee knows
            <br />
            <em>what to do next.</em>
          </h1>
          <p>
            Real authentication, tenant-scoped data, tracked learning, verified
            knowledge and auditable ownership.
          </p>
          <div className={styles.liveStack}>
            <b>● API</b>
            <b>● PostgreSQL</b>
            <b>● Claude-ready search</b>
            <b>● n8n automation</b>
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
              <small>
                Start the API with <code>make up</code>, then try again.
              </small>
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
          <small>API: {API}</small>
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
  const dashboardData = view === "dashboard" ? data as DashboardData | null : null;
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
              onClick={() => setView(id)}
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
            <small>EXAMPLE ORGANISATION · LIVE DATA</small>
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
                  <span>
                    ✓ VERIFIED ORGANISATIONAL ANSWER ·{" "}
                    {Math.round(searchData.confidence * 100)}% CONFIDENCE
                  </span>
                  <h2>{searchData.answer}</h2>
                  <p>
                    {searchData.ai_used
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
                      onClick={() => takeQuiz(m.id)}
                    >
                      {m.progress?.status === "completed"
                        ? "Retake quiz"
                        : "Open assessment"}
                    </button>
                  </div>
                </article>
              ))}
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
            </div>
          )}
          {!busy && adminData && (
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
        </div>
      </section>
      {toast && <div className={styles.toast}>✓ {toast}</div>}
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
