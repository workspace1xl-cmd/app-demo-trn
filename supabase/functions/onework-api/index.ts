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

function forbidUnlessAdmin(isAdmin: boolean) {
  return isAdmin ? null : json({ detail: "Administrator permission required." }, 403);
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
      return json({ access_token: token, token_type: "bearer", user: { id: user.id, name: user.full_name, email: user.email, role: user.role, org_id: user.org_id } });
    }
    const user = await authenticate(req);
    if (!user) return json({ detail: "Authentication required." }, 401);
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
      const query = rawUrl.searchParams.get("q");
      let request = supabase.from("activities").select("*").eq("org_id", user.org_id).order("department").order("name");
      if (query) request = request.ilike("name", `%${query.replace(/[%_,]/g, " ")}%`);
      const { data, error } = await request; if (error) throw error; return json(data);
    }

    if (path === "/api/v1/sops" && req.method === "GET") {
      const { data, error } = await supabase.from("sop_documents").select("*").eq("org_id", user.org_id).order("code"); if (error) throw error; return json(data);
    }

    if (path === "/api/v1/training/modules" && req.method === "GET") {
      const [{ data: modules, error }, { data: enrollment }] = await Promise.all([supabase.from("training_modules").select("*").eq("org_id", user.org_id).order("sequence"), supabase.from("enrollments").select("module_id,status,progress_percent,best_score,completed_at,due_date").eq("org_id", user.org_id).eq("user_id", user.id)]);
      if (error) throw error; const progress = new Map(enrollment?.map((item) => [item.module_id, item])); return json(modules?.map((module) => ({ ...module, progress: progress.get(module.id) || null })) || []);
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
      const sopFilters = searchTerms.flatMap((term) => [`title.ilike.%${term}%`, `summary.ilike.%${term}%`, `department.ilike.%${term}%`]).join(",");
      const moduleFilters = searchTerms.flatMap((term) => [`title.ilike.%${term}%`, `objective.ilike.%${term}%`, `code.ilike.%${term}%`]).join(",");
      const mistakeFilters = searchTerms.flatMap((term) => [`title.ilike.%${term}%`, `description.ilike.%${term}%`, `category.ilike.%${term}%`]).join(",");
      const [{ data: activities }, { data: sops }, { data: modules }, { data: mistakes }] = await Promise.all([
        supabase.from("activities").select("*").eq("org_id", user.org_id).or(activityFilters).limit(5),
        supabase.from("sop_documents").select("*").eq("org_id", user.org_id).or(sopFilters).limit(5),
        supabase.from("training_modules").select("*").eq("org_id", user.org_id).or(moduleFilters).limit(5),
        supabase.from("mistake_register").select("code,title,description,correct_practice,severity").eq("org_id", user.org_id).eq("status", "active").or(mistakeFilters).limit(3),
      ]);
      const context = [...(activities || []).map((a) => `Activity: ${a.name}; owner ${a.responsible_role}; contact ${a.contact_details}; SLA ${a.sla}; escalation ${a.escalation_level_1} then ${a.escalation_level_2}`), ...(sops || []).map((s) => `SOP: ${s.code} ${s.title}; ${s.summary}`), ...(modules || []).map((m) => `Training: ${m.code} ${m.title}; ${m.objective}`), ...(mistakes || []).map((mk) => `Common mistake ${mk.code}: ${mk.title}. ${mk.description} Correct practice: ${mk.correct_practice}`)].join("\n");
      const answer = await claudeAnswer(safe, context); const count = (activities?.length || 0) + (sops?.length || 0) + (modules?.length || 0) + (mistakes?.length || 0);
      await audit(user, "knowledge.search", "search", undefined, { query: safe, result_count: count, ai_used: Boolean(answer) });
      return json({ query: safe, answer: answer || (count ? `Verified results found for ${safe}. Use the official owner, channel and SLA below.` : "No confirmed answer was found. Report this question for owner review."), confidence: activities?.length ? .93 : count ? .72 : 0, ai_used: Boolean(answer), activities: activities || [], sops: sops || [], modules: modules || [], mistakes: mistakes || [], unresolved: count === 0 });
    }

    if (path === "/api/v1/feedback" && req.method === "POST") {
      const body = await req.json(); const { data, error } = await supabase.from("knowledge_feedback").insert({ org_id: user.org_id, user_id: user.id, query: body.query, reason: body.reason, routed_to: "Knowledge governance queue" }).select().single(); if (error) throw error; await audit(user, "feedback.create", "knowledge_feedback", data.id); return json({ id: data.id, status: data.status, routed_to: data.routed_to }, 201);
    }

    // -------------------------------------------------------------------
    // Administrator: dashboard analytics
    // -------------------------------------------------------------------
    if (path === "/api/v1/admin/analytics") {
      const deny = forbidUnlessAdmin(isAdmin); if (deny) return deny;
      const [employees, enrollment, certificates, attempts, feedback, activities, sops] = await Promise.all([supabase.from("app_users").select("id", { count: "exact", head: true }).eq("org_id", user.org_id).eq("role", "employee"), supabase.from("enrollments").select("status").eq("org_id", user.org_id), supabase.from("certificates").select("id", { count: "exact", head: true }).eq("org_id", user.org_id), supabase.from("quiz_attempts").select("score").eq("org_id", user.org_id), supabase.from("knowledge_feedback").select("id", { count: "exact", head: true }).eq("org_id", user.org_id).eq("status", "open"), supabase.from("activities").select("id", { count: "exact", head: true }).eq("org_id", user.org_id), supabase.from("sop_documents").select("id", { count: "exact", head: true }).eq("org_id", user.org_id)]);
      const total = enrollment.data?.length || 0, complete = enrollment.data?.filter((item) => item.status === "completed").length || 0, scores = attempts.data?.map((item) => item.score) || [];
      return json({ employees: employees.count || 0, training_completion: total ? Math.round(complete / total * 100) : 0, certificates: certificates.count || 0, average_quiz_score: scores.length ? Math.round(scores.reduce((a,b)=>a+b,0)/scores.length*10)/10 : 0, open_feedback: feedback.count || 0, activities: activities.count || 0, sops: sops.count || 0 });
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
      const { data, error } = await supabase.from("departments").select("id,name,code,created_at").eq("org_id", user.org_id).order("name"); if (error) throw error; return json(data);
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
    if (path === "/api/v1/admin/employees" && req.method === "GET") {
      const deny = forbidUnlessAdmin(isAdmin); if (deny) return deny;
      const { page, pageSize, from, to } = paginate(rawUrl); const query = rawUrl.searchParams.get("q");
      let request = supabase.from("app_users").select("id,email,full_name,role,is_active,created_at,department_id,departments(name)", { count: "exact" }).eq("org_id", user.org_id);
      if (query) request = request.or(`full_name.ilike.%${query}%,email.ilike.%${query}%`);
      const { data, error, count } = await request.order("full_name").range(from, to); if (error) throw error;
      return json({ items: (data || []).map((item: any) => ({ ...item, department_name: item.departments?.name || null, departments: undefined })), page, page_size: pageSize, total: count || 0 });
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
      if (body.role !== undefined) { if (!["employee","manager","content_admin","admin"].includes(body.role)) return fieldError("role", "Select a valid role."); patch.role = body.role; }
      if (body.is_active !== undefined) patch.is_active = Boolean(body.is_active);
      if (Object.keys(patch).length) {
        const { data, error } = await supabase.from("app_users").update(patch).eq("id", employeeMatch[1]).eq("org_id", user.org_id).select("id,email,full_name,role,is_active,department_id").maybeSingle();
        if (error) throw error; if (!data) return json({ detail: "Employee not found." }, 404);
        await audit(user, "employee.update", "app_user", data.id, patch);
      }
      if (body.password) {
        if (body.password.length < 8) return fieldError("password", "Password must be at least 8 characters.");
        const { data: ok } = await supabase.rpc("admin_set_password", { p_org_id: user.org_id, p_user_id: employeeMatch[1], p_password: body.password });
        if (!ok) return json({ detail: "Employee not found." }, 404);
        await audit(user, "employee.reset_password", "app_user", employeeMatch[1]);
      }
      const { data: fresh, error: freshError } = await supabase.from("app_users").select("id,email,full_name,role,is_active,department_id").eq("id", employeeMatch[1]).eq("org_id", user.org_id).maybeSingle();
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

    // -------------------------------------------------------------------
    // Administrator: SOP editor and approval workflow
    // -------------------------------------------------------------------
    if (path === "/api/v1/admin/sops" && req.method === "POST") {
      const deny = forbidUnlessAdmin(isAdmin); if (deny) return deny;
      const body = await req.json();
      for (const field of ["code","title","department","owner_role","approver_role","summary"]) {
        if (!body[field]?.toString().trim()) return fieldError(field, `${field.replace(/_/g, " ")} is required.`);
      }
      const { data, error } = await supabase.from("sop_documents").insert({ org_id: user.org_id, code: body.code.trim().toUpperCase(), title: body.title.trim(), department: body.department.trim(), owner_role: body.owner_role.trim(), approver_role: body.approver_role.trim(), summary: body.summary.trim(), content: body.content || {}, status: "draft" }).select().single();
      if (error) return json({ detail: "An SOP with this code already exists." }, 409);
      await audit(user, "sop.create", "sop", data.id); return json(data, 201);
    }
    const sopMatch = path.match(/^\/api\/v1\/admin\/sops\/([^/]+)$/);
    if (sopMatch && req.method === "PATCH") {
      const deny = forbidUnlessAdmin(isAdmin); if (deny) return deny;
      const body = await req.json(); const editable = ["title","department","owner_role","approver_role","summary","content","version"];
      const patch: Record<string, unknown> = {}; for (const key of editable) if (body[key] !== undefined) patch[key] = body[key];
      const { data, error } = await supabase.from("sop_documents").update(patch).eq("id", sopMatch[1]).eq("org_id", user.org_id).select().maybeSingle();
      if (error) throw error; if (!data) return json({ detail: "SOP not found." }, 404);
      await audit(user, "sop.update", "sop", data.id); return json(data);
    }
    const sopWorkflowMatch = path.match(/^\/api\/v1\/admin\/sops\/([^/]+)\/(submit|approve|retire)$/);
    if (sopWorkflowMatch && req.method === "POST") {
      const deny = forbidUnlessAdmin(isAdmin); if (deny) return deny;
      const [, sopId, action] = sopWorkflowMatch;
      const { data: sop } = await supabase.from("sop_documents").select("*").eq("id", sopId).eq("org_id", user.org_id).maybeSingle();
      if (!sop) return json({ detail: "SOP not found." }, 404);
      const transitions: Record<string, { from: string[]; to: string; patch: Record<string, unknown> }> = {
        submit: { from: ["draft"], to: "in_review", patch: { submitted_by: user.id, submitted_at: new Date().toISOString() } },
        approve: { from: ["in_review"], to: "effective", patch: { approved_by: user.id, approved_at: new Date().toISOString(), effective_date: new Date().toISOString().slice(0,10), review_date: new Date(Date.now() + 180 * 86400000).toISOString().slice(0,10) } },
        retire: { from: ["effective","approved"], to: "archived", patch: {} },
      };
      const transition = transitions[action];
      if (!transition.from.includes(sop.status)) return json({ detail: `An SOP in ${sop.status} status cannot be ${action === "submit" ? "submitted" : action === "approve" ? "approved" : "retired"}.` }, 409);
      const { data, error } = await supabase.from("sop_documents").update({ status: transition.to, ...transition.patch }).eq("id", sopId).select().single();
      if (error) throw error; await audit(user, `sop.${action}`, "sop", sopId, { status: transition.to }); return json(data);
    }

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
      let request = supabase.from("enrollments").select("id,status,progress_percent,best_score,due_date,completed_at,app_users(id,full_name,email),training_modules(id,title,code)", { count: "exact" }).eq("org_id", user.org_id);
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
      const { data, error, count } = await supabase.from("knowledge_feedback").select("id,query,reason,status,resolution,created_at,resolved_at,app_users(full_name)", { count: "exact" }).eq("org_id", user.org_id).eq("status", status).order("created_at", { ascending: false }).range(from, to);
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
      let request = supabase.from("content_assets").select("id,kind,title,description,department,file_name,mime_type,size_bytes,version,status,created_at", { count: "exact" }).eq("org_id", user.org_id);
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
      const { data: asset } = await supabase.from("content_assets").select("storage_path").eq("id", contentDownloadMatch[1]).eq("org_id", user.org_id).maybeSingle();
      if (!asset) return json({ detail: "Asset not found." }, 404);
      const { data: signed, error } = await supabase.storage.from(CONTENT_BUCKET).createSignedUrl(asset.storage_path, 600);
      if (error || !signed) return json({ detail: "Could not prepare the download." }, 502);
      return json({ download_url: signed.signedUrl });
    }
    const contentMatch = path.match(/^\/api\/v1\/admin\/content\/([^/]+)$/);
    if (contentMatch && req.method === "DELETE") {
      const deny = forbidUnlessAdmin(isAdmin); if (deny) return deny;
      const { data: asset } = await supabase.from("content_assets").select("storage_path").eq("id", contentMatch[1]).eq("org_id", user.org_id).maybeSingle();
      if (!asset) return json({ detail: "Asset not found." }, 404);
      await supabase.storage.from(CONTENT_BUCKET).remove([asset.storage_path]);
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
