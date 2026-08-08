import { createClient } from "npm:@supabase/supabase-js@2";

const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const CONTENT_BUCKET = "onework-content";

async function sha256(value: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function authenticate(req: Request) {
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const tokenHash = await sha256(token);
  const { data } = await supabase.from("sessions").select("id,org_id,user_id,expires_at,app_users(id,org_id,department_id,email,full_name,role,is_active)").eq("token_hash", tokenHash).gt("expires_at", new Date().toISOString()).maybeSingle();
  const user = Array.isArray(data?.app_users) ? data?.app_users[0] : data?.app_users;
  return user?.is_active && user.org_id === data?.org_id ? user : null;
}

// Returns { answer, escalate } or null. `escalate` used to be guessed by
// regex-matching Claude's free-text prose for phrases like "must be
// escalated" — fragile and non-deterministic in practice: identical or
// near-identical queries ("leave" vs "leave policy") got different verdicts
// purely because Claude's *wording* varied between calls, sometimes
// matching the regex, sometimes not, even when the retrieved context was
// the same relevant record either time. Asking Claude to emit one fixed,
// parsed token up front is a structured signal instead of a prose guess —
// still Claude's own judgment call, but no longer at the mercy of how it
// happens to phrase the sentence around it.
async function claudeAnswer(question: string, context: string): Promise<{ answer: string; escalate: boolean } | null> {
  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key || !context) return null;
  try {
    const prompt = `You answer employee questions using ONLY the verified organisational context below.
Respond in exactly this format, with nothing before it:
STATUS: ANSWER
or
STATUS: ESCALATE
(blank line)
<the answer, written normally for the employee>

Use STATUS: ESCALATE only if the context contains no record that is actually relevant to the question. If the context includes a specific matching record, use STATUS: ANSWER even when the question is a short topic phrase rather than a full sentence (e.g. "leave policy" should be answered the same as "how do I request leave" if a matching record exists) — do not escalate merely because of phrasing.

Question: ${question}
Context:
${context}`;
    const response = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" }, body: JSON.stringify({ model: Deno.env.get("ANTHROPIC_MODEL") || "claude-sonnet-4-5", max_tokens: 500, messages: [{ role: "user", content: prompt }] }) });
    if (!response.ok) return null;
    const payload = await response.json();
    const raw = payload.content?.filter((block: { type: string }) => block.type === "text").map((block: { text: string }) => block.text).join("\n") || null;
    if (!raw) return null;
    const match = raw.match(/^STATUS:\s*(ANSWER|ESCALATE)\s*\n+([\s\S]*)$/i);
    if (!match) return { answer: raw.trim(), escalate: false }; // model didn't follow the format; treat the raw text as a best-effort answer
    return { answer: match[2].trim(), escalate: match[1].toUpperCase() === "ESCALATE" };
  } catch { return null; }
}

async function audit(user: any, action: string, entityType: string, entityId?: string, details: Record<string, unknown> = {}) {
  await supabase.from("audit_events").insert({ org_id: user.org_id, actor_user_id: user.id, action, entity_type: entityType, entity_id: entityId || null, details });
}

function forbidUnlessAdmin(isAdmin: boolean) {
  return isAdmin ? null : json({ detail: "Administrator permission required." }, 403);
}

// BUILD PROMPT v4 item 6: captures today's org-wide readiness into
// readiness_snapshots so the exec view has a trend to draw — reuses
// whatever readiness was JUST computed by scoreFromComponents() rather
// than a second formula, and upserts on (org_id, captured_at) so calling
// this on every admin/analytics load (not just once a day) is harmless.
async function captureReadinessSnapshot(orgId: string, readiness: { score: number; components: ReadinessComponent[] }) {
  await supabase.from("readiness_snapshots").upsert(
    { org_id: orgId, score: readiness.score, components: readiness.components, captured_at: new Date().toISOString().slice(0, 10) },
    { onConflict: "org_id,captured_at" },
  );
}

function paginate(url: URL) {
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const pageSizeRaw = Number(url.searchParams.get("page_size")) || 20;
  const pageSize = [10, 20, 50, 100].includes(pageSizeRaw) ? pageSizeRaw : 20;
  return { page, pageSize, from: (page - 1) * pageSize, to: (page - 1) * pageSize + pageSize - 1 };
}

function fieldError(field: string, message: string) {
  return json({ detail: message, field }, 400);
}

