"use client";

import { useEffect, useMemo, useState } from "react";
import styles from "./platform.module.css";
import { API, request } from "./PlatformApp";
import type { AdminSection } from "./PlatformApp";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

type Paged<T> = { items: T[]; page: number; page_size: number; total: number };

function parseApiError(body: unknown): { message: string; field?: string } {
  const obj = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const d = obj.detail;
  if (typeof d === "string") return { message: d, field: typeof obj.field === "string" ? obj.field : undefined };
  if (Array.isArray(d) && d[0] && typeof d[0] === "object") {
    const first = d[0] as Record<string, unknown>;
    const loc = Array.isArray(first.loc) ? (first.loc as unknown[]) : undefined;
    return { message: typeof first.msg === "string" ? first.msg : "Invalid value.", field: loc?.length ? String(loc[loc.length - 1]) : undefined };
  }
  if (d && typeof d === "object") {
    const nested = d as Record<string, unknown>;
    return { message: typeof nested.detail === "string" ? nested.detail : "Request failed.", field: typeof nested.field === "string" ? nested.field : undefined };
  }
  return { message: "Request failed." };
}

async function submitJson(path: string, token: string, method: string, body?: unknown) {
  let response: Response;
  try {
    response = await fetch(`${API}${path}`, {
      method,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    // Same rationale as request() in page.tsx: don't let a raw browser
    // network-error string ("Failed to fetch") reach the admin console.
    throw new Error("Could not reach the server. Check your connection and try again.");
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const parsed = parseApiError(data);
    const error = new Error(parsed.message) as Error & { field?: string };
    error.field = parsed.field;
    throw error;
  }
  return data;
}

function formatDate(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

const STATUS_TONE: Record<string, string> = {
  draft: "neutral", pending: "neutral", queued: "neutral", locked: "neutral",
  in_review: "warning", assigned: "info", in_progress: "info", processing: "info",
  effective: "success", published: "success", completed: "success", ready: "success",
  active: "success", resolved: "success", approved: "success",
  archived: "danger", failed: "danger", dismissed: "danger", waived: "danger",
  open: "warning",
};

function StatusBadge({ status }: { status?: string | null }) {
  if (!status) return <span>—</span>;
  return (
    <span className={styles.badge} data-tone={STATUS_TONE[status] || "neutral"}>
      {status.replace(/_/g, " ")}
    </span>
  );
}

function useLookup<T>(token: string, path: string): T[] {
  const [items, setItems] = useState<T[]>([]);
  useEffect(() => {
    let cancelled = false;
    request<T[]>(path, token).then((data) => { if (!cancelled) setItems(data); }).catch(() => {});
    return () => { cancelled = true; };
  }, [token, path]);
  return items;
}

// ---------------------------------------------------------------------------
// Pagination
// ---------------------------------------------------------------------------

function Pagination({ page, pageSize, total, onPage, onPageSize }: { page: number; pageSize: number; total: number; onPage: (p: number) => void; onPageSize: (s: number) => void }) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  return (
    <div className={styles.pagination}>
      <span className="pageInfo" style={{ fontSize: 8, color: "#8b8f9e" }}>
        {total === 0 ? "Showing 0 records" : `Showing ${from}–${to} of ${total} records`}
      </span>
      <div className={styles.pageControls}>
        <select value={pageSize} onChange={(e) => onPageSize(Number(e.target.value))} aria-label="Records per page">
          {[10, 20, 50, 100].map((size) => (
            <option key={size} value={size}>{size} / page</option>
          ))}
        </select>
        <button type="button" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page">‹</button>
        <button type="button" disabled={page >= totalPages} onClick={() => onPage(page + 1)} aria-label="Next page">›</button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Data table
// ---------------------------------------------------------------------------

type Column<T> = { key: string; label: string; render?: (row: T) => React.ReactNode };

function DataTable<T>({ columns, rows, rowId, loading, actions }: { columns: Column<T>[]; rows: T[]; rowId: (row: T) => string; loading: boolean; actions?: (row: T) => React.ReactNode }) {
  if (loading) return <div className={styles.loading}>Synchronising verified data…</div>;
  if (!rows.length) return <div className={styles.noRecords}>No records found.</div>;
  return (
    <div className={styles.dataTable}>
      <table>
        <thead>
          <tr>
            <th>SR. No.</th>
            {columns.map((column) => <th key={column.key}>{column.label}</th>)}
            {actions && <th>{"Actions"}</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={rowId(row)}>
              <td>{index + 1}</td>
              {columns.map((column) => (
                <td key={column.key}>{column.render ? column.render(row) : String((row as Record<string, unknown>)[column.key] ?? "—")}</td>
              ))}
              {actions && <td>{actions(row)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Modal shell, confirm dialog, feedback banner
// ---------------------------------------------------------------------------

function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className={styles.modalOverlay} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={styles.modalPanel} data-wide={wide ? "true" : "false"}>
        <div className={styles.modalHeader}>
          <h3>{title}</h3>
          <button type="button" onClick={onClose} aria-label="Close">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function ConfirmDialog({ title, message, busy, onCancel, onConfirm }: { title: string; message: string; busy: boolean; onCancel: () => void; onConfirm: () => void }) {
  return (
    <Modal title={title} onClose={onCancel}>
      <div className={styles.confirmPanel}>
        <p>{message}</p>
        <div className={styles.confirmActions}>
          <button type="button" className={styles.secondaryBtn} onClick={onCancel}>Cancel</button>
          <button type="button" className={styles.dangerBtn} disabled={busy} onClick={onConfirm}>{busy ? "Deleting…" : "Delete"}</button>
        </div>
      </div>
    </Modal>
  );
}

function Feedback({ error, toast }: { error?: string; toast?: string }) {
  return (
    <>
      {error && <div className={styles.error}>{error}</div>}
      {toast && <div className={styles.toast}>✓ {toast}</div>}
    </>
  );
}

// ---------------------------------------------------------------------------
// Generic field-driven form
// ---------------------------------------------------------------------------

type FieldDef = {
  key: string;
  label: string;
  type: "text" | "textarea" | "select" | "number" | "date" | "password" | "email";
  required?: boolean;
  options?: { value: string; label: string }[];
  placeholder?: string;
  minLength?: number;
  helpText?: string;
};

function FieldRenderer({ field, value, error, onChange }: { field: FieldDef; value: string | undefined; error?: string; onChange: (value: string) => void }) {
  const invalid = Boolean(error);
  return (
    <div className={styles.field} data-invalid={invalid ? "true" : "false"}>
      <label>
        {field.label}
        {field.required && <span className={styles.required}>*</span>}
      </label>
      {field.type === "textarea" && (
        <textarea value={value ?? ""} placeholder={field.placeholder} onChange={(e) => onChange(e.target.value)} />
      )}
      {field.type === "select" && (
        <select value={value ?? ""} onChange={(e) => onChange(e.target.value)}>
          <option value="">Select {field.label}</option>
          {field.options?.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      )}
      {["text", "number", "date", "password", "email"].includes(field.type) && (
        <input
          type={field.type}
          value={value ?? ""}
          placeholder={field.placeholder || (field.type !== "date" ? `Enter ${field.label}` : "DD/MM/YYYY")}
          minLength={field.minLength}
          // Without this, browsers may silently offer/insert a saved or
          // generated credential into an admin-facing password field with
          // no keystroke from the person filling out the form — the field
          // ends up non-empty (so "required" never fires) with a value
          // nobody chose. new-password stops that; off suppresses the
          // browser's unrelated autofill (name/date/etc.) suggestions.
          autoComplete={field.type === "password" ? "new-password" : "off"}
          onChange={(e) => onChange(field.type === "number" ? e.target.value : e.target.value)}
        />
      )}
      {field.helpText && !error && <p className={styles.fieldError} style={{ color: "#8b8f9e" }}>{field.helpText}</p>}
      {error && <p className={styles.fieldError}>{error}</p>}
    </div>
  );
}

function validateFields(fields: FieldDef[], values: Record<string, string>): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const field of fields) {
    const value = values[field.key];
    if (field.required && (value === undefined || value === null || String(value).trim() === "")) {
      errors[field.key] = `${field.label} is required.`;
      continue;
    }
    if (field.type === "email" && value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      errors[field.key] = "Enter a valid Email ID.";
    }
    if (field.minLength && value && String(value).length < field.minLength) {
      errors[field.key] = `${field.label} must be at least ${field.minLength} characters.`;
    }
    if (value && !String(value).trim() && field.required) {
      errors[field.key] = `${field.label} is required.`;
    }
  }
  return errors;
}

function FormModal({ title, fields, initialValues, submitLabel, onCancel, onSubmit }: {
  title: string;
  fields: FieldDef[];
  initialValues: Record<string, string | number | boolean | null | undefined>;
  submitLabel: string;
  onCancel: () => void;
  onSubmit: (values: Record<string, string>) => Promise<void>;
}) {
  const [values, setValues] = useState<Record<string, string>>(() => {
    const normalised: Record<string, string> = {};
    for (const [key, raw] of Object.entries(initialValues)) normalised[key] = raw === null || raw === undefined ? "" : String(raw);
    return normalised;
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState("");

  async function handleSubmit() {
    const clientErrors = validateFields(fields, values);
    if (Object.keys(clientErrors).length) { setErrors(clientErrors); return; }
    setBusy(true); setBanner(""); setErrors({});
    try {
      // Only submit the keys this form actually edits. `values` is seeded
      // from the full row (initialValues) so every other column — content,
      // id, org_id, created_at, anything not rendered as a field — rode
      // along too, coerced through String(). For a non-primitive column
      // like a SOP's JSON `content`, that silently overwrote it with the
      // literal text "[object Object]" on every save.
      const editableKeys = fields.map((f) => f.key);
      const payload = Object.fromEntries(editableKeys.map((key) => [key, values[key]]));
      await onSubmit(payload);
    } catch (error) {
      const err = error as Error & { field?: string };
      if (err.field) setErrors({ [err.field]: err.message.endsWith(".") ? err.message : `${err.message}.` });
      else setBanner(err.message.endsWith(".") ? err.message : `${err.message}.`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={title} onClose={onCancel} wide={fields.length > 4}>
      <div className={styles.modalBody}>
        {banner && <div className={styles.error}>{banner}</div>}
        <div className={styles.formGrid} data-single={fields.length <= 2 ? "true" : "false"}>
          {fields.map((field) => (
            <FieldRenderer
              key={field.key}
              field={field}
              value={values[field.key]}
              error={errors[field.key]}
              onChange={(value) => setValues((prev) => ({ ...prev, [field.key]: value }))}
            />
          ))}
        </div>
      </div>
      <div className={styles.modalFooter}>
        <button type="button" className={styles.secondaryBtn} onClick={onCancel}>Cancel</button>
        <button type="button" className={styles.primaryBtn} disabled={busy} onClick={handleSubmit}>
          {busy ? "Saving…" : submitLabel}
        </button>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Paginated / client-side list hooks
// ---------------------------------------------------------------------------

function usePagedList<T>(token: string, buildPath: (page: number, size: number, q: string) => string, reloadKey: number, filterKey: string | number = "") {
  const [items, setItems] = useState<T[]>([]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [total, setTotal] = useState(0);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // `buildPath` closes over each caller's own filter state (statusFilter,
  // moduleFilter, kindFilter, ...), but the fetch effect below never
  // depended on any of that — only on page/pageSize/q/reloadKey/token —
  // so switching tabs (e.g. Feedback Queue's open/in review/resolved/
  // dismissed) changed the URL buildPath *would* produce without ever
  // re-running the effect that calls it. The list just kept showing
  // whatever the first fetch returned. `filterKey` is the caller's own
  // filter value, passed in explicitly so it's a real dependency.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setLoading(true); setError("");
      request<Paged<T>>(buildPath(page, pageSize, q), token)
        .then((res) => { setItems(res.items); setTotal(res.total); })
        .catch((e) => setError(e instanceof Error ? e.message : "Could not load records."))
        .finally(() => setLoading(false));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [token, page, pageSize, q, reloadKey, filterKey]); // eslint-disable-line react-hooks/exhaustive-deps

  return { items, page, setPage, pageSize, setPageSize: (s: number) => { setPageSize(s); setPage(1); }, total, q, setQ: (v: string) => { setQ(v); setPage(1); }, loading, error };
}

function useClientList<T>(token: string, path: string, searchFields: (keyof T)[], reloadKey: number) {
  const [all, setAll] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setLoading(true); setError("");
      request<T[]>(path, token).then(setAll).catch((e) => setError(e instanceof Error ? e.message : "Could not load records.")).finally(() => setLoading(false));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [token, path, reloadKey]);

  const filtered = useMemo(() => {
    if (!q) return all;
    const needle = q.toLowerCase();
    return all.filter((row) => searchFields.some((field) => String((row as Record<string, unknown>)[field as string] || "").toLowerCase().includes(needle)));
  }, [all, q, searchFields]);

  const total = filtered.length;
  const items = filtered.slice((page - 1) * pageSize, (page - 1) * pageSize + pageSize);
  return { items, all, page, setPage, pageSize, setPageSize: (s: number) => { setPageSize(s); setPage(1); }, total, q, setQ: (v: string) => { setQ(v); setPage(1); }, loading, error };
}

// ---------------------------------------------------------------------------
// Toolbar
// ---------------------------------------------------------------------------

function Toolbar({ q, onSearch, placeholder, createLabel, onCreate }: { q: string; onSearch: (v: string) => void; placeholder: string; createLabel?: string; onCreate?: () => void }) {
  return (
    <div className={styles.toolbar}>
      <div className={styles.searchBox}>
        <input value={q} placeholder={placeholder} onChange={(e) => onSearch(e.target.value)} />
        {q && <button type="button" className={styles.clearBtn} onClick={() => onSearch("")} aria-label="Clear search">✕</button>}
      </div>
      {createLabel && onCreate && <button type="button" className={styles.primaryBtn} onClick={onCreate}>{createLabel}</button>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Departments
// ---------------------------------------------------------------------------

type Department = { id: string; name: string; code: string };

function DepartmentsPanel({ token }: { token: string }) {
  const [reloadKey, setReloadKey] = useState(0);
  const list = useClientList<Department>(token, "/api/v1/admin/departments", ["name", "code"], reloadKey);
  const [modal, setModal] = useState<null | { mode: "create" | "edit"; row?: Department }>(null);
  const [toast, setToast] = useState("");

  const fields: FieldDef[] = [
    { key: "name", label: "Department Name", type: "text", required: true },
    { key: "code", label: "Department Code", type: "text", required: true, placeholder: "e.g. HR" },
  ];

  return (
    <section>
      <Toolbar q={list.q} onSearch={list.setQ} placeholder="Search departments" createLabel="+ Add Department" onCreate={() => setModal({ mode: "create" })} />
      <Feedback error={list.error} toast={toast} />
      <DataTable
        columns={[{ key: "name", label: "Department Name" }, { key: "code", label: "Department Code" }]}
        rows={list.items}
        rowId={(row) => row.id}
        loading={list.loading}
        actions={(row) => (
          <button className={styles.iconBtn} data-tip="Edit" onClick={() => setModal({ mode: "edit", row })}>✎</button>
        )}
      />
      <Pagination page={list.page} pageSize={list.pageSize} total={list.total} onPage={list.setPage} onPageSize={list.setPageSize} />
      {modal && (
        <FormModal
          title={modal.mode === "create" ? "Add Department" : `Edit ${modal.row?.name}`}
          fields={fields}
          initialValues={modal.row ? { name: modal.row.name, code: modal.row.code } : {}}
          submitLabel={modal.mode === "create" ? "Create Department" : "Save Changes"}
          onCancel={() => setModal(null)}
          onSubmit={async (values) => {
            if (modal.mode === "create") await submitJson("/api/v1/admin/departments", token, "POST", values);
            else await submitJson(`/api/v1/admin/departments/${modal.row!.id}`, token, "PATCH", values);
            setToast(`Department ${modal.mode === "create" ? "created" : "updated"} successfully.`);
            setTimeout(() => setToast(""), 3000);
            setModal(null); setReloadKey((k) => k + 1);
          }}
        />
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Employees
// ---------------------------------------------------------------------------

type Employee = { id: string; full_name: string; email: string; role: string; is_active: boolean; department_id: string | null; department_name: string | null };

const ROLE_OPTIONS = [
  { value: "employee", label: "Employee" },
  { value: "manager", label: "Manager" },
  { value: "content_admin", label: "Content Admin" },
  { value: "admin", label: "Admin" },
];

function EmployeesPanel({ token }: { token: string }) {
  const [reloadKey, setReloadKey] = useState(0);
  const list = usePagedList<Employee>(token, (page, size, q) => `/api/v1/admin/employees?page=${page}&page_size=${size}${q ? `&q=${encodeURIComponent(q)}` : ""}`, reloadKey);
  const departments = useLookup<Department>(token, "/api/v1/admin/departments");
  const [modal, setModal] = useState<null | { mode: "create" | "edit"; row?: Employee }>(null);
  const [toast, setToast] = useState("");

  const departmentOptions = departments.map((d) => ({ value: d.id, label: d.name }));

  const createFields: FieldDef[] = [
    { key: "full_name", label: "Full Name", type: "text", required: true },
    { key: "email", label: "Email ID", type: "email", required: true },
    { key: "password", label: "Password", type: "password", required: true, minLength: 8, helpText: "At least 8 characters." },
    { key: "role", label: "Role", type: "select", required: true, options: ROLE_OPTIONS },
    { key: "department_id", label: "Department", type: "select", options: departmentOptions },
  ];
  const editFields: FieldDef[] = [
    { key: "full_name", label: "Full Name", type: "text", required: true },
    { key: "role", label: "Role", type: "select", required: true, options: ROLE_OPTIONS },
    { key: "department_id", label: "Department", type: "select", options: departmentOptions },
    { key: "is_active", label: "Status", type: "select", required: true, options: [{ value: "true", label: "Active" }, { value: "false", label: "Inactive" }] },
    { key: "password", label: "Reset Password", type: "password", minLength: 8, helpText: "Leave blank to keep the current password." },
  ];

  return (
    <section>
      <Toolbar q={list.q} onSearch={list.setQ} placeholder="Search by name or Email ID" createLabel="+ Add Employee" onCreate={() => setModal({ mode: "create" })} />
      <Feedback error={list.error} toast={toast} />
      <DataTable
        columns={[
          { key: "full_name", label: "Full Name", render: (row) => (<><b>{row.full_name}</b><small>{row.email}</small></>) },
          { key: "department_name", label: "Department" },
          { key: "role", label: "Role", render: (row) => <StatusBadge status={row.role} /> },
          { key: "is_active", label: "Status", render: (row) => <StatusBadge status={row.is_active ? "active" : "archived"} /> },
        ]}
        rows={list.items}
        rowId={(row) => row.id}
        loading={list.loading}
        actions={(row) => (
          <button className={styles.iconBtn} data-tip="Edit" onClick={() => setModal({ mode: "edit", row })}>✎</button>
        )}
      />
      <Pagination page={list.page} pageSize={list.pageSize} total={list.total} onPage={list.setPage} onPageSize={list.setPageSize} />
      {modal && (
        <FormModal
          title={modal.mode === "create" ? "Add Employee" : `Edit ${modal.row?.full_name}`}
          fields={modal.mode === "create" ? createFields : editFields}
          initialValues={modal.row ? { full_name: modal.row.full_name, role: modal.row.role, department_id: modal.row.department_id || "", is_active: String(modal.row.is_active) } : { role: "employee" }}
          submitLabel={modal.mode === "create" ? "Create Employee" : "Save Changes"}
          onCancel={() => setModal(null)}
          onSubmit={async (values) => {
            const payload: Record<string, unknown> = { ...values };
            if (modal.mode === "edit") payload.is_active = values.is_active === "true";
            if (!payload.password) delete payload.password;
            if (modal.mode === "create") await submitJson("/api/v1/admin/employees", token, "POST", payload);
            else await submitJson(`/api/v1/admin/employees/${modal.row!.id}`, token, "PATCH", payload);
            setToast(`Employee ${modal.mode === "create" ? "created" : "updated"} successfully.`);
            setTimeout(() => setToast(""), 3000);
            setModal(null); setReloadKey((k) => k + 1);
          }}
        />
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Responsibility matrix
// ---------------------------------------------------------------------------

type Activity = {
  id: string; name: string; department: string; responsible_role: string; current_person: string; backup_person: string;
  contact_details: string; sla: string; escalation_level_1: string; escalation_level_2: string; sop_link?: string; training_module_link?: string; status: string;
};

function MatrixPanel({ token }: { token: string }) {
  const [reloadKey, setReloadKey] = useState(0);
  const list = useClientList<Activity>(token, "/api/v1/activities", ["name", "department", "responsible_role"], reloadKey);
  const [modal, setModal] = useState<null | { mode: "create" | "edit"; row?: Activity }>(null);
  const [toast, setToast] = useState("");

  const fields: FieldDef[] = [
    { key: "name", label: "Activity Name", type: "text", required: true },
    { key: "department", label: "Department", type: "text", required: true },
    { key: "responsible_role", label: "Responsible Role", type: "text", required: true },
    { key: "current_person", label: "Current Person", type: "text" },
    { key: "backup_person", label: "Backup Person", type: "text" },
    { key: "contact_details", label: "Contact Details", type: "text", required: true },
    { key: "sla", label: "SLA", type: "text", required: true, placeholder: "e.g. 2 business days" },
    { key: "escalation_level_1", label: "Escalation Level 1", type: "text", required: true },
    { key: "escalation_level_2", label: "Escalation Level 2", type: "text", required: true },
    { key: "sop_link", label: "SOPGalaxy Link", type: "text", placeholder: "https://app.sopgalaxy.com/…" },
    { key: "training_module_link", label: "Training Module Link", type: "text" },
  ];
  const editFields: FieldDef[] = [...fields, { key: "status", label: "Status", type: "select", options: [{ value: "draft", label: "Draft" }, { value: "confirmed", label: "Confirmed" }, { value: "archived", label: "Archived" }] }];

  return (
    <section>
      <Toolbar q={list.q} onSearch={list.setQ} placeholder="Search the responsibility matrix" createLabel="+ Add Activity" onCreate={() => setModal({ mode: "create" })} />
      <Feedback error={list.error} toast={toast} />
      <DataTable
        columns={[
          { key: "name", label: "Activity", render: (row) => (<><b>{row.name}</b><small>{row.department} · {row.responsible_role}</small></>) },
          { key: "contact_details", label: "Contact / SLA", render: (row) => (<>{row.contact_details}<small>{row.sla}</small></>) },
          { key: "escalation_level_1", label: "Escalation", render: (row) => (<>{row.escalation_level_1}<small>→ {row.escalation_level_2}</small></>) },
          { key: "status", label: "Status", render: (row) => <StatusBadge status={row.status} /> },
        ]}
        rows={list.items}
        rowId={(row) => row.id}
        loading={list.loading}
        actions={(row) => (
          <button className={styles.iconBtn} data-tip="Edit" onClick={() => setModal({ mode: "edit", row })}>✎</button>
        )}
      />
      <Pagination page={list.page} pageSize={list.pageSize} total={list.total} onPage={list.setPage} onPageSize={list.setPageSize} />
      {modal && (
        <FormModal
          title={modal.mode === "create" ? "Add Activity" : `Edit ${modal.row?.name}`}
          fields={modal.mode === "create" ? fields : editFields}
          initialValues={modal.row || { current_person: "Organisation to confirm", backup_person: "Department backup" }}
          submitLabel={modal.mode === "create" ? "Create Activity" : "Save Changes"}
          onCancel={() => setModal(null)}
          onSubmit={async (values) => {
            if (modal.mode === "create") await submitJson("/api/v1/admin/activities", token, "POST", values);
            else await submitJson(`/api/v1/admin/activities/${modal.row!.id}`, token, "PATCH", values);
            setToast(`Activity ${modal.mode === "create" ? "created" : "updated"} successfully.`);
            setTimeout(() => setToast(""), 3000);
            setModal(null); setReloadKey((k) => k + 1);
          }}
        />
      )}
    </section>
  );
}

// SOP body/versioning/document management is deliberately not built here —
// SOPGalaxy (https://app.sopgalaxy.com/) owns SOP documents. OneWork keeps
// only a plain-text link field on each Responsibility Matrix row (see
// MatrixPanel's "sop_link" field above) pointing into it. The former
// in-house SOP repository (metadata table + draft/review/approve/retire
// workflow) has been removed, not left running in parallel — see
// supabase/migrations/20260807100000_drop_sop_repository.sql.

// ---------------------------------------------------------------------------
// Training module and quiz builder
// ---------------------------------------------------------------------------

type TrainingModuleRow = { id: string; code: string; title: string; objective: string; duration_minutes: number; passing_score: number; sequence: number; status: string };
type QuizQuestionRow = { id: string; prompt: string; options: string[]; correct_index: number; explanation: string };

function QuizBuilderModal({ token, module, onClose }: { token: string; module: TrainingModuleRow; onClose: () => void }) {
  const [questions, setQuestions] = useState<QuizQuestionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [formOpen, setFormOpen] = useState<null | { mode: "create" | "edit"; row?: QuizQuestionRow }>(null);
  const [confirmDelete, setConfirmDelete] = useState<QuizQuestionRow | null>(null);
  const [deleting, setDeleting] = useState(false);

  function load() {
    setLoading(true);
    request<QuizQuestionRow[]>(`/api/v1/admin/training/modules/${module.id}/questions`, token)
      .then(setQuestions).catch((e) => setError(e instanceof Error ? e.message : "Could not load questions.")).finally(() => setLoading(false));
  }
  useEffect(() => {
    const timer = window.setTimeout(load, 0);
    return () => window.clearTimeout(timer);
  }, [module.id]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Modal title={`Quiz builder — ${module.code} ${module.title}`} onClose={onClose} wide>
      <div className={styles.modalBody}>
        <Feedback error={error} toast={toast} />
        <div className={styles.toolbar}>
          <span style={{ fontSize: 9, color: "#8b8f9e" }}>{questions.length} question{questions.length === 1 ? "" : "s"} · passing score {module.passing_score}%</span>
          <button type="button" className={styles.primaryBtn} onClick={() => setFormOpen({ mode: "create" })}>+ Add Question</button>
        </div>
        <DataTable
          columns={[
            { key: "prompt", label: "Prompt", render: (row) => (<><b>{row.prompt}</b><small>Correct: {row.options[row.correct_index]}</small></>) },
            { key: "options", label: "Options", render: (row) => row.options.join(" · ") },
          ]}
          rows={questions}
          rowId={(row) => row.id}
          loading={loading}
          actions={(row) => (
            <div className={styles.workflowRow}>
              <button className={styles.iconBtn} data-tip="Edit" onClick={() => setFormOpen({ mode: "edit", row })}>✎</button>
              <button className={styles.iconBtn} data-tip="Delete" data-danger="true" onClick={() => setConfirmDelete(row)}>🗑</button>
            </div>
          )}
        />
      </div>
      <div className={styles.modalFooter}>
        <button type="button" className={styles.secondaryBtn} onClick={onClose}>Close</button>
      </div>
      {formOpen && (
        <QuestionFormModal
          token={token}
          moduleId={module.id}
          existing={formOpen.row}
          onCancel={() => setFormOpen(null)}
          onSaved={() => { setFormOpen(null); load(); setToast(`Question ${formOpen.mode === "create" ? "added" : "updated"} successfully.`); setTimeout(() => setToast(""), 3000); }}
        />
      )}
      {confirmDelete && (
        <ConfirmDialog
          title="Delete Question"
          message={`Are you sure you want to delete this question: "${confirmDelete.prompt}"?`}
          busy={deleting}
          onCancel={() => setConfirmDelete(null)}
          onConfirm={async () => {
            setDeleting(true);
            try {
              await submitJson(`/api/v1/admin/training/questions/${confirmDelete.id}`, token, "DELETE");
              setConfirmDelete(null); load();
              setToast("Question deleted successfully."); setTimeout(() => setToast(""), 3000);
            } catch (e) {
              setError(e instanceof Error ? e.message : "Could not delete the question.");
            } finally {
              setDeleting(false);
            }
          }}
        />
      )}
    </Modal>
  );
}

function QuestionFormModal({ token, moduleId, existing, onCancel, onSaved }: { token: string; moduleId: string; existing?: QuizQuestionRow; onCancel: () => void; onSaved: () => void }) {
  const [prompt, setPrompt] = useState(existing?.prompt || "");
  const [options, setOptions] = useState<string[]>(existing?.options || ["", "", "", ""]);
  const [correctIndex, setCorrectIndex] = useState(existing?.correct_index ?? 0);
  const [explanation, setExplanation] = useState(existing?.explanation || "");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [banner, setBanner] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleSubmit() {
    const nextErrors: Record<string, string> = {};
    if (!prompt.trim()) nextErrors.prompt = "Question Prompt is required.";
    const filledOptions = options.map((o) => o.trim()).filter(Boolean);
    if (filledOptions.length < 2) nextErrors.options = "Provide at least two options.";
    if (!explanation.trim()) nextErrors.explanation = "Explanation is required.";
    if (Object.keys(nextErrors).length) { setErrors(nextErrors); return; }
    setBusy(true); setBanner(""); setErrors({});
    try {
      const payload = { prompt: prompt.trim(), options: filledOptions, correct_index: correctIndex, explanation: explanation.trim() };
      if (existing) await submitJson(`/api/v1/admin/training/questions/${existing.id}`, token, "PATCH", payload);
      else await submitJson(`/api/v1/admin/training/modules/${moduleId}/questions`, token, "POST", payload);
      onSaved();
    } catch (e) {
      setBanner(e instanceof Error ? e.message : "Could not save the question.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={existing ? "Edit Question" : "Add Question"} onClose={onCancel}>
      <div className={styles.modalBody}>
        {banner && <div className={styles.error}>{banner}</div>}
        <div className={styles.field} data-invalid={errors.prompt ? "true" : "false"}>
          <label>Question Prompt<span className={styles.required}>*</span></label>
          <textarea value={prompt} placeholder="Enter Question Prompt" onChange={(e) => setPrompt(e.target.value)} />
          {errors.prompt && <p className={styles.fieldError}>{errors.prompt}</p>}
        </div>
        <div className={styles.field} data-invalid={errors.options ? "true" : "false"}>
          <label>Options (mark the correct one)<span className={styles.required}>*</span></label>
          {options.map((option, index) => (
            <div key={index} style={{ display: "flex", gap: 8, alignItems: "center", marginTop: index ? 6 : 0 }}>
              <input type="radio" name="correct-option" checked={correctIndex === index} onChange={() => setCorrectIndex(index)} aria-label={`Mark option ${index + 1} correct`} />
              <input
                style={{ flex: 1 }}
                value={option}
                placeholder={`Enter Option ${index + 1}`}
                onChange={(e) => setOptions((prev) => prev.map((o, i) => (i === index ? e.target.value : o)))}
              />
            </div>
          ))}
          {errors.options && <p className={styles.fieldError}>{errors.options}</p>}
        </div>
        <div className={styles.field} data-invalid={errors.explanation ? "true" : "false"}>
          <label>Explanation<span className={styles.required}>*</span></label>
          <textarea value={explanation} placeholder="Enter Explanation" onChange={(e) => setExplanation(e.target.value)} />
          {errors.explanation && <p className={styles.fieldError}>{errors.explanation}</p>}
        </div>
      </div>
      <div className={styles.modalFooter}>
        <button type="button" className={styles.secondaryBtn} onClick={onCancel}>Cancel</button>
        <button type="button" className={styles.primaryBtn} disabled={busy} onClick={handleSubmit}>{busy ? "Saving…" : "Save Question"}</button>
      </div>
    </Modal>
  );
}

function TrainingPanel({ token }: { token: string }) {
  const [reloadKey, setReloadKey] = useState(0);
  const list = useClientList<TrainingModuleRow>(token, "/api/v1/training/modules", ["title", "code"], reloadKey);
  const [modal, setModal] = useState<null | { mode: "create" | "edit"; row?: TrainingModuleRow }>(null);
  const [quizModule, setQuizModule] = useState<TrainingModuleRow | null>(null);
  const [resourceModule, setResourceModule] = useState<TrainingModuleRow | null>(null);
  const [toast, setToast] = useState("");

  const createFields: FieldDef[] = [
    { key: "code", label: "Module Code", type: "text", required: true, placeholder: "e.g. TRN-23" },
    { key: "title", label: "Title", type: "text", required: true },
    { key: "objective", label: "Objective", type: "textarea", required: true },
    { key: "duration_minutes", label: "Duration (minutes)", type: "number", required: true },
    { key: "passing_score", label: "Passing Score (%)", type: "number" },
  ];
  const editFields: FieldDef[] = [
    { key: "title", label: "Title", type: "text", required: true },
    { key: "objective", label: "Objective", type: "textarea", required: true },
    { key: "duration_minutes", label: "Duration (minutes)", type: "number", required: true },
    { key: "passing_score", label: "Passing Score (%)", type: "number" },
    { key: "status", label: "Status", type: "select", required: true, options: [{ value: "draft", label: "Draft" }, { value: "published", label: "Published" }, { value: "archived", label: "Archived" }] },
  ];

  return (
    <section>
      <Toolbar q={list.q} onSearch={list.setQ} placeholder="Search training modules" createLabel="+ Add Module" onCreate={() => setModal({ mode: "create" })} />
      <Feedback error={list.error} toast={toast} />
      <DataTable
        columns={[
          { key: "code", label: "Code" },
          { key: "title", label: "Title", render: (row) => (<><b>{row.title}</b><small>{row.duration_minutes} min · Sequence {row.sequence}</small></>) },
          { key: "passing_score", label: "Passing Score", render: (row) => `${row.passing_score}%` },
          { key: "status", label: "Status", render: (row) => <StatusBadge status={row.status} /> },
        ]}
        rows={list.items}
        rowId={(row) => row.id}
        loading={list.loading}
        actions={(row) => (
          <div className={styles.workflowRow}>
            <button className={styles.iconBtn} data-tip="Edit" onClick={() => setModal({ mode: "edit", row })}>✎</button>
            <button className={styles.iconBtn} data-tip="Quiz builder" onClick={() => setQuizModule(row)}>❓</button>
            <button className={styles.iconBtn} data-tip="Videos & documents" onClick={() => setResourceModule(row)}>🎬</button>
          </div>
        )}
      />
      <Pagination page={list.page} pageSize={list.pageSize} total={list.total} onPage={list.setPage} onPageSize={list.setPageSize} />
      {modal && (
        <FormModal
          title={modal.mode === "create" ? "Add Training Module" : `Edit ${modal.row?.code}`}
          fields={modal.mode === "create" ? createFields : editFields}
          initialValues={modal.row || { passing_score: 80 }}
          submitLabel={modal.mode === "create" ? "Create Module" : "Save Changes"}
          onCancel={() => setModal(null)}
          onSubmit={async (values) => {
            const payload = { ...values, duration_minutes: Number(values.duration_minutes), passing_score: values.passing_score ? Number(values.passing_score) : undefined };
            if (modal.mode === "create") await submitJson("/api/v1/admin/training/modules", token, "POST", payload);
            else await submitJson(`/api/v1/admin/training/modules/${modal.row!.id}`, token, "PATCH", payload);
            setToast(`Module ${modal.mode === "create" ? "created" : "updated"} successfully. New modules start locked for every employee until assigned.`);
            setTimeout(() => setToast(""), 4000);
            setModal(null); setReloadKey((k) => k + 1);
          }}
        />
      )}
      {quizModule && <QuizBuilderModal token={token} module={quizModule} onClose={() => setQuizModule(null)} />}
      {resourceModule && <ResourcesModal token={token} module={resourceModule} onClose={() => setResourceModule(null)} />}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Module video/document resources — including YouTube and other external links
// ---------------------------------------------------------------------------
type ModuleResourceRow = { id: string; resource_type: string; sequence: number; asset: { id: string; title: string; kind: string; mime_type: string | null; status: string } | null };

const RESOURCE_KIND_OPTIONS = [
  { value: "video", label: "Video (e.g. YouTube link)" },
  { value: "document", label: "Document link" },
  { value: "template", label: "Template link" },
  { value: "image", label: "Image link" },
];

function ResourcesModal({ token, module, onClose }: { token: string; module: TrainingModuleRow; onClose: () => void }) {
  const [resources, setResources] = useState<ModuleResourceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<ModuleResourceRow | null>(null);
  const [deleting, setDeleting] = useState(false);

  function load() {
    setLoading(true);
    request<ModuleResourceRow[]>(`/api/v1/admin/training/modules/${module.id}/resources`, token)
      .then(setResources).catch((e) => setError(e instanceof Error ? e.message : "Could not load resources.")).finally(() => setLoading(false));
  }
  useEffect(() => {
    const timer = window.setTimeout(load, 0);
    return () => window.clearTimeout(timer);
  }, [module.id]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Modal title={`Videos & documents — ${module.code} ${module.title}`} onClose={onClose} wide>
      <div className={styles.modalBody}>
        <Feedback error={error} toast={toast} />
        <div className={styles.toolbar}>
          <span style={{ fontSize: 9, color: "#8b8f9e" }}>Paste a YouTube link or any hosted video/document URL — no file upload needed.</span>
          <button type="button" className={styles.primaryBtn} onClick={() => setAddOpen(true)}>+ Add Link</button>
        </div>
        <DataTable
          columns={[
            { key: "title", label: "Title", render: (row) => row.asset?.title || "—" },
            { key: "kind", label: "Type", render: (row) => <StatusBadge status={row.asset?.kind} /> },
            { key: "resource_type", label: "Shown As", render: (row) => <StatusBadge status={row.resource_type} /> },
          ]}
          rows={resources}
          rowId={(row) => row.id}
          loading={loading}
          actions={(row) => (
            <button className={styles.iconBtn} data-tip="Remove" data-danger="true" onClick={() => setConfirmDelete(row)}>🗑</button>
          )}
        />
      </div>
      <div className={styles.modalFooter}>
        <button type="button" className={styles.secondaryBtn} onClick={onClose}>Close</button>
      </div>
      {addOpen && (
        <FormModal
          title="Add Video or Document Link"
          fields={[
            { key: "title", label: "Title", type: "text", required: true, placeholder: "e.g. Leave Request Walkthrough" },
            { key: "kind", label: "Content Type", type: "select", required: true, options: RESOURCE_KIND_OPTIONS },
            { key: "external_url", label: "Link (YouTube or any URL)", type: "text", required: true, placeholder: "https://www.youtube.com/watch?v=..." },
          ]}
          initialValues={{ kind: "video" }}
          submitLabel="Add to Module"
          onCancel={() => setAddOpen(false)}
          onSubmit={async (values) => {
            const asset = await submitJson("/api/v1/admin/content/external", token, "POST", { title: values.title, kind: values.kind, external_url: values.external_url });
            await submitJson(`/api/v1/admin/training/modules/${module.id}/resources`, token, "POST", { asset_id: asset.id, resource_type: values.kind === "video" ? "video" : "document" });
            setAddOpen(false); load();
            setToast("Added successfully."); setTimeout(() => setToast(""), 3000);
          }}
        />
      )}
      {confirmDelete && (
        <ConfirmDialog
          title="Remove Resource"
          message={`Are you sure you want to remove "${confirmDelete.asset?.title}" from this module?`}
          busy={deleting}
          onCancel={() => setConfirmDelete(null)}
          onConfirm={async () => {
            setDeleting(true);
            try {
              await submitJson(`/api/v1/admin/training/resources/${confirmDelete.id}`, token, "DELETE");
              setConfirmDelete(null); load();
              setToast("Removed successfully."); setTimeout(() => setToast(""), 3000);
            } catch (e) {
              setError(e instanceof Error ? e.message : "Could not remove the resource.");
            } finally {
              setDeleting(false);
            }
          }}
        />
      )}
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Assignments and due dates
// ---------------------------------------------------------------------------

type EnrollmentRow = { id: string; status: string; progress_percent: number; best_score: number | null; due_date: string | null; employee: { id: string; full_name: string; email: string } | null; module: { id: string; title: string; code: string } | null };

function AssignmentsPanel({ token }: { token: string }) {
  const [reloadKey, setReloadKey] = useState(0);
  const [moduleFilter, setModuleFilter] = useState("");
  const list = usePagedList<EnrollmentRow>(token, (page, size) => `/api/v1/admin/enrollments?page=${page}&page_size=${size}${moduleFilter ? `&module_id=${moduleFilter}` : ""}`, reloadKey, moduleFilter);
  const modules = useLookup<TrainingModuleRow>(token, "/api/v1/training/modules");
  const [employeeList, setEmployeeList] = useState<{ id: string; full_name: string }[]>([]);
  useEffect(() => {
    request<Paged<{ id: string; full_name: string }>>("/api/v1/admin/employees?page=1&page_size=100", token)
      .then((res) => setEmployeeList(res.items)).catch(() => {});
  }, [token]);
  const [assignOpen, setAssignOpen] = useState(false);
  const [dueEdit, setDueEdit] = useState<EnrollmentRow | null>(null);
  const [toast, setToast] = useState("");

  return (
    <section>
      <div className={styles.toolbar}>
        <select value={moduleFilter} onChange={(e) => setModuleFilter(e.target.value)} style={{ height: 40, border: "1px solid #e0e1e8", borderRadius: 10, fontSize: 10, padding: "0 10px" }}>
          <option value="">All modules</option>
          {modules.map((m) => <option key={m.id} value={m.id}>{m.code} · {m.title}</option>)}
        </select>
        <button type="button" className={styles.primaryBtn} onClick={() => setAssignOpen(true)}>+ Assign Training</button>
      </div>
      <Feedback error={list.error} toast={toast} />
      <DataTable
        columns={[
          { key: "employee", label: "Employee", render: (row) => (<><b>{row.employee?.full_name || "—"}</b><small>{row.employee?.email}</small></>) },
          { key: "module", label: "Module", render: (row) => (<><b>{row.module?.code}</b><small>{row.module?.title}</small></>) },
          { key: "status", label: "Status", render: (row) => <StatusBadge status={row.status} /> },
          { key: "due_date", label: "Due Date", render: (row) => formatDate(row.due_date) },
          { key: "best_score", label: "Best Score", render: (row) => (row.best_score == null ? "—" : `${row.best_score}%`) },
        ]}
        rows={list.items}
        rowId={(row) => row.id}
        loading={list.loading}
        actions={(row) => (
          <button className={styles.iconBtn} data-tip="Set due date" onClick={() => setDueEdit(row)}>📅</button>
        )}
      />
      <Pagination page={list.page} pageSize={list.pageSize} total={list.total} onPage={list.setPage} onPageSize={list.setPageSize} />
      {assignOpen && (
        <AssignModal
          token={token}
          modules={modules}
          employees={employeeList}
          onCancel={() => setAssignOpen(false)}
          onAssigned={(count) => {
            setAssignOpen(false); setReloadKey((k) => k + 1);
            setToast(`Training assigned to ${count} employee${count === 1 ? "" : "s"} successfully.`);
            setTimeout(() => setToast(""), 3000);
          }}
        />
      )}
      {dueEdit && (
        <FormModal
          title={`Set Due Date — ${dueEdit.employee?.full_name}`}
          fields={[{ key: "due_date", label: "Due Date", type: "date" }]}
          initialValues={{ due_date: dueEdit.due_date || "" }}
          submitLabel="Save"
          onCancel={() => setDueEdit(null)}
          onSubmit={async (values) => {
            await submitJson(`/api/v1/admin/enrollments/${dueEdit.id}`, token, "PATCH", { due_date: values.due_date || null });
            setDueEdit(null); setReloadKey((k) => k + 1);
            setToast("Due date updated successfully."); setTimeout(() => setToast(""), 3000);
          }}
        />
      )}
    </section>
  );
}

function AssignModal({ token, modules, employees, onCancel, onAssigned }: { token: string; modules: TrainingModuleRow[]; employees: { id: string; full_name: string }[]; onCancel: () => void; onAssigned: (count: number) => void }) {
  const [moduleId, setModuleId] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [dueDate, setDueDate] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [banner, setBanner] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleSubmit() {
    const nextErrors: Record<string, string> = {};
    if (!moduleId) nextErrors.module_id = "Select a training module.";
    if (!selected.length) nextErrors.employee_ids = "Select at least one employee.";
    if (Object.keys(nextErrors).length) { setErrors(nextErrors); return; }
    setBusy(true); setBanner(""); setErrors({});
    try {
      const result = await submitJson("/api/v1/admin/enrollments/assign", token, "POST", { module_id: moduleId, employee_ids: selected, due_date: dueDate || null });
      onAssigned(result.assigned ?? selected.length);
    } catch (e) {
      setBanner(e instanceof Error ? e.message : "Could not assign training.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Assign Training" onClose={onCancel} wide>
      <div className={styles.modalBody}>
        {banner && <div className={styles.error}>{banner}</div>}
        <div className={styles.field} data-invalid={errors.module_id ? "true" : "false"}>
          <label>Training Module<span className={styles.required}>*</span></label>
          <select value={moduleId} onChange={(e) => setModuleId(e.target.value)}>
            <option value="">Select Training Module</option>
            {modules.map((m) => <option key={m.id} value={m.id}>{m.code} · {m.title}</option>)}
          </select>
          {errors.module_id && <p className={styles.fieldError}>{errors.module_id}</p>}
        </div>
        <div className={styles.field} data-invalid={errors.employee_ids ? "true" : "false"}>
          <label>Employees<span className={styles.required}>*</span></label>
          <div style={{ maxHeight: 220, overflowY: "auto", border: "1px solid #e0e1e8", borderRadius: 9, padding: 10, display: "grid", gap: 6 }}>
            {employees.map((employee) => (
              <label key={employee.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 9 }}>
                <input
                  type="checkbox"
                  checked={selected.includes(employee.id)}
                  onChange={(e) => setSelected((prev) => (e.target.checked ? [...prev, employee.id] : prev.filter((id) => id !== employee.id)))}
                />
                {employee.full_name}
              </label>
            ))}
            {!employees.length && <span style={{ fontSize: 9, color: "#8b8f9e" }}>No employees found.</span>}
          </div>
          {errors.employee_ids && <p className={styles.fieldError}>{errors.employee_ids}</p>}
        </div>
        <div className={styles.field}>
          <label>Due Date</label>
          <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        </div>
      </div>
      <div className={styles.modalFooter}>
        <button type="button" className={styles.secondaryBtn} onClick={onCancel}>Cancel</button>
        <button type="button" className={styles.primaryBtn} disabled={busy} onClick={handleSubmit}>{busy ? "Assigning…" : "Assign Training"}</button>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Unresolved-question governance queue
// ---------------------------------------------------------------------------

type FeedbackRow = { id: string; query: string; reason: string; status: string; resolution: string | null; employee: string; created_at: string };

function FeedbackPanel({ token }: { token: string }) {
  const [reloadKey, setReloadKey] = useState(0);
  const [statusFilter, setStatusFilter] = useState("open");
  const list = usePagedList<FeedbackRow>(token, (page, size) => `/api/v1/admin/feedback?page=${page}&page_size=${size}&status=${statusFilter}`, reloadKey, statusFilter);
  const [resolveRow, setResolveRow] = useState<FeedbackRow | null>(null);
  const [toast, setToast] = useState("");

  return (
    <section>
      <div className={styles.adminTabs} style={{ borderBottom: "none", marginBottom: 12 }}>
        {["open", "in_review", "resolved", "dismissed"].map((status) => (
          <button key={status} className={statusFilter === status ? styles.adminTabActive : ""} onClick={() => setStatusFilter(status)}>
            {status.replace(/_/g, " ")}
          </button>
        ))}
      </div>
      <Feedback error={list.error} toast={toast} />
      <DataTable
        columns={[
          { key: "query", label: "Question", render: (row) => (<><b>{row.query}</b><small>Asked by {row.employee}</small></>) },
          { key: "reason", label: "Reason Reported" },
          { key: "resolution", label: "Resolution", render: (row) => row.resolution || "—" },
        ]}
        rows={list.items}
        rowId={(row) => row.id}
        loading={list.loading}
        actions={(row) => (
          row.status === "resolved" || row.status === "dismissed"
            ? <span style={{ fontSize: 8, color: "#8b8f9e" }}>Closed</span>
            : <button className={styles.secondaryBtn} onClick={() => setResolveRow(row)}>Resolve</button>
        )}
      />
      <Pagination page={list.page} pageSize={list.pageSize} total={list.total} onPage={list.setPage} onPageSize={list.setPageSize} />
      {resolveRow && (
        <FormModal
          title={`Resolve — ${resolveRow.query}`}
          fields={[
            { key: "status", label: "Outcome", type: "select", required: true, options: [{ value: "resolved", label: "Resolved" }, { value: "dismissed", label: "Dismissed" }] },
            { key: "resolution", label: "Resolution Notes", type: "textarea", required: true },
          ]}
          initialValues={{ status: "resolved" }}
          submitLabel="Save Resolution"
          onCancel={() => setResolveRow(null)}
          onSubmit={async (values) => {
            await submitJson(`/api/v1/admin/feedback/${resolveRow.id}`, token, "PATCH", values);
            setResolveRow(null); setReloadKey((k) => k + 1);
            setToast("Feedback resolved successfully."); setTimeout(() => setToast(""), 3000);
          }}
        />
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Content library — documents, video tutorials, SOP files and mistake register
// ---------------------------------------------------------------------------

type ContentAsset = { id: string; kind: string; title: string; description: string | null; file_name: string; mime_type: string; size_bytes: number; status: string; created_at: string };
type MistakeRow = { id: string; code: string; title: string; description: string; correct_practice: string; category: string; severity: string; status: string; is_seed: boolean };

const CONTENT_KIND_OPTIONS = [
  { value: "document", label: "Document" },
  { value: "video", label: "Video" },
  { value: "sop", label: "SOP File" },
  { value: "mistake_register", label: "Mistake Register Sheet" },
  { value: "template", label: "Template" },
  { value: "image", label: "Image" },
];

function formatBytes(bytes: number) {
  if (!bytes) return "—";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes, index = 0;
  while (value >= 1024 && index < units.length - 1) { value /= 1024; index += 1; }
  return `${value.toFixed(1)} ${units[index]}`;
}

function UploadModal({ token, onCancel, onUploaded }: { token: string; onCancel: () => void; onUploaded: () => void }) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [kind, setKind] = useState("document");
  const [file, setFile] = useState<File | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [banner, setBanner] = useState("");
  const [progress, setProgress] = useState(0);
  const [busy, setBusy] = useState(false);

  async function handleUpload() {
    const nextErrors: Record<string, string> = {};
    if (!title.trim()) nextErrors.title = "Title is required.";
    if (!file) nextErrors.file = "Choose a file to upload.";
    if (Object.keys(nextErrors).length) { setErrors(nextErrors); return; }
    setBusy(true); setBanner(""); setErrors({}); setProgress(10);
    try {
      const prepared = await submitJson("/api/v1/admin/content/upload-url", token, "POST", {
        title: title.trim(), description: description.trim() || undefined, kind,
        file_name: file!.name, mime_type: file!.type || "application/octet-stream", size_bytes: file!.size,
      });
      setProgress(45);
      const uploadResponse = await fetch(prepared.upload_url, { method: "PUT", body: file, headers: { "Content-Type": file!.type || "application/octet-stream" } });
      if (!uploadResponse.ok) throw new Error("The file could not be uploaded. Try again.");
      setProgress(80);
      await submitJson(`/api/v1/admin/content/${prepared.asset_id}/complete`, token, "POST");
      setProgress(100);
      onUploaded();
    } catch (e) {
      setBanner(e instanceof Error ? e.message : "Upload failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Upload Document or Video" onClose={onCancel}>
      <div className={styles.modalBody}>
        {banner && <div className={styles.error}>{banner}</div>}
        <div className={styles.field} data-invalid={errors.title ? "true" : "false"}>
          <label>Title<span className={styles.required}>*</span></label>
          <input value={title} placeholder="Enter Title" onChange={(e) => setTitle(e.target.value)} />
          {errors.title && <p className={styles.fieldError}>{errors.title}</p>}
        </div>
        <div className={styles.field}>
          <label>Description</label>
          <textarea value={description} placeholder="Enter Description" onChange={(e) => setDescription(e.target.value)} />
        </div>
        <div className={styles.field}>
          <label>Content Type<span className={styles.required}>*</span></label>
          <select value={kind} onChange={(e) => setKind(e.target.value)}>
            {CONTENT_KIND_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </div>
        <div className={styles.field} data-invalid={errors.file ? "true" : "false"}>
          <label>File<span className={styles.required}>*</span></label>
          <div className={styles.uploadDrop}>
            {file ? file.name : "PDF, Word, Excel, PowerPoint, CSV, image or video, up to 500 MB."}
            <br />
            <input type="file" onChange={(e) => setFile(e.target.files?.[0] || null)} />
          </div>
          {errors.file && <p className={styles.fieldError}>{errors.file}</p>}
        </div>
        {busy && <div className={styles.progressBar}><b style={{ width: `${progress}%` }} /></div>}
      </div>
      <div className={styles.modalFooter}>
        <button type="button" className={styles.secondaryBtn} onClick={onCancel}>Cancel</button>
        <button type="button" className={styles.primaryBtn} disabled={busy} onClick={handleUpload}>{busy ? "Uploading…" : "Upload"}</button>
      </div>
    </Modal>
  );
}

function ContentLibraryPanel({ token }: { token: string }) {
  const [reloadKey, setReloadKey] = useState(0);
  const [kindFilter, setKindFilter] = useState("");
  const list = usePagedList<ContentAsset>(token, (page, size) => `/api/v1/admin/content?page=${page}&page_size=${size}${kindFilter ? `&kind=${kindFilter}` : ""}`, reloadKey, kindFilter);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<ContentAsset | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [toast, setToast] = useState("");
  const [error, setError] = useState("");

  async function download(asset: ContentAsset) {
    try {
      const result = await request<{ download_url: string }>(`/api/v1/admin/content/${asset.id}/download-url`, token);
      window.open(result.download_url, "_blank", "noopener,noreferrer");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not prepare the download.");
    }
  }

  return (
    <section>
      <div className={styles.toolbar}>
        <select value={kindFilter} onChange={(e) => setKindFilter(e.target.value)} style={{ height: 40, border: "1px solid #e0e1e8", borderRadius: 10, fontSize: 10, padding: "0 10px" }}>
          <option value="">All content</option>
          {CONTENT_KIND_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
        <button type="button" className={styles.primaryBtn} onClick={() => setUploadOpen(true)}>+ Upload Document or Video</button>
      </div>
      <Feedback error={list.error || error} toast={toast} />
      <DataTable
        columns={[
          { key: "title", label: "Title", render: (row) => (<><b>{row.title}</b><small>{row.file_name} · {formatBytes(row.size_bytes)}</small></>) },
          { key: "kind", label: "Type", render: (row) => <StatusBadge status={row.kind} /> },
          { key: "status", label: "Status", render: (row) => <StatusBadge status={row.status} /> },
          { key: "created_at", label: "Uploaded", render: (row) => formatDate(row.created_at) },
        ]}
        rows={list.items}
        rowId={(row) => row.id}
        loading={list.loading}
        actions={(row) => (
          <div className={styles.workflowRow}>
            <button className={styles.iconBtn} data-tip="Download" onClick={() => download(row)}>⬇</button>
            <button className={styles.iconBtn} data-tip="Delete" data-danger="true" onClick={() => setConfirmDelete(row)}>🗑</button>
          </div>
        )}
      />
      <Pagination page={list.page} pageSize={list.pageSize} total={list.total} onPage={list.setPage} onPageSize={list.setPageSize} />
      {uploadOpen && (
        <UploadModal
          token={token}
          onCancel={() => setUploadOpen(false)}
          onUploaded={() => { setUploadOpen(false); setReloadKey((k) => k + 1); setToast("File uploaded successfully."); setTimeout(() => setToast(""), 3000); }}
        />
      )}
      {confirmDelete && (
        <ConfirmDialog
          title="Delete Content"
          message={`Are you sure you want to delete "${confirmDelete.title}"?`}
          busy={deleting}
          onCancel={() => setConfirmDelete(null)}
          onConfirm={async () => {
            setDeleting(true);
            try {
              await submitJson(`/api/v1/admin/content/${confirmDelete.id}`, token, "DELETE");
              setConfirmDelete(null); setReloadKey((k) => k + 1);
              setToast("Content deleted successfully."); setTimeout(() => setToast(""), 3000);
            } catch (e) {
              setError(e instanceof Error ? e.message : "Could not delete the content.");
            } finally {
              setDeleting(false);
            }
          }}
        />
      )}
    </section>
  );
}

function MistakeRegisterPanel({ token }: { token: string }) {
  const [reloadKey, setReloadKey] = useState(0);
  const list = usePagedList<MistakeRow>(token, (page, size, q) => `/api/v1/admin/mistakes?page=${page}&page_size=${size}${q ? `&q=${encodeURIComponent(q)}` : ""}`, reloadKey);
  const [modal, setModal] = useState<null | { mode: "create" | "edit"; row?: MistakeRow }>(null);
  const [toast, setToast] = useState("");
  const [error, setError] = useState("");
  const [confirmReplace, setConfirmReplace] = useState(false);
  const [replacing, setReplacing] = useState(false);
  const seedCount = list.items.filter((row) => row.is_seed).length;

  const fields: FieldDef[] = [
    { key: "code", label: "Entry Code", type: "text", required: true, placeholder: "e.g. MIS-021" },
    { key: "title", label: "Title", type: "text", required: true },
    { key: "description", label: "Description", type: "textarea", required: true },
    { key: "correct_practice", label: "Correct Practice", type: "textarea", required: true },
    { key: "category", label: "Category", type: "text", required: true },
    { key: "severity", label: "Severity", type: "select", options: [{ value: "low", label: "Low" }, { value: "medium", label: "Medium" }, { value: "high", label: "High" }, { value: "critical", label: "Critical" }] },
  ];

  return (
    <section>
      {seedCount > 0 && (
        <div className={styles.emptyState} style={{ marginBottom: 14, textAlign: "left" }}>
          <b>{seedCount} mock entries are shown from the placeholder mistake register.</b> Upload the completed organisation survey through Content Library, then replace the mock entries in one step.
          <div style={{ marginTop: 10 }}>
            <button type="button" className={styles.secondaryBtn} onClick={() => setConfirmReplace(true)}>Replace Mock Entries with Survey Data</button>
          </div>
        </div>
      )}
      <Toolbar q={list.q} onSearch={list.setQ} placeholder="Search the mistake register" createLabel="+ Add Entry" onCreate={() => setModal({ mode: "create" })} />
      <Feedback error={list.error || error} toast={toast} />
      <DataTable
        columns={[
          { key: "code", label: "Code" },
          { key: "title", label: "Title", render: (row) => (<><b>{row.title}</b>{row.is_seed && <small>Mock entry</small>}</>) },
          { key: "category", label: "Category" },
          { key: "severity", label: "Severity", render: (row) => <StatusBadge status={row.severity} /> },
        ]}
        rows={list.items}
        rowId={(row) => row.id}
        loading={list.loading}
        actions={(row) => (
          <button className={styles.iconBtn} data-tip="Edit" onClick={() => setModal({ mode: "edit", row })}>✎</button>
        )}
      />
      <Pagination page={list.page} pageSize={list.pageSize} total={list.total} onPage={list.setPage} onPageSize={list.setPageSize} />
      {modal && (
        <FormModal
          title={modal.mode === "create" ? "Add Register Entry" : `Edit ${modal.row?.code}`}
          fields={modal.mode === "create" ? fields : fields.slice(1)}
          initialValues={modal.row || { severity: "medium" }}
          submitLabel={modal.mode === "create" ? "Create Entry" : "Save Changes"}
          onCancel={() => setModal(null)}
          onSubmit={async (values) => {
            if (modal.mode === "create") await submitJson("/api/v1/admin/mistakes", token, "POST", values);
            else await submitJson(`/api/v1/admin/mistakes/${modal.row!.id}`, token, "PATCH", values);
            setToast(`Entry ${modal.mode === "create" ? "created" : "updated"} successfully.`);
            setTimeout(() => setToast(""), 3000);
            setModal(null); setReloadKey((k) => k + 1);
          }}
        />
      )}
      {confirmReplace && (
        <ConfirmDialog
          title="Replace Mock Entries"
          message="Are you sure you want to remove every mock mistake-register entry? Entries you or another administrator have already added will not be affected."
          busy={replacing}
          onCancel={() => setConfirmReplace(false)}
          onConfirm={async () => {
            setReplacing(true);
            try {
              await submitJson("/api/v1/admin/mistakes/replace-seed", token, "POST");
              setConfirmReplace(false); setReloadKey((k) => k + 1);
              setToast("Mock entries removed successfully."); setTimeout(() => setToast(""), 3000);
            } catch (e) {
              setError(e instanceof Error ? e.message : "Could not replace the mock entries.");
            } finally {
              setReplacing(false);
            }
          }}
        />
      )}
    </section>
  );
}

function ContentSection({ token }: { token: string }) {
  const [tab, setTab] = useState<"assets" | "mistakes">("assets");
  return (
    <section>
      <div className={styles.adminTabs} style={{ borderBottom: "none", marginBottom: 12 }}>
        <button className={tab === "assets" ? styles.adminTabActive : ""} onClick={() => setTab("assets")}>Documents &amp; Videos</button>
        <button className={tab === "mistakes" ? styles.adminTabActive : ""} onClick={() => setTab("mistakes")}>Mistake Register</button>
      </div>
      {tab === "assets" ? <ContentLibraryPanel token={token} /> : <MistakeRegisterPanel token={token} />}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Audit log
// ---------------------------------------------------------------------------

type AuditRow = { id: string; action: string; entity_type: string; entity_id: string | null; details: Record<string, unknown>; created_at: string; actor: string };

function AuditPanel({ token }: { token: string }) {
  const list = usePagedList<AuditRow>(token, (page, size) => `/api/v1/admin/audit?page=${page}&page_size=${size}`, 0);
  return (
    <section>
      <Feedback error={list.error} />
      <DataTable
        columns={[
          {
            key: "created_at",
            label: "When",
            // Same date format as everywhere else (formatDate: "07 Aug 2026"),
            // plus a time — this used to be the one screen rendering
            // "07/08/2026, 15:49:26" while Certificates showed a raw ISO
            // string and Content Library showed "07 Aug 2026".
            render: (row) => `${formatDate(row.created_at)}, ${new Date(row.created_at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`,
          },
          { key: "actor", label: "Actor" },
          { key: "action", label: "Action" },
          { key: "entity_type", label: "Entity" },
          { key: "details", label: "Details", render: (row) => <code style={{ fontSize: 8 }}>{JSON.stringify(row.details)}</code> },
        ]}
        rows={list.items}
        rowId={(row) => row.id}
        loading={list.loading}
      />
      <Pagination page={list.page} pageSize={list.pageSize} total={list.total} onPage={list.setPage} onPageSize={list.setPageSize} />
    </section>
  );
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export default function AdminConsole({ token, section }: { token: string; section: AdminSection }) {
  switch (section) {
    case "employees": return <EmployeesPanel token={token} />;
    case "departments": return <DepartmentsPanel token={token} />;
    case "matrix": return <MatrixPanel token={token} />;
    case "training": return <TrainingPanel token={token} />;
    case "assignments": return <AssignmentsPanel token={token} />;
    case "content": return <ContentSection token={token} />;
    case "feedback": return <FeedbackPanel token={token} />;
    case "audit": return <AuditPanel token={token} />;
    default: return null;
  }
}
