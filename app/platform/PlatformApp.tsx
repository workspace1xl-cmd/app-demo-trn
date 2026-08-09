"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams, usePathname, useRouter } from "next/navigation";
import styles from "./platform.module.css";
import AdminConsole from "./AdminConsole";
import OrgSignup from "./OrgSignup";
import QuizPlayer from "./QuizPlayer";
import ResponsibilityGraph, { type GraphActivity } from "./ResponsibilityGraph";
import AiAssistant from "./AiAssistant";

export const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

type Session = {
  access_token: string;
  user: { name: string; email: string; role: string; org_name?: string | null };
};
// SOP body/versioning/document management lives entirely in SOPGalaxy
// (https://app.sopgalaxy.com/) — OneWork doesn't own, track status on, or
// display a UI around SOP documents. There is deliberately no "sops" view:
// the sidebar item below opens SOPGalaxy directly in a new tab, and the
// only trace of SOPs OneWork keeps is a plain URL field (sop_link) on each
// Responsibility Matrix row.
type View =
  | "dashboard"
  | "search"
  | "training"
  | "matrix"
  | "graph"
  | "certificates"
  | "manager"
  | "admin";
const VIEW_IDS: View[] = ["dashboard", "search", "training", "matrix", "graph", "certificates", "manager", "admin"];
export type AdminSection =
  | "overview"
  | "employees"
  | "departments"
  | "candidates"
  | "matrix"
  | "training"
  | "assignments"
  | "content"
  | "feedback"
  | "audit"
  | "exec";
const ADMIN_SECTION_IDS: AdminSection[] = ["overview", "employees", "departments", "candidates", "matrix", "training", "assignments", "content", "feedback", "audit", "exec"];
// Ten flat tabs read as a wall of text — grouped here into 5 clusters
// (icons + labels, current-section highlighted, sized to the "5-8
// top-level items" guidance) purely as a navigation reorganisation.
// Every existing route/screen/AdminSection is untouched; this only
// changes how the tab bar presents them.
const ADMIN_GROUPS: { key: string; label: string; icon: string; sections: [AdminSection, string][] }[] = [
  { key: "insights", label: "Insights", icon: "◈", sections: [["overview", "Overview"], ["exec", "Exec View"]] },
  { key: "people", label: "People", icon: "◍", sections: [["employees", "Employees"], ["departments", "Departments"], ["candidates", "Candidates"]] },
  { key: "learning", label: "Learning", icon: "◎", sections: [["training", "Training & Quiz Builder"], ["assignments", "Assignments"], ["content", "Content Library"]] },
  { key: "ownership", label: "Ownership", icon: "⬡", sections: [["matrix", "Responsibility Matrix"]] },
  { key: "governance", label: "Governance", icon: "◉", sections: [["feedback", "Feedback Queue"], ["audit", "Audit Log"]] },
];
function adminGroupFor(section: AdminSection) {
  return ADMIN_GROUPS.find((g) => g.sections.some(([id]) => id === section)) || ADMIN_GROUPS[0];
}

type Activity = {
  id: string; name: string; department: string; responsible_role: string;
  current_person: string; backup_person: string; contact_details: string; sla: string;
  escalation_level_1: string; escalation_level_2: string; sop_link?: string; training_module_link?: string;
};
// Every component that actually applies is listed — a readiness score
// should never be a black box, per the design brief. A component the
// backend didn't consider applicable (e.g. cert currency for someone with
// no certificates yet) simply doesn't appear here, rather than showing as
// a misleading 0%.
type ReadinessComponent = { key: string; label: string; percent: number };
type Readiness = { score: number; components: ReadinessComponent[] };
type Milestone = { key: string; label: string; fraction: number; achieved: boolean };
type Gamification = { streak_days: number; milestones: Milestone[] };
type DashboardData = { user: { name: string }; training: { percent: number; completed: number; total: number }; certificates: number; points: number; open_actions: number; readiness: Readiness; gamification?: Gamification };
type SearchData = { query: string; confidence: number; answer: string; ai_used: boolean; activities: Activity[]; unresolved?: boolean };
type ModuleResource = { resource_type: string; title: string; kind: string; url: string | null };
type TrainingModule = { id: string; sequence: number; code: string; title: string; objective: string; duration_minutes: number; content_type: string; progress?: { status: string; percent?: number; progress_percent?: number; best_score?: number | null } | null; resources?: ModuleResource[] };

