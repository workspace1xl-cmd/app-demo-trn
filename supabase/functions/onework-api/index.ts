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

// BUILD PROMPT v5 BLOCK D: the actual gating chain — "can't pass a quiz
// without 100% required reading". Checked at attempt time, not just
// display time, so this is a real server-side gate, not a UI hint. Returns
// the titles of whatever's unread (empty array = clear to attempt).
async function unreadMandatoryRuleTitles(user: { id: string; org_id: string; department_id: string | null }): Promise<string[]> {
  const { data: rules } = await supabase.from("rules")
    .select("title,published_version_id")
    .eq("org_id", user.org_id).eq("status", "active").eq("is_mandatory", true)
    .or(`department_id.is.null,department_id.eq.${user.department_id || "00000000-0000-0000-0000-000000000000"}`);
  const withVersion = (rules || []).filter((r) => r.published_version_id);
  if (!withVersion.length) return [];
  const { data: reads } = await supabase.from("rule_reads").select("rule_version_id").eq("user_id", user.id);
  const readVersionIds = new Set((reads || []).map((r) => r.rule_version_id));
  return withVersion.filter((r) => !readVersionIds.has(r.published_version_id)).map((r) => r.title);
}

// BUILD PROMPT v5 BLOCK F: attempts-used is computed by counting
// quiz_attempts rows (the real attempt log), not a separate counter column
// that could drift — attempts before enrollment.attempts_reset_at (if any)
// don't count, which is what makes a reset genuinely clear the block
// instead of the block being permanent once tripped.
async function attemptStatus(user: { id: string; org_id: string }, moduleId: string, moduleMaxAttempts: number | null) {
  const [{ data: org }, { data: enrollment }] = await Promise.all([
    supabase.from("organizations").select("default_max_quiz_attempts").eq("id", user.org_id).maybeSingle(),
    supabase.from("enrollments").select("onboarding_blocked,attempts_reset_at").eq("org_id", user.org_id).eq("user_id", user.id).eq("module_id", moduleId).maybeSingle(),
  ]);
  const maxAttempts = moduleMaxAttempts ?? org?.default_max_quiz_attempts ?? 3;
  let attemptsQuery = supabase.from("quiz_attempts").select("id", { count: "exact", head: true }).eq("org_id", user.org_id).eq("user_id", user.id).eq("module_id", moduleId);
  if (enrollment?.attempts_reset_at) attemptsQuery = attemptsQuery.gt("created_at", enrollment.attempts_reset_at);
  const { count: attemptsUsed } = await attemptsQuery;
  return {
    max_attempts: maxAttempts,
    attempts_used: attemptsUsed || 0,
    attempts_remaining: Math.max(0, maxAttempts - (attemptsUsed || 0)),
    onboarding_blocked: enrollment?.onboarding_blocked || false,
  };
}

// QA REMEDIATION BLOCKER 1 + 9: modules unlock strictly in sequence
// (enrollments.status starts "locked" for every module past sequence 1,
// and only flips to "assigned" once the module before it is passed —
// see the `if (passed)` unlock below). Until this fix, that "locked"
// status was enforced ONLY by the frontend disabling the button — a
// direct call to GET .../quiz or POST .../attempt for a module the
// employee hadn't reached yet skipped the check entirely and graded it
// like any other. This is the real server-side gate: called from both
// routes so a locked module can neither be viewed nor attempted by
// going straight to the API, matching the same defence-in-depth pattern
// already used for the mandatory-rules-unread and attempt-cap gates.
async function assertModuleUnlocked(user: { id: string; org_id: string }, moduleId: string) {
  const { data: enrollment } = await supabase.from("enrollments").select("status").eq("org_id", user.org_id).eq("user_id", user.id).eq("module_id", moduleId).maybeSingle();
  if (enrollment?.status === "locked") {
    return json({ detail: "This module isn't unlocked yet — complete the modules before it first." }, 403);
  }
  return null;
}

function forbidUnlessAdmin(isAdmin: boolean) {
  return isAdmin ? null : json({ detail: "Administrator permission required." }, 403);
}

