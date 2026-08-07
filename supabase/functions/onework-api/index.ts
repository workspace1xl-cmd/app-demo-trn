import { createClient } from "npm:@supabase/supabase-js@2";

const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "GET,POST,OPTIONS" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

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

async function claudeAnswer(question: string, context: string) {
  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key || !context) return null;
  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" }, body: JSON.stringify({ model: Deno.env.get("ANTHROPIC_MODEL") || "claude-sonnet-4-5", max_tokens: 500, messages: [{ role: "user", content: `Answer only from the verified organisational context. If it is insufficient, say the question must be escalated.\nQuestion: ${question}\nContext:\n${context}` }] }) });
    if (!response.ok) return null;
    const payload = await response.json();
    return payload.content?.filter((block: { type: string }) => block.type === "text").map((block: { text: string }) => block.text).join("\n") || null;
  } catch { return null; }
}

async function audit(user: any, action: string, entityType: string, entityId?: string, details: Record<string, unknown> = {}) {
  await supabase.from("audit_events").insert({ org_id: user.org_id, actor_user_id: user.id, action, entity_type: entityType, entity_id: entityId || null, details });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const rawPath = new URL(req.url).pathname;
  const path = rawPath.includes("/onework-api/") ? rawPath.slice(rawPath.indexOf("/onework-api") + "/onework-api".length) : rawPath;
  try {
    if (path === "/health") return json({ status: "healthy", service: "onework-cloud-api", time: new Date().toISOString() });
    if (path === "/api/v1/auth/login" && req.method === "POST") {
      const { email, password, organization = "example-organisation" } = await req.json();
      const { data, error } = await supabase.rpc("authenticate_onework_user", { p_email: email, p_password: password, p_org_slug: organization });
      const user = data?.[0];
      if (error || !user) return json({ detail: "Incorrect email or password" }, 401);
      const token = `${crypto.randomUUID()}${crypto.randomUUID()}`.replaceAll("-", "");
      await supabase.from("sessions").insert({ org_id: user.org_id, user_id: user.id, token_hash: await sha256(token), expires_at: new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString() });
      await audit(user, "auth.login", "user", user.id);
      return json({ access_token: token, token_type: "bearer", user: { id: user.id, name: user.full_name, email: user.email, role: user.role, org_id: user.org_id } });
    }
    const user = await authenticate(req);
    if (!user) return json({ detail: "Authentication required" }, 401);
    const isAdmin = ["admin", "content_admin"].includes(user.role);

    if (path === "/api/v1/me") return json({ id: user.id, org_id: user.org_id, name: user.full_name, email: user.email, role: user.role, department_id: user.department_id });

    if (path === "/api/v1/dashboard") {
      const [{ data: enrollment }, { count: certificateCount }] = await Promise.all([
        supabase.from("enrollments").select("status,best_score").eq("org_id", user.org_id).eq("user_id", user.id),
        supabase.from("certificates").select("id", { count: "exact", head: true }).eq("org_id", user.org_id).eq("user_id", user.id),
      ]);
      const total = enrollment?.length || 0, completed = enrollment?.filter((item) => item.status === "completed").length || 0;
      return json({ user: { name: user.full_name, role: user.role }, training: { completed, total, percent: total ? Math.round(completed / total * 100) : 0 }, certificates: certificateCount || 0, points: enrollment?.reduce((sum, item) => sum + (item.best_score || 0) * 5, 0) || 0, open_actions: enrollment?.filter((item) => ["assigned", "in_progress"].includes(item.status)).length || 0 });
    }

    if (path === "/api/v1/activities" && req.method === "GET") {
      const query = new URL(req.url).searchParams.get("q");
      let request = supabase.from("activities").select("*").eq("org_id", user.org_id).order("department").order("name");
      if (query) request = request.ilike("name", `%${query.replace(/[%_,]/g, " ")}%`);
      const { data, error } = await request; if (error) throw error; return json(data);
    }

    if (path === "/api/v1/sops" && req.method === "GET") {
      const { data, error } = await supabase.from("sop_documents").select("*").eq("org_id", user.org_id).order("code"); if (error) throw error; return json(data);
    }

    if (path === "/api/v1/training/modules" && req.method === "GET") {
      const [{ data: modules, error }, { data: enrollment }] = await Promise.all([supabase.from("training_modules").select("*").eq("org_id", user.org_id).order("sequence"), supabase.from("enrollments").select("module_id,status,progress_percent,best_score,completed_at").eq("org_id", user.org_id).eq("user_id", user.id)]);
      if (error) throw error; const progress = new Map(enrollment?.map((item) => [item.module_id, item])); return json(modules?.map((module) => ({ ...module, progress: progress.get(module.id) || null })) || []);
    }

    const quizMatch = path.match(/^\/api\/v1\/training\/modules\/([^/]+)\/quiz$/);
    if (quizMatch && req.method === "GET") {
      const { data: module } = await supabase.from("training_modules").select("id,title,passing_score").eq("id", quizMatch[1]).eq("org_id", user.org_id).maybeSingle();
      if (!module) return json({ detail: "Module not found" }, 404);
      const { data: questions } = await supabase.from("quiz_questions").select("id,prompt,options").eq("org_id", user.org_id).eq("module_id", module.id).order("created_at");
      return json({ module_id: module.id, title: module.title, passing_score: module.passing_score, questions: questions || [] });
    }

    const attemptMatch = path.match(/^\/api\/v1\/training\/modules\/([^/]+)\/attempt$/);
    if (attemptMatch && req.method === "POST") {
      const { answers } = await req.json();
      const [{ data: module }, { data: questions }] = await Promise.all([supabase.from("training_modules").select("*").eq("id", attemptMatch[1]).eq("org_id", user.org_id).maybeSingle(), supabase.from("quiz_questions").select("correct_index,explanation").eq("org_id", user.org_id).eq("module_id", attemptMatch[1]).order("created_at")]);
      if (!module) return json({ detail: "Module not found" }, 404);
      if (!questions?.length || answers?.length !== questions.length) return json({ detail: "Submit one answer for every question" }, 400);
      const correct = questions.filter((question, index) => question.correct_index === answers[index]).length, score = Math.round(correct / questions.length * 100), passed = score >= module.passing_score;
      await supabase.from("quiz_attempts").insert({ org_id: user.org_id, user_id: user.id, module_id: module.id, score, passed, answers });
      const { data: enrollment } = await supabase.from("enrollments").select("id,best_score").eq("org_id", user.org_id).eq("user_id", user.id).eq("module_id", module.id).maybeSingle();
      if (enrollment) await supabase.from("enrollments").update({ best_score: Math.max(enrollment.best_score || 0, score), ...(passed ? { status: "completed", progress_percent: 100, completed_at: new Date().toISOString() } : {}) }).eq("id", enrollment.id);
      if (passed) {
        await supabase.from("certificates").upsert({ org_id: user.org_id, user_id: user.id, module_id: module.id, certificate_number: `OW-${module.code}-${Date.now()}`, issued_at: new Date().toISOString().slice(0,10), expires_at: new Date(Date.now() + module.refresher_months * 30 * 86400000).toISOString().slice(0,10) }, { onConflict: "org_id,user_id,module_id", ignoreDuplicates: true });
        const { data: next } = await supabase.from("training_modules").select("id").eq("org_id", user.org_id).eq("sequence", module.sequence + 1).maybeSingle();
        if (next) await supabase.from("enrollments").update({ status: "assigned" }).eq("org_id", user.org_id).eq("user_id", user.id).eq("module_id", next.id).eq("status", "locked");
      }
      await audit(user, "quiz.submit", "training_module", module.id, { score, passed }); return json({ score, passed, passing_score: module.passing_score, correct, total: questions.length, explanations: questions.map((q) => q.explanation) });
    }

    if (path === "/api/v1/certificates") {
      const { data, error } = await supabase.from("certificates").select("id,certificate_number,issued_at,expires_at,training_modules(title)").eq("org_id", user.org_id).eq("user_id", user.id).order("issued_at", { ascending: false }); if (error) throw error;
      return json(data?.map((item: any) => ({ id: item.id, certificate_number: item.certificate_number, issued_at: item.issued_at, expires_at: item.expires_at, module: item.training_modules?.title })) || []);
    }

    if (path === "/api/v1/search" && req.method === "POST") {
      const { query } = await req.json(); const safe = String(query || "").replace(/[%_,]/g, " ").trim();
      if (safe.length < 2) return json({ detail: "Question is too short" }, 400);
      const stopWords = new Set(["a", "an", "and", "can", "do", "does", "for", "how", "i", "is", "my", "of", "process", "request", "the", "to", "what", "where", "who"]);
      const terms = safe.toLowerCase().split(/\s+/).map((term) => term.replace(/[^a-z0-9-]/g, "")).filter((term) => term.length > 2 && !stopWords.has(term)).slice(0, 6);
      const searchTerms = terms.length ? terms : [safe.toLowerCase()];
      const activityFilters = searchTerms.flatMap((term) => [`name.ilike.%${term}%`, `department.ilike.%${term}%`, `responsible_role.ilike.%${term}%`]).join(",");
      const sopFilters = searchTerms.flatMap((term) => [`title.ilike.%${term}%`, `summary.ilike.%${term}%`, `department.ilike.%${term}%`]).join(",");
      const moduleFilters = searchTerms.flatMap((term) => [`title.ilike.%${term}%`, `objective.ilike.%${term}%`, `code.ilike.%${term}%`]).join(",");
      const [{ data: activities }, { data: sops }, { data: modules }] = await Promise.all([
        supabase.from("activities").select("*").eq("org_id", user.org_id).or(activityFilters).limit(5),
        supabase.from("sop_documents").select("*").eq("org_id", user.org_id).or(sopFilters).limit(5),
        supabase.from("training_modules").select("*").eq("org_id", user.org_id).or(moduleFilters).limit(5),
      ]);
      const context = [...(activities || []).map((a) => `Activity: ${a.name}; owner ${a.responsible_role}; contact ${a.contact_details}; SLA ${a.sla}; escalation ${a.escalation_level_1} then ${a.escalation_level_2}`), ...(sops || []).map((s) => `SOP: ${s.code} ${s.title}; ${s.summary}`), ...(modules || []).map((m) => `Training: ${m.code} ${m.title}; ${m.objective}`)].join("\n");
      const answer = await claudeAnswer(safe, context); const count = (activities?.length || 0) + (sops?.length || 0) + (modules?.length || 0);
      await audit(user, "knowledge.search", "search", undefined, { query: safe, result_count: count, ai_used: Boolean(answer) });
      return json({ query: safe, answer: answer || (count ? `Verified results found for ${safe}. Use the official owner, channel and SLA below.` : "No confirmed answer was found. Report this question for owner review."), confidence: activities?.length ? .93 : count ? .72 : 0, ai_used: Boolean(answer), activities: activities || [], sops: sops || [], modules: modules || [], unresolved: count === 0 });
    }

    if (path === "/api/v1/feedback" && req.method === "POST") {
      const body = await req.json(); const { data, error } = await supabase.from("knowledge_feedback").insert({ org_id: user.org_id, user_id: user.id, query: body.query, reason: body.reason, routed_to: "Knowledge governance queue" }).select().single(); if (error) throw error; await audit(user, "feedback.create", "knowledge_feedback", data.id); return json({ id: data.id, status: data.status, routed_to: data.routed_to }, 201);
    }

    if (path === "/api/v1/admin/analytics") {
      if (!isAdmin) return json({ detail: "Administrator permission required" }, 403);
      const [employees, enrollment, certificates, attempts, feedback, activities, sops] = await Promise.all([supabase.from("app_users").select("id", { count: "exact", head: true }).eq("org_id", user.org_id).eq("role", "employee"), supabase.from("enrollments").select("status").eq("org_id", user.org_id), supabase.from("certificates").select("id", { count: "exact", head: true }).eq("org_id", user.org_id), supabase.from("quiz_attempts").select("score").eq("org_id", user.org_id), supabase.from("knowledge_feedback").select("id", { count: "exact", head: true }).eq("org_id", user.org_id).eq("status", "open"), supabase.from("activities").select("id", { count: "exact", head: true }).eq("org_id", user.org_id), supabase.from("sop_documents").select("id", { count: "exact", head: true }).eq("org_id", user.org_id)]);
      const total = enrollment.data?.length || 0, complete = enrollment.data?.filter((item) => item.status === "completed").length || 0, scores = attempts.data?.map((item) => item.score) || [];
      return json({ employees: employees.count || 0, training_completion: total ? Math.round(complete / total * 100) : 0, certificates: certificates.count || 0, average_quiz_score: scores.length ? Math.round(scores.reduce((a,b)=>a+b,0)/scores.length*10)/10 : 0, open_feedback: feedback.count || 0, activities: activities.count || 0, sops: sops.count || 0 });
    }
    return json({ detail: "Route not found" }, 404);
  } catch (error) {
    console.error(error); return json({ detail: "The service could not complete the request" }, 500);
  }
});