// Readiness score (BUILD PROMPT v4 item 3) — a transparent blend, not a
// black box: every component that actually applies is listed in the
// response so the UI can show a real breakdown on hover/click instead of
// just a bare number. A component that isn't applicable yet (e.g. an
// employee with zero issued certificates) is left OUT of the average
// entirely rather than counted as 0% — someone who hasn't reached a
// certificate-bearing module yet isn't "at risk" on certification, they
// just don't have that signal yet.
type ReadinessComponent = { key: string; label: string; percent: number };
function scoreFromComponents(components: ReadinessComponent[]): { score: number; components: ReadinessComponent[] } {
  const applicable = components.filter((c) => c.percent !== null && !Number.isNaN(c.percent));
  const score = applicable.length ? Math.round(applicable.reduce((sum, c) => sum + c.percent, 0) / applicable.length) : 0;
  return { score, components };
}
// BUILD PROMPT v4 item 8 (lowest priority — built last, once every other
// item was solid). Both signals are derived from data that already exists
// (module completion count, enrollments.completed_at) rather than a new
// events/points table: milestones are thresholds against the real
// curriculum size, and the streak is the longest run of CONSECUTIVE
// CALENDAR DAYS on which at least one module was actually completed —
// not "days since last login" or anything that could be gamed by just
// opening the app. It's a historical fact, so it stays honest even if the
// most recent completion was a while ago (no "your streak is at risk"
// framing that would imply activity happening today).
const MILESTONE_THRESHOLDS: { key: string; label: string; fraction: number }[] = [
  { key: "getting_started", label: "Getting started", fraction: 0.25 },
  { key: "halfway", label: "Halfway there", fraction: 0.5 },
  { key: "almost_there", label: "Almost there", fraction: 0.75 },
  { key: "graduate", label: "Fully certified", fraction: 1 },
];
function longestStreak(completedAtDates: (string | null)[]): number {
  const days = Array.from(new Set(completedAtDates.filter((d): d is string => Boolean(d)).map((d) => d.slice(0, 10)))).sort();
  if (!days.length) return 0;
  let best = 1, current = 1;
  for (let i = 1; i < days.length; i++) {
    const prev = new Date(days[i - 1]), cur = new Date(days[i]);
    const diffDays = Math.round((cur.getTime() - prev.getTime()) / 86400000);
    current = diffDays === 1 ? current + 1 : 1;
    best = Math.max(best, current);
  }
  return best;
}
function buildGamification(completed: number, total: number, enrollment: { completed_at: string | null }[]) {
  const milestones = MILESTONE_THRESHOLDS.map((m) => ({ ...m, achieved: total > 0 && completed >= Math.ceil(m.fraction * total) }));
  return { streak_days: longestStreak(enrollment.map((e) => e.completed_at)), milestones };
}
function certificateCurrency(certificates: { expires_at: string | null }[]): number | null {
  if (!certificates.length) return null;
  const today = new Date().toISOString().slice(0, 10);
  const current = certificates.filter((c) => !c.expires_at || c.expires_at >= today).length;
  return Math.round((current / certificates.length) * 100);
}
function personalReadiness(trainingPercent: number, certificates: { expires_at: string | null }[]) {
  const currency = certificateCurrency(certificates);
  const components: ReadinessComponent[] = [{ key: "training", label: "Training completion", percent: trainingPercent }];
  if (currency !== null) components.push({ key: "cert_currency", label: "Certificates current (not expired)", percent: currency });
  return scoreFromComponents(components);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const rawUrl = new URL(req.url);
  const rawPath = rawUrl.pathname;
  const path = rawPath.includes("/onework-api/") ? rawPath.slice(rawPath.indexOf("/onework-api") + "/onework-api".length) : rawPath;
  try {
    if (path === "/health") return json({ status: "healthy", service: "onework-cloud-api", time: new Date().toISOString() });
    if (path === "/api/v1/auth/login" && req.method === "POST") {
      const { email, password, organization = "example-organisation" } = await req.json();
      const { data, error } = await supabase.rpc("authenticate_onework_user", { p_email: email, p_password: password, p_org_slug: organization });
      const user = data?.[0];
      if (error || !user) return json({ detail: "Incorrect email or password." }, 401);
      const token = `${crypto.randomUUID()}${crypto.randomUUID()}`.replaceAll("-", "");
      await supabase.from("sessions").insert({ org_id: user.org_id, user_id: user.id, token_hash: await sha256(token), expires_at: new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString() });
      await audit(user, "auth.login", "user", user.id);
      const { data: org } = await supabase.from("organizations").select("name").eq("id", user.org_id).maybeSingle();
      return json({ access_token: token, token_type: "bearer", user: { id: user.id, name: user.full_name, email: user.email, role: user.role, org_id: user.org_id, org_name: org?.name || null } });
    }

    if (path === "/api/v1/organizations" && req.method === "POST") {
      const body = await req.json();
      for (const field of ["organization_name", "organization_slug", "full_name", "email", "password"]) {
        if (!body[field]?.toString().trim()) return fieldError(field, `${field.replace(/_/g, " ")} is required.`);
      }
      if (body.password.length < 8) return fieldError("password", "Password must be at least 8 characters.");
      const { data, error } = await supabase.rpc("provision_organization", {
        p_org_name: body.organization_name, p_org_slug: body.organization_slug,
        p_admin_full_name: body.full_name, p_admin_email: body.email, p_admin_password: body.password,
      });
      const created = data?.[0];
      if (error || !created) {
        const message = error?.message || "";
        const field = message.includes("Organisation URL") ? "organization_slug" : message.includes("already exists") ? "organization_name" : message.includes("Password") ? "password" : message.includes("Email") ? "email" : undefined;
        return json({ detail: message || "Could not create the organisation.", field }, message ? 400 : 500);
      }
      const token = `${crypto.randomUUID()}${crypto.randomUUID()}`.replaceAll("-", "");
      await supabase.from("sessions").insert({ org_id: created.org_id, user_id: created.admin_user_id, token_hash: await sha256(token), expires_at: new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString() });
      await audit({ org_id: created.org_id, id: created.admin_user_id }, "organization.provision", "organization", created.org_id, { name: created.org_name });
      return json({ access_token: token, token_type: "bearer", user: { id: created.admin_user_id, name: created.admin_full_name, email: created.admin_email, role: "admin", org_id: created.org_id, org_name: created.org_name } }, 201);
    }

    const user = await authenticate(req);
    if (!user) return json({ detail: "Authentication required." }, 401);
    const isAdmin = ["admin", "content_admin"].includes(user.role);

    if (path === "/api/v1/me") {
      const { data: org } = await supabase.from("organizations").select("name").eq("id", user.org_id).maybeSingle();
      return json({ id: user.id, org_id: user.org_id, org_name: org?.name || null, name: user.full_name, email: user.email, role: user.role, department_id: user.department_id });
    }

    if (path === "/api/v1/dashboard") {
      const [{ data: enrollment }, { data: certificates }, { count: moduleCount }] = await Promise.all([
        supabase.from("enrollments").select("status,best_score,completed_at").eq("org_id", user.org_id).eq("user_id", user.id),
        supabase.from("certificates").select("id,expires_at").eq("org_id", user.org_id).eq("user_id", user.id),
        supabase.from("training_modules").select("id", { count: "exact", head: true }).eq("org_id", user.org_id).eq("status", "published"),
      ]);
      // `total` used to be enrollment.length, which is 0 for anyone with no
      // personal enrollment rows yet (e.g. admin accounts, which the seed
      // never auto-enrolls) — "0/0 completed modules" while My Learning,
      // fetched from training_modules directly, correctly lists all 22.
      // The curriculum size (published modules) is the real denominator.
      const total = moduleCount || 0, completed = enrollment?.filter((item) => item.status === "completed").length || 0;
      const trainingPercent = total ? Math.round(completed / total * 100) : 0;
      const readiness = personalReadiness(trainingPercent, certificates || []);
      const gamification = buildGamification(completed, total, enrollment || []);
      return json({ user: { name: user.full_name, role: user.role }, training: { completed, total, percent: trainingPercent }, certificates: certificates?.length || 0, points: enrollment?.reduce((sum, item) => sum + (item.best_score || 0) * 5, 0) || 0, open_actions: enrollment?.filter((item) => ["assigned", "in_progress"].includes(item.status)).length || 0, readiness, gamification });
    }

    // -------------------------------------------------------------------
    // Manager dashboard (BUILD PROMPT v4 item 4) — RBAC-scoped to "my
    // team", reusing department_id as the reporting-line signal since
    // that's the only one that already exists on app_users; there is no
    // real org-chart/reports-to model yet. "manager" was already a valid
    // role value accepted by the employee create/update routes and listed
    // in the admin Employees role dropdown before this route existed —
    // nothing previously treated it differently from "employee".
    // -------------------------------------------------------------------
    if (path === "/api/v1/manager/dashboard") {
      if (user.role !== "manager" && !isAdmin) return json({ detail: "Manager permission required." }, 403);
      // BUILD PROMPT v5 item A3: real reports-to hierarchy, not the
      // department_id proxy the first version of this route used.
      // Department is not a reporting line — multiple managers can share
      // a department, and people report across departments. This BFS
      // walks the real manager_id chain (including manager-of-manager
      // rollup, so a skip-level sees their whole subtree), depth-capped
      // at 10 as a defence against a data-entry cycle rather than relying
      // solely on the DB's manager_id != id constraint.
      const [{ data: allUsers }, { data: departments }, { count: moduleCount }] = await Promise.all([
        supabase.from("app_users").select("id,full_name,email,manager_id,department_id").eq("org_id", user.org_id).eq("is_active", true),
        supabase.from("departments").select("id,name").eq("org_id", user.org_id),
        supabase.from("training_modules").select("id", { count: "exact", head: true }).eq("org_id", user.org_id).eq("status", "published"),
      ]);
      const deptNameById = new Map((departments || []).map((d) => [d.id, d.name]));
      const directReportsOf = new Map<string, typeof allUsers>();
      for (const u of allUsers || []) {
        if (!u.manager_id) continue;
        const list = directReportsOf.get(u.manager_id) || [];
        list.push(u);
        directReportsOf.set(u.manager_id, list as any);
      }
      const subtree: typeof allUsers = [];
      const seen = new Set<string>([user.id]);
      let frontier = [user.id];
      for (let depth = 0; depth < 10 && frontier.length; depth++) {
        const next: string[] = [];
        for (const managerId of frontier) {
          for (const report of (directReportsOf.get(managerId) || []) as any[]) {
            if (seen.has(report.id)) continue;
            seen.add(report.id);
            subtree.push(report);
            next.push(report.id);
          }
        }
        frontier = next;
      }
      const teamIds = subtree.map((u: any) => u.id);
      const teamDeptIds = Array.from(new Set(subtree.map((u: any) => u.department_id).filter(Boolean)));
      const teamDepartments = teamDeptIds.map((id) => ({ id, name: deptNameById.get(id) || "Unknown" })).sort((a, b) => a.name.localeCompare(b.name));
      const teamDeptNames = teamDepartments.map((d) => d.name);
      const [{ data: enrollments }, { data: activities }] = await Promise.all([
        teamIds.length ? supabase.from("enrollments").select("user_id,status,due_date").eq("org_id", user.org_id).in("user_id", teamIds) : Promise.resolve({ data: [] as { user_id: string; status: string; due_date: string | null }[] }),
        teamDeptNames.length ? supabase.from("activities").select("id,name,department,responsible_role,current_person,backup_person,contact_details,sla,escalation_level_1,escalation_level_2,sop_link,training_module_link,status").eq("org_id", user.org_id).in("department", teamDeptNames) : Promise.resolve({ data: [] as unknown[] }),
      ]);
      const today = new Date().toISOString().slice(0, 10);
      const total = moduleCount || 0;
      const members = subtree.map((member: any) => {
        const rows = (enrollments || []).filter((e) => e.user_id === member.id);
        const completed = rows.filter((e) => e.status === "completed").length;
        const overdue = rows.filter((e) => e.due_date && e.due_date < today && e.status !== "completed").length;
        const percent = total ? Math.round((completed / total) * 100) : 0;
        return { id: member.id, name: member.full_name, email: member.email, department: deptNameById.get(member.department_id) || null, training_percent: percent, completed, total, overdue_count: overdue };
      });
      const teamTotal = members.reduce((sum, m) => sum + m.total, 0), teamCompleted = members.reduce((sum, m) => sum + m.completed, 0);
      const teamReadiness = scoreFromComponents([{ key: "training", label: "Team training completion", percent: teamTotal ? Math.round((teamCompleted / teamTotal) * 100) : 0 }]);
      return json({
        departments: teamDepartments,
        team_readiness: teamReadiness,
        members,
        overdue_total: members.reduce((sum, m) => sum + m.overdue_count, 0),
        activities: activities || [],
        // Honesty signal for the UI: distinguishes "you have zero direct
        // or rolled-up reports" (a real, valid org state — nudge to ask
        // an admin to set manager_id) from "loading"/"error".
        has_reports: members.length > 0,
      });
    }

    // notification_outbox is populated nightly by public.enqueue_onework_reminders()
    // (pg_cron, added for the n8n email pipeline) — read_at is purely in-app
    // "seen in the bell dropdown" state, kept separate from status/sent_at
    // which track actual email delivery.
    if (path === "/api/v1/notifications" && req.method === "GET") {
      const { data: rows } = await supabase.from("notification_outbox").select("id,kind,subject,payload,created_at,read_at").eq("org_id", user.org_id).eq("user_id", user.id).order("created_at", { ascending: false }).limit(30);
      const notifications = rows || [];
      return json({ notifications, unread_count: notifications.filter((n) => !n.read_at).length });
    }

    const notifReadMatch = path.match(/^\/api\/v1\/notifications\/([^/]+)\/read$/);
    if (notifReadMatch && req.method === "POST") {
      const { data: notif } = await supabase.from("notification_outbox").select("id").eq("id", notifReadMatch[1]).eq("org_id", user.org_id).eq("user_id", user.id).maybeSingle();
      if (!notif) return json({ detail: "Notification not found." }, 404);
      await supabase.from("notification_outbox").update({ read_at: new Date().toISOString() }).eq("id", notif.id);
      return json({ ok: true });
    }

    if (path === "/api/v1/notifications/read-all" && req.method === "POST") {
      const { data: rows } = await supabase.from("notification_outbox").update({ read_at: new Date().toISOString() }).eq("org_id", user.org_id).eq("user_id", user.id).is("read_at", null).select("id");
      return json({ ok: true, marked: (rows || []).length });
    }

    if (path === "/api/v1/activities" && req.method === "GET") {
      const query = rawUrl.searchParams.get("q");
      let request = supabase.from("activities").select("*").eq("org_id", user.org_id).order("department").order("name");
      if (query) request = request.ilike("name", `%${query.replace(/[%_,]/g, " ")}%`);
      const { data, error } = await request; if (error) throw error; return json(data);
    }

    if (path === "/api/v1/training/modules" && req.method === "GET") {
      const [{ data: modules, error }, { data: enrollment }, { data: resources }] = await Promise.all([
        supabase.from("training_modules").select("*").eq("org_id", user.org_id).order("sequence"),
        supabase.from("enrollments").select("module_id,status,progress_percent,best_score,completed_at,due_date").eq("org_id", user.org_id).eq("user_id", user.id),
        supabase.from("module_resources").select("module_id,resource_type,sequence,content_assets(title,kind,external_url,storage_path,status)").eq("org_id", user.org_id).order("sequence"),
      ]);
      if (error) throw error;
      const progress = new Map(enrollment?.map((item) => [item.module_id, item]));
      const resourcesByModule = new Map<string, { module_id: string; resource_type: string; title: string; kind: string; url: string | null; storage_path: string | null }[]>();
      for (const r of resources || []) {
        const asset: any = Array.isArray((r as any).content_assets) ? (r as any).content_assets[0] : (r as any).content_assets;
        if (!asset || asset.status !== "ready") continue;
        const moduleId = (r as any).module_id;
        const list = resourcesByModule.get(moduleId) || [];
        list.push({ module_id: moduleId, resource_type: (r as any).resource_type, title: asset.title, kind: asset.kind, url: asset.external_url || null, storage_path: asset.storage_path || null });
        resourcesByModule.set(moduleId, list);
      }
      // Sign download URLs for uploaded files (external links already have a usable URL).
      const allResources = Array.from(resourcesByModule.values()).flat();
      await Promise.all(allResources.filter((r) => r.storage_path && !r.url).map(async (r) => {
        const { data: signed } = await supabase.storage.from(CONTENT_BUCKET).createSignedUrl(r.storage_path!, 3600);
        r.url = signed?.signedUrl || null;
      }));
      return json(modules?.map((module) => ({
        ...module,
        progress: progress.get(module.id) || null,
        resources: (resourcesByModule.get(module.id) || []).map((r) => ({ resource_type: r.resource_type, title: r.title, kind: r.kind, url: r.url })),
      })) || []);
    }

    const quizMatch = path.match(/^\/api\/v1\/training\/modules\/([^/]+)\/quiz$/);
    if (quizMatch && req.method === "GET") {
      const { data: module } = await supabase.from("training_modules").select("id,title,passing_score").eq("id", quizMatch[1]).eq("org_id", user.org_id).maybeSingle();
      if (!module) return json({ detail: "Module not found." }, 404);
      const { data: questions } = await supabase.from("quiz_questions").select("id,prompt,options").eq("org_id", user.org_id).eq("module_id", module.id).order("created_at");
      return json({ module_id: module.id, title: module.title, passing_score: module.passing_score, questions: questions || [] });
    }

    const attemptMatch = path.match(/^\/api\/v1\/training\/modules\/([^/]+)\/attempt$/);
    if (attemptMatch && req.method === "POST") {
      const { answers } = await req.json();
      const [{ data: module }, { data: questions }] = await Promise.all([supabase.from("training_modules").select("*").eq("id", attemptMatch[1]).eq("org_id", user.org_id).maybeSingle(), supabase.from("quiz_questions").select("correct_index,explanation").eq("org_id", user.org_id).eq("module_id", attemptMatch[1]).order("created_at")]);
      if (!module) return json({ detail: "Module not found." }, 404);
      if (!questions?.length || answers?.length !== questions.length) return json({ detail: "Submit one answer for every question." }, 400);
      const correct = questions.filter((question, index) => question.correct_index === answers[index]).length, score = Math.round(correct / questions.length * 100), passed = score >= module.passing_score;
      await supabase.from("quiz_attempts").insert({ org_id: user.org_id, user_id: user.id, module_id: module.id, score, passed, answers });
      const { data: enrollment } = await supabase.from("enrollments").select("id,best_score").eq("org_id", user.org_id).eq("user_id", user.id).eq("module_id", module.id).maybeSingle();
      if (enrollment) await supabase.from("enrollments").update({ best_score: Math.max(enrollment.best_score || 0, score), ...(passed ? { status: "completed", progress_percent: 100, completed_at: new Date().toISOString() } : {}) }).eq("id", enrollment.id);
      if (passed) {
        // A refresher_months=12 certificate must expire in exactly one
        // calendar year, not 12*30=360 days (5 days short of a year).
        const expiryDate = new Date();
        expiryDate.setUTCMonth(expiryDate.getUTCMonth() + module.refresher_months);
        await supabase.from("certificates").upsert({ org_id: user.org_id, user_id: user.id, module_id: module.id, certificate_number: `OW-${module.code}-${Date.now()}`, issued_at: new Date().toISOString().slice(0,10), expires_at: expiryDate.toISOString().slice(0,10) }, { onConflict: "org_id,user_id,module_id", ignoreDuplicates: true });
        const { data: next } = await supabase.from("training_modules").select("id").eq("org_id", user.org_id).eq("sequence", module.sequence + 1).maybeSingle();
        if (next) await supabase.from("enrollments").update({ status: "assigned" }).eq("org_id", user.org_id).eq("user_id", user.id).eq("module_id", next.id).eq("status", "locked");
      }
      await audit(user, "quiz.submit", "training_module", module.id, { score, passed }); return json({ score, passed, passing_score: module.passing_score, correct, total: questions.length, explanations: questions.map((q) => q.explanation) });
    }

    if (path === "/api/v1/certificates") {
      const { data, error } = await supabase.from("certificates").select("id,certificate_number,issued_at,expires_at,training_modules(title)").eq("org_id", user.org_id).eq("user_id", user.id).order("issued_at", { ascending: false }); if (error) throw error;
      return json(data?.map((item: any) => ({ id: item.id, certificate_number: item.certificate_number, issued_at: item.issued_at, expires_at: item.expires_at, module: item.training_modules?.title })) || []);
    }

    if (path === "/api/v1/mistakes" && req.method === "GET") {
      const query = rawUrl.searchParams.get("q");
      let request = supabase.from("mistake_register").select("id,code,title,description,correct_practice,category,severity,department,module_id").eq("org_id", user.org_id).eq("status", "active").order("code");
      if (query) request = request.or(`title.ilike.%${query}%,description.ilike.%${query}%,category.ilike.%${query}%`);
      const { data, error } = await request; if (error) throw error; return json(data);
    }

    if (path === "/api/v1/search" && req.method === "POST") {
      const { query } = await req.json(); const safe = String(query || "").replace(/[%_,]/g, " ").trim();
      if (safe.length < 2) return json({ detail: "Question is too short." }, 400);
      const stopWords = new Set(["a", "an", "and", "can", "do", "does", "for", "how", "i", "is", "my", "of", "process", "request", "the", "to", "what", "where", "who"]);
      const terms = safe.toLowerCase().split(/\s+/).map((term) => term.replace(/[^a-z0-9-]/g, "")).filter((term) => term.length > 2 && !stopWords.has(term)).slice(0, 6);
      const searchTerms = terms.length ? terms : [safe.toLowerCase()];
      const activityFilters = searchTerms.flatMap((term) => [`name.ilike.%${term}%`, `department.ilike.%${term}%`, `responsible_role.ilike.%${term}%`]).join(",");
      const moduleFilters = searchTerms.flatMap((term) => [`title.ilike.%${term}%`, `objective.ilike.%${term}%`, `code.ilike.%${term}%`]).join(",");
      const mistakeFilters = searchTerms.flatMap((term) => [`title.ilike.%${term}%`, `description.ilike.%${term}%`, `category.ilike.%${term}%`]).join(",");
      // SOP documents live in SOPGalaxy, not a table this API queries — the
      // only SOP-related signal in context is each activity's own sop_link
      // (a plain URL), included inline below when present, not a separate
      // sop_documents lookup.
      const [{ data: activities }, { data: modules }, { data: mistakes }] = await Promise.all([
        supabase.from("activities").select("*").eq("org_id", user.org_id).or(activityFilters).limit(5),
        supabase.from("training_modules").select("*").eq("org_id", user.org_id).or(moduleFilters).limit(5),
        supabase.from("mistake_register").select("code,title,description,correct_practice,severity").eq("org_id", user.org_id).eq("status", "active").or(mistakeFilters).limit(3),
      ]);
      const context = [...(activities || []).map((a) => `Activity: ${a.name}; owner ${a.responsible_role}; contact ${a.contact_details}; SLA ${a.sla}; escalation ${a.escalation_level_1} then ${a.escalation_level_2}${a.sop_link ? `; SOP: ${a.sop_link}` : ""}`), ...(modules || []).map((m) => `Training: ${m.code} ${m.title}; ${m.objective}`), ...(mistakes || []).map((mk) => `Common mistake ${mk.code}: ${mk.title}. ${mk.description} Correct practice: ${mk.correct_practice}`)].join("\n");
      const claude = await claudeAnswer(safe, context); const count = (activities?.length || 0) + (modules?.length || 0) + (mistakes?.length || 0);
      // `escalate` now comes from a fixed STATUS: token Claude is asked to
      // emit first, parsed exactly — not guessed by regex-matching whatever
      // prose Claude happened to write. The regex approach was genuinely
      // non-deterministic in production: "leave" and "leave policy" hit the
      // same matched activity but got different verdicts purely because
      // Claude's *phrasing* of the same underlying answer varied between
      // calls, sometimes tripping the regex and sometimes not.
      const unresolved = count === 0 || (claude?.escalate ?? false);
      await audit(user, "knowledge.search", "search", undefined, { query: safe, result_count: count, ai_used: Boolean(claude), unresolved });
      return json({ query: safe, answer: claude?.answer || (count ? `Verified results found for ${safe}. Use the official owner, channel and SLA below.` : "No confirmed answer was found. Report this question for owner review."), confidence: unresolved ? 0 : activities?.length ? .93 : .72, ai_used: Boolean(claude), activities: activities || [], modules: modules || [], mistakes: mistakes || [], unresolved });
    }

    if (path === "/api/v1/feedback" && req.method === "POST") {
      const body = await req.json(); const { data, error } = await supabase.from("knowledge_feedback").insert({ org_id: user.org_id, user_id: user.id, query: body.query, reason: body.reason, routed_to: "Knowledge governance queue" }).select().single(); if (error) throw error; await audit(user, "feedback.create", "knowledge_feedback", data.id); return json({ id: data.id, status: data.status, routed_to: data.routed_to }, 201);
    }

    // -------------------------------------------------------------------
    // Administrator: dashboard analytics
    // -------------------------------------------------------------------
    if (path === "/api/v1/admin/analytics") {
      const deny = forbidUnlessAdmin(isAdmin); if (deny) return deny;
      // Counts every org member (matches the Employees tab's total, which
      // also lists admins), not just role=employee — the two used to
      // disagree because this query filtered by role and that one doesn't.
      const [employees, enrollment, certificates, attempts, feedback, activities] = await Promise.all([supabase.from("app_users").select("id", { count: "exact", head: true }).eq("org_id", user.org_id), supabase.from("enrollments").select("status").eq("org_id", user.org_id), supabase.from("certificates").select("id,expires_at").eq("org_id", user.org_id), supabase.from("quiz_attempts").select("score").eq("org_id", user.org_id), supabase.from("knowledge_feedback").select("id", { count: "exact", head: true }).eq("org_id", user.org_id).eq("status", "open"), supabase.from("activities").select("id,current_person").eq("org_id", user.org_id)]);
      const total = enrollment.data?.length || 0, complete = enrollment.data?.filter((item) => item.status === "completed").length || 0, scores = attempts.data?.map((item) => item.score) || [];
      const trainingPercent = total ? Math.round(complete / total * 100) : 0;
      // Org-wide readiness adds a third component the employee-facing score
      // can't have: RACI ownership coverage — what fraction of
      // responsibility rows actually have a named owner, not just an
      // assigned role. Same "Organisation to confirm" placeholder check as
      // the responsibility graph's node coloring, so the two stay
      // consistent with each other.
      const raciRows = activities.data || [];
      const raciCoverage = raciRows.length ? Math.round((raciRows.filter((a) => (a.current_person || "").trim().toLowerCase() !== "organisation to confirm").length / raciRows.length) * 100) : null;
      const readinessComponents: ReadinessComponent[] = [{ key: "training", label: "Org-wide training completion", percent: trainingPercent }];
      const certCurrency = certificateCurrency(certificates.data || []);
      if (certCurrency !== null) readinessComponents.push({ key: "cert_currency", label: "Certificates current (not expired)", percent: certCurrency });
      if (raciCoverage !== null) readinessComponents.push({ key: "raci_coverage", label: "Responsibilities with a named owner", percent: raciCoverage });
      const readiness = scoreFromComponents(readinessComponents);
      await captureReadinessSnapshot(user.org_id, readiness);
      return json({ employees: employees.count || 0, training_completion: trainingPercent, certificates: certificates.data?.length || 0, average_quiz_score: scores.length ? Math.round(scores.reduce((a,b)=>a+b,0)/scores.length*10)/10 : 0, open_feedback: feedback.count || 0, activities: activities.data?.length || 0, readiness });
    }

    // -------------------------------------------------------------------
    // Administrator: exec/org health view (BUILD PROMPT v4 item 6)
    // -------------------------------------------------------------------
    if (path === "/api/v1/admin/exec" && req.method === "GET") {
      const deny = forbidUnlessAdmin(isAdmin); if (deny) return deny;
      const [{ data: snapshotsDesc }, { data: departments }, { data: deptUsers }, { data: deptEnrollments }, { data: activities }] = await Promise.all([
        // Most recent 30 days: order DESCENDING before the limit (an
        // ascending order + limit, the original version of this query,
        // took the OLDEST 30 rows instead — invisible while there were
        // only 1-2 snapshot rows total, but very visible once real
        // history existed: the trend chart silently stopped in June
        // instead of showing up to today). Reversed back to ascending
        // afterwards since that's the order a left-to-right chart needs.
        supabase.from("readiness_snapshots").select("score,captured_at").eq("org_id", user.org_id).order("captured_at", { ascending: false }).limit(30),
        supabase.from("departments").select("id,name").eq("org_id", user.org_id).order("name"),
        supabase.from("app_users").select("id,department_id").eq("org_id", user.org_id),
        supabase.from("enrollments").select("user_id,status").eq("org_id", user.org_id),
        supabase.from("activities").select("department,current_person").eq("org_id", user.org_id),
      ]);
      const snapshots = (snapshotsDesc || []).slice().reverse();
      const usersByDept = new Map<string, string[]>();
      for (const u of deptUsers || []) { if (!u.department_id) continue; const list = usersByDept.get(u.department_id) || []; list.push(u.id); usersByDept.set(u.department_id, list); }
      const enrollmentsByUser = new Map<string, { status: string }[]>();
      for (const e of deptEnrollments || []) { const list = enrollmentsByUser.get(e.user_id) || []; list.push({ status: e.status }); enrollmentsByUser.set(e.user_id, list); }
      // Ownership coverage per department name — same placeholder check as
      // the responsibility graph and org-wide readiness, just grouped by
      // department instead of computed once for the whole org, so this view
      // can actually point at WHICH departments have the gap.
      const activitiesByDept = new Map<string, { current_person: string }[]>();
      for (const a of activities || []) { const list = activitiesByDept.get(a.department) || []; list.push({ current_person: a.current_person }); activitiesByDept.set(a.department, list); }
      const departmentComparison = (departments || []).map((dept) => {
        const userIds = usersByDept.get(dept.id) || [];
        const rows = userIds.flatMap((id) => enrollmentsByUser.get(id) || []);
        const total = rows.length, complete = rows.filter((r) => r.status === "completed").length;
        const deptActivities = activitiesByDept.get(dept.name) || [];
        const owned = deptActivities.filter((a) => (a.current_person || "").trim().toLowerCase() !== "organisation to confirm").length;
        return {
          id: dept.id, name: dept.name, employee_count: userIds.length,
          readiness_score: total ? Math.round((complete / total) * 100) : null,
          ownership_coverage: deptActivities.length ? Math.round((owned / deptActivities.length) * 100) : null,
          activity_count: deptActivities.length,
        };
      });
      return json({ trend: snapshots || [], departments: departmentComparison });
    }

    if (path === "/api/v1/admin/audit" && req.method === "GET") {
      const deny = forbidUnlessAdmin(isAdmin); if (deny) return deny;
      const { page, pageSize, from, to } = paginate(rawUrl);
      const { data, error, count } = await supabase.from("audit_events").select("id,action,entity_type,entity_id,details,created_at,app_users(full_name)", { count: "exact" }).eq("org_id", user.org_id).order("created_at", { ascending: false }).range(from, to);
      if (error) throw error;
      return json({ items: (data || []).map((item: any) => ({ id: item.id, action: item.action, entity_type: item.entity_type, entity_id: item.entity_id, details: item.details, created_at: item.created_at, actor: item.app_users?.full_name || "System" })), page, page_size: pageSize, total: count || 0 });
    }

    // -------------------------------------------------------------------
    // Administrator: departments
    // -------------------------------------------------------------------
    if (path === "/api/v1/admin/departments" && req.method === "GET") {
      const deny = forbidUnlessAdmin(isAdmin); if (deny) return deny;
      const [{ data, error }, { data: deptUsers }, { data: deptEnrollments }] = await Promise.all([
        supabase.from("departments").select("id,name,code,created_at").eq("org_id", user.org_id).order("name"),
        supabase.from("app_users").select("id,department_id").eq("org_id", user.org_id),
        supabase.from("enrollments").select("user_id,status").eq("org_id", user.org_id),
      ]);
      if (error) throw error;
      // Department-level readiness (training completion only, for now — see
      // BUILD PROMPT v4 item 3): computed client-side from users +
      // enrollments rather than a SQL aggregate, to avoid adding an RPC for
      // what's still a small dataset. Revisit as a real aggregate query if
      // org sizes grow enough for this to matter.
      const usersByDept = new Map<string, string[]>();
      for (const u of deptUsers || []) {
        if (!u.department_id) continue;
        const list = usersByDept.get(u.department_id) || [];
        list.push(u.id);
        usersByDept.set(u.department_id, list);
      }
      const enrollmentsByUser = new Map<string, { status: string }[]>();
      for (const e of deptEnrollments || []) {
        const list = enrollmentsByUser.get(e.user_id) || [];
        list.push({ status: e.status });
        enrollmentsByUser.set(e.user_id, list);
      }
      const withReadiness = (data || []).map((dept) => {
        const userIds = usersByDept.get(dept.id) || [];
        const rows = userIds.flatMap((id) => enrollmentsByUser.get(id) || []);
        const total = rows.length, complete = rows.filter((r) => r.status === "completed").length;
        return { ...dept, employee_count: userIds.length, readiness_score: total ? Math.round((complete / total) * 100) : null };
      });
      return json(withReadiness);
    }
    if (path === "/api/v1/admin/departments" && req.method === "POST") {
      const deny = forbidUnlessAdmin(isAdmin); if (deny) return deny;
      const body = await req.json();
      if (!body.name?.trim()) return fieldError("name", "Department Name is required.");
      if (!body.code?.trim()) return fieldError("code", "Department Code is required.");
      const { data, error } = await supabase.from("departments").insert({ org_id: user.org_id, name: body.name.trim(), code: body.code.trim().toUpperCase() }).select().single();
      if (error) return json({ detail: error.message.includes("duplicate") ? "A department with this name or code already exists." : "Could not create the department." }, 409);
      await audit(user, "department.create", "department", data.id); return json(data, 201);
    }
    const departmentMatch = path.match(/^\/api\/v1\/admin\/departments\/([^/]+)$/);
    if (departmentMatch && req.method === "PATCH") {
      const deny = forbidUnlessAdmin(isAdmin); if (deny) return deny;
      const body = await req.json(); const patch: Record<string, unknown> = {};
      if (body.name !== undefined) patch.name = String(body.name).trim();
      if (body.code !== undefined) patch.code = String(body.code).trim().toUpperCase();
      const { data, error } = await supabase.from("departments").update(patch).eq("id", departmentMatch[1]).eq("org_id", user.org_id).select().maybeSingle();
      if (error) return json({ detail: "A department with this name or code already exists." }, 409);
      if (!data) return json({ detail: "Department not found." }, 404);
      await audit(user, "department.update", "department", data.id); return json(data);
    }

    // -------------------------------------------------------------------
    // Administrator: employees
    // -------------------------------------------------------------------
    // Unpaginated id+name lookup for the manager-picker dropdown (BUILD
    // PROMPT v5 item A3) — the main employees list is paginated and a
    // manager can be on any page, so the dropdown needs its own source.
    if (path === "/api/v1/admin/employees/lookup" && req.method === "GET") {
      const deny = forbidUnlessAdmin(isAdmin); if (deny) return deny;
      const { data, error } = await supabase.from("app_users").select("id,full_name").eq("org_id", user.org_id).eq("is_active", true).order("full_name");
      if (error) throw error;
      return json(data || []);
    }
    if (path === "/api/v1/admin/employees" && req.method === "GET") {
      const deny = forbidUnlessAdmin(isAdmin); if (deny) return deny;
      const { page, pageSize, from, to } = paginate(rawUrl); const query = rawUrl.searchParams.get("q");
      let request = supabase.from("app_users").select("id,email,full_name,role,is_active,created_at,department_id,manager_id,departments(name)", { count: "exact" }).eq("org_id", user.org_id);
      if (query) request = request.or(`full_name.ilike.%${query}%,email.ilike.%${query}%`);
      const { data, error, count } = await request.order("full_name").range(from, to); if (error) throw error;
      const managers = new Map((data || []).map((u: any) => [u.id, u.full_name]));
      // manager_id can point at anyone in the org, not just this page, so
      // a manager whose page isn't currently loaded still needs a name —
      // fetch the missing ones by id rather than leaving manager_name blank.
      const missingManagerIds = Array.from(new Set((data || []).map((u: any) => u.manager_id).filter((id: string | null) => id && !managers.has(id))));
      if (missingManagerIds.length) {
        const { data: extra } = await supabase.from("app_users").select("id,full_name").in("id", missingManagerIds);
        for (const m of extra || []) managers.set(m.id, m.full_name);
      }
      return json({ items: (data || []).map((item: any) => ({ ...item, department_name: item.departments?.name || null, manager_name: item.manager_id ? managers.get(item.manager_id) || null : null, departments: undefined })), page, page_size: pageSize, total: count || 0 });
    }
    if (path === "/api/v1/admin/employees" && req.method === "POST") {
      const deny = forbidUnlessAdmin(isAdmin); if (deny) return deny;
      const body = await req.json();
      if (!body.full_name?.trim()) return fieldError("full_name", "Full Name is required.");
      if (!body.email?.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) return fieldError("email", "Enter a valid Email ID.");
      if (!body.password || body.password.length < 8) return fieldError("password", "Password must be at least 8 characters.");
      if (!["employee","manager","content_admin","admin"].includes(body.role)) return fieldError("role", "Select a valid role.");
      const { data, error } = await supabase.rpc("admin_create_user", { p_org_id: user.org_id, p_department_id: body.department_id || null, p_email: body.email, p_full_name: body.full_name.trim(), p_role: body.role, p_password: body.password });
      const created = data?.[0];
      if (error || !created) return json({ detail: error?.message?.includes("duplicate") ? "An employee with this Email ID already exists." : "Could not create the employee." }, 409);
      // admin_create_user predates manager_id (BUILD PROMPT v5 item A3) and
      // its signature isn't touched here — set it with a follow-up update
      // instead of a migration to the RPC, to keep this change additive.
      if (body.manager_id) await supabase.from("app_users").update({ manager_id: body.manager_id }).eq("id", created.id).eq("org_id", user.org_id);
      const { data: modules } = await supabase.from("training_modules").select("id,sequence").eq("org_id", user.org_id).order("sequence");
      if (modules?.length) await supabase.from("enrollments").insert(modules.map((m) => ({ org_id: user.org_id, user_id: created.id, module_id: m.id, status: m.sequence === 1 ? "assigned" : "locked", assigned_by: user.id, assigned_at: new Date().toISOString() })));
      await audit(user, "employee.create", "app_user", created.id, { role: created.role }); return json(created, 201);
    }
    const employeeMatch = path.match(/^\/api\/v1\/admin\/employees\/([^/]+)$/);
    if (employeeMatch && req.method === "PATCH") {
      const deny = forbidUnlessAdmin(isAdmin); if (deny) return deny;
      const body = await req.json(); const patch: Record<string, unknown> = {};
      if (body.full_name !== undefined) patch.full_name = String(body.full_name).trim();
      if (body.department_id !== undefined) patch.department_id = body.department_id || null;
      if (body.manager_id !== undefined) {
        if (body.manager_id === employeeMatch[1]) return fieldError("manager_id", "An employee cannot be their own manager.");
        patch.manager_id = body.manager_id || null;
      }
      if (body.role !== undefined) { if (!["employee","manager","content_admin","admin"].includes(body.role)) return fieldError("role", "Select a valid role."); patch.role = body.role; }
      if (body.is_active !== undefined) patch.is_active = Boolean(body.is_active);
      if (Object.keys(patch).length) {
        const { data, error } = await supabase.from("app_users").update(patch).eq("id", employeeMatch[1]).eq("org_id", user.org_id).select("id,email,full_name,role,is_active,department_id,manager_id").maybeSingle();
        if (error) throw error; if (!data) return json({ detail: "Employee not found." }, 404);
        await audit(user, "employee.update", "app_user", data.id, patch);
      }
      if (body.password) {
        if (body.password.length < 8) return fieldError("password", "Password must be at least 8 characters.");
        const { data: ok } = await supabase.rpc("admin_set_password", { p_org_id: user.org_id, p_user_id: employeeMatch[1], p_password: body.password });
        if (!ok) return json({ detail: "Employee not found." }, 404);
        await audit(user, "employee.reset_password", "app_user", employeeMatch[1]);
      }
      const { data: fresh, error: freshError } = await supabase.from("app_users").select("id,email,full_name,role,is_active,department_id,manager_id").eq("id", employeeMatch[1]).eq("org_id", user.org_id).maybeSingle();
      if (freshError) throw freshError; if (!fresh) return json({ detail: "Employee not found." }, 404);
      return json(fresh);
    }

    // -------------------------------------------------------------------
    // Administrator: responsibility matrix
    // -------------------------------------------------------------------
    if (path === "/api/v1/admin/activities" && req.method === "POST") {
      const deny = forbidUnlessAdmin(isAdmin); if (deny) return deny;
      const body = await req.json();
      for (const field of ["name","department","responsible_role","contact_details","sla","escalation_level_1","escalation_level_2"]) {
        if (!body[field]?.toString().trim()) return fieldError(field, `${field.replace(/_/g, " ")} is required.`);
      }
      const { data, error } = await supabase.from("activities").insert({ org_id: user.org_id, name: body.name.trim(), department: body.department.trim(), responsible_role: body.responsible_role.trim(), current_person: body.current_person?.trim() || "Organisation to confirm", backup_person: body.backup_person?.trim() || "Department backup", contact_details: body.contact_details.trim(), sla: body.sla.trim(), escalation_level_1: body.escalation_level_1.trim(), escalation_level_2: body.escalation_level_2.trim(), sop_link: body.sop_link || null, training_module_link: body.training_module_link || null }).select().single();
      if (error) return json({ detail: "An activity with this name already exists." }, 409);
      await audit(user, "activity.create", "activity", data.id); return json(data, 201);
    }
    const activityMatch = path.match(/^\/api\/v1\/admin\/activities\/([^/]+)$/);
    if (activityMatch && req.method === "PATCH") {
      const deny = forbidUnlessAdmin(isAdmin); if (deny) return deny;
      const body = await req.json(); const editable = ["name","department","responsible_role","current_person","backup_person","contact_details","sla","escalation_level_1","escalation_level_2","sop_link","training_module_link","status"];
      const patch: Record<string, unknown> = {}; for (const key of editable) if (body[key] !== undefined) patch[key] = typeof body[key] === "string" ? body[key].trim() : body[key];
      if (patch.status && !["draft","confirmed","archived"].includes(patch.status as string)) return fieldError("status", "Select a valid status.");
      const { data, error } = await supabase.from("activities").update(patch).eq("id", activityMatch[1]).eq("org_id", user.org_id).select().maybeSingle();
      if (error) return json({ detail: "An activity with this name already exists." }, 409);
      if (!data) return json({ detail: "Activity not found." }, 404);
      await audit(user, "activity.update", "activity", data.id, patch); return json(data);
    }

    // SOP documents live in SOPGalaxy (https://app.sopgalaxy.com/), not
    // here — no editor, no approval workflow, no status tracking. The only
    // trace of SOPs this API touches is activities.sop_link, a plain URL
    // edited through /api/v1/admin/activities above.

    // -------------------------------------------------------------------
    // Administrator: training module and quiz builder
    // -------------------------------------------------------------------
    if (path === "/api/v1/admin/training/modules" && req.method === "POST") {
      const deny = forbidUnlessAdmin(isAdmin); if (deny) return deny;
      const body = await req.json();
      for (const field of ["code","title","objective"]) if (!body[field]?.toString().trim()) return fieldError(field, `${field[0].toUpperCase()}${field.slice(1)} is required.`);
      if (!body.duration_minutes || Number(body.duration_minutes) <= 0) return fieldError("duration_minutes", "Duration must be greater than zero.");
      const { data: maxRow } = await supabase.from("training_modules").select("sequence").eq("org_id", user.org_id).order("sequence", { ascending: false }).limit(1).maybeSingle();
      const sequence = (maxRow?.sequence || 0) + 1;
      const { data: module, error } = await supabase.from("training_modules").insert({ org_id: user.org_id, code: body.code.trim().toUpperCase(), title: body.title.trim(), objective: body.objective.trim(), duration_minutes: Number(body.duration_minutes), content_type: body.content_type || "mixed", passing_score: Number(body.passing_score) || 80, refresher_months: Number(body.refresher_months) || 12, sequence, status: "draft" }).select().single();
      if (error) return json({ detail: "A module with this code already exists." }, 409);
      const { data: employees } = await supabase.from("app_users").select("id").eq("org_id", user.org_id).eq("role", "employee").eq("is_active", true);
      if (employees?.length) await supabase.from("enrollments").insert(employees.map((e) => ({ org_id: user.org_id, user_id: e.id, module_id: module.id, status: "locked", assigned_by: user.id, assigned_at: new Date().toISOString() })));
      await audit(user, "module.create", "training_module", module.id); return json(module, 201);
    }
    const moduleMatch = path.match(/^\/api\/v1\/admin\/training\/modules\/([^/]+)$/);
    if (moduleMatch && req.method === "PATCH") {
      const deny = forbidUnlessAdmin(isAdmin); if (deny) return deny;
      const body = await req.json(); const editable = ["title","objective","duration_minutes","content_type","passing_score","refresher_months","is_mandatory","status"];
      const patch: Record<string, unknown> = {}; for (const key of editable) if (body[key] !== undefined) patch[key] = body[key];
      if (patch.status && !["draft","published","archived"].includes(patch.status as string)) return fieldError("status", "Select a valid status.");
      const { data, error } = await supabase.from("training_modules").update(patch).eq("id", moduleMatch[1]).eq("org_id", user.org_id).select().maybeSingle();
      if (error) throw error; if (!data) return json({ detail: "Module not found." }, 404);
      await audit(user, "module.update", "training_module", data.id, patch); return json(data);
    }
    const questionsMatch = path.match(/^\/api\/v1\/admin\/training\/modules\/([^/]+)\/questions$/);
    if (questionsMatch && req.method === "GET") {
      const deny = forbidUnlessAdmin(isAdmin); if (deny) return deny;
      const { data, error } = await supabase.from("quiz_questions").select("*").eq("org_id", user.org_id).eq("module_id", questionsMatch[1]).order("created_at"); if (error) throw error; return json(data);
    }
    if (questionsMatch && req.method === "POST") {
      const deny = forbidUnlessAdmin(isAdmin); if (deny) return deny;
      const body = await req.json();
      if (!body.prompt?.trim()) return fieldError("prompt", "Question Prompt is required.");
      if (!Array.isArray(body.options) || body.options.length < 2) return fieldError("options", "Provide at least two options.");
      if (typeof body.correct_index !== "number" || body.correct_index < 0 || body.correct_index >= body.options.length) return fieldError("correct_index", "Select which option is correct.");
      if (!body.explanation?.trim()) return fieldError("explanation", "Explanation is required.");
      const { data, error } = await supabase.from("quiz_questions").insert({ org_id: user.org_id, module_id: questionsMatch[1], prompt: body.prompt.trim(), options: body.options, correct_index: body.correct_index, explanation: body.explanation.trim() }).select().single();
      if (error) throw error; await audit(user, "question.create", "quiz_question", data.id); return json(data, 201);
    }
    const questionMatch = path.match(/^\/api\/v1\/admin\/training\/questions\/([^/]+)$/);
    if (questionMatch && req.method === "PATCH") {
      const deny = forbidUnlessAdmin(isAdmin); if (deny) return deny;
      const body = await req.json(); const editable = ["prompt","options","correct_index","explanation"];
      const patch: Record<string, unknown> = {}; for (const key of editable) if (body[key] !== undefined) patch[key] = body[key];
      const { data, error } = await supabase.from("quiz_questions").update(patch).eq("id", questionMatch[1]).eq("org_id", user.org_id).select().maybeSingle();
      if (error) throw error; if (!data) return json({ detail: "Question not found." }, 404);
      await audit(user, "question.update", "quiz_question", data.id); return json(data);
    }
    if (questionMatch && req.method === "DELETE") {
      const deny = forbidUnlessAdmin(isAdmin); if (deny) return deny;
      const { error, count } = await supabase.from("quiz_questions").delete({ count: "exact" }).eq("id", questionMatch[1]).eq("org_id", user.org_id);
      if (error) throw error; if (!count) return json({ detail: "Question not found." }, 404);
      await audit(user, "question.delete", "quiz_question", questionMatch[1]); return json({ deleted: true });
    }

    // -------------------------------------------------------------------
    // Administrator: assignment and due-date management
    // -------------------------------------------------------------------
    if (path === "/api/v1/admin/enrollments" && req.method === "GET") {
      const deny = forbidUnlessAdmin(isAdmin); if (deny) return deny;
      const { page, pageSize, from, to } = paginate(rawUrl); const moduleId = rawUrl.searchParams.get("module_id");
      let request = supabase.from("enrollments").select("id,status,progress_percent,best_score,due_date,completed_at,app_users!enrollments_user_id_fkey(id,full_name,email),training_modules(id,title,code)", { count: "exact" }).eq("org_id", user.org_id);
      if (moduleId) request = request.eq("module_id", moduleId);
      const { data, error, count } = await request.order("due_date", { ascending: true, nullsFirst: false }).range(from, to); if (error) throw error;
      return json({ items: (data || []).map((item: any) => ({ id: item.id, status: item.status, progress_percent: item.progress_percent, best_score: item.best_score, due_date: item.due_date, completed_at: item.completed_at, employee: item.app_users, module: item.training_modules })), page, page_size: pageSize, total: count || 0 });
    }
    const enrollmentMatch = path.match(/^\/api\/v1\/admin\/enrollments\/([^/]+)$/);
    if (enrollmentMatch && req.method === "PATCH") {
      const deny = forbidUnlessAdmin(isAdmin); if (deny) return deny;
      const body = await req.json(); const patch: Record<string, unknown> = {};
      if (body.due_date !== undefined) patch.due_date = body.due_date || null;
      if (body.status !== undefined) { if (!["locked","assigned","in_progress","completed","waived"].includes(body.status)) return fieldError("status", "Select a valid status."); patch.status = body.status; }
      const { data, error } = await supabase.from("enrollments").update(patch).eq("id", enrollmentMatch[1]).eq("org_id", user.org_id).select().maybeSingle();
      if (error) throw error; if (!data) return json({ detail: "Assignment not found." }, 404);
      await audit(user, "enrollment.update", "enrollment", data.id, patch); return json(data);
    }
    if (path === "/api/v1/admin/enrollments/assign" && req.method === "POST") {
      const deny = forbidUnlessAdmin(isAdmin); if (deny) return deny;
      const body = await req.json();
      if (!body.module_id) return fieldError("module_id", "Select a training module.");
      if (!Array.isArray(body.employee_ids) || !body.employee_ids.length) return fieldError("employee_ids", "Select at least one employee.");
      const rows = body.employee_ids.map((employeeId: string) => ({ org_id: user.org_id, user_id: employeeId, module_id: body.module_id, status: "assigned", due_date: body.due_date || null, assigned_by: user.id, assigned_at: new Date().toISOString() }));
      const { data, error } = await supabase.from("enrollments").upsert(rows, { onConflict: "org_id,user_id,module_id" }).select();
      if (error) throw error; await audit(user, "enrollment.assign", "training_module", body.module_id, { employee_count: rows.length, due_date: body.due_date || null }); return json({ assigned: data?.length || 0 }, 201);
    }

    // -------------------------------------------------------------------
    // Administrator: unresolved-question governance queue
    // -------------------------------------------------------------------
    if (path === "/api/v1/admin/feedback" && req.method === "GET") {
      const deny = forbidUnlessAdmin(isAdmin); if (deny) return deny;
      const { page, pageSize, from, to } = paginate(rawUrl); const status = rawUrl.searchParams.get("status") || "open";
      const { data, error, count } = await supabase.from("knowledge_feedback").select("id,query,reason,status,resolution,created_at,resolved_at,app_users!knowledge_feedback_user_id_fkey(full_name)", { count: "exact" }).eq("org_id", user.org_id).eq("status", status).order("created_at", { ascending: false }).range(from, to);
      if (error) throw error;
      return json({ items: (data || []).map((item: any) => ({ id: item.id, query: item.query, reason: item.reason, status: item.status, resolution: item.resolution, created_at: item.created_at, resolved_at: item.resolved_at, employee: item.app_users?.full_name || "Unknown" })), page, page_size: pageSize, total: count || 0 });
    }
    const feedbackMatch = path.match(/^\/api\/v1\/admin\/feedback\/([^/]+)$/);
    if (feedbackMatch && req.method === "PATCH") {
      const deny = forbidUnlessAdmin(isAdmin); if (deny) return deny;
      const body = await req.json();
      if (!["resolved","dismissed","in_review"].includes(body.status)) return fieldError("status", "Select a valid status.");
      if (body.status !== "in_review" && !body.resolution?.trim()) return fieldError("resolution", "Resolution notes are required.");
      const patch: Record<string, unknown> = { status: body.status };
      if (body.status !== "in_review") { patch.resolution = body.resolution.trim(); patch.resolved_by = user.id; patch.resolved_at = new Date().toISOString(); }
      const { data, error } = await supabase.from("knowledge_feedback").update(patch).eq("id", feedbackMatch[1]).eq("org_id", user.org_id).select().maybeSingle();
      if (error) throw error; if (!data) return json({ detail: "Feedback item not found." }, 404);
      await audit(user, "feedback.resolve", "knowledge_feedback", data.id, { status: body.status }); return json(data);
    }

    // -------------------------------------------------------------------
    // Administrator: content library — documents, video tutorials, SOP files
    // and the common-mistake register. Files never pass through this
    // function; a short-lived signed URL lets the browser upload directly to
    // private storage.
    // -------------------------------------------------------------------
    if (path === "/api/v1/admin/content" && req.method === "GET") {
      const deny = forbidUnlessAdmin(isAdmin); if (deny) return deny;
      const { page, pageSize, from, to } = paginate(rawUrl); const kind = rawUrl.searchParams.get("kind");
      let request = supabase.from("content_assets").select("id,kind,title,description,department,file_name,mime_type,size_bytes,version,status,external_url,created_at", { count: "exact" }).eq("org_id", user.org_id);
      if (kind) request = request.eq("kind", kind);
      const { data, error, count } = await request.order("created_at", { ascending: false }).range(from, to); if (error) throw error;
      return json({ items: data || [], page, page_size: pageSize, total: count || 0 });
    }
    if (path === "/api/v1/admin/content/upload-url" && req.method === "POST") {
      const deny = forbidUnlessAdmin(isAdmin); if (deny) return deny;
      const body = await req.json();
      if (!body.file_name?.trim()) return fieldError("file_name", "Choose a file to upload.");
      if (!body.title?.trim()) return fieldError("title", "Title is required.");
      if (!["document","video","sop","mistake_register","template","image"].includes(body.kind)) return fieldError("kind", "Select a valid content type.");
      const safeName = body.file_name.trim().replace(/[^a-zA-Z0-9_.-]/g, "-");
      const storagePath = `${user.org_id}/${body.kind}/${crypto.randomUUID()}-${safeName}`;
      const { data: signed, error: signError } = await supabase.storage.from(CONTENT_BUCKET).createSignedUploadUrl(storagePath);
      if (signError || !signed) return json({ detail: "Could not prepare the upload. Try again." }, 502);
      const { data: asset, error } = await supabase.from("content_assets").insert({ org_id: user.org_id, kind: body.kind, title: body.title.trim(), description: body.description?.trim() || null, department: body.department || null, storage_path: storagePath, file_name: safeName, mime_type: body.mime_type || "application/octet-stream", size_bytes: Number(body.size_bytes) || 0, uploaded_by: user.id, status: "pending" }).select().single();
      if (error) throw error;
      return json({ asset_id: asset.id, upload_url: signed.signedUrl, storage_path: storagePath }, 201);
    }
    if (path === "/api/v1/admin/content/external" && req.method === "POST") {
      const deny = forbidUnlessAdmin(isAdmin); if (deny) return deny;
      const body = await req.json();
      if (!body.title?.trim()) return fieldError("title", "Title is required.");
      if (!body.external_url?.trim() || !/^https?:\/\//i.test(body.external_url.trim())) return fieldError("external_url", "Enter a valid link starting with http:// or https://.");
      if (!["document","video","sop","template","image"].includes(body.kind)) return fieldError("kind", "Select a valid content type.");
      const { data: asset, error } = await supabase.from("content_assets").insert({ org_id: user.org_id, kind: body.kind, title: body.title.trim(), description: body.description?.trim() || null, department: body.department || null, external_url: body.external_url.trim(), uploaded_by: user.id, status: "ready" }).select().single();
      if (error) throw error;
      await audit(user, "content.link", "content_asset", asset.id, { kind: asset.kind, title: asset.title }); return json(asset, 201);
    }
    const contentCompleteMatch = path.match(/^\/api\/v1\/admin\/content\/([^/]+)\/complete$/);
    if (contentCompleteMatch && req.method === "POST") {
      const deny = forbidUnlessAdmin(isAdmin); if (deny) return deny;
      const { data, error } = await supabase.from("content_assets").update({ status: "ready" }).eq("id", contentCompleteMatch[1]).eq("org_id", user.org_id).select().maybeSingle();
      if (error) throw error; if (!data) return json({ detail: "Asset not found." }, 404);
      await audit(user, "content.upload", "content_asset", data.id, { kind: data.kind, title: data.title }); return json(data);
    }
    const contentDownloadMatch = path.match(/^\/api\/v1\/admin\/content\/([^/]+)\/download-url$/);
    if (contentDownloadMatch && req.method === "GET") {
      const deny = forbidUnlessAdmin(isAdmin); if (deny) return deny;
      const { data: asset } = await supabase.from("content_assets").select("storage_path,external_url").eq("id", contentDownloadMatch[1]).eq("org_id", user.org_id).maybeSingle();
      if (!asset) return json({ detail: "Asset not found." }, 404);
      if (asset.external_url) return json({ download_url: asset.external_url });
      const { data: signed, error } = await supabase.storage.from(CONTENT_BUCKET).createSignedUrl(asset.storage_path, 600);
      if (error || !signed) return json({ detail: "Could not prepare the download." }, 502);
      return json({ download_url: signed.signedUrl });
    }
    const contentMatch = path.match(/^\/api\/v1\/admin\/content\/([^/]+)$/);
    if (contentMatch && req.method === "DELETE") {
      const deny = forbidUnlessAdmin(isAdmin); if (deny) return deny;
      const { data: asset } = await supabase.from("content_assets").select("storage_path").eq("id", contentMatch[1]).eq("org_id", user.org_id).maybeSingle();
      if (!asset) return json({ detail: "Asset not found." }, 404);
      if (asset.storage_path) await supabase.storage.from(CONTENT_BUCKET).remove([asset.storage_path]);
      await supabase.from("content_assets").update({ status: "archived" }).eq("id", contentMatch[1]);
      await audit(user, "content.archive", "content_asset", contentMatch[1]); return json({ archived: true });
    }

    // -------------------------------------------------------------------
    // Administrator: common-mistake register
    // -------------------------------------------------------------------
    if (path === "/api/v1/admin/mistakes" && req.method === "GET") {
      const deny = forbidUnlessAdmin(isAdmin); if (deny) return deny;
      const { page, pageSize, from, to } = paginate(rawUrl); const query = rawUrl.searchParams.get("q");
      let request = supabase.from("mistake_register").select("*", { count: "exact" }).eq("org_id", user.org_id);
      if (query) request = request.or(`title.ilike.%${query}%,category.ilike.%${query}%`);
      const { data, error, count } = await request.order("code").range(from, to); if (error) throw error;
      return json({ items: data || [], page, page_size: pageSize, total: count || 0 });
    }
    if (path === "/api/v1/admin/mistakes" && req.method === "POST") {
      const deny = forbidUnlessAdmin(isAdmin); if (deny) return deny;
      const body = await req.json();
      for (const field of ["code","title","description","correct_practice","category"]) if (!body[field]?.toString().trim()) return fieldError(field, `${field.replace(/_/g, " ")} is required.`);
      const { data, error } = await supabase.from("mistake_register").insert({ org_id: user.org_id, code: body.code.trim().toUpperCase(), title: body.title.trim(), description: body.description.trim(), correct_practice: body.correct_practice.trim(), category: body.category.trim(), severity: body.severity || "medium", department: body.department || null, module_id: body.module_id || null, is_seed: false }).select().single();
      if (error) return json({ detail: "A register entry with this code already exists." }, 409);
      await audit(user, "mistake.create", "mistake_register", data.id); return json(data, 201);
    }
    const mistakeMatch = path.match(/^\/api\/v1\/admin\/mistakes\/([^/]+)$/);
    if (mistakeMatch && req.method === "PATCH") {
      const deny = forbidUnlessAdmin(isAdmin); if (deny) return deny;
      const body = await req.json(); const editable = ["title","description","correct_practice","category","severity","department","module_id","status"];
      const patch: Record<string, unknown> = {}; for (const key of editable) if (body[key] !== undefined) patch[key] = body[key];
      const { data, error } = await supabase.from("mistake_register").update(patch).eq("id", mistakeMatch[1]).eq("org_id", user.org_id).select().maybeSingle();
      if (error) throw error; if (!data) return json({ detail: "Register entry not found." }, 404);
      await audit(user, "mistake.update", "mistake_register", data.id); return json(data);
    }
    if (mistakeMatch && req.method === "DELETE") {
      const deny = forbidUnlessAdmin(isAdmin); if (deny) return deny;
      const { error, count } = await supabase.from("mistake_register").delete({ count: "exact" }).eq("id", mistakeMatch[1]).eq("org_id", user.org_id);
      if (error) throw error; if (!count) return json({ detail: "Register entry not found." }, 404);
      await audit(user, "mistake.delete", "mistake_register", mistakeMatch[1]); return json({ deleted: true });
    }
    if (path === "/api/v1/admin/mistakes/replace-seed" && req.method === "POST") {
      const deny = forbidUnlessAdmin(isAdmin); if (deny) return deny;
      const { data: removed, error } = await supabase.rpc("replace_seed_mistake_register", { p_org_id: user.org_id });
      if (error) throw error; await audit(user, "mistake.replace_seed", "mistake_register", undefined, { removed }); return json({ removed_seed_rows: removed || 0 });
    }

    // -------------------------------------------------------------------
    // Administrator: video tutorials and documents linked to a module
    // -------------------------------------------------------------------
    const resourcesMatch = path.match(/^\/api\/v1\/admin\/training\/modules\/([^/]+)\/resources$/);
    if (resourcesMatch && req.method === "GET") {
      const deny = forbidUnlessAdmin(isAdmin); if (deny) return deny;
      const { data, error } = await supabase.from("module_resources").select("id,resource_type,sequence,content_assets(id,title,kind,mime_type,status)").eq("org_id", user.org_id).eq("module_id", resourcesMatch[1]).order("sequence"); if (error) throw error;
      return json((data || []).map((item: any) => ({ id: item.id, resource_type: item.resource_type, sequence: item.sequence, asset: item.content_assets })));
    }
    if (resourcesMatch && req.method === "POST") {
      const deny = forbidUnlessAdmin(isAdmin); if (deny) return deny;
      const body = await req.json();
      if (!body.asset_id) return fieldError("asset_id", "Select a document or video to attach.");
      if (!["video","document","template","reference"].includes(body.resource_type)) return fieldError("resource_type", "Select a valid resource type.");
      const { data, error } = await supabase.from("module_resources").insert({ org_id: user.org_id, module_id: resourcesMatch[1], asset_id: body.asset_id, resource_type: body.resource_type, sequence: Number(body.sequence) || 1 }).select().single();
      if (error) return json({ detail: "This resource is already attached to the module." }, 409);
      await audit(user, "resource.attach", "module_resource", data.id); return json(data, 201);
    }
    const resourceMatch = path.match(/^\/api\/v1\/admin\/training\/resources\/([^/]+)$/);
    if (resourceMatch && req.method === "DELETE") {
      const deny = forbidUnlessAdmin(isAdmin); if (deny) return deny;
      const { error, count } = await supabase.from("module_resources").delete({ count: "exact" }).eq("id", resourceMatch[1]).eq("org_id", user.org_id);
      if (error) throw error; if (!count) return json({ detail: "Resource not found." }, 404);
      await audit(user, "resource.detach", "module_resource", resourceMatch[1]); return json({ deleted: true });
    }

    return json({ detail: "Route not found." }, 404);
  } catch (error) {
    console.error(error); return json({ detail: "The service could not complete the request." }, 500);
  }
});