// Single date format for the whole app. Before this, Certificates showed
// raw ISO ("2026-08-07"), the admin console showed "07 Aug 2026", and the
// audit log showed "07/08/2026" — three formats across three screens.
function formatDate(value?: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}
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
type Notification = { id: string; kind: string; subject: string; payload: Record<string, unknown>; created_at: string; read_at: string | null };
type Certificate = { id: string; module: string; certificate_number: string; issued_at: string; expires_at: string };
type AdminData = { employees: number; training_completion: number; certificates: number; average_quiz_score: number; activities: number; open_feedback: number; readiness: Readiness };
type ManagerMember = { id: string; name: string; email: string; department: string | null; training_percent: number; completed: number; total: number; overdue_count: number; last_nudged_at: string | null };
// BUILD PROMPT v5 item A3: `department` (singular) replaced with
// `departments` (the set actually represented across the real
// manager_id-derived team, which can span more than one) and
// `has_reports` distinguishes "zero direct/rolled-up reports" — a real,
// valid org state while manager_id assignment is still rolling out — from
// a loading/error state.
type ManagerData = { departments: { id: string; name: string }[]; team_readiness: Readiness; members: ManagerMember[]; overdue_total: number; activities: Activity[]; has_reports: boolean };
type PlatformData = DashboardData | SearchData | TrainingModule[] | Activity[] | Certificate[] | AdminData | ManagerData | null;

export async function request<T = PlatformData>(
  path: string,
  token?: string,
  options: RequestInit = {},
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...options.headers,
      },
    });
  } catch {
    // fetch() itself throws (offline, DNS, CORS, connection refused) with a
    // raw browser string like "Failed to fetch" — every call in this app
    // funnels through here, so catching it once at the source keeps that
    // string from surfacing to users at all 18+ call sites individually.
    throw new Error("Could not reach the server. Check your connection and try again.");
  }
  if (!response.ok)
    throw new Error(
      (await response.json().catch(() => ({}))).detail || "Request failed",
    );
  return response.json() as Promise<T>;
}