// QA REMEDIATION BLOCKER 6: "that query goes to the particular
// department automatically or someone can then assign it to a
// particular department." Reuses activities.department — the same
// real, admin-maintained topic-to-department mapping Knowledge Search
// already matches queries against — as the auto-routing signal, rather
// than inventing a separate keyword-rules table. Same ILIKE
// term-extraction Search uses; the best-matching activity's department
// wins. Returns null (unrouted) when nothing matches, which an Admin
// can then assign manually from the Feedback Queue.
async function autoRouteDepartmentId(orgId: string, text: string): Promise<string | null> {
  const stopWords = new Set(["a", "an", "and", "can", "do", "does", "for", "how", "i", "is", "my", "of", "process", "request", "the", "to", "what", "where", "who"]);
  const terms = text.toLowerCase().split(/\s+/).map((t) => t.replace(/[^a-z0-9-]/g, "")).filter((t) => t.length > 2 && !stopWords.has(t)).slice(0, 6);
  if (!terms.length) return null;
  const activityFilters = terms.flatMap((term) => [`name.ilike.%${term}%`, `department.ilike.%${term}%`, `responsible_role.ilike.%${term}%`]).join(",");
  const { data: activity } = await supabase.from("activities").select("department").eq("org_id", orgId).or(activityFilters).limit(1).maybeSingle();
  if (!activity?.department) return null;
  const { data: department } = await supabase.from("departments").select("id").eq("org_id", orgId).ilike("name", activity.department).maybeSingle();
  return department?.id || null;
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

// BUILD PROMPT v5 BLOCK C: mirrors content_assets_message_subtype_matches_kind
// — required for (and only for) kind = 'onboarding_message'. Checked
// server-side even though the DB constraint would also catch it, so the
// admin console gets a field-specific error instead of a raw 400.
const MESSAGE_SUBTYPES = ["welcome", "founder", "md", "co_founder", "management", "hr", "hr_training_video"];
function validateMessageSubtype(kind: string, subtype: unknown) {
  if (kind === "onboarding_message") {
    if (!MESSAGE_SUBTYPES.includes(String(subtype))) return fieldError("message_subtype", "Choose who this message is from.");
  } else if (subtype) {
    return fieldError("message_subtype", "Message From only applies to Onboarding Message content.");
  }
  return null;
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

    // -------------------------------------------------------------------
    // BUILD PROMPT v5 BLOCK A: Pre-Joining Portal — genuinely public,
    // unauthenticated routes (a candidate has no account yet, so there is
    // no session to check). Deliberately placed before the
    // `authenticate(req)` gate below, same as login/signup above. Scoped
    // entirely by invite_token, never by org/session — the token IS the
    // credential.
    // -------------------------------------------------------------------
    const previewMatch = path.match(/^\/api\/v1\/public\/preview\/([0-9a-f-]+)$/i);
    if (previewMatch && req.method === "GET") {
      const { data: candidate } = await supabase.from("candidates").select("id,full_name,status,department_id,org_id").eq("invite_token", previewMatch[1]).maybeSingle();
      if (!candidate) return json({ detail: "This invite link isn't valid. Ask whoever sent it for a new one." }, 404);
      // QA REMEDIATION BLOCKER 7 (+ Step 0a): rules_available was
      // hardcoded false forever — a leftover from before Block D (Rules
      // & Regulations) existed, never wired up once it shipped. Now a
      // real query: the same org-wide-or-candidate's-department
      // visibility rule the employee-facing /api/v1/rules route already
      // uses. Only mandatory rules are shown here — a candidate hasn't
      // joined yet, so this is a heads-up preview ("here's what you'll
      // be expected to know"), not the full active regulations list they
      // get once onboarded.
      const [{ data: org }, { data: department }, { data: content }, { data: ack }, { data: rules }] = await Promise.all([
        supabase.from("organizations").select("name").eq("id", candidate.org_id).maybeSingle(),
        candidate.department_id ? supabase.from("departments").select("name").eq("id", candidate.department_id).maybeSingle() : Promise.resolve({ data: null }),
        supabase.from("org_preboarding_content").select("block_key,body").eq("org_id", candidate.org_id),
        supabase.from("preboarding_acknowledgments").select("acknowledged_at").eq("candidate_id", candidate.id).maybeSingle(),
        supabase.from("rules").select("title,category").eq("org_id", candidate.org_id).eq("status", "active").eq("is_mandatory", true).or(`department_id.is.null,department_id.eq.${candidate.department_id || "00000000-0000-0000-0000-000000000000"}`).order("category"),
      ]);
      const blocks = Object.fromEntries((content || []).map((c) => [c.block_key, c.body]));
      return json({
        candidate_name: candidate.full_name,
        org_name: org?.name || "the organisation",
        department_name: department?.name || null,
        welcome: blocks.welcome || "",
        expectations_from_you: blocks.expectations_from_you || "",
        expectations_from_us: blocks.expectations_from_us || "",
        rules_available: Boolean(rules?.length),
        rules: (rules || []).map((r) => ({ title: r.title, category: r.category })),
        already_acknowledged: Boolean(ack),
        acknowledged_at: ack?.acknowledged_at || null,
      });
    }
    const ackMatch = path.match(/^\/api\/v1\/public\/preview\/([0-9a-f-]+)\/acknowledge$/i);
    if (ackMatch && req.method === "POST") {
      const { data: candidate } = await supabase.from("candidates").select("id").eq("invite_token", ackMatch[1]).maybeSingle();
      if (!candidate) return json({ detail: "This invite link isn't valid. Ask whoever sent it for a new one." }, 404);
      // Idempotent: re-submitting an already-acknowledged link succeeds
      // quietly rather than erroring — a candidate double-clicking or
      // reloading the confirmation page is a real, expected case, not
      // something that should surface as a failure.
      const { data: existing } = await supabase.from("preboarding_acknowledgments").select("acknowledged_at").eq("candidate_id", candidate.id).maybeSingle();
      if (!existing) {
        await supabase.from("preboarding_acknowledgments").insert({ candidate_id: candidate.id, ip_address: req.headers.get("x-forwarded-for"), user_agent: req.headers.get("user-agent") });
        await supabase.from("candidates").update({ status: "acknowledged" }).eq("id", candidate.id);
      }
      return json({ ok: true });
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
    // BUILD PROMPT v5 BLOCK B: employee-facing onboarding journey. Status
    // is computed on every read from enrollments + employee_item_progress
    // — there is no cached "onboarding complete" flag anywhere to drift
    // out of sync. A stage is "completed" once every item in it is
    // completed; a stage is "available" once every earlier stage is
    // completed (or it's the first stage); otherwise it's "locked". The
    // whole journey is "completed" once every stage is.
    // -------------------------------------------------------------------
    if (path === "/api/v1/onboarding/journey" && req.method === "GET") {
      // BUILD PROMPT v5 BLOCK C: content_assets(...) here resolves a
      // content_block item's linked asset (e.g. a Welcome Message) so the
      // employee sees the real title/kind/link, not just a bare item title.
      const [{ data: stages, error }, { data: items }, { data: itemProgress }, { data: enrollments }] = await Promise.all([
        supabase.from("onboarding_stages").select("id,name,description,sequence").eq("org_id", user.org_id).order("sequence"),
        supabase.from("onboarding_stage_items").select("id,stage_id,item_type,training_module_id,content_asset_id,title,description,sequence,onboarding_stages!inner(org_id),content_assets(title,kind,message_subtype,external_url)").eq("onboarding_stages.org_id", user.org_id).order("sequence"),
        supabase.from("employee_item_progress").select("item_id,completed_at").eq("user_id", user.id),
        supabase.from("enrollments").select("module_id,status").eq("org_id", user.org_id).eq("user_id", user.id),
      ]);
      if (error) throw error;
      const ackByItem = new Map((itemProgress || []).map((p) => [p.item_id, p.completed_at]));
      const completedModuleIds = new Set((enrollments || []).filter((e) => e.status === "completed").map((e) => e.module_id));
      // BUILD PROMPT v5 BLOCK D: rules_ack completion is DERIVED, like
      // training_module — "done" means every mandatory rule that applies
      // to this employee is read, not a manual click. Only computed when
      // a rules_ack item actually exists, to avoid the extra query on
      // every journey load for orgs that don't use it.
      const hasRulesAckItem = (items || []).some((i: any) => i.item_type === "rules_ack");
      const rulesAckComplete = hasRulesAckItem ? (await unreadMandatoryRuleTitles(user)).length === 0 : true;
      const itemsByStage = new Map<string, any[]>();
      for (const raw of items || []) {
        const { onboarding_stages, content_assets, ...item } = raw as any;
        const completed = item.item_type === "training_module" ? completedModuleIds.has(item.training_module_id) : item.item_type === "rules_ack" ? rulesAckComplete : ackByItem.has(item.id);
        if (!itemsByStage.has(item.stage_id)) itemsByStage.set(item.stage_id, []);
        itemsByStage.get(item.stage_id)!.push({ ...item, content_asset: content_assets || null, completed, completed_at: item.item_type === "training_module" || item.item_type === "rules_ack" ? null : ackByItem.get(item.id) || null });
      }
      let priorComplete = true;
      const shaped = (stages || []).map((s) => {
        const stageItems = itemsByStage.get(s.id) || [];
        const stageComplete = stageItems.length > 0 && stageItems.every((i) => i.completed);
        const status = stageComplete ? "completed" : priorComplete ? "available" : "locked";
        priorComplete = priorComplete && stageComplete;
        return { ...s, status, items: stageItems };
      });
      const journeyComplete = shaped.length > 0 && shaped.every((s) => s.status === "completed");
      return json({ stages: shaped, journey_complete: journeyComplete });
    }
    const journeyAckMatch = path.match(/^\/api\/v1\/onboarding\/journey\/items\/([^/]+)\/complete$/);
    if (journeyAckMatch && req.method === "POST") {
      const { data: item } = await supabase.from("onboarding_stage_items").select("id,item_type,onboarding_stages!inner(org_id)").eq("id", journeyAckMatch[1]).eq("onboarding_stages.org_id", user.org_id).maybeSingle();
      if (!item) return json({ detail: "This onboarding item couldn't be found." }, 404);
      if (item.item_type === "training_module") return json({ detail: "This item completes automatically once you finish the training module." }, 400);
      if (item.item_type === "rules_ack") return json({ detail: "This item completes automatically once you've read every mandatory rule that applies to you." }, 400);
      // Idempotent: re-clicking "mark done" after it's already recorded is
      // a no-op, not an error — same pattern as Block A's acknowledge route.
      const { error } = await supabase.from("employee_item_progress").upsert({ user_id: user.id, item_id: item.id }, { onConflict: "user_id,item_id", ignoreDuplicates: true });
      if (error) throw error;
      return json({ ok: true });
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
      const [{ data: enrollments }, { data: activities }, { data: recentNudges }] = await Promise.all([
        // QA REMEDIATION BLOCKER 3: onboarding_blocked selected alongside
        // status/due_date — a manager could not previously see which of
        // their reports had permanently failed a mandatory module.
        teamIds.length ? supabase.from("enrollments").select("user_id,status,due_date,onboarding_blocked").eq("org_id", user.org_id).in("user_id", teamIds) : Promise.resolve({ data: [] as { user_id: string; status: string; due_date: string | null; onboarding_blocked: boolean }[] }),
        teamDeptNames.length ? supabase.from("activities").select("id,name,department,responsible_role,current_person,backup_person,contact_details,sla,escalation_level_1,escalation_level_2,sop_link,training_module_link,status").eq("org_id", user.org_id).in("department", teamDeptNames) : Promise.resolve({ data: [] as unknown[] }),
        // BUILD PROMPT v5 item B2: "nudged Nd ago" state so a manager can
        // see a nudge already went out instead of guessing whether to
        // send another — reuses notification_outbox (kind='learning_reminder')
        // as the record of it, not a separate nudge-log table.
        teamIds.length ? supabase.from("notification_outbox").select("user_id,created_at").eq("org_id", user.org_id).in("user_id", teamIds).eq("kind", "learning_reminder").order("created_at", { ascending: false }) : Promise.resolve({ data: [] as { user_id: string; created_at: string }[] }),
      ]);
      const lastNudgedByUser = new Map<string, string>();
      for (const n of recentNudges || []) if (!lastNudgedByUser.has(n.user_id)) lastNudgedByUser.set(n.user_id, n.created_at);
      const today = new Date().toISOString().slice(0, 10);
      const total = moduleCount || 0;
      const members = subtree.map((member: any) => {
        const rows = (enrollments || []).filter((e) => e.user_id === member.id);
        const completed = rows.filter((e) => e.status === "completed").length;
        const overdue = rows.filter((e) => e.due_date && e.due_date < today && e.status !== "completed").length;
        const percent = total ? Math.round((completed / total) * 100) : 0;
        // QA REMEDIATION BLOCKER 3: "if he's failing on two or three
        // occasions, we won't basically move ahead with him" — a manager
        // needs to see this without going to Admin. Admin's Assignments
        // panel already surfaces onboarding_blocked per-enrollment; this
        // is the same signal rolled up per team member.
        const blockedCount = rows.filter((e) => e.onboarding_blocked).length;
        return { id: member.id, name: member.full_name, email: member.email, department: deptNameById.get(member.department_id) || null, training_percent: percent, completed, total, overdue_count: overdue, attempts_exhausted_count: blockedCount, last_nudged_at: lastNudgedByUser.get(member.id) || null };
      });
      const teamTotal = members.reduce((sum, m) => sum + m.total, 0), teamCompleted = members.reduce((sum, m) => sum + m.completed, 0);
      const teamReadiness = scoreFromComponents([{ key: "training", label: "Team training completion", percent: teamTotal ? Math.round((teamCompleted / teamTotal) * 100) : 0 }]);
      return json({
        departments: teamDepartments,
        team_readiness: teamReadiness,
        members,
        overdue_total: members.reduce((sum, m) => sum + m.overdue_count, 0),
        attempts_exhausted_total: members.reduce((sum, m) => sum + m.attempts_exhausted_count, 0),
        activities: activities || [],
        // Honesty signal for the UI: distinguishes "you have zero direct
        // or rolled-up reports" (a real, valid org state — nudge to ask
        // an admin to set manager_id) from "loading"/"error".
        has_reports: members.length > 0,
      });
    }

    // BUILD PROMPT v5 item B2: "nudge from anywhere" — a manager (or
    // admin) sends an immediate reminder to someone overdue, instead of
    // waiting for the nightly cron to eventually notice. Scoped to the
    // caller's real reports-to subtree (walked the same way the
    // dashboard above does — a manager can't nudge a stranger), and
    // capped at one nudge per person per 24h so it can't be used to spam.
    const nudgeMatch = path.match(/^\/api\/v1\/manager\/nudge\/([^/]+)$/);
    if (nudgeMatch && req.method === "POST") {
      if (user.role !== "manager" && !isAdmin) return json({ detail: "Manager permission required." }, 403);
      const targetId = nudgeMatch[1];
      if (!isAdmin) {
        const { data: allUsers } = await supabase.from("app_users").select("id,manager_id").eq("org_id", user.org_id).eq("is_active", true);
        const directReportsOf = new Map<string, string[]>();
        for (const u of allUsers || []) { if (!u.manager_id) continue; const list = directReportsOf.get(u.manager_id) || []; list.push(u.id); directReportsOf.set(u.manager_id, list); }
        const seen = new Set<string>([user.id]); let frontier = [user.id]; let inSubtree = false;
        for (let depth = 0; depth < 10 && frontier.length && !inSubtree; depth++) {
          const next: string[] = [];
          for (const managerId of frontier) for (const reportId of directReportsOf.get(managerId) || []) { if (reportId === targetId) inSubtree = true; if (!seen.has(reportId)) { seen.add(reportId); next.push(reportId); } }
          frontier = next;
        }
        if (!inSubtree) return json({ detail: "This person doesn't report to you." }, 403);
      }
      const { data: recent } = await supabase.from("notification_outbox").select("id,created_at").eq("org_id", user.org_id).eq("user_id", targetId).eq("kind", "learning_reminder").gte("created_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()).order("created_at", { ascending: false }).limit(1);
      if (recent && recent.length) return json({ ok: true, already_nudged: true, last_nudged_at: recent[0].created_at });
      const today = new Date().toISOString().slice(0, 10);
      const { data: overdueEnrollments } = await supabase.from("enrollments").select("module_id,status,training_modules(title,code)").eq("org_id", user.org_id).eq("user_id", targetId).lt("due_date", today).neq("status", "completed");
      if (!overdueEnrollments || !overdueEnrollments.length) return json({ detail: "No overdue training to nudge about." }, 409);
      const rows = overdueEnrollments.map((e: any) => ({ org_id: user.org_id, user_id: targetId, kind: "learning_reminder", subject: "Continue your required OneWork training", payload: { module_id: e.module_id, module_code: e.training_modules?.code, module_title: e.training_modules?.title, status: e.status, nudged_by: user.id } }));
      const { error } = await supabase.from("notification_outbox").insert(rows);
      if (error) throw error;
      await audit(user, "manager.nudge", "app_user", targetId, { count: rows.length });
      return json({ ok: true, already_nudged: false, nudged_count: rows.length });
    }

    // notification_outbox is populated nightly by public.enqueue_onework_reminders()
    // (pg_cron, added for the n8n email pipeline) — read_at is purely in-app
    // "seen in the bell dropdown" state, kept separate from status/sent_at
    // which track actual email delivery.
    //
    // Also called lazily here, mirroring the FastAPI mirror's
    // _enqueue_reminders (which never had a scheduler to rely on) —
    // without this, data that starts qualifying for a reminder AFTER
    // today's 2:30am cron run stays invisible in the bell until
    // tomorrow, a real gap found while re-seeding demo data mid-day.
    // The function's own per-day dedup guards make this safe to call on
    // every notifications read, not just once.
    if (path === "/api/v1/notifications" && req.method === "GET") {
      await supabase.rpc("enqueue_onework_reminders");
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
      const { data: module } = await supabase.from("training_modules").select("id,title,passing_score,max_attempts").eq("id", quizMatch[1]).eq("org_id", user.org_id).maybeSingle();
      if (!module) return json({ detail: "Module not found." }, 404);
      const lockDenied = await assertModuleUnlocked(user, module.id); if (lockDenied) return lockDenied;
      // QA REMEDIATION BLOCKER 2: weight_percent surfaced upfront so the
      // employee sees which questions count for more before starting,
      // same "no surprise after the fact" principle as the attempt cap.
      const { data: questions } = await supabase.from("quiz_questions").select("id,prompt,options,weight_percent").eq("org_id", user.org_id).eq("module_id", module.id).order("created_at");
      // BUILD PROMPT v5 BLOCK F: upfront requirements/remaining-attempts
      // display — the employee sees the threshold and cap before starting,
      // not after failing enough times to hit a surprise block.
      const attempts = await attemptStatus(user, module.id, module.max_attempts);
      return json({ module_id: module.id, title: module.title, passing_score: module.passing_score, questions: questions || [], ...attempts });
    }

    const attemptMatch = path.match(/^\/api\/v1\/training\/modules\/([^/]+)\/attempt$/);
    if (attemptMatch && req.method === "POST") {
      const { answers } = await req.json();
      const [{ data: module }, { data: questions }] = await Promise.all([supabase.from("training_modules").select("*").eq("id", attemptMatch[1]).eq("org_id", user.org_id).maybeSingle(), supabase.from("quiz_questions").select("correct_index,explanation,weight_percent").eq("org_id", user.org_id).eq("module_id", attemptMatch[1]).order("created_at")]);
      if (!module) return json({ detail: "Module not found." }, 404);
      const lockDenied = await assertModuleUnlocked(user, module.id); if (lockDenied) return lockDenied;
      if (!questions?.length || answers?.length !== questions.length) return json({ detail: "Submit one answer for every question." }, 400);
      // BUILD PROMPT v5 BLOCK D: gating chain — you cannot even attempt a
      // quiz while a mandatory rule that applies to you is unread.
      const unread = await unreadMandatoryRuleTitles(user);
      if (unread.length) return json({ detail: `Read all mandatory rules before attempting this quiz. Still unread: ${unread.join(", ")}.`, unread_rules: unread }, 403);
      // BUILD PROMPT v5 BLOCK F: the actual attempt cap — blocked (or
      // already out of attempts) means no scoring happens at all, not
      // just a UI warning after the fact.
      const attemptsBefore = await attemptStatus(user, module.id, module.max_attempts);
      if (attemptsBefore.onboarding_blocked) return json({ detail: "You've used all your attempts for this quiz without passing. Ask your admin or manager to reset your attempts.", ...attemptsBefore }, 403);
      if (attemptsBefore.attempts_remaining <= 0) return json({ detail: "No attempts remaining for this quiz.", ...attemptsBefore }, 403);
      // QA REMEDIATION BLOCKER 2: "some questions may be required 100%
      // pass marks, some 75%, some 50%" — a single-select MCQ answer is
      // binary (right or wrong), so a per-question threshold can only
      // mean how much that question counts toward the overall score.
      // A 100%-weighted question missed hurts the score far more than a
      // 50%-weighted one; weight_percent defaults to 100 (full weight)
      // so every question created before this fix scores exactly as it
      // did — this changes what "score" MEANS for new weighted setups,
      // not the scores already on record.
      const correct = questions.filter((question, index) => question.correct_index === answers[index]).length;
      const totalWeight = questions.reduce((sum, q) => sum + (q.weight_percent ?? 100), 0);
      const earnedWeight = questions.reduce((sum, q, index) => sum + (q.correct_index === answers[index] ? (q.weight_percent ?? 100) : 0), 0);
      const score = totalWeight > 0 ? Math.round((earnedWeight / totalWeight) * 100) : 0;
      const passed = score >= module.passing_score;
      await supabase.from("quiz_attempts").insert({ org_id: user.org_id, user_id: user.id, module_id: module.id, score, passed, answers });
      const { data: enrollment } = await supabase.from("enrollments").select("id,best_score").eq("org_id", user.org_id).eq("user_id", user.id).eq("module_id", module.id).maybeSingle();
      // A failed final attempt trips the block; a pass never does, even on
      // the last allowed attempt.
      const willExhaustAttempts = !passed && attemptsBefore.attempts_remaining <= 1;
      if (enrollment) await supabase.from("enrollments").update({ best_score: Math.max(enrollment.best_score || 0, score), onboarding_blocked: willExhaustAttempts, ...(passed ? { status: "completed", progress_percent: 100, completed_at: new Date().toISOString() } : {}) }).eq("id", enrollment.id);
      if (passed) {
        // A refresher_months=12 certificate must expire in exactly one
        // calendar year, not 12*30=360 days (5 days short of a year).
        const expiryDate = new Date();
        expiryDate.setUTCMonth(expiryDate.getUTCMonth() + module.refresher_months);
        await supabase.from("certificates").upsert({ org_id: user.org_id, user_id: user.id, module_id: module.id, certificate_number: `OW-${module.code}-${Date.now()}`, issued_at: new Date().toISOString().slice(0,10), expires_at: expiryDate.toISOString().slice(0,10) }, { onConflict: "org_id,user_id,module_id", ignoreDuplicates: true });
        const { data: next } = await supabase.from("training_modules").select("id").eq("org_id", user.org_id).eq("sequence", module.sequence + 1).maybeSingle();
        if (next) await supabase.from("enrollments").update({ status: "assigned" }).eq("org_id", user.org_id).eq("user_id", user.id).eq("module_id", next.id).eq("status", "locked");
      }
      await audit(user, "quiz.submit", "training_module", module.id, { score, passed });
      const attemptsAfter = await attemptStatus(user, module.id, module.max_attempts);
      return json({ score, passed, passing_score: module.passing_score, correct, total: questions.length, explanations: questions.map((q) => q.explanation), ...attemptsAfter });
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

    // -------------------------------------------------------------------
    // BUILD PROMPT v5 BLOCK H: Knowledge Search default state — curated
    // blocks shown before the employee types anything, instead of a blank
    // box. Top Searches / Trending This Week / Popular in Your Department
    // are all just different filters over the real search log that
    // already existed (audit_events, action = 'knowledge.search', logged
    // by the /api/v1/search route below on every real search) — not a new
    // table duplicating it. Recently Added is genuinely new content
    // (training modules + content library items), not searches.
    // -------------------------------------------------------------------
    if (path === "/api/v1/search/defaults" && req.method === "GET") {
      function topQueries(rows: { details: any }[], limit: number) {
        const counts = new Map<string, number>();
        for (const row of rows) {
          const q = String(row.details?.query || "").trim().toLowerCase();
          if (!q) continue;
          counts.set(q, (counts.get(q) || 0) + 1);
        }
        return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([query, count]) => ({ query, count }));
      }
      const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const [{ data: allSearches }, { data: weekSearches }, { data: deptUsers }, { data: recentModules }, { data: recentContent }] = await Promise.all([
        supabase.from("audit_events").select("details").eq("org_id", user.org_id).eq("action", "knowledge.search").order("created_at", { ascending: false }).limit(500),
        supabase.from("audit_events").select("details").eq("org_id", user.org_id).eq("action", "knowledge.search").gte("created_at", weekAgo).order("created_at", { ascending: false }).limit(500),
        user.department_id ? supabase.from("app_users").select("id").eq("org_id", user.org_id).eq("department_id", user.department_id) : Promise.resolve({ data: [] as { id: string }[] }),
        supabase.from("training_modules").select("id,title,code,created_at").eq("org_id", user.org_id).eq("status", "published").order("created_at", { ascending: false }).limit(6),
        supabase.from("content_assets").select("id,title,kind,created_at").eq("org_id", user.org_id).eq("status", "ready").order("created_at", { ascending: false }).limit(6),
      ]);
      const deptUserIds = new Set((deptUsers || []).map((u: { id: string }) => u.id));
      let deptSearches: { details: any }[] = [];
      if (deptUserIds.size) {
        const { data } = await supabase.from("audit_events").select("details,actor_user_id").eq("org_id", user.org_id).eq("action", "knowledge.search").in("actor_user_id", [...deptUserIds]).order("created_at", { ascending: false }).limit(500);
        deptSearches = data || [];
      }
      return json({
        top_searches: topQueries(allSearches || [], 6),
        trending_this_week: topQueries(weekSearches || [], 6),
        popular_in_department: user.department_id ? topQueries(deptSearches, 6) : [],
        recently_added: [
          ...(recentModules || []).map((m: any) => ({ title: m.title, kind: "training_module", label: m.code, created_at: m.created_at })),
          ...(recentContent || []).map((c: any) => ({ title: c.title, kind: c.kind, label: c.kind.replace(/_/g, " "), created_at: c.created_at })),
        ].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()).slice(0, 6),
      });
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
      // QA REMEDIATION BLOCKER 5: "when the query is answered, he is able
      // to know things... he knows all the knowledge that is there." A
      // resolved query previously only reached the original submitter via
      // notification — nobody else could ever find it. Matched the exact
      // same way as every other search source here (ILIKE across
      // extracted terms), against both the original question text and
      // the admin's resolution, so searching close to the original
      // wording or close to the answer's own wording both find it.
      const resolvedQueryFilters = searchTerms.flatMap((term) => [`query.ilike.%${term}%`, `resolution.ilike.%${term}%`]).join(",");
      // QA REMEDIATION BLOCKER 8: "message from the founder... managing
      // director... co-founders... message from the management... welcome
      // to the team message... message from the HR, the training videos
      // from the HR." All seven leadership/HR onboarding_message assets
      // are real content_assets rows (Block C's schema already supported
      // all seven; this block populated the missing six) — but nothing
      // ever queried content_assets from Search at all, so even fully
      // populated they'd never have shown up here. Matched by title and
      // description, same ILIKE convention as everything else in this
      // route.
      const messageFilters = searchTerms.flatMap((term) => [`title.ilike.%${term}%`, `description.ilike.%${term}%`]).join(",");
      // SOP documents live in SOPGalaxy, not a table this API queries — the
      // only SOP-related signal in context is each activity's own sop_link
      // (a plain URL), included inline below when present, not a separate
      // sop_documents lookup.
      const [{ data: activities }, { data: modules }, { data: mistakes }, { data: resolvedQueries }, { data: messages }] = await Promise.all([
        supabase.from("activities").select("*").eq("org_id", user.org_id).or(activityFilters).limit(5),
        supabase.from("training_modules").select("*").eq("org_id", user.org_id).or(moduleFilters).limit(5),
        supabase.from("mistake_register").select("code,title,description,correct_practice,severity").eq("org_id", user.org_id).eq("status", "active").or(mistakeFilters).limit(3),
        supabase.from("knowledge_feedback").select("id,query,resolution,resolved_at").eq("org_id", user.org_id).eq("type", "query").eq("status", "resolved").or(resolvedQueryFilters).limit(3),
        // limit(8), not limit(3) like the other sources: every onboarding
        // message title starts with "A Message From..." and "welcome"/
        // "message" alone matches nearly every row, so a tight cap was
        // crowding out the actual best match (e.g. searching "Co-Founder"
        // returned three OTHER messages and never the co-founder ones).
        // Leadership/HR messages are a small, bounded set per org — 8
        // comfortably covers the seven types even with two co-founders.
        supabase.from("content_assets").select("id,title,description,message_subtype,external_url").eq("org_id", user.org_id).eq("kind", "onboarding_message").eq("status", "ready").or(messageFilters).limit(8),
      ]);
      const context = [...(activities || []).map((a) => `Activity: ${a.name}; owner ${a.responsible_role}; contact ${a.contact_details}; SLA ${a.sla}; escalation ${a.escalation_level_1} then ${a.escalation_level_2}${a.sop_link ? `; SOP: ${a.sop_link}` : ""}`), ...(modules || []).map((m) => `Training: ${m.code} ${m.title}; ${m.objective}`), ...(mistakes || []).map((mk) => `Common mistake ${mk.code}: ${mk.title}. ${mk.description} Correct practice: ${mk.correct_practice}`), ...(resolvedQueries || []).map((rq) => `Previously answered question "${rq.query}": ${rq.resolution}`), ...(messages || []).map((m) => `Leadership/HR message "${m.title}" (${m.message_subtype}): ${m.description || "no description"}`)].join("\n");
      const claude = await claudeAnswer(safe, context); const count = (activities?.length || 0) + (modules?.length || 0) + (mistakes?.length || 0) + (resolvedQueries?.length || 0) + (messages?.length || 0);
      // `escalate` now comes from a fixed STATUS: token Claude is asked to
      // emit first, parsed exactly — not guessed by regex-matching whatever
      // prose Claude happened to write. The regex approach was genuinely
      // non-deterministic in production: "leave" and "leave policy" hit the
      // same matched activity but got different verdicts purely because
      // Claude's *phrasing* of the same underlying answer varied between
      // calls, sometimes tripping the regex and sometimes not.
      const unresolved = count === 0 || (claude?.escalate ?? false);
      await audit(user, "knowledge.search", "search", undefined, { query: safe, result_count: count, ai_used: Boolean(claude), unresolved });
      return json({ query: safe, answer: claude?.answer || (count ? `Verified results found for ${safe}. Use the official owner, channel and SLA below.` : "No confirmed answer was found. Report this question for owner review."), confidence: unresolved ? 0 : activities?.length ? .93 : .72, ai_used: Boolean(claude), activities: activities || [], modules: modules || [], mistakes: mistakes || [], resolved_queries: resolvedQueries || [], messages: (messages || []).map((m) => ({ id: m.id, title: m.title, description: m.description, message_subtype: m.message_subtype, url: m.external_url })), unresolved });
    }

    if (path === "/api/v1/feedback" && req.method === "POST") {
      const body = await req.json();
      // QA REMEDIATION BLOCKER 6: auto-route to the best-matching
      // department at submission time; an Admin can reassign it later.
      const departmentId = await autoRouteDepartmentId(user.org_id, `${body.query} ${body.reason || ""}`);
      const { data, error } = await supabase.from("knowledge_feedback").insert({ org_id: user.org_id, user_id: user.id, query: body.query, reason: body.reason, type: "query", routed_to: "Knowledge governance queue", department_id: departmentId }).select().single(); if (error) throw error; await audit(user, "feedback.create", "knowledge_feedback", data.id, departmentId ? { auto_routed_department_id: departmentId } : undefined); return json({ id: data.id, status: data.status, routed_to: data.routed_to, department_id: data.department_id }, 201);
    }

    // -------------------------------------------------------------------
    // BUILD PROMPT v5 BLOCK G: Suggestion & Query Engine — the general-
    // purpose suggestion flow (not tied to a specific rule; Block D's
    // rule_change_suggestions stays as the rule-specific version). Reuses
    // knowledge_feedback's query/reason columns: query holds the
    // suggestion's title/description, reason holds the category/context
    // — same columns, different meaning per type, same table either way.
    // -------------------------------------------------------------------
    if (path === "/api/v1/submissions" && req.method === "POST") {
      const body = await req.json();
      if (!body.description?.trim()) return fieldError("description", "Describe your suggestion.");
      const { data, error } = await supabase.from("knowledge_feedback").insert({ org_id: user.org_id, user_id: user.id, query: body.description.trim(), reason: body.category?.trim() || "general", type: "suggestion", status: "submitted", routed_to: "Suggestions & queries queue" }).select().single();
      if (error) throw error;
      await audit(user, "submission.create", "knowledge_feedback", data.id, { type: "suggestion" });
      return json({ id: data.id, status: data.status, routed_to: data.routed_to }, 201);
    }
    if (path === "/api/v1/submissions/mine" && req.method === "GET") {
      const { data, error } = await supabase.from("knowledge_feedback").select("id,type,query,reason,status,resolution,rejection_reason,target_implementation_date,created_at,resolved_at").eq("org_id", user.org_id).eq("user_id", user.id).order("created_at", { ascending: false });
      if (error) throw error;
      return json(data || []);
    }

    // -------------------------------------------------------------------
    // BUILD PROMPT v5 BLOCK F: org-wide default max quiz attempts — a
    // per-module override (training_modules.max_attempts) always wins
    // when set; this is only the fallback for modules that don't set one.
    // -------------------------------------------------------------------
    if (path === "/api/v1/admin/organization" && req.method === "GET") {
      const deny = forbidUnlessAdmin(isAdmin); if (deny) return deny;
      const { data } = await supabase.from("organizations").select("id,name,default_max_quiz_attempts").eq("id", user.org_id).maybeSingle();
      return json(data);
    }
    if (path === "/api/v1/admin/organization" && req.method === "PATCH") {
      const deny = forbidUnlessAdmin(isAdmin); if (deny) return deny;
      const body = await req.json();
      if (body.default_max_quiz_attempts !== undefined && Number(body.default_max_quiz_attempts) <= 0) return fieldError("default_max_quiz_attempts", "Must be greater than zero.");
      const { data, error } = await supabase.from("organizations").update({ default_max_quiz_attempts: Number(body.default_max_quiz_attempts) }).eq("id", user.org_id).select().maybeSingle();
      if (error) throw error;
      await audit(user, "organization.update", "organization", user.org_id, { default_max_quiz_attempts: data?.default_max_quiz_attempts }); return json(data);
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
    // -------------------------------------------------------------------
    // BUILD PROMPT v5 BLOCK A: admin side — invite candidates, see who's
    // acknowledged, edit the preview page's content blocks.
    // -------------------------------------------------------------------
    if (path === "/api/v1/admin/candidates" && req.method === "GET") {
      const deny = forbidUnlessAdmin(isAdmin); if (deny) return deny;
      const [{ data: candidates, error }, { data: departments }, { data: acks }] = await Promise.all([
        supabase.from("candidates").select("id,full_name,email,department_id,invite_token,status,created_at").eq("org_id", user.org_id).order("created_at", { ascending: false }),
        supabase.from("departments").select("id,name").eq("org_id", user.org_id),
        supabase.from("preboarding_acknowledgments").select("candidate_id,acknowledged_at"),
      ]);
      if (error) throw error;
      const deptById = new Map((departments || []).map((d) => [d.id, d.name]));
      const ackByCandidate = new Map((acks || []).map((a) => [a.candidate_id, a.acknowledged_at]));
      return json((candidates || []).map((c) => ({ ...c, department_name: c.department_id ? deptById.get(c.department_id) || null : null, acknowledged_at: ackByCandidate.get(c.id) || null })));
    }
    if (path === "/api/v1/admin/candidates" && req.method === "POST") {
      const deny = forbidUnlessAdmin(isAdmin); if (deny) return deny;
      const body = await req.json();
      if (!body.full_name?.trim()) return fieldError("full_name", "Full Name is required.");
      if (!body.email?.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) return fieldError("email", "Enter a valid Email ID.");
      const { data, error } = await supabase.from("candidates").insert({ org_id: user.org_id, full_name: body.full_name.trim(), email: body.email.trim().toLowerCase(), department_id: body.department_id || null, created_by: user.id }).select().single();
      if (error) return json({ detail: error.message?.includes("duplicate") ? "A candidate with this Email ID has already been invited." : "Could not create the invite." }, 409);
      await audit(user, "candidate.invite", "candidate", data.id, { email: data.email });
      return json(data, 201);
    }
    if (path === "/api/v1/admin/preboarding-content" && req.method === "GET") {
      const deny = forbidUnlessAdmin(isAdmin); if (deny) return deny;
      const { data } = await supabase.from("org_preboarding_content").select("block_key,body").eq("org_id", user.org_id);
      return json(Object.fromEntries((data || []).map((c) => [c.block_key, c.body])));
    }
    if (path === "/api/v1/admin/preboarding-content" && req.method === "PATCH") {
      const deny = forbidUnlessAdmin(isAdmin); if (deny) return deny;
      const body = await req.json();
      const allowed = ["welcome", "expectations_from_you", "expectations_from_us"];
      const rows = allowed.filter((k) => body[k] !== undefined).map((k) => ({ org_id: user.org_id, block_key: k, body: String(body[k]), updated_at: new Date().toISOString() }));
      if (!rows.length) return json({ detail: "Nothing to update." }, 400);
      const { error } = await supabase.from("org_preboarding_content").upsert(rows, { onConflict: "org_id,block_key" });
      if (error) throw error;
      await audit(user, "preboarding_content.update", "organization", user.org_id, { blocks: rows.map((r) => r.block_key) });
      return json({ ok: true });
    }

    // -------------------------------------------------------------------
    // BUILD PROMPT v5 BLOCK B: admin side — configure the stage-gated
    // onboarding journey. Stages are returned with their items nested
    // (one round trip covers the whole config screen); item CRUD is
    // scoped through the parent stage's org_id so an admin can never
    // touch another org's items even by guessing an id.
    // -------------------------------------------------------------------
    if (path === "/api/v1/admin/onboarding-stages" && req.method === "GET") {
      const deny = forbidUnlessAdmin(isAdmin); if (deny) return deny;
      const [{ data: stages, error }, { data: items }] = await Promise.all([
        supabase.from("onboarding_stages").select("id,name,description,sequence").eq("org_id", user.org_id).order("sequence"),
        supabase.from("onboarding_stage_items").select("id,stage_id,item_type,training_module_id,content_asset_id,title,description,sequence,onboarding_stages!inner(org_id),content_assets(title,kind,message_subtype)").eq("onboarding_stages.org_id", user.org_id).order("sequence"),
      ]);
      if (error) throw error;
      const itemsByStage = new Map<string, unknown[]>();
      for (const item of items || []) {
        const { onboarding_stages, content_assets, ...rest } = item as any;
        if (!itemsByStage.has(rest.stage_id)) itemsByStage.set(rest.stage_id, []);
        itemsByStage.get(rest.stage_id)!.push({ ...rest, content_asset: content_assets || null });
      }
      return json((stages || []).map((s) => ({ ...s, items: itemsByStage.get(s.id) || [] })));
    }
    if (path === "/api/v1/admin/onboarding-stages" && req.method === "POST") {
      const deny = forbidUnlessAdmin(isAdmin); if (deny) return deny;
      const body = await req.json();
      if (!body.name?.trim()) return fieldError("name", "Stage Name is required.");
      if (!Number.isInteger(body.sequence)) return fieldError("sequence", "Sequence is required.");
      const { data, error } = await supabase.from("onboarding_stages").insert({ org_id: user.org_id, name: body.name.trim(), description: body.description?.trim() || "", sequence: body.sequence }).select().single();
      if (error) return json({ detail: error.message?.includes("duplicate") ? "A stage already exists at that sequence position." : "Could not create the stage." }, 409);
      await audit(user, "onboarding_stage.create", "onboarding_stage", data.id); return json(data, 201);
    }
    const stageMatch = path.match(/^\/api\/v1\/admin\/onboarding-stages\/([^/]+)$/);
    if (stageMatch && req.method === "PATCH") {
      const deny = forbidUnlessAdmin(isAdmin); if (deny) return deny;
      const body = await req.json(); const patch: Record<string, unknown> = {};
      if (body.name !== undefined) patch.name = String(body.name).trim();
      if (body.description !== undefined) patch.description = String(body.description).trim();
      if (body.sequence !== undefined) patch.sequence = body.sequence;
      const { data, error } = await supabase.from("onboarding_stages").update(patch).eq("id", stageMatch[1]).eq("org_id", user.org_id).select().maybeSingle();
      if (error) return json({ detail: "A stage already exists at that sequence position." }, 409);
      if (!data) return json({ detail: "Stage not found." }, 404);
      await audit(user, "onboarding_stage.update", "onboarding_stage", data.id); return json(data);
    }
    if (stageMatch && req.method === "DELETE") {
      const deny = forbidUnlessAdmin(isAdmin); if (deny) return deny;
      const { data, error } = await supabase.from("onboarding_stages").delete().eq("id", stageMatch[1]).eq("org_id", user.org_id).select().maybeSingle();
      if (error) throw error;
      if (!data) return json({ detail: "Stage not found." }, 404);
      await audit(user, "onboarding_stage.delete", "onboarding_stage", stageMatch[1]); return json({ ok: true });
    }
    const stageItemsMatch = path.match(/^\/api\/v1\/admin\/onboarding-stages\/([^/]+)\/items$/);
    if (stageItemsMatch && req.method === "POST") {
      const deny = forbidUnlessAdmin(isAdmin); if (deny) return deny;
      const { data: stage } = await supabase.from("onboarding_stages").select("id").eq("id", stageItemsMatch[1]).eq("org_id", user.org_id).maybeSingle();
      if (!stage) return json({ detail: "Stage not found." }, 404);
      const body = await req.json();
      if (!["training_module", "content_block", "custom_task", "rules_ack"].includes(body.item_type)) return fieldError("item_type", "Choose a valid item type.");
      if (!body.title?.trim()) return fieldError("title", "Title is required.");
      if (!Number.isInteger(body.sequence)) return fieldError("sequence", "Sequence is required.");
      if (body.item_type === "training_module" && !body.training_module_id) return fieldError("training_module_id", "Select a Training Module.");
      // BUILD PROMPT v5 BLOCK C: a content_block item may optionally point
      // at a real Content Library asset (e.g. the Welcome Message) instead
      // of only carrying its own free-text title/description.
      const { data, error } = await supabase.from("onboarding_stage_items").insert({
        stage_id: stage.id, item_type: body.item_type,
        training_module_id: body.item_type === "training_module" ? body.training_module_id : null,
        content_asset_id: body.item_type === "content_block" ? body.content_asset_id || null : null,
        title: body.title.trim(), description: body.description?.trim() || "", sequence: body.sequence,
      }).select().single();
      if (error) return json({ detail: error.message?.includes("duplicate") ? "An item already exists at that sequence position." : "Could not create the item." }, 409);
      await audit(user, "onboarding_stage_item.create", "onboarding_stage_item", data.id); return json(data, 201);
    }
    const stageItemMatch = path.match(/^\/api\/v1\/admin\/onboarding-stage-items\/([^/]+)$/);
    if (stageItemMatch && (req.method === "PATCH" || req.method === "DELETE")) {
      const deny = forbidUnlessAdmin(isAdmin); if (deny) return deny;
      // Scope through the parent stage's org_id — this table has no
      // org_id column of its own.
      const { data: existing } = await supabase.from("onboarding_stage_items").select("id,stage_id,onboarding_stages!inner(org_id)").eq("id", stageItemMatch[1]).eq("onboarding_stages.org_id", user.org_id).maybeSingle();
      if (!existing) return json({ detail: "Item not found." }, 404);
      if (req.method === "DELETE") {
        const { error } = await supabase.from("onboarding_stage_items").delete().eq("id", stageItemMatch[1]);
        if (error) throw error;
        await audit(user, "onboarding_stage_item.delete", "onboarding_stage_item", stageItemMatch[1]); return json({ ok: true });
      }
      const body = await req.json(); const patch: Record<string, unknown> = {};
      if (body.title !== undefined) patch.title = String(body.title).trim();
      if (body.description !== undefined) patch.description = String(body.description).trim();
      if (body.sequence !== undefined) patch.sequence = body.sequence;
      // content_asset_id is only meaningful for content_block items; the
      // DB check constraint rejects it on any other type, so this only
      // needs to pass the value through, not gate it a second time here.
      if (body.content_asset_id !== undefined) patch.content_asset_id = body.content_asset_id || null;
      const { data, error } = await supabase.from("onboarding_stage_items").update(patch).eq("id", stageItemMatch[1]).select().maybeSingle();
      if (error) return json({ detail: "An item already exists at that sequence position." }, 409);
      await audit(user, "onboarding_stage_item.update", "onboarding_stage_item", data.id); return json(data);
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
    // BUILD PROMPT v5 item B3: bulk CSV import — admins will not
    // hand-create 200 employees one FormModal at a time. Column mapping
    // happens client-side (the browser already knows the CSV headers);
    // this route takes already-mapped rows and does the validation +
    // creation, returning a per-row report so a partial import (some
    // rows good, some bad) is visible rather than all-or-nothing.
    // Passwords are randomly generated — there's no invite-email
    // pipeline yet (deliberately out of scope, same as SSO), so a
    // freshly-imported account needs an admin-issued password reset
    // before that person can sign in. That limitation is surfaced in the
    // import UI copy, not hidden.
    if (path === "/api/v1/admin/employees/import" && req.method === "POST") {
      const deny = forbidUnlessAdmin(isAdmin); if (deny) return deny;
      const body = await req.json();
      const rows: any[] = Array.isArray(body.rows) ? body.rows : [];
      if (!rows.length) return json({ detail: "No rows to import." }, 400);
      if (rows.length > 500) return json({ detail: "Import is capped at 500 rows at a time." }, 400);
      const [{ data: departments }, { data: existingUsers }] = await Promise.all([
        supabase.from("departments").select("id,name").eq("org_id", user.org_id),
        supabase.from("app_users").select("id,email,full_name").eq("org_id", user.org_id),
      ]);
      const deptByLowerName = new Map((departments || []).map((d) => [d.name.toLowerCase(), d.id]));
      const userByLowerEmail = new Map((existingUsers || []).map((u) => [u.email.toLowerCase(), u.id]));
      const created: unknown[] = []; const errors: { row: number; email: string; message: string }[] = [];
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i]; const rowNum = i + 1;
        const fullName = String(r.full_name || "").trim();
        const email = String(r.email || "").trim().toLowerCase();
        const role = String(r.role || "employee").trim().toLowerCase() || "employee";
        const deptName = String(r.department || "").trim();
        const managerEmail = String(r.manager_email || "").trim().toLowerCase();
        if (!fullName) { errors.push({ row: rowNum, email, message: "Full Name is required." }); continue; }
        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { errors.push({ row: rowNum, email, message: "Invalid Email ID." }); continue; }
        if (userByLowerEmail.has(email)) { errors.push({ row: rowNum, email, message: "An employee with this Email ID already exists." }); continue; }
        if (!["employee", "manager", "content_admin", "admin"].includes(role)) { errors.push({ row: rowNum, email, message: `Unknown role "${role}".` }); continue; }
        let departmentId: string | null = null;
        if (deptName) {
          departmentId = deptByLowerName.get(deptName.toLowerCase()) || null;
          if (!departmentId) { errors.push({ row: rowNum, email, message: `Unknown department "${deptName}".` }); continue; }
        }
        let managerId: string | null = null;
        if (managerEmail) {
          managerId = userByLowerEmail.get(managerEmail) || null;
          if (!managerId) { errors.push({ row: rowNum, email, message: `Manager email "${managerEmail}" not found — import the manager first, or leave this blank and set it afterwards.` }); continue; }
        }
        const randomPassword = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
        const { data: newUser, error: createError } = await supabase.rpc("admin_create_user", { p_org_id: user.org_id, p_department_id: departmentId, p_email: email, p_full_name: fullName, p_role: role, p_password: randomPassword });
        const row = newUser?.[0];
        if (createError || !row) { errors.push({ row: rowNum, email, message: "Could not create this employee." }); continue; }
        if (managerId) await supabase.from("app_users").update({ manager_id: managerId }).eq("id", row.id).eq("org_id", user.org_id);
        userByLowerEmail.set(email, row.id); // so a later row can reference this one as its manager
        created.push(row);
      }
      if (created.length) {
        const { data: modules } = await supabase.from("training_modules").select("id,sequence").eq("org_id", user.org_id).order("sequence");
        if (modules?.length) {
          const enrollmentRows = (created as { id: string }[]).flatMap((u) => modules.map((m) => ({ org_id: user.org_id, user_id: u.id, module_id: m.id, status: m.sequence === 1 ? "assigned" : "locked", assigned_by: user.id, assigned_at: new Date().toISOString() })));
          await supabase.from("enrollments").insert(enrollmentRows);
        }
        await audit(user, "employee.bulk_import", "app_user", undefined, { created: created.length, errors: errors.length });
      }
      return json({ created: created.length, errors });
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
    // BUILD PROMPT v5 item B3: bulk CSV import for the Responsibility
    // Matrix — same shape as the employees import above (client-mapped
    // rows in, per-row created/error report out). "activity name already
    // exists" is a real per-row failure mode (unique constraint), not
    // swallowed into a generic 500.
    if (path === "/api/v1/admin/activities/import" && req.method === "POST") {
      const deny = forbidUnlessAdmin(isAdmin); if (deny) return deny;
      const body = await req.json();
      const rows: any[] = Array.isArray(body.rows) ? body.rows : [];
      if (!rows.length) return json({ detail: "No rows to import." }, 400);
      if (rows.length > 500) return json({ detail: "Import is capped at 500 rows at a time." }, 400);
      const required = ["name", "department", "responsible_role", "contact_details", "sla", "escalation_level_1", "escalation_level_2"];
      const created: unknown[] = []; const errors: { row: number; name: string; message: string }[] = [];
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i]; const rowNum = i + 1; const name = String(r.name || "").trim();
        const missing = required.find((f) => !String(r[f] || "").trim());
        if (missing) { errors.push({ row: rowNum, name, message: `${missing.replace(/_/g, " ")} is required.` }); continue; }
        const { data, error } = await supabase.from("activities").insert({
          org_id: user.org_id, name, department: String(r.department).trim(), responsible_role: String(r.responsible_role).trim(),
          current_person: String(r.current_person || "").trim() || "Organisation to confirm", backup_person: String(r.backup_person || "").trim() || "Department backup",
          contact_details: String(r.contact_details).trim(), sla: String(r.sla).trim(), escalation_level_1: String(r.escalation_level_1).trim(), escalation_level_2: String(r.escalation_level_2).trim(),
          sop_link: r.sop_link || null, training_module_link: r.training_module_link || null,
        }).select().single();
        if (error || !data) { errors.push({ row: rowNum, name, message: "An activity with this name already exists." }); continue; }
        created.push(data);
      }
      if (created.length) await audit(user, "activity.bulk_import", "activity", undefined, { created: created.length, errors: errors.length });
      return json({ created: created.length, errors });
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
      if (body.max_attempts !== undefined && body.max_attempts !== null && body.max_attempts !== "" && Number(body.max_attempts) <= 0) return fieldError("max_attempts", "Max Attempts must be greater than zero.");
      const { data: module, error } = await supabase.from("training_modules").insert({ org_id: user.org_id, code: body.code.trim().toUpperCase(), title: body.title.trim(), objective: body.objective.trim(), duration_minutes: Number(body.duration_minutes), content_type: body.content_type || "mixed", passing_score: Number(body.passing_score) || 80, refresher_months: Number(body.refresher_months) || 12, sequence, status: "draft", sop_url: body.sop_url?.trim() || null, sop_label: body.sop_label?.trim() || null, max_attempts: body.max_attempts ? Number(body.max_attempts) : null }).select().single();
      if (error) return json({ detail: "A module with this code already exists." }, 409);
      const { data: employees } = await supabase.from("app_users").select("id").eq("org_id", user.org_id).eq("role", "employee").eq("is_active", true);
      if (employees?.length) await supabase.from("enrollments").insert(employees.map((e) => ({ org_id: user.org_id, user_id: e.id, module_id: module.id, status: "locked", assigned_by: user.id, assigned_at: new Date().toISOString() })));
      await audit(user, "module.create", "training_module", module.id); return json(module, 201);
    }
    const moduleMatch = path.match(/^\/api\/v1\/admin\/training\/modules\/([^/]+)$/);
    if (moduleMatch && req.method === "PATCH") {
      const deny = forbidUnlessAdmin(isAdmin); if (deny) return deny;
      const body = await req.json(); const editable = ["title","objective","duration_minutes","content_type","passing_score","refresher_months","is_mandatory","status","sop_url","sop_label","max_attempts"];
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
      // QA REMEDIATION BLOCKER 2: how much this question counts toward
      // the module's overall score — defaults to 100 (full weight) when
      // not specified.
      if (body.weight_percent !== undefined && (typeof body.weight_percent !== "number" || body.weight_percent <= 0 || body.weight_percent > 100)) return fieldError("weight_percent", "Weight must be between 1 and 100.");
      const { data, error } = await supabase.from("quiz_questions").insert({ org_id: user.org_id, module_id: questionsMatch[1], prompt: body.prompt.trim(), options: body.options, correct_index: body.correct_index, explanation: body.explanation.trim(), weight_percent: body.weight_percent ?? 100 }).select().single();
      if (error) throw error; await audit(user, "question.create", "quiz_question", data.id); return json(data, 201);
    }
    const questionMatch = path.match(/^\/api\/v1\/admin\/training\/questions\/([^/]+)$/);
    if (questionMatch && req.method === "PATCH") {
      const deny = forbidUnlessAdmin(isAdmin); if (deny) return deny;
      const body = await req.json();
      if (body.weight_percent !== undefined && (typeof body.weight_percent !== "number" || body.weight_percent <= 0 || body.weight_percent > 100)) return fieldError("weight_percent", "Weight must be between 1 and 100.");
      const editable = ["prompt","options","correct_index","explanation","weight_percent"];
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
      let request = supabase.from("enrollments").select("id,status,progress_percent,best_score,due_date,completed_at,onboarding_blocked,app_users!enrollments_user_id_fkey(id,full_name,email),training_modules(id,title,code)", { count: "exact" }).eq("org_id", user.org_id);
      if (moduleId) request = request.eq("module_id", moduleId);
      const { data, error, count } = await request.order("due_date", { ascending: true, nullsFirst: false }).range(from, to); if (error) throw error;
      return json({ items: (data || []).map((item: any) => ({ id: item.id, status: item.status, progress_percent: item.progress_percent, best_score: item.best_score, due_date: item.due_date, completed_at: item.completed_at, onboarding_blocked: item.onboarding_blocked, employee: item.app_users, module: item.training_modules })), page, page_size: pageSize, total: count || 0 });
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
    // BUILD PROMPT v5 BLOCK F: a genuine reset — attempts_reset_at means
    // attempts before this moment stop counting towards the cap, and
    // onboarding_blocked clears, without deleting the real attempt log.
    const resetAttemptsMatch = path.match(/^\/api\/v1\/admin\/enrollments\/([^/]+)\/reset-attempts$/);
    if (resetAttemptsMatch && req.method === "POST") {
      const deny = forbidUnlessAdmin(isAdmin); if (deny) return deny;
      const { data, error } = await supabase.from("enrollments").update({ onboarding_blocked: false, attempts_reset_at: new Date().toISOString() }).eq("id", resetAttemptsMatch[1]).eq("org_id", user.org_id).select().maybeSingle();
      if (error) throw error; if (!data) return json({ detail: "Assignment not found." }, 404);
      await audit(user, "enrollment.reset_attempts", "enrollment", data.id); return json(data);
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
      const { page, pageSize, from, to } = paginate(rawUrl);
      const type = rawUrl.searchParams.get("type") || "query";
      const status = rawUrl.searchParams.get("status") || (type === "suggestion" ? "submitted" : "open");
      // QA REMEDIATION BLOCKER 6: department_id + its resolved name
      // surfaced to the queue, same "Applies To" pattern Rules already
      // uses for department_id -> department_name. Optional
      // ?department_id= filter so an admin can view just their
      // department's queue, not a single flat undifferentiated one.
      const departmentFilter = rawUrl.searchParams.get("department_id");
      let feedbackQuery = supabase.from("knowledge_feedback").select("id,type,query,reason,status,resolution,rejection_reason,target_implementation_date,department_id,created_at,resolved_at,app_users!knowledge_feedback_user_id_fkey(full_name)", { count: "exact" }).eq("org_id", user.org_id).eq("type", type).eq("status", status).order("created_at", { ascending: false }).range(from, to);
      if (departmentFilter) feedbackQuery = feedbackQuery.eq("department_id", departmentFilter);
      const [{ data, error, count }, { data: departments }] = await Promise.all([
        feedbackQuery,
        supabase.from("departments").select("id,name").eq("org_id", user.org_id),
      ]);
      if (error) throw error;
      const deptNameById = new Map((departments || []).map((d) => [d.id, d.name]));
      return json({ items: (data || []).map((item: any) => ({ id: item.id, type: item.type, query: item.query, reason: item.reason, status: item.status, resolution: item.resolution, rejection_reason: item.rejection_reason, target_implementation_date: item.target_implementation_date, department_id: item.department_id, department_name: item.department_id ? deptNameById.get(item.department_id) || null : null, created_at: item.created_at, resolved_at: item.resolved_at, employee: item.app_users?.full_name || "Unknown" })), page, page_size: pageSize, total: count || 0 });
    }
    const feedbackMatch = path.match(/^\/api\/v1\/admin\/feedback\/([^/]+)$/);
    if (feedbackMatch && req.method === "PATCH") {
      const deny = forbidUnlessAdmin(isAdmin); if (deny) return deny;
      const { data: existing } = await supabase.from("knowledge_feedback").select("id,type,user_id,query").eq("id", feedbackMatch[1]).eq("org_id", user.org_id).maybeSingle();
      if (!existing) return json({ detail: "Item not found." }, 404);
      const body = await req.json();
      const patch: Record<string, unknown> = {};
      // QA REMEDIATION BLOCKER 6: "or someone can then assign it to a
      // particular department" — reassignable independently of a status
      // change, so an admin can route a still-open query before ever
      // resolving it.
      if (body.department_id !== undefined) patch.department_id = body.department_id || null;
      if (body.status !== undefined) {
        patch.status = body.status;
        if (existing.type === "suggestion") {
          // BUILD PROMPT v5 BLOCK G: the same 5-state lifecycle Block D's
          // rule_change_suggestions uses. Mandatory rejection reason —
          // same rule as everywhere else rejection reasons are required.
          if (!["under_review","accepted","rejected","implementation_pending","implemented"].includes(body.status)) return fieldError("status", "Choose a valid status.");
          if (body.status === "rejected" && !body.rejection_reason?.trim()) return fieldError("rejection_reason", "A reason is required when rejecting a suggestion.");
          if (body.status === "rejected") patch.rejection_reason = body.rejection_reason.trim();
          if (body.target_implementation_date !== undefined) patch.target_implementation_date = body.target_implementation_date || null;
          patch.resolved_by = user.id; patch.resolved_at = new Date().toISOString();
        } else {
          if (!["resolved","dismissed","in_review"].includes(body.status)) return fieldError("status", "Select a valid status.");
          if (body.status !== "in_review" && !body.resolution?.trim()) return fieldError("resolution", "Resolution notes are required.");
          if (body.status !== "in_review") { patch.resolution = body.resolution.trim(); patch.resolved_by = user.id; patch.resolved_at = new Date().toISOString(); }
        }
      }
      if (!Object.keys(patch).length) return fieldError("status", "Nothing to update.");
      const { data, error } = await supabase.from("knowledge_feedback").update(patch).eq("id", feedbackMatch[1]).select().maybeSingle();
      if (error) throw error; if (!data) return json({ detail: "Item not found." }, 404);
      // Notify the submitter only on a real status change — a pure
      // department reassignment isn't news to them.
      if (body.status !== undefined) {
        await supabase.from("notification_outbox").insert({ org_id: user.org_id, user_id: existing.user_id, kind: "submission_update", subject: `Your ${existing.type} "${existing.query.slice(0, 60)}" is now ${String(body.status).replace(/_/g, " ")}.`, payload: { submission_id: data.id, status: body.status } });
      }
      await audit(user, existing.type === "suggestion" ? "submission.review" : "feedback.resolve", "knowledge_feedback", data.id, { status: body.status, department_id: body.department_id }); return json(data);
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
      let request = supabase.from("content_assets").select("id,kind,title,description,department,file_name,mime_type,size_bytes,version,status,external_url,message_subtype,sop_url,sop_label,created_at", { count: "exact" }).eq("org_id", user.org_id);
      if (kind) request = request.eq("kind", kind);
      const { data, error, count } = await request.order("created_at", { ascending: false }).range(from, to); if (error) throw error;
      return json({ items: data || [], page, page_size: pageSize, total: count || 0 });
    }
    if (path === "/api/v1/admin/content/upload-url" && req.method === "POST") {
      const deny = forbidUnlessAdmin(isAdmin); if (deny) return deny;
      const body = await req.json();
      if (!body.file_name?.trim()) return fieldError("file_name", "Choose a file to upload.");
      if (!body.title?.trim()) return fieldError("title", "Title is required.");
      if (!["document","video","audio","sop","mistake_register","template","image","onboarding_message"].includes(body.kind)) return fieldError("kind", "Select a valid content type.");
      const messageSubtypeError = validateMessageSubtype(body.kind, body.message_subtype);
      if (messageSubtypeError) return messageSubtypeError;
      const safeName = body.file_name.trim().replace(/[^a-zA-Z0-9_.-]/g, "-");
      const storagePath = `${user.org_id}/${body.kind}/${crypto.randomUUID()}-${safeName}`;
      const { data: signed, error: signError } = await supabase.storage.from(CONTENT_BUCKET).createSignedUploadUrl(storagePath);
      if (signError || !signed) return json({ detail: "Could not prepare the upload. Try again." }, 502);
      const { data: asset, error } = await supabase.from("content_assets").insert({ org_id: user.org_id, kind: body.kind, message_subtype: body.kind === "onboarding_message" ? body.message_subtype : null, title: body.title.trim(), description: body.description?.trim() || null, department: body.department || null, storage_path: storagePath, file_name: safeName, mime_type: body.mime_type || "application/octet-stream", size_bytes: Number(body.size_bytes) || 0, sop_url: body.sop_url?.trim() || null, sop_label: body.sop_label?.trim() || null, uploaded_by: user.id, status: "pending" }).select().single();
      if (error) throw error;
      return json({ asset_id: asset.id, upload_url: signed.signedUrl, storage_path: storagePath }, 201);
    }
    if (path === "/api/v1/admin/content/external" && req.method === "POST") {
      const deny = forbidUnlessAdmin(isAdmin); if (deny) return deny;
      const body = await req.json();
      if (!body.title?.trim()) return fieldError("title", "Title is required.");
      if (!body.external_url?.trim() || !/^https?:\/\//i.test(body.external_url.trim())) return fieldError("external_url", "Enter a valid link starting with http:// or https://.");
      if (!["document","video","audio","sop","template","image","onboarding_message"].includes(body.kind)) return fieldError("kind", "Select a valid content type.");
      const messageSubtypeError = validateMessageSubtype(body.kind, body.message_subtype);
      if (messageSubtypeError) return messageSubtypeError;
      const { data: asset, error } = await supabase.from("content_assets").insert({ org_id: user.org_id, kind: body.kind, message_subtype: body.kind === "onboarding_message" ? body.message_subtype : null, title: body.title.trim(), description: body.description?.trim() || null, department: body.department || null, external_url: body.external_url.trim(), sop_url: body.sop_url?.trim() || null, sop_label: body.sop_label?.trim() || null, uploaded_by: user.id, status: "ready" }).select().single();
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
    // BUILD PROMPT v5 BLOCK D: Rules & Regulations — admin side. Rules are
    // versioned: creating a rule creates version 1 and publishes it in the
    // same call (an unpublished rule is pointless — nobody can be gated on
    // it); editing content always creates a NEW version rather than
    // mutating the old one, so read-tracking never silently misattributes
    // "read v1" as "read v2".
    // -------------------------------------------------------------------
    if (path === "/api/v1/admin/rules" && req.method === "GET") {
      const deny = forbidUnlessAdmin(isAdmin); if (deny) return deny;
      const [{ data: rules, error }, { data: departments }, { data: versions }] = await Promise.all([
        supabase.from("rules").select("id,department_id,title,category,is_mandatory,status,published_version_id,sop_url,sop_label,attachment_asset_id,content_assets(title,kind,external_url,storage_path),created_at").eq("org_id", user.org_id).order("created_at", { ascending: false }),
        supabase.from("departments").select("id,name").eq("org_id", user.org_id),
        supabase.from("rule_versions").select("id,rule_id,version,body,created_at").order("version", { ascending: false }),
      ]);
      if (error) throw error;
      const deptById = new Map((departments || []).map((d) => [d.id, d.name]));
      const versionById = new Map((versions || []).map((v) => [v.id, v]));
      return json((rules || []).map((r: any) => { const { content_assets, ...rest } = r; return { ...rest, department_name: r.department_id ? deptById.get(r.department_id) || null : null, published_version: r.published_version_id ? versionById.get(r.published_version_id) || null : null, attachment: content_assets || null }; }));
    }
    if (path === "/api/v1/admin/rules" && req.method === "POST") {
      const deny = forbidUnlessAdmin(isAdmin); if (deny) return deny;
      const body = await req.json();
      if (!body.title?.trim()) return fieldError("title", "Title is required.");
      if (!body.body?.trim()) return fieldError("body", "Rule content is required.");
      const { data: rule, error } = await supabase.from("rules").insert({ org_id: user.org_id, department_id: body.department_id || null, title: body.title.trim(), category: body.category?.trim() || "general", is_mandatory: body.is_mandatory !== false, sop_url: body.sop_url?.trim() || null, sop_label: body.sop_label?.trim() || null, attachment_asset_id: body.attachment_asset_id || null, created_by: user.id }).select().single();
      if (error) throw error;
      const { data: version, error: vError } = await supabase.from("rule_versions").insert({ rule_id: rule.id, version: 1, body: body.body.trim(), created_by: user.id }).select().single();
      if (vError) throw vError;
      await supabase.from("rules").update({ published_version_id: version.id }).eq("id", rule.id);
      await audit(user, "rule.create", "rule", rule.id, { title: rule.title }); return json({ ...rule, published_version_id: version.id }, 201);
    }
    const ruleMatch = path.match(/^\/api\/v1\/admin\/rules\/([^/]+)$/);
    if (ruleMatch && req.method === "PATCH") {
      const deny = forbidUnlessAdmin(isAdmin); if (deny) return deny;
      const body = await req.json(); const patch: Record<string, unknown> = {};
      if (body.title !== undefined) patch.title = String(body.title).trim();
      if (body.category !== undefined) patch.category = String(body.category).trim();
      if (body.department_id !== undefined) patch.department_id = body.department_id || null;
      if (body.is_mandatory !== undefined) patch.is_mandatory = Boolean(body.is_mandatory);
      if (body.status !== undefined) patch.status = body.status;
      if (body.sop_url !== undefined) patch.sop_url = String(body.sop_url).trim() || null;
      if (body.sop_label !== undefined) patch.sop_label = String(body.sop_label).trim() || null;
      if (body.attachment_asset_id !== undefined) patch.attachment_asset_id = body.attachment_asset_id || null;
      // QA REMEDIATION BLOCKER 4: management's words — "how do I change
      // an existing rule?" — with the expectation that editing it (title,
      // category, or content) is a real, tracked change: it must bump the
      // version and require everyone who already acknowledged the old one
      // to re-acknowledge. Previously the Edit dialog didn't even have a
      // body field, and editing title/category via PATCH silently left
      // published_version_id untouched — a title correction looked
      // identical to a no-op to every employee's read status. Now every
      // edit through this route creates a new rule_versions row (read
      // tracking is keyed by rule_version_id, so a new version id is what
      // actually clears everyone's read status — no separate "reset
      // reads" table needed). The standalone "New Version" action
      // (POST .../versions) still exists unchanged for a content-only
      // publish that doesn't touch title/category/etc.
      if (body.body !== undefined && !String(body.body).trim()) return fieldError("body", "Rule content is required.");
      const { data: existing } = await supabase.from("rules").select("id,published_version_id").eq("id", ruleMatch[1]).eq("org_id", user.org_id).maybeSingle();
      if (!existing) return json({ detail: "Rule not found." }, 404);
      let newVersionId: string | undefined;
      const newBody = body.body !== undefined ? String(body.body).trim() : undefined;
      if (newBody !== undefined) {
        const { data: latest } = await supabase.from("rule_versions").select("version").eq("rule_id", existing.id).order("version", { ascending: false }).limit(1).maybeSingle();
        const nextVersion = (latest?.version || 0) + 1;
        const { data: version, error: vError } = await supabase.from("rule_versions").insert({ rule_id: existing.id, version: nextVersion, body: newBody, created_by: user.id }).select().single();
        if (vError) throw vError;
        newVersionId = version.id;
        patch.published_version_id = version.id;
      }
      const { data, error } = await supabase.from("rules").update(patch).eq("id", ruleMatch[1]).eq("org_id", user.org_id).select().maybeSingle();
      if (error) throw error; if (!data) return json({ detail: "Rule not found." }, 404);
      await audit(user, "rule.update", "rule", data.id, newVersionId ? { new_version_id: newVersionId } : undefined); return json(data);
    }
    // A content-only publish, kept separate from the general Edit dialog
    // above for admins who just want to push a body update without
    // touching any metadata.
    const ruleVersionMatch = path.match(/^\/api\/v1\/admin\/rules\/([^/]+)\/versions$/);
    if (ruleVersionMatch && req.method === "POST") {
      const deny = forbidUnlessAdmin(isAdmin); if (deny) return deny;
      const { data: rule } = await supabase.from("rules").select("id").eq("id", ruleVersionMatch[1]).eq("org_id", user.org_id).maybeSingle();
      if (!rule) return json({ detail: "Rule not found." }, 404);
      const body = await req.json();
      if (!body.body?.trim()) return fieldError("body", "Rule content is required.");
      const { data: latest } = await supabase.from("rule_versions").select("version").eq("rule_id", rule.id).order("version", { ascending: false }).limit(1).maybeSingle();
      const nextVersion = (latest?.version || 0) + 1;
      const { data: version, error } = await supabase.from("rule_versions").insert({ rule_id: rule.id, version: nextVersion, body: body.body.trim(), created_by: user.id }).select().single();
      if (error) throw error;
      await supabase.from("rules").update({ published_version_id: version.id }).eq("id", rule.id);
      await audit(user, "rule.new_version", "rule", rule.id, { version: nextVersion }); return json(version, 201);
    }
    if (path === "/api/v1/admin/rule-suggestions" && req.method === "GET") {
      const deny = forbidUnlessAdmin(isAdmin); if (deny) return deny;
      const status = rawUrl.searchParams.get("status");
      let request = supabase.from("rule_change_suggestions").select("id,rule_id,suggested_by,suggestion_text,status,rejection_reason,target_implementation_date,reviewed_at,created_at,rules!inner(org_id,title),app_users!rule_change_suggestions_suggested_by_fkey(full_name)").eq("rules.org_id", user.org_id);
      if (status) request = request.eq("status", status);
      const { data, error } = await request.order("created_at", { ascending: false });
      if (error) throw error;
      return json((data || []).map((s: any) => ({ ...s, rule_title: s.rules?.title, suggested_by_name: s.app_users?.full_name, rules: undefined, app_users: undefined })));
    }
    const suggestionMatch = path.match(/^\/api\/v1\/admin\/rule-suggestions\/([^/]+)$/);
    if (suggestionMatch && req.method === "PATCH") {
      const deny = forbidUnlessAdmin(isAdmin); if (deny) return deny;
      const { data: existing } = await supabase.from("rule_change_suggestions").select("id,rule_id,rules!inner(org_id)").eq("id", suggestionMatch[1]).eq("rules.org_id", user.org_id).maybeSingle();
      if (!existing) return json({ detail: "Suggestion not found." }, 404);
      const body = await req.json();
      if (!["under_review", "accepted", "rejected", "implementation_pending", "implemented"].includes(body.status)) return fieldError("status", "Choose a valid status.");
      if (body.status === "rejected" && !body.rejection_reason?.trim()) return fieldError("rejection_reason", "A reason is required when rejecting a suggestion.");
      const patch: Record<string, unknown> = { status: body.status, reviewed_by: user.id, reviewed_at: new Date().toISOString() };
      if (body.status === "rejected") patch.rejection_reason = body.rejection_reason.trim();
      if (body.target_implementation_date !== undefined) patch.target_implementation_date = body.target_implementation_date || null;
      const { data, error } = await supabase.from("rule_change_suggestions").update(patch).eq("id", suggestionMatch[1]).select().single();
      if (error) throw error;
      await audit(user, "rule_suggestion.review", "rule_change_suggestion", data.id, { status: data.status }); return json(data);
    }

    // -------------------------------------------------------------------
    // BUILD PROMPT v5 BLOCK D: Rules & Regulations — employee side.
    // Visibility is department-scoped: a rule with department_id = null
    // applies org-wide; otherwise only to that department.
    // -------------------------------------------------------------------
    if (path === "/api/v1/rules" && req.method === "GET") {
      // BUILD PROMPT v5 BLOCK I: content_assets(...) resolves a rule's
      // attached video/audio/image/document, same as Block C's
      // content_block resolution — a real attachment, not just a link.
      const [{ data: rules, error }, { data: reads }] = await Promise.all([
        supabase.from("rules").select("id,department_id,title,category,is_mandatory,published_version_id,sop_url,sop_label,attachment_asset_id,content_assets(title,kind,external_url,storage_path),rule_versions!rules_published_version_id_fkey(id,version,body,created_at)").eq("org_id", user.org_id).eq("status", "active").or(`department_id.is.null,department_id.eq.${user.department_id || "00000000-0000-0000-0000-000000000000"}`),
        supabase.from("rule_reads").select("rule_version_id").eq("user_id", user.id),
      ]);
      if (error) throw error;
      const readVersionIds = new Set((reads || []).map((r) => r.rule_version_id));
      const shaped = await Promise.all((rules || []).map(async (r: any) => {
        let attachmentUrl: string | null = r.content_assets?.external_url || null;
        if (!attachmentUrl && r.content_assets?.storage_path) {
          const { data: signed } = await supabase.storage.from(CONTENT_BUCKET).createSignedUrl(r.content_assets.storage_path, 3600);
          attachmentUrl = signed?.signedUrl || null;
        }
        return {
          id: r.id, title: r.title, category: r.category, is_mandatory: r.is_mandatory,
          version_id: r.rule_versions?.id || null, version: r.rule_versions?.version || null, body: r.rule_versions?.body || null,
          sop_url: r.sop_url || null, sop_label: r.sop_label || null,
          attachment: r.content_assets ? { title: r.content_assets.title, kind: r.content_assets.kind, url: attachmentUrl } : null,
          read: r.rule_versions?.id ? readVersionIds.has(r.rule_versions.id) : false,
        };
      }));
      return json(shaped);
    }
    const ruleReadMatch = path.match(/^\/api\/v1\/rules\/versions\/([^/]+)\/read$/);
    if (ruleReadMatch && req.method === "POST") {
      // Idempotent — same pattern as every other "mark as done" route in
      // this app (Block A's acknowledge, Block B's item-complete).
      const { error } = await supabase.from("rule_reads").upsert({ rule_version_id: ruleReadMatch[1], user_id: user.id }, { onConflict: "rule_version_id,user_id", ignoreDuplicates: true });
      if (error) throw error;
      return json({ ok: true });
    }
    const ruleSuggestMatch = path.match(/^\/api\/v1\/rules\/([^/]+)\/suggest$/);
    if (ruleSuggestMatch && req.method === "POST") {
      const { data: rule } = await supabase.from("rules").select("id").eq("id", ruleSuggestMatch[1]).eq("org_id", user.org_id).maybeSingle();
      if (!rule) return json({ detail: "Rule not found." }, 404);
      const body = await req.json();
      if (!body.suggestion_text?.trim()) return fieldError("suggestion_text", "Describe your suggested change.");
      const { data, error } = await supabase.from("rule_change_suggestions").insert({ rule_id: rule.id, suggested_by: user.id, suggestion_text: body.suggestion_text.trim() }).select().single();
      if (error) throw error;
      return json(data, 201);
    }
    if (path === "/api/v1/rules/my-suggestions" && req.method === "GET") {
      const { data, error } = await supabase.from("rule_change_suggestions").select("id,rule_id,suggestion_text,status,rejection_reason,target_implementation_date,created_at,rules(title)").eq("suggested_by", user.id).order("created_at", { ascending: false });
      if (error) throw error;
      return json((data || []).map((s: any) => ({ ...s, rule_title: s.rules?.title, rules: undefined })));
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