export default function WorkingPlatform() {
  const router = useRouter();
  const pathname = usePathname();
  // `slug` is the catch-all segment array from app/platform/[[...slug]]/page.tsx:
  // /platform -> undefined, /platform/training -> ["training"],
  // /platform/admin/employees -> ["admin", "employees"]. The URL is the single
  // source of truth for which screen is showing — there is deliberately no
  // separate `view`/`adminSection` React state to keep in sync with it, which
  // is what let the two drift apart before (browser back/forward, a stale
  // render, or a missed call site could each show one screen while state
  // said another).
  const params = useParams<{ slug?: string[] }>();
  const slug = params?.slug;
  const rawView = slug?.[0];
  const view: View = (VIEW_IDS as string[]).includes(rawView ?? "") ? (rawView as View) : "dashboard";
  const rawSection = slug?.[1];
  const adminSection: AdminSection =
    view === "admin" && (ADMIN_SECTION_IDS as string[]).includes(rawSection ?? "") ? (rawSection as AdminSection) : "overview";

  function goToView(id: View) {
    router.push(`/platform/${id}`);
  }
  function goToAdminSection(id: AdminSection) {
    router.push(`/platform/admin/${id}`);
  }

  const [session, setSession] = useState<Session | null>(null);
  const [email, setEmail] = useState("employee@company.com");
  const [password, setPassword] = useState("Demo123!");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [data, setData] = useState<PlatformData>(null);
  const [query, setQuery] = useState("leave");
  const [toast, setToast] = useState("");
  const [showSignup, setShowSignup] = useState(false);
  const [activeQuizModule, setActiveQuizModule] = useState<string | null>(null);
  const [activeVideo, setActiveVideo] = useState<ModuleResource | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const headingRef = useRef<HTMLHeadingElement>(null);

  // Reset whatever the previous screen had loaded as soon as the
  // URL-derived view changes — via a nav click, the browser Back/Forward
  // buttons, or a direct deep link — before this render commits. Without
  // this, the previous view's data would render for one frame under the
  // new view's markup (wrong shape, sometimes a crash); doing it here
  // (React's documented pattern for "adjust state when a derived value
  // changes", not inside a useEffect) covers every navigation path,
  // including back/forward, in the same render rather than a tick later.
  const [resetForView, setResetForView] = useState(view);
  if (view !== resetForView) {
    setResetForView(view);
    setData(null);
    setError("");
  }

  useEffect(() => {
    const saved = sessionStorage.getItem("onework-session");
    if (!saved) return;
    const timer = window.setTimeout(() => setSession(JSON.parse(saved) as Session), 0);
    return () => window.clearTimeout(timer);
  }, []);

  // Once a session exists, /platform itself (no slug) is never the "real"
  // URL for anything — redirect it to the role-appropriate default so the
  // address bar always accurately names what's on screen. router.replace
  // (not push) so this redirect doesn't add a Back-button step.
  useEffect(() => {
    if (session && !slug) {
      router.replace(session.user.role === "admin" ? "/platform/admin" : "/platform/dashboard");
    }
  }, [session, slug, router]);

  // Accessibility: move focus to the new screen's heading on every route
  // change, matching how a full page navigation would behave. Without this,
  // a keyboard/screen-reader user's focus silently stays on the sidebar
  // button they just activated instead of moving into the new content.
  useEffect(() => {
    headingRef.current?.focus();
  }, [view, adminSection]);

  // The responsibility graph is fetched once and shared between the
  // Dashboard hero's mini fragment and the full /platform/graph view,
  // instead of each re-fetching /api/v1/activities on every switch between
  // them — same underlying data, same shape MatrixPanel/the RACI table
  // already use.
  const [graphActivities, setGraphActivities] = useState<Activity[] | null>(null);
  useEffect(() => {
    if (!session) return;
    request<Activity[]>("/api/v1/activities", session.access_token)
      .then(setGraphActivities)
      .catch(() => {});
  }, [session]);
  // Bell/notification centre: fetched independently of the view-switching
  // effect above (it isn't tied to any one screen) and refreshed on an
  // interval so a reminder that lands while someone's mid-session still
  // shows up without a manual reload.
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifOpen, setNotifOpen] = useState(false);
  useEffect(() => {
    if (!session) return;
    function load() {
      if (!session) return;
      request<{ notifications: Notification[]; unread_count: number }>("/api/v1/notifications", session.access_token)
        .then((res) => {
          setNotifications(res.notifications);
          setUnreadCount(res.unread_count);
        })
        .catch(() => {});
    }
    load();
    const interval = window.setInterval(load, 60000);
    return () => window.clearInterval(interval);
  }, [session]);
  async function markNotificationRead(id: string) {
    if (!session) return;
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read_at: new Date().toISOString() } : n)));
    setUnreadCount((c) => Math.max(0, c - 1));
    request(`/api/v1/notifications/${id}/read`, session.access_token, { method: "POST" }).catch(() => {});
  }
  async function markAllNotificationsRead() {
    if (!session || unreadCount === 0) return;
    setNotifications((prev) => prev.map((n) => ({ ...n, read_at: n.read_at || new Date().toISOString() })));
    setUnreadCount(0);
    request("/api/v1/notifications/read-all", session.access_token, { method: "POST" }).catch(() => {});
  }
  const [graphDeptFilter, setGraphDeptFilter] = useState("");
  const [graphSelection, setGraphSelection] = useState<{ label: string; kind: string; activities: GraphActivity[] } | null>(null);
  // BUILD PROMPT v5 item B1: inline RACI resolution — turns "here's a gap"
  // into "fix it here", not just a link to a separate admin page. Owner
  // names stay free text (activities.current_person has no FK to a real
  // employee row — a bigger schema change than this pass covers), so this
  // is a name suggestion via datalist, not a true relational picker; the
  // employee roster is still the source of the suggestions, not a
  // free-for-all guess.
  const [employeesLookup, setEmployeesLookup] = useState<{ id: string; full_name: string }[]>([]);
  const [editingActivityId, setEditingActivityId] = useState<string | null>(null);
  const [editingOwner, setEditingOwner] = useState({ current_person: "", backup_person: "" });
  const [ownerSaveBusy, setOwnerSaveBusy] = useState(false);
  useEffect(() => {
    if (!session || session.user.role !== "admin") return;
    request<{ id: string; full_name: string }[]>("/api/v1/admin/employees/lookup", session.access_token)
      .then(setEmployeesLookup)
      .catch(() => {});
  }, [session]);
  function startAssignOwner(a: GraphActivity) {
    setEditingActivityId(a.id);
    setEditingOwner({ current_person: a.current_person === "Organisation to confirm" ? "" : a.current_person, backup_person: a.backup_person });
  }
  async function saveAssignOwner(activityId: string) {
    if (!session) return;
    setOwnerSaveBusy(true);
    try {
      await request(`/api/v1/admin/activities/${activityId}`, session.access_token, {
        method: "PATCH",
        body: JSON.stringify({ current_person: editingOwner.current_person.trim() || "Organisation to confirm", backup_person: editingOwner.backup_person.trim() || "Department backup" }),
      });
      setGraphSelection((prev) =>
        prev
          ? { ...prev, activities: prev.activities.map((a) => (a.id === activityId ? { ...a, current_person: editingOwner.current_person.trim() || "Organisation to confirm", backup_person: editingOwner.backup_person.trim() || "Department backup" } : a)) }
          : prev,
      );
      setEditingActivityId(null);
      // The node's colour (owned vs gap) depends on ALL activities under
      // that role, not just the one just edited — refetch so the graph
      // and every readiness/coverage number derived from it stay honest.
      setReloadKey((k) => k + 1);
    } catch {
      // FormModal-style inline errors would need more plumbing than this
      // compact panel has room for; the busy state clearing is the signal
      // to retry.
    } finally {
      setOwnerSaveBusy(false);
    }
  }
  // BUILD PROMPT v5 item B2: nudge state lives here (not inside the
  // Manager Dashboard render block below) for the same rules-of-hooks
  // reason as the owner-assign state above — this component's early
  // `if (!session) return` happens later, so every hook must be declared
  // before it to stay unconditional across renders.
  const [nudgeBusyId, setNudgeBusyId] = useState<string | null>(null);
  const [nudgeResults, setNudgeResults] = useState<Record<string, { already_nudged: boolean; last_nudged_at?: string }>>({});
  // Date.now() can't be called directly in the render body (React's
  // purity rule) — a useState lazy initializer runs exactly once, at
  // mount, which is the documented escape hatch for capturing an
  // external impure value like this. Fine to be a little stale; this
  // only gates whether the Nudge button shows a disabled "already
  // nudged" state.
  const [nowMs] = useState(() => Date.now());
  async function nudgeMember(memberId: string) {
    if (!session) return;
    setNudgeBusyId(memberId);
    try {
      const result = await request<{ ok: boolean; already_nudged: boolean; nudged_count?: number; last_nudged_at?: string }>(
        `/api/v1/manager/nudge/${memberId}`,
        session.access_token,
        { method: "POST" },
      );
      setNudgeResults((prev) => ({ ...prev, [memberId]: { already_nudged: result.already_nudged, last_nudged_at: result.last_nudged_at || new Date().toISOString() } }));
    } catch (e) {
      setToast(e instanceof Error ? e.message : "Could not send the nudge.");
      setTimeout(() => setToast(""), 3500);
    } finally {
      setNudgeBusyId(null);
    }
  }
  // Declared here (before the early login/signup returns below) because
  // it's a Hook — rules-of-hooks requires every hook to run on every
  // render regardless of those conditional returns. Memoized so the array
  // reference stays stable across renders that don't change the
  // underlying data or filter: an inline .filter() call in the JSX
  // created a fresh array every render (including on every hover inside
  // the graph itself), which restarted the whole d3 force simulation each
  // time instead of only when the data or filter genuinely changed.
  const filteredGraphActivities = useMemo(() => {
    const raw = view === "graph" && Array.isArray(data) ? (data as Activity[]) : null;
    if (!raw) return null;
    return graphDeptFilter ? raw.filter((a) => a.department === graphDeptFilter) : raw;
  }, [view, data, graphDeptFilter]);

  useEffect(() => {
    if (!session) return;
    const paths: Record<View, string> = {
      dashboard: "/api/v1/dashboard",
      search: `/api/v1/search`,
      training: "/api/v1/training/modules",
      matrix: "/api/v1/activities",
      graph: "/api/v1/activities",
      certificates: "/api/v1/certificates",
      manager: "/api/v1/manager/dashboard",
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

  // `overrideEmail`/`overridePassword` let the one-click role buttons below
  // log straight in — "choose Manager, you're in" — instead of filling the
  // fields and making the person click Sign in as a second step.
  // `event` is optional for the same reason: those buttons aren't a form
  // submit, so there's nothing to preventDefault().
  async function login(event?: FormEvent, overrideEmail?: string, overridePassword?: string) {
    event?.preventDefault();
    const loginEmail = overrideEmail ?? email;
    const loginPassword = overridePassword ?? password;
    setBusy(true);
    setError("");
    try {
      const next = await request<Session>("/api/v1/auth/login", undefined, {
        method: "POST",
        body: JSON.stringify({
          email: loginEmail,
          password: loginPassword,
          organization: "example-organisation",
        }),
      });
      setSession(next);
      sessionStorage.setItem("onework-session", JSON.stringify(next));
      // Deep-linking: someone who followed a link to e.g. /platform/training
      // before signing in should land there after login, not always on the
      // role default — unless that link points into /platform/admin and
      // they're not actually an admin.
      const wantsAdmin = pathname?.startsWith("/platform/admin");
      const target =
        pathname && pathname !== "/platform" && !(wantsAdmin && next.user.role !== "admin")
          ? pathname
          : next.user.role === "admin"
            ? "/platform/admin"
            : "/platform/dashboard";
      router.push(target);
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
      const result = await request<SearchData>("/api/v1/search", session.access_token, {
        method: "POST",
        body: JSON.stringify({ query }),
      });
      setData(result);
      // The UI tells the employee an unresolved question "has been logged
      // for the knowledge team to review" — make that literally true by
      // actually creating the feedback-queue record, instead of only
      // computing an `unresolved` flag that nothing downstream used.
      if (result.unresolved) {
        request("/api/v1/feedback", session.access_token, {
          method: "POST",
          body: JSON.stringify({ query, reason: "No verified organisational match was found for this question." }),
        }).catch(() => {});
      }
    } catch (e) {
      setData(null); // don't leave the previous answer rendered under the new error
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
    if (result.passed) goToView("certificates");
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
            router.push("/platform/admin");
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
            training, and see exactly who owns what — as a live graph, not
            a static chart — with a transparent readiness score for every
            person, team and the org as a whole.
          </p>
          <div className={styles.liveStack}>
            <b>● Verified answers</b>
            <b>● Live ownership graph</b>
            <b>● Readiness score</b>
            <b>● Manager &amp; exec views</b>
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
          <small className={styles.demoAccountsLabel}>Or sign in instantly as:</small>
          <div className={styles.demoAccounts}>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setEmail("employee@company.com");
                setPassword("Demo123!");
                login(undefined, "employee@company.com", "Demo123!");
              }}
            >
              <span>◈</span>
              Employee
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setEmail("manager@company.com");
                setPassword("Manager123!");
                login(undefined, "manager@company.com", "Manager123!");
              }}
            >
              <span>◍</span>
              Manager
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setEmail("admin@company.com");
                setPassword("Admin123!");
                login(undefined, "admin@company.com", "Admin123!");
              }}
            >
              <span>◉</span>
              Admin
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
    ["graph", "⬡", "Responsibility graph"],
    ["certificates", "◇", "Certificates"],
    ...(session.user.role === "manager" || session.user.role === "admin"
      ? [["manager", "◫", "My team"] as [View, string, string]]
      : []),
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
  const fullGraphData = view === "graph" && Array.isArray(data) ? data as Activity[] : null;
  const certificateData = view === "certificates" && Array.isArray(data) ? data as Certificate[] : null;
  const adminData = view === "admin" ? data as AdminData | null : null;
  const managerData =
    view === "manager" && data && !Array.isArray(data) && "members" in data ? (data as ManagerData) : null;
  return (
    <main className={styles.shell}>
      <aside>
        <button type="button" className={styles.logo} onClick={() => goToView("dashboard")}>
          <span>1</span>
          <b>
            OneWork<small>LIVE PLATFORM</small>
          </b>
        </button>
        <nav>
          {nav.map(([id, icon, label]) => (
            <button
              className={view === id ? styles.active : ""}
              key={id}
              title={label}
              onClick={() => goToView(id)}
            >
              <span>{icon}</span>
              {label}
            </button>
          ))}
          {/* SOP documents live in SOPGalaxy, not OneWork — this opens it
              directly rather than routing to an in-app SOP screen. */}
          <button
            type="button"
            title="Open SOPGalaxy"
            onClick={() => window.open("https://app.sopgalaxy.com/", "_blank", "noopener,noreferrer")}
          >
            <span>▤</span>
            SOP repository ↗
          </button>
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
            // Logout only used to clear the session token — the search box
            // text, the last search result, and any error banner all
            // survived into the next login in the same tab, so a second
            // person signing in on a shared machine would briefly see the
            // previous person's query and answer. (Which view/tab was open
            // is now URL state, reset below by navigating to /platform.)
            setData(null);
            setError("");
            setQuery("leave");
            router.push("/platform");
          }}
        >
          Sign out
        </button>
      </aside>
      <section className={styles.work}>
        <header>
          <div>
            <small>{(session.user.org_name || "YOUR ORGANISATION").toUpperCase()} · LIVE DATA</small>
            <h1 ref={headingRef} tabIndex={-1}>{nav.find((x) => x[0] === view)?.[2]}</h1>
          </div>
          <div className={styles.notifWrap}>
            <button
              type="button"
              className={styles.notifBell}
              onClick={() => setNotifOpen((v) => !v)}
              aria-expanded={notifOpen}
              aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : "Notifications"}
            >
              🔔
              {unreadCount > 0 && <span className={styles.notifBadge}>{unreadCount > 9 ? "9+" : unreadCount}</span>}
            </button>
            {notifOpen && (
              <div className={styles.notifPanel} role="menu">
                <div className={styles.notifPanelHead}>
                  <b>Notifications</b>
                  {unreadCount > 0 && (
                    <button type="button" onClick={markAllNotificationsRead}>
                      Mark all read
                    </button>
                  )}
                </div>
                {notifications.length === 0 && <p className={styles.noRecords}>No records found. You&apos;re fully caught up.</p>}
                <ul>
                  {notifications.map((n) => (
                    <li key={n.id} className={n.read_at ? "" : styles.notifUnread}>
                      <button type="button" onClick={() => markNotificationRead(n.id)}>
                        <b>{n.subject}</b>
                        <small>
                          {n.kind === "learning_reminder" && typeof n.payload.module_title === "string" ? n.payload.module_title : ""}
                          {n.kind === "certificate_expiry" && typeof n.payload.expires_at === "string" ? `Expires ${formatDate(n.payload.expires_at)}` : ""}
                        </small>
                        <small>{formatDate(n.created_at)}</small>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </header>
        <div className={styles.content} key={`${view}-${view === "admin" ? adminSection : ""}`}>
          {/* Keyed on view (+ admin section) so React genuinely remounts
              this div — and its CSS fade-in animation replays — on every
              navigation. Deliberately NOT keyed on `busy`: a background
              refetch within the same view must NOT retrigger this, or
              the "keep old content visible while refetching" fix above
              would still visibly judder on every sync. */}
          {/* The old version hid every content block on `!busy`, which
              meant a background refetch (after a CSV import, an inline
              owner-assign, marking a notification read, anything that
              bumps reloadKey) unmounted the whole screen back to this
              loading block and remounted it a moment later — a real
              blink, not a CSS timing issue. Now: the full-page loading
              state only shows when there's genuinely nothing to display
              yet (first load); once data exists it stays on screen
              during any later refetch, with a small non-blocking
              "Syncing…" indicator near the header instead of a wipe. */}
          {busy && !data && (
            <div className={styles.loading}>Synchronising verified data…</div>
          )}
          {busy && data && <div className={styles.syncingBadge}>Syncing…</div>}
          {error && <div className={styles.error}>{error}</div>}
          {dashboardData && (
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
                {/* The signature element from the design pass: this hero
                    used to be a flat gradient card. It's now a live render
                    of the org's responsibility graph — genuinely computed
                    from the same RACI data as "Who does what", not a static
                    image. Honesty note: this shows the org-wide graph, not
                    a per-viewer-filtered one — every activity's
                    current_person is still the unassigned seed placeholder
                    ("Organisation to confirm"), so there's no real named
                    owner anywhere yet to filter down to. Once ownership
                    rows carry a real employee_id, this can genuinely narrow
                    to "your" connections. */}
                {graphActivities && graphActivities.length > 0 && (
                  <ResponsibilityGraph
                    activities={graphActivities}
                    mode="mini"
                    onOpenFull={() => goToView("graph")}
                  />
                )}
                <ReadinessRing
                  readiness={dashboardData.readiness}
                  caption="readiness score"
                  drillDown={{ training: () => goToView("training"), cert_currency: () => goToView("certificates") }}
                />
              </section>
              <div className={styles.stats}>
                <Stat
                  label="COMPLETED MODULES"
                  value={`${dashboardData.training.completed}/${dashboardData.training.total}`}
                  note="Sequential induction path"
                  tone="readiness"
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
                  tone={dashboardData.open_actions > 0 ? "risk" : undefined}
                />
              </div>
              {dashboardData.gamification && (
                <section className={styles.gamification}>
                  <div className={styles.streakBadge} data-active={dashboardData.gamification.streak_days > 1}>
                    <b>{dashboardData.gamification.streak_days}</b>
                    <small>day streak</small>
                  </div>
                  <ul className={styles.milestoneList}>
                    {dashboardData.gamification.milestones.map((m) => (
                      <li key={m.key} data-achieved={m.achieved}>
                        <span>{m.achieved ? "✓" : "○"}</span>
                        {m.label}
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </>
          )}
          {view === "search" && (
            <>
              <form className={styles.search} onSubmit={search}>
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Ask: How do I request leave?"
                />
                <button disabled={busy}>{busy ? "Searching…" : "Search verified knowledge →"}</button>
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
          {trainingData && (
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
          {matrixData && (
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
                    {/* sop_link is a plain URL into SOPGalaxy, not a record
                        OneWork owns — render it as a real link when it looks
                        like one, otherwise as inert text (legacy values from
                        before the SOP repository was removed). */}
                    {a.sop_link && /^https?:\/\//.test(a.sop_link) ? (
                      <a href={a.sop_link} target="_blank" rel="noopener noreferrer">
                        Open in SOPGalaxy ↗
                      </a>
                    ) : (
                      <b>{a.sop_link || "—"}</b>
                    )}
                    <small>{a.training_module_link}</small>
                  </span>
                </article>
              ))}
              {matrixData.length === 0 && <div className={styles.noRecords}>No records found.</div>}
            </div>
          )}
          {fullGraphData && (
            <>
              <div className={styles.graphToolbar}>
                <select value={graphDeptFilter} onChange={(e) => setGraphDeptFilter(e.target.value)}>
                  <option value="">All departments</option>
                  {Array.from(new Set(fullGraphData.map((a) => a.department))).sort().map((d) => (
                    <option key={d} value={d}>{d}</option>
                  ))}
                </select>
                <small>
                  <span className={styles.legendDot} data-tone="risk" /> No named owner
                  <span className={styles.legendDot} data-tone="readiness" /> Has a named owner
                  <span className={styles.legendDot} data-tone="ownership" /> Department
                </small>
              </div>
              <ResponsibilityGraph
                activities={filteredGraphActivities!}
                mode="full"
                onNodeSelect={setGraphSelection}
              />
              {graphSelection && (
                <div className={styles.graphSelectionPanel}>
                  <div>
                    <b>{graphSelection.label}</b>
                    <small>{graphSelection.kind === "department" ? "Department" : graphSelection.kind === "role" ? "Responsible role" : "Escalation contact"}</small>
                  </div>
                  <ul>
                    {graphSelection.activities.map((a) => {
                      const unassigned = a.current_person === "Organisation to confirm";
                      return (
                        <li key={a.id}>
                          <b>{a.name}</b>
                          <span>{a.contact_details} · SLA {a.sla}</span>
                          <em>{a.escalation_level_1} → {a.escalation_level_2}</em>
                          <span>
                            Owner: {unassigned ? <b className={styles.gapText}>Unassigned</b> : a.current_person}
                          </span>
                          {session.user.role === "admin" && editingActivityId !== a.id && (
                            <button type="button" className={styles.secondaryBtn} onClick={() => startAssignOwner(a)}>
                              {unassigned ? "Assign owner →" : "Reassign →"}
                            </button>
                          )}
                          {editingActivityId === a.id && (
                            <div className={styles.ownerAssignForm}>
                              <label>
                                Owner
                                <input
                                  list="onework-employee-names"
                                  value={editingOwner.current_person}
                                  onChange={(e) => setEditingOwner((prev) => ({ ...prev, current_person: e.target.value }))}
                                  placeholder="Full name"
                                />
                              </label>
                              <label>
                                Backup
                                <input
                                  list="onework-employee-names"
                                  value={editingOwner.backup_person}
                                  onChange={(e) => setEditingOwner((prev) => ({ ...prev, backup_person: e.target.value }))}
                                  placeholder="Full name"
                                />
                              </label>
                              <div>
                                <button type="button" disabled={ownerSaveBusy} onClick={() => saveAssignOwner(a.id)}>
                                  {ownerSaveBusy ? "Saving…" : "Save"}
                                </button>
                                <button type="button" className={styles.secondaryBtn} onClick={() => setEditingActivityId(null)} disabled={ownerSaveBusy}>
                                  Cancel
                                </button>
                              </div>
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                  <datalist id="onework-employee-names">
                    {employeesLookup.map((e) => (
                      <option key={e.id} value={e.full_name} />
                    ))}
                  </datalist>
                  {session.user.role === "admin" && (
                    <button type="button" onClick={() => goToAdminSection("matrix")}>
                      Manage in Responsibility Matrix →
                    </button>
                  )}
                  <button type="button" className={styles.secondaryBtn} onClick={() => setGraphSelection(null)}>
                    Close
                  </button>
                </div>
              )}
            </>
          )}
          {certificateData && (
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
                      <b>{formatDate(c.issued_at)}</b>
                    </small>
                    <small>
                      VALID UNTIL
                      <br />
                      <b>{formatDate(c.expires_at)}</b>
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
          {view === "manager" && managerData && (
            <>
              <section className={styles.orgReadiness}>
                <ReadinessRing readiness={managerData.team_readiness} caption="team readiness" />
                <div>
                  <b>Your team</b>
                  <p>
                    {managerData.members.length} {managerData.members.length === 1 ? "person" : "people"}
                    {managerData.departments.length > 0 && ` across ${managerData.departments.map((d) => d.name).join(", ")}`}
                    {" · "}
                    {managerData.overdue_total > 0
                      ? `${managerData.overdue_total} overdue training item${managerData.overdue_total === 1 ? "" : "s"}`
                      : "nothing overdue"}
                    . This is who actually reports to you (directly or through another
                    manager), not everyone in your department.
                  </p>
                </div>
              </section>
              {!managerData.has_reports && (
                <div className={styles.error}>
                  Nobody reports to you yet. An admin can set this in{" "}
                  <b>Admin → Employees → edit an employee → Reports To</b>.
                </div>
              )}
              <div className={styles.dataTable}>
                <table>
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Email ID</th>
                      <th>Department</th>
                      <th>Training</th>
                      <th>Overdue</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {managerData.members.map((m) => {
                      // BUILD PROMPT v5 item B2: "nudge from anywhere" —
                      // an overdue row is now something a manager can act
                      // on right here, not just observe. last_nudged_at
                      // (persisted server-side) plus this session's own
                      // nudgeResults keeps the "already nudged" state
                      // accurate even before the next full data refetch.
                      const nudged = nudgeResults[m.id];
                      const lastNudgedAt = nudged?.last_nudged_at || m.last_nudged_at;
                      const recentlyNudged = lastNudgedAt && nowMs - new Date(lastNudgedAt).getTime() < 24 * 60 * 60 * 1000;
                      return (
                        <tr key={m.id}>
                          <td>{m.name}</td>
                          <td>{m.email}</td>
                          <td>{m.department || "—"}</td>
                          <td>
                            {m.completed}/{m.total} ({m.training_percent}%)
                          </td>
                          <td>
                            {m.overdue_count > 0 ? (
                              <span className={styles.legendDot} data-tone="risk" />
                            ) : null}
                            {m.overdue_count}
                          </td>
                          <td>
                            {m.overdue_count > 0 &&
                              (recentlyNudged ? (
                                <small style={{ color: "#8b8f9e" }}>
                                  Nudged {formatDate(lastNudgedAt!)}
                                </small>
                              ) : (
                                <button
                                  type="button"
                                  className={styles.secondaryBtn}
                                  disabled={nudgeBusyId === m.id}
                                  onClick={() => nudgeMember(m.id)}
                                >
                                  {nudgeBusyId === m.id ? "Sending…" : "Nudge"}
                                </button>
                              ))}
                          </td>
                        </tr>
                      );
                    })}
                    {managerData.members.length === 0 && (
                      <tr>
                        <td colSpan={6} className={styles.noRecords}>
                          No records found.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              {managerData.activities.length > 0 && (
                <>
                  <h3>Your team&apos;s responsibilities</h3>
                  <ResponsibilityGraph
                    activities={managerData.activities}
                    mode="full"
                    onNodeSelect={setGraphSelection}
                  />
                </>
              )}
            </>
          )}
          {view === "admin" && (
            <>
              <div className={styles.adminGroupTabs}>
                {ADMIN_GROUPS.map((g) => {
                  const active = adminGroupFor(adminSection).key === g.key;
                  return (
                    <button
                      key={g.key}
                      type="button"
                      data-active={active}
                      onClick={() => { if (!active) goToAdminSection(g.sections[0][0]); }}
                    >
                      <span>{g.icon}</span>
                      {g.label}
                    </button>
                  );
                })}
              </div>
              {adminGroupFor(adminSection).sections.length > 1 && (
                <div className={styles.adminSubTabs}>
                  {adminGroupFor(adminSection).sections.map(([id, label]) => (
                    <button
                      key={id}
                      type="button"
                      data-active={adminSection === id}
                      onClick={() => goToAdminSection(id)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
          {adminData && adminSection === "overview" && (
            <section className={styles.orgReadiness}>
              <ReadinessRing
                readiness={adminData.readiness}
                caption="org readiness"
                drillDown={{ training: () => goToAdminSection("employees"), raci_coverage: () => goToAdminSection("matrix") }}
              />
              <div>
                <b>Organisation readiness</b>
                <p>
                  Blends training completion, certificate currency and how many
                  Responsibility Matrix rows actually have a named owner — not
                  just an assigned role. Hover or tap the score for the full
                  breakdown.
                </p>
              </div>
            </section>
          )}
          {adminData && adminSection === "overview" && (
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
                tone="readiness"
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
                label="OPEN FEEDBACK"
                value={adminData.open_feedback}
                note="Governance queue"
                tone={adminData.open_feedback > 0 ? "risk" : undefined}
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
      <AiAssistant token={session.access_token} unreadCount={unreadCount} notifications={notifications} />
    </main>
  );
}

function Stat({
  label,
  value,
  note,
  tone,
}: {
  label: string;
  value: string | number;
  note: string;
  tone?: "readiness" | "risk";
}) {
  return (
    <article data-tone={tone}>
      <small>{label}</small>
      <h3>{value}</h3>
      <p>{note}</p>
    </article>
  );
}

// "The one number a CEO or auditor asks for" — surfaced big, with a
// transparent breakdown on hover/click rather than a black box. Score
// >=70 reads as readiness-toned, otherwise risk-toned, so the ring color
// itself carries meaning instead of always defaulting to one color.
// BUILD PROMPT v5 item B4: the score used to just be a number with a
// breakdown tooltip — informative, but not actionable. Each component row
// that has a real destination (a screen listing the actual people/rows
// dragging that component down) is now a link there; a component with no
// such screen for this caller (e.g. cert currency at org level, which has
// no dedicated list view yet) stays plain text rather than a link to
// nowhere.
function ReadinessRing({
  readiness,
  caption,
  drillDown,
}: {
  readiness: Readiness | null | undefined;
  caption: string;
  drillDown?: Partial<Record<string, () => void>>;
}) {
  const [open, setOpen] = useState(false);
  // Defensive, not just decorative: a backend that hasn't picked up the
  // `readiness` field yet (a stale server mid-deploy, an older API
  // version) shouldn't crash the whole Dashboard — this was caught for
  // real during verification against a FastAPI instance still running
  // pre-readiness-score code.
  if (!readiness) return null;
  const tone = readiness.score >= 70 ? "readiness" : "risk";
  return (
    <div
      className={styles.readinessWrap}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        className={styles.score}
        data-tone={tone}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={`Readiness score ${readiness.score} out of 100 — ${caption}. Activate for a breakdown.`}
      >
        <b>{readiness.score}</b>
        <small>{caption}</small>
      </button>
      {open && (
        <div className={styles.readinessBreakdown} role="tooltip">
          <b>What&apos;s behind this score</b>
          <ul>
            {readiness.components.map((c) => {
              const goTo = drillDown?.[c.key];
              return (
                <li key={c.key}>
                  {goTo ? (
                    <button type="button" onClick={() => { goTo(); setOpen(false); }}>
                      <span>{c.label} →</span>
                      <b>{c.percent}%</b>
                    </button>
                  ) : (
                    <>
                      <span>{c.label}</span>
                      <b>{c.percent}%</b>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
          <p>Average of the components above that currently apply. Click a component with an arrow to see who&apos;s behind it.</p>
        </div>
      )}
    </div>
  );
}
