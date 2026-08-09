"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import styles from "./platform.module.css";
import { API, request } from "./PlatformApp";
import type { AdminSection } from "./PlatformApp";
import ResponsibilityGraph, { type GraphActivity } from "./ResponsibilityGraph";

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
  // Same fix as PlatformApp's top-level content: a table that's already
  // showing rows must NOT vanish back to a bare loading line every time
  // reloadKey bumps (after any Create/Edit/Import/delete across all 8
  // admin panels this component drives) — that was the actual "blink,"
  // not a missing CSS transition. Only the genuine first load (no rows
  // yet) gets the full loading state.
  if (loading && !rows.length) return <div className={styles.loading}>Synchronising verified data…</div>;
  if (!loading && !rows.length) return <div className={styles.noRecords}>No records found.</div>;
  return (
    <div className={styles.dataTable} data-syncing={loading && rows.length > 0 ? "true" : "false"}>
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

// ---------------------------------------------------------------------------
// CSV bulk import (BUILD PROMPT v5 item B3)
// ---------------------------------------------------------------------------

// A small hand-written parser rather than a dependency — this only needs
// to handle the common real-world CSV shapes (quoted fields, embedded
// commas, escaped "" quotes, \r\n or \n line endings), not the full RFC.
function parseCsv(text: string): { headers: string[]; rows: string[][] } {
  const rows: string[][] = [];
  let row: string[] = []; let field = ""; let inQuotes = false;
  const pushField = () => { row.push(field); field = ""; };
  const pushRow = () => { pushField(); rows.push(row); row = []; };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false; }
      else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") pushField();
    else if (c === "\n") pushRow();
    else if (c === "\r") { /* skip, \n follows */ }
    else field += c;
  }
  if (field || row.length) pushRow();
  const nonEmpty = rows.filter((r) => r.some((v) => v.trim() !== ""));
  const [headerRow, ...dataRows] = nonEmpty;
  return { headers: (headerRow || []).map((h) => h.trim()), rows: dataRows };
}

type ImportField = { key: string; label: string; required?: boolean };
type ImportResult = { created: number; errors: { row: number; message: string; [k: string]: unknown }[] };

// Generic across Employees and Activities — the caller supplies the
// target field list and the import endpoint; everything else (file read,
// column mapping UI, preview, per-row error report) is shared. Column
// mapping defaults to an exact (case-insensitive) header match, which
// covers the common case of "export this system's own CSV, re-import
// it here" without forcing a manual mapping step every time.
function CsvImportModal({ title, fields, importPath, token, onClose, onImported }: { title: string; fields: ImportField[]; importPath: string; token: string; onClose: () => void; onImported: (result: ImportResult) => void }) {
  const [parsed, setParsed] = useState<{ headers: string[]; rows: string[][] } | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<ImportResult | null>(null);

  function handleFile(file: File) {
    setError(""); setResult(null);
    file.text().then((text) => {
      const p = parseCsv(text);
      if (!p.headers.length || !p.rows.length) { setError("Couldn't find any data rows in that file."); return; }
      const initialMapping: Record<string, string> = {};
      for (const f of fields) {
        const match = p.headers.find((h) => h.toLowerCase().replace(/[\s_-]/g, "") === f.key.toLowerCase().replace(/[\s_-]/g, ""));
        if (match) initialMapping[f.key] = match;
      }
      setMapping(initialMapping);
      setParsed(p);
    });
  }

  async function runImport() {
    if (!parsed) return;
    const missingRequired = fields.filter((f) => f.required && !mapping[f.key]);
    if (missingRequired.length) { setError(`Map a column for: ${missingRequired.map((f) => f.label).join(", ")}.`); return; }
    setBusy(true); setError("");
    try {
      const headerIndex = new Map(parsed.headers.map((h, i) => [h, i]));
      const rows = parsed.rows.map((row) => {
        const obj: Record<string, string> = {};
        for (const f of fields) {
          const col = mapping[f.key];
          if (col === undefined) continue;
          const idx = headerIndex.get(col);
          obj[f.key] = idx !== undefined ? (row[idx] || "").trim() : "";
        }
        return obj;
      });
      const res = await submitJson(importPath, token, "POST", { rows });
      setResult(res as ImportResult);
      onImported(res as ImportResult);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={title} onClose={onClose} wide>
      <div className={styles.csvImport}>
        {!parsed && (
          <div className={styles.csvDrop}>
            <p>Upload a CSV file. The first row must be column headers.</p>
            <input type="file" accept=".csv,text/csv" onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])} />
            {error && <div className={styles.error}>{error}</div>}
          </div>
        )}
        {parsed && !result && (
          <>
            <p className={styles.csvSummary}>{parsed.rows.length} row{parsed.rows.length === 1 ? "" : "s"} found. Match each field below to a column from your file.</p>
            <div className={styles.csvMapping}>
              {fields.map((f) => (
                <label key={f.key}>
                  {f.label}{f.required && <span className={styles.gapText}>*</span>}
                  <select value={mapping[f.key] || ""} onChange={(e) => setMapping((prev) => ({ ...prev, [f.key]: e.target.value }))}>
                    <option value="">— Not mapped —</option>
                    {parsed.headers.map((h) => (
                      <option key={h} value={h}>{h}</option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
            <div className={styles.csvPreviewWrap}>
              <table className={styles.csvPreview}>
                <thead>
                  <tr>{fields.map((f) => <th key={f.key}>{f.label}</th>)}</tr>
                </thead>
                <tbody>
                  {parsed.rows.slice(0, 5).map((row, i) => (
                    <tr key={i}>
                      {fields.map((f) => {
                        const col = mapping[f.key];
                        const idx = col ? parsed.headers.indexOf(col) : -1;
                        return <td key={f.key}>{idx >= 0 ? row[idx] : <span style={{ color: "#c3c5cf" }}>—</span>}</td>;
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
              {parsed.rows.length > 5 && <small>…and {parsed.rows.length - 5} more row{parsed.rows.length - 5 === 1 ? "" : "s"}.</small>}
            </div>
            {error && <div className={styles.error}>{error}</div>}
            <div className={styles.confirmActions}>
              <button type="button" className={styles.secondaryBtn} onClick={() => { setParsed(null); setMapping({}); }}>Choose a different file</button>
              <button type="button" className={styles.primaryBtn} disabled={busy} onClick={runImport}>{busy ? "Importing…" : `Import ${parsed.rows.length} row${parsed.rows.length === 1 ? "" : "s"}`}</button>
            </div>
          </>
        )}
        {result && (
          <div className={styles.csvResult}>
            <p>
              <b style={{ color: "var(--readiness,#1c8a5f)" }}>{result.created} created.</b>{" "}
              {result.errors.length > 0 && <span className={styles.gapText}>{result.errors.length} row{result.errors.length === 1 ? "" : "s"} skipped.</span>}
            </p>
            {result.errors.length > 0 && (
              <div className={styles.csvErrorList}>
                {result.errors.map((e, i) => (
                  <div key={i}>Row {e.row}: {e.message}</div>
                ))}
              </div>
            )}
            <div className={styles.confirmActions}>
              <button type="button" className={styles.primaryBtn} onClick={onClose}>Done</button>
            </div>
          </div>
        )}
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

function Toolbar({ q, onSearch, placeholder, createLabel, onCreate, extra }: { q: string; onSearch: (v: string) => void; placeholder: string; createLabel?: string; onCreate?: () => void; extra?: React.ReactNode }) {
  return (
    <div className={styles.toolbar}>
      <div className={styles.searchBox}>
        <input value={q} placeholder={placeholder} onChange={(e) => onSearch(e.target.value)} />
        {q && <button type="button" className={styles.clearBtn} onClick={() => onSearch("")} aria-label="Clear search">✕</button>}
      </div>
      {extra}
      {createLabel && onCreate && <button type="button" className={styles.primaryBtn} onClick={onCreate}>{createLabel}</button>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Departments
// ---------------------------------------------------------------------------

type Department = { id: string; name: string; code: string; employee_count?: number; readiness_score?: number | null };

// ---------------------------------------------------------------------------
// Candidates (BUILD PROMPT v5 BLOCK A: Pre-Joining Portal)
// ---------------------------------------------------------------------------

type Candidate = { id: string; full_name: string; email: string; department_id: string | null; department_name: string | null; invite_token: string; status: string; created_at: string; acknowledged_at: string | null };

function CandidatesPanel({ token }: { token: string }) {
  const [tab, setTab] = useState<"candidates" | "content">("candidates");
  const [reloadKey, setReloadKey] = useState(0);
  const list = useClientList<Candidate>(token, "/api/v1/admin/candidates", ["full_name", "email"], reloadKey);
  const departments = useLookup<Department>(token, "/api/v1/admin/departments");
  const [modal, setModal] = useState<null | { mode: "create" }>(null);
  const [toast, setToast] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const fields: FieldDef[] = [
    { key: "full_name", label: "Full Name", type: "text", required: true },
    { key: "email", label: "Email ID", type: "email", required: true },
    { key: "department_id", label: "Department", type: "select", options: departments.map((d) => ({ value: d.id, label: d.name })), helpText: "Optional — leave blank if not yet decided. If set, the candidate sees that department's expectations." },
  ];

  function inviteLink(inviteToken: string) {
    return typeof window !== "undefined" ? `${window.location.origin}/join/${inviteToken}` : `/join/${inviteToken}`;
  }
  function copyLink(row: Candidate) {
    navigator.clipboard?.writeText(inviteLink(row.invite_token)).then(() => {
      setCopiedId(row.id);
      setTimeout(() => setCopiedId((v) => (v === row.id ? null : v)), 2000);
    });
  }

  return (
    <section>
      <div className={styles.adminSubTabs}>
        <button type="button" data-active={tab === "candidates"} onClick={() => setTab("candidates")}>Candidates</button>
        <button type="button" data-active={tab === "content"} onClick={() => setTab("content")}>Preview Page Content</button>
      </div>
      {tab === "candidates" && (
        <>
          <Toolbar q={list.q} onSearch={list.setQ} placeholder="Search candidates" createLabel="+ Invite Candidate" onCreate={() => setModal({ mode: "create" })} />
          <Feedback error={list.error} toast={toast} />
          <DataTable
            columns={[
              { key: "full_name", label: "Full Name", render: (row) => (<><b>{row.full_name}</b><small>{row.email}</small></>) },
              { key: "department_name", label: "Department", render: (row) => row.department_name || <span style={{ color: "#8b8f9e" }}>Not set</span> },
              {
                key: "status",
                label: "Status",
                render: (row) =>
                  row.status === "acknowledged" || row.status === "joined" ? (
                    <StatusBadge status={row.status} />
                  ) : (
                    <span className={styles.gapText} style={{ fontWeight: 700 }}>Not yet acknowledged</span>
                  ),
              },
              { key: "acknowledged_at", label: "Acknowledged", render: (row) => formatDate(row.acknowledged_at) },
              {
                key: "invite_token",
                label: "Invite Link",
                render: (row) => (
                  <button type="button" className={styles.secondaryBtn} onClick={() => copyLink(row)}>
                    {copiedId === row.id ? "✓ Copied" : "Copy link"}
                  </button>
                ),
              },
            ]}
            rows={list.items}
            rowId={(row) => row.id}
            loading={list.loading}
          />
          <Pagination page={list.page} pageSize={list.pageSize} total={list.total} onPage={list.setPage} onPageSize={list.setPageSize} />
          {modal && (
            <FormModal
              title="Invite Candidate"
              fields={fields}
              initialValues={{}}
              submitLabel="Create Invite"
              onCancel={() => setModal(null)}
              onSubmit={async (values) => {
                await submitJson("/api/v1/admin/candidates", token, "POST", values);
                setToast("Candidate invited. Copy their link from the table below to send it on.");
                setTimeout(() => setToast(""), 4000);
                setModal(null); setReloadKey((k) => k + 1);
              }}
            />
          )}
        </>
      )}
      {tab === "content" && <PreboardingContentEditor token={token} />}
    </section>
  );
}

function PreboardingContentEditor({ token }: { token: string }) {
  const [content, setContent] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState("");
  useEffect(() => {
    request<Record<string, string>>("/api/v1/admin/preboarding-content", token).then((data) => { setContent(data); setLoading(false); }).catch(() => setLoading(false));
  }, [token]);

  const blocks: [string, string][] = [
    ["welcome", "Welcome message"],
    ["expectations_from_you", "What we expect from you"],
    ["expectations_from_us", "What you can expect from us"],
  ];

  async function save() {
    setSaving(true);
    try {
      await submitJson("/api/v1/admin/preboarding-content", token, "PATCH", content);
      setToast("Preview page content updated successfully.");
      setTimeout(() => setToast(""), 3000);
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className={styles.loading}>Synchronising verified data…</div>;
  return (
    <div className={styles.formGrid} style={{ display: "block" }}>
      <Feedback toast={toast} />
      <p style={{ color: "#7c8090", fontSize: 13, margin: "0 0 16px" }}>
        This is what a candidate sees on their pre-joining preview page, before they have an account. Common Rules
        &amp; Regulations aren&apos;t shown here yet — that&apos;s a separate module, not built in this pass.
      </p>
      {blocks.map(([key, label]) => (
        <label key={key} style={{ display: "block", marginBottom: 18 }}>
          <b style={{ display: "block", fontSize: 13, marginBottom: 6 }}>{label}</b>
          <textarea
            value={content[key] || ""}
            onChange={(e) => setContent((prev) => ({ ...prev, [key]: e.target.value }))}
            rows={4}
            style={{ width: "100%", border: "1px solid #dfe0e8", borderRadius: 10, padding: "10px 13px", fontFamily: "inherit", fontSize: 14 }}
          />
        </label>
      ))}
      <button type="button" className={styles.primaryBtn} disabled={saving} onClick={save}>
        {saving ? "Saving…" : "Save changes"}
      </button>
    </div>
  );
}

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
        columns={[
          { key: "name", label: "Department Name" },
          { key: "code", label: "Department Code" },
          { key: "employee_count", label: "Employees", render: (row) => row.employee_count ?? "—" },
          {
            key: "readiness_score",
            label: "Readiness",
            render: (row) =>
              row.readiness_score == null ? (
                <span style={{ color: "#8b8f9e" }}>No training data yet</span>
              ) : (
                <span style={{ fontWeight: 800, color: row.readiness_score >= 70 ? "var(--readiness)" : "var(--risk)" }}>
                  {row.readiness_score}%
                </span>
              ),
          },
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

type Employee = { id: string; full_name: string; email: string; role: string; is_active: boolean; department_id: string | null; department_name: string | null; manager_id: string | null; manager_name: string | null };
type EmployeeLookup = { id: string; full_name: string };

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
  // BUILD PROMPT v5 item A3: unpaginated roster for the manager picker —
  // the paginated employees list can't be used here since the person a
  // manager should be set to might be on a different page.
  const allEmployees = useLookup<EmployeeLookup>(token, "/api/v1/admin/employees/lookup");
  const [modal, setModal] = useState<null | { mode: "create" | "edit"; row?: Employee }>(null);
  const [toast, setToast] = useState("");

  const departmentOptions = departments.map((d) => ({ value: d.id, label: d.name }));
  const managerOptions = (excludeId?: string) =>
    allEmployees.filter((e) => e.id !== excludeId).map((e) => ({ value: e.id, label: e.full_name }));

  const createFields: FieldDef[] = [
    { key: "full_name", label: "Full Name", type: "text", required: true },
    { key: "email", label: "Email ID", type: "email", required: true },
    { key: "password", label: "Password", type: "password", required: true, minLength: 8, helpText: "At least 8 characters." },
    { key: "role", label: "Role", type: "select", required: true, options: ROLE_OPTIONS },
    { key: "department_id", label: "Department", type: "select", options: departmentOptions },
    { key: "manager_id", label: "Reports To", type: "select", options: managerOptions(), helpText: "Who this person reports to — drives the Manager Dashboard, not the department." },
  ];
  const editFields = (excludeId: string): FieldDef[] => [
    { key: "full_name", label: "Full Name", type: "text", required: true },
    { key: "role", label: "Role", type: "select", required: true, options: ROLE_OPTIONS },
    { key: "department_id", label: "Department", type: "select", options: departmentOptions },
    { key: "manager_id", label: "Reports To", type: "select", options: managerOptions(excludeId), helpText: "Who this person reports to — drives the Manager Dashboard, not the department." },
    { key: "is_active", label: "Status", type: "select", required: true, options: [{ value: "true", label: "Active" }, { value: "false", label: "Inactive" }] },
    { key: "password", label: "Reset Password", type: "password", minLength: 8, helpText: "Leave blank to keep the current password." },
  ];

  const [importOpen, setImportOpen] = useState(false);

  return (
    <section>
      <Toolbar
        q={list.q}
        onSearch={list.setQ}
        placeholder="Search by name or Email ID"
        createLabel="+ Add Employee"
        onCreate={() => setModal({ mode: "create" })}
        extra={<button type="button" className={styles.secondaryBtn} onClick={() => setImportOpen(true)}>⇪ Import CSV</button>}
      />
      <Feedback error={list.error} toast={toast} />
      <DataTable
        columns={[
          { key: "full_name", label: "Full Name", render: (row) => (<><b>{row.full_name}</b><small>{row.email}</small></>) },
          { key: "department_name", label: "Department" },
          { key: "manager_name", label: "Reports To", render: (row) => row.manager_name || <span style={{ color: "#8b8f9e" }}>Unassigned</span> },
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
          fields={modal.mode === "create" ? createFields : editFields(modal.row!.id)}
          initialValues={modal.row ? { full_name: modal.row.full_name, role: modal.row.role, department_id: modal.row.department_id || "", manager_id: modal.row.manager_id || "", is_active: String(modal.row.is_active) } : { role: "employee" }}
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
      {importOpen && (
        <CsvImportModal
          title="Import Employees from CSV"
          token={token}
          importPath="/api/v1/admin/employees/import"
          fields={[
            { key: "full_name", label: "Full Name", required: true },
            { key: "email", label: "Email ID", required: true },
            { key: "department", label: "Department" },
            { key: "manager_email", label: "Manager's Email ID" },
            { key: "role", label: "Role" },
          ]}
          onClose={() => { setImportOpen(false); setReloadKey((k) => k + 1); }}
          onImported={() => setReloadKey((k) => k + 1)}
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
  const [importOpen, setImportOpen] = useState(false);

  return (
    <section>
      <Toolbar
        q={list.q}
        onSearch={list.setQ}
        placeholder="Search the responsibility matrix"
        createLabel="+ Add Activity"
        onCreate={() => setModal({ mode: "create" })}
        extra={<button type="button" className={styles.secondaryBtn} onClick={() => setImportOpen(true)}>⇪ Import CSV</button>}
      />
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
      {importOpen && (
        <CsvImportModal
          title="Import Responsibility Matrix from CSV"
          token={token}
          importPath="/api/v1/admin/activities/import"
          fields={[
            { key: "name", label: "Activity Name", required: true },
            { key: "department", label: "Department", required: true },
            { key: "responsible_role", label: "Responsible Role", required: true },
            { key: "current_person", label: "Current Person" },
            { key: "backup_person", label: "Backup Person" },
            { key: "contact_details", label: "Contact Details", required: true },
            { key: "sla", label: "SLA", required: true },
            { key: "escalation_level_1", label: "Escalation Level 1", required: true },
            { key: "escalation_level_2", label: "Escalation Level 2", required: true },
            { key: "sop_link", label: "SOPGalaxy Link" },
          ]}
          onClose={() => { setImportOpen(false); setReloadKey((k) => k + 1); }}
          onImported={() => setReloadKey((k) => k + 1)}
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

type ContentAsset = { id: string; kind: string; title: string; description: string | null; file_name: string; mime_type: string; size_bytes: number; status: string; message_subtype?: string | null; created_at: string };
type MistakeRow = { id: string; code: string; title: string; description: string; correct_practice: string; category: string; severity: string; status: string; is_seed: boolean };

const CONTENT_KIND_OPTIONS = [
  { value: "document", label: "Document" },
  { value: "video", label: "Video" },
  { value: "sop", label: "SOP File" },
  { value: "mistake_register", label: "Mistake Register Sheet" },
  { value: "template", label: "Template" },
  { value: "image", label: "Image" },
  { value: "onboarding_message", label: "Onboarding Message" },
];

// BUILD PROMPT v5 BLOCK C: who an Onboarding Message is from. Required
// for, and only meaningful on, kind = "onboarding_message" — mirrors the
// DB check constraint content_assets_message_subtype_matches_kind.
const MESSAGE_SUBTYPE_OPTIONS = [
  { value: "welcome", label: "Welcome Message" },
  { value: "founder", label: "Founder" },
  { value: "md", label: "Managing Director" },
  { value: "co_founder", label: "Co-Founder" },
  { value: "management", label: "Management" },
  { value: "hr", label: "HR" },
  { value: "hr_training_video", label: "HR Training Video" },
];
function messageSubtypeLabel(value?: string | null) {
  return MESSAGE_SUBTYPE_OPTIONS.find((o) => o.value === value)?.label || value || "";
}

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
  const [messageSubtype, setMessageSubtype] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [banner, setBanner] = useState("");
  const [progress, setProgress] = useState(0);
  const [busy, setBusy] = useState(false);

  async function handleUpload() {
    const nextErrors: Record<string, string> = {};
    if (!title.trim()) nextErrors.title = "Title is required.";
    if (!file) nextErrors.file = "Choose a file to upload.";
    if (kind === "onboarding_message" && !messageSubtype) nextErrors.message_subtype = "Choose who this message is from.";
    if (Object.keys(nextErrors).length) { setErrors(nextErrors); return; }
    setBusy(true); setBanner(""); setErrors({}); setProgress(10);
    try {
      const prepared = await submitJson("/api/v1/admin/content/upload-url", token, "POST", {
        title: title.trim(), description: description.trim() || undefined, kind,
        message_subtype: kind === "onboarding_message" ? messageSubtype : undefined,
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
        {kind === "onboarding_message" && (
          <div className={styles.field} data-invalid={errors.message_subtype ? "true" : "false"}>
            <label>Message From<span className={styles.required}>*</span></label>
            <select value={messageSubtype} onChange={(e) => setMessageSubtype(e.target.value)}>
              <option value="">Select Message From</option>
              {MESSAGE_SUBTYPE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
            {errors.message_subtype && <p className={styles.fieldError}>{errors.message_subtype}</p>}
          </div>
        )}
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

// Message From is always shown, not conditionally rendered on the Content
// Type selection — FormModal owns its own field values internally, so this
// component has no way to react to the in-progress kind selection until
// submit. Same reasoning as onboarding_stage_items' training_module_id
// field in OnboardingJourneyPanel below: explain via helpText, validate on
// submit, let the (also-real) DB constraint be the final backstop.
function ExternalLinkModal({ token, onCancel, onAdded }: { token: string; onCancel: () => void; onAdded: () => void }) {
  const fields: FieldDef[] = [
    { key: "title", label: "Title", type: "text", required: true },
    { key: "description", label: "Description", type: "textarea" },
    { key: "kind", label: "Content Type", type: "select", required: true, options: CONTENT_KIND_OPTIONS.filter((o) => o.value !== "mistake_register") },
    { key: "message_subtype", label: "Message From", type: "select", options: MESSAGE_SUBTYPE_OPTIONS, helpText: "Only used when Content Type is Onboarding Message." },
    { key: "external_url", label: "Link (YouTube or any URL)", type: "text", required: true, placeholder: "https://www.youtube.com/watch?v=..." },
  ];
  return (
    <FormModal
      title="Add External Link"
      fields={fields}
      initialValues={{ kind: "video" }}
      submitLabel="Add Link"
      onCancel={onCancel}
      onSubmit={async (values) => {
        if (values.kind === "onboarding_message" && !values.message_subtype) throw Object.assign(new Error("Choose who this message is from."), { field: "message_subtype" });
        if (values.kind !== "onboarding_message") values.message_subtype = "";
        await submitJson("/api/v1/admin/content/external", token, "POST", values);
        onAdded();
      }}
    />
  );
}

function ContentLibraryPanel({ token }: { token: string }) {
  const [reloadKey, setReloadKey] = useState(0);
  const [kindFilter, setKindFilter] = useState("");
  const list = usePagedList<ContentAsset>(token, (page, size) => `/api/v1/admin/content?page=${page}&page_size=${size}${kindFilter ? `&kind=${kindFilter}` : ""}`, reloadKey, kindFilter);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
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
        <button type="button" className={styles.secondaryBtn} onClick={() => setLinkOpen(true)}>+ Add External Link</button>
        <button type="button" className={styles.primaryBtn} onClick={() => setUploadOpen(true)}>+ Upload Document or Video</button>
      </div>
      <Feedback error={list.error || error} toast={toast} />
      <DataTable
        columns={[
          { key: "title", label: "Title", render: (row) => (<><b>{row.title}</b><small>{row.file_name ? `${row.file_name} · ${formatBytes(row.size_bytes)}` : "External link"}</small></>) },
          {
            key: "kind",
            label: "Type",
            render: (row) => row.kind === "onboarding_message" ? (
              <><StatusBadge status={row.kind} /><small style={{ display: "block", marginTop: 4 }}>From: {messageSubtypeLabel(row.message_subtype)}</small></>
            ) : (
              <StatusBadge status={row.kind} />
            ),
          },
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
      {linkOpen && (
        <ExternalLinkModal
          token={token}
          onCancel={() => setLinkOpen(false)}
          onAdded={() => { setLinkOpen(false); setReloadKey((k) => k + 1); setToast("Link added successfully."); setTimeout(() => setToast(""), 3000); }}
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
      <div className={styles.adminSubTabs}>
        <button type="button" data-active={tab === "assets"} onClick={() => setTab("assets")}>Documents &amp; Videos</button>
        <button type="button" data-active={tab === "mistakes"} onClick={() => setTab("mistakes")}>Mistake Register</button>
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
// Exec / org health view (BUILD PROMPT v4 item 6)
// ---------------------------------------------------------------------------

type ExecTrendPoint = { score: number; captured_at: string };
type ExecDepartment = { id: string; name: string; employee_count: number; readiness_score: number | null; ownership_coverage: number | null; activity_count: number };
type ExecData = { trend: ExecTrendPoint[]; departments: ExecDepartment[] };

// A small hand-built SVG bar chart rather than a charting library — this is
// a handful of points on a 0-100 axis, not worth a dependency, and it stays
// inside the same token system (readiness/risk colours) as everything else.
function TrendChart({ trend }: { trend: ExecTrendPoint[] }) {
  if (trend.length === 0) return <p className={styles.noRecords}>No records found. Readiness snapshots start accumulating once Admin Overview has been viewed on at least two different days.</p>;
  const width = 640, height = 160, pad = 24;
  const barWidth = (width - pad * 2) / trend.length;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} style={{ width: "100%", height: "auto" }} role="img" aria-label="Org readiness trend over time">
      <line x1={pad} y1={height - pad} x2={width - pad} y2={height - pad} stroke="#e8e9f0" />
      {trend.map((point, index) => {
        const barHeight = ((height - pad * 2) * point.score) / 100;
        const x = pad + index * barWidth;
        const y = height - pad - barHeight;
        return (
          <g key={point.captured_at}>
            <rect x={x + 2} y={y} width={Math.max(2, barWidth - 4)} height={barHeight} rx={3} fill={point.score >= 70 ? "var(--readiness)" : "var(--risk)"} />
            <title>{`${formatDate(point.captured_at)}: ${point.score}%`}</title>
          </g>
        );
      })}
    </svg>
  );
}

function ExecPanel({ token }: { token: string }) {
  const router = useRouter();
  const [data, setData] = useState<ExecData | null>(null);
  const [error, setError] = useState("");
  const activities = useLookup<GraphActivity>(token, "/api/v1/activities");
  useEffect(() => {
    request<ExecData>("/api/v1/admin/exec", token).then(setData).catch((e) => setError(e instanceof Error ? e.message : "Request failed"));
  }, [token]);
  const gapDepartments = (data?.departments || []).filter((d) => d.ownership_coverage !== null && d.ownership_coverage < 50);
  return (
    <section>
      <Feedback error={error} />
      <div className={styles.orgReadiness} style={{ display: "block" }}>
        <b>Org readiness trend</b>
        <p>Captured once a day from the same score shown on Admin Overview — the two can never disagree, because this is that score&apos;s history, not a separate calculation.</p>
        <TrendChart trend={data?.trend || []} />
      </div>
      {gapDepartments.length > 0 && (
        // BUILD PROMPT v5 item B1: this used to just report the gap. It's
        // now a button into the exact screen that fixes it, not a dead
        // end — "reports a problem it can't resolve" was the core
        // diagnosis three independent reviews converged on.
        <div className={styles.error} style={{ marginTop: 16, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <span>
            <b>{gapDepartments.length} department{gapDepartments.length === 1 ? "" : "s"} with an ownership gap:</b>{" "}
            {gapDepartments.map((d) => d.name).join(", ")} — under half of their Responsibility Matrix rows have a named owner.
          </span>
          <button type="button" onClick={() => router.push("/platform/admin/matrix")} style={{ flexShrink: 0, whiteSpace: "nowrap" }}>
            Resolve in Responsibility Matrix →
          </button>
        </div>
      )}
      <DataTable
        columns={[
          { key: "name", label: "Department" },
          { key: "employee_count", label: "Employees" },
          {
            key: "readiness_score",
            label: "Readiness",
            render: (row) =>
              row.readiness_score == null ? (
                <span style={{ color: "#8b8f9e" }}>No training data yet</span>
              ) : (
                <span style={{ fontWeight: 800, color: row.readiness_score >= 70 ? "var(--readiness)" : "var(--risk)" }}>{row.readiness_score}%</span>
              ),
          },
          {
            key: "ownership_coverage",
            label: "Named ownership",
            render: (row) =>
              row.ownership_coverage == null ? (
                <span style={{ color: "#8b8f9e" }}>No responsibilities logged</span>
              ) : (
                <span style={{ fontWeight: 800, color: row.ownership_coverage >= 50 ? "var(--readiness)" : "var(--risk)" }}>{row.ownership_coverage}% of {row.activity_count}</span>
              ),
          },
        ]}
        rows={data?.departments || []}
        rowId={(row) => row.id}
        loading={!data}
      />
      <h3 style={{ marginTop: 28 }}>Org-wide responsibility graph</h3>
      {activities.length > 0 ? (
        <ResponsibilityGraph activities={activities} mode="full" />
      ) : (
        <p className={styles.noRecords}>No records found.</p>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// BUILD PROMPT v5 BLOCK B: configure the stage-gated onboarding journey.
// Stages arrive nested with their items in one call — this screen edits
// both in place rather than being two separate list pages, since an item
// is meaningless without its parent stage's context.
// ---------------------------------------------------------------------------

type JourneyAdminItem = { id: string; stage_id: string; item_type: "training_module" | "content_block" | "custom_task"; training_module_id: string | null; content_asset_id: string | null; content_asset: { title: string; kind: string; message_subtype: string | null } | null; title: string; description: string; sequence: number };
type JourneyAdminStage = { id: string; name: string; description: string; sequence: number; items: JourneyAdminItem[] };

function OnboardingJourneyPanel({ token }: { token: string }) {
  const [stages, setStages] = useState<JourneyAdminStage[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState("");
  const [error, setError] = useState("");
  const [stageModal, setStageModal] = useState<null | { mode: "create" } | { mode: "edit"; row: JourneyAdminStage }>(null);
  const [itemModal, setItemModal] = useState<null | { mode: "create"; stageId: string } | { mode: "edit"; stageId: string; row: JourneyAdminItem }>(null);
  const [confirmDeleteStage, setConfirmDeleteStage] = useState<JourneyAdminStage | null>(null);
  const [confirmDeleteItem, setConfirmDeleteItem] = useState<JourneyAdminItem | null>(null);
  const [busy, setBusy] = useState(false);
  const trainingModules = useLookup<{ id: string; title: string }>(token, "/api/v1/training/modules");
  // BUILD PROMPT v5 BLOCK C: only Onboarding Message assets are offered
  // here — /api/v1/admin/content returns a Paged<T> (not a bare array like
  // useLookup expects), so this is its own small fetch rather than reusing
  // that hook.
  const [messageAssets, setMessageAssets] = useState<{ id: string; title: string; message_subtype: string | null }[]>([]);
  useEffect(() => {
    request<Paged<{ id: string; title: string; message_subtype: string | null }>>("/api/v1/admin/content?kind=onboarding_message&page_size=100", token)
      .then((res) => setMessageAssets(res.items))
      .catch(() => {});
  }, [token]);

  function load() {
    request<JourneyAdminStage[]>("/api/v1/admin/onboarding-stages", token)
      .then((data) => { setStages(data); setError(""); })
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load the onboarding journey."))
      .finally(() => setLoading(false));
  }
  useEffect(() => { load(); }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  const nextStageSequence = stages.length ? Math.max(...stages.map((s) => s.sequence)) + 1 : 1;
  const stageFields: FieldDef[] = [
    { key: "name", label: "Stage Name", type: "text", required: true },
    { key: "description", label: "Description", type: "textarea" },
    { key: "sequence", label: "Sequence", type: "number", required: true, helpText: "Order this stage unlocks in — 1 is first." },
  ];

  function itemFields(stageId: string): FieldDef[] {
    const stage = stages.find((s) => s.id === stageId);
    const nextItemSequence = stage?.items.length ? Math.max(...stage.items.map((i) => i.sequence)) + 1 : 1;
    return [
      { key: "item_type", label: "Item Type", type: "select", required: true, options: [
        { value: "training_module", label: "Training Module (completes automatically)" },
        { value: "custom_task", label: "Custom Task (employee marks it done)" },
        { value: "content_block", label: "Content Block (employee marks it done)" },
      ] },
      { key: "training_module_id", label: "Training Module", type: "select", options: trainingModules.map((m) => ({ value: m.id, label: m.title })), helpText: "Only used when Item Type is Training Module." },
      { key: "content_asset_id", label: "Onboarding Message", type: "select", options: messageAssets.map((m) => ({ value: m.id, label: `${m.title} (${messageSubtypeLabel(m.message_subtype)})` })), helpText: "Only used when Item Type is Content Block — leave blank for a plain acknowledge-this-title item." },
      { key: "title", label: "Title", type: "text", required: true },
      { key: "description", label: "Description", type: "textarea" },
      { key: "sequence", label: "Sequence", type: "number", required: true, helpText: `Order this item appears in the stage — next free slot is ${nextItemSequence}.` },
    ];
  }

  if (loading) return <div className={styles.loading}>Synchronising verified data…</div>;
  return (
    <section>
      <div className={styles.formGrid} style={{ display: "block" }}>
        <p style={{ color: "#7c8090", fontSize: 13, margin: "0 0 16px" }}>
          New employees see these stages, in order, on their dashboard until every stage is complete. A stage unlocks
          once the one before it is fully done. Rules &amp; Regulations acknowledgment isn&apos;t an item type yet —
          that module doesn&apos;t exist yet either.
        </p>
        <Feedback error={error} toast={toast} />
        <button type="button" className={styles.primaryBtn} onClick={() => setStageModal({ mode: "create" })} style={{ marginBottom: 18 }}>
          + Add Stage
        </button>
        {stages.length === 0 && !error && <p style={{ color: "#8b8f9e", fontSize: 13 }}>No stages configured yet — new employees skip straight to the standard dashboard.</p>}
        <div style={{ display: "grid", gap: 16 }}>
          {stages.map((stage) => (
            <div key={stage.id} style={{ border: "1px solid #e8e9f0", borderRadius: 15, padding: "18px 20px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
                <div>
                  <b style={{ fontSize: 15 }}>{stage.sequence}. {stage.name}</b>
                  {stage.description && <p style={{ color: "#878b9a", fontSize: 13, margin: "4px 0 0" }}>{stage.description}</p>}
                </div>
                <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                  <button className={styles.iconBtn} data-tip="Edit" onClick={() => setStageModal({ mode: "edit", row: stage })}>✎</button>
                  <button className={styles.iconBtn} data-tip="Delete" data-danger="true" onClick={() => setConfirmDeleteStage(stage)}>🗑</button>
                </div>
              </div>
              <ul style={{ listStyle: "none", margin: "14px 0 0", padding: 0, display: "grid", gap: 8 }}>
                {stage.items.map((item) => (
                  <li key={item.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, background: "#f8f8fb", borderRadius: 10, padding: "9px 12px" }}>
                    <div>
                      <b style={{ fontSize: 13 }}>{item.title}</b>
                      <small style={{ display: "block", color: "#8b8f9e", fontSize: 12 }}>
                        {item.item_type === "training_module" ? "Training Module (auto)" : item.item_type === "custom_task" ? "Custom Task" : "Content Block"}
                        {item.content_asset ? ` · Linked: ${item.content_asset.title}` : ""}
                        {item.description ? ` · ${item.description}` : ""}
                      </small>
                    </div>
                    <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                      <button className={styles.iconBtn} data-tip="Edit" onClick={() => setItemModal({ mode: "edit", stageId: stage.id, row: item })}>✎</button>
                      <button className={styles.iconBtn} data-tip="Delete" data-danger="true" onClick={() => setConfirmDeleteItem(item)}>🗑</button>
                    </div>
                  </li>
                ))}
              </ul>
              <button type="button" className={styles.secondaryBtn} style={{ marginTop: 12 }} onClick={() => setItemModal({ mode: "create", stageId: stage.id })}>
                + Add Item
              </button>
            </div>
          ))}
        </div>
      </div>

      {stageModal && (
        <FormModal
          title={stageModal.mode === "create" ? "Add Stage" : "Edit Stage"}
          fields={stageFields}
          initialValues={stageModal.mode === "edit" ? { name: stageModal.row.name, description: stageModal.row.description, sequence: stageModal.row.sequence } : { sequence: nextStageSequence }}
          submitLabel={stageModal.mode === "create" ? "Add Stage" : "Save Changes"}
          onCancel={() => setStageModal(null)}
          onSubmit={async (values) => {
            const payload = { ...values, sequence: Number(values.sequence) };
            if (stageModal.mode === "create") await submitJson("/api/v1/admin/onboarding-stages", token, "POST", payload);
            else await submitJson(`/api/v1/admin/onboarding-stages/${stageModal.row.id}`, token, "PATCH", payload);
            setToast(stageModal.mode === "create" ? "Stage added successfully." : "Stage updated successfully.");
            setTimeout(() => setToast(""), 3000);
            setStageModal(null); load();
          }}
        />
      )}
      {itemModal && (
        <FormModal
          title={itemModal.mode === "create" ? "Add Item" : "Edit Item"}
          fields={itemFields(itemModal.stageId)}
          initialValues={
            itemModal.mode === "edit"
              ? { item_type: itemModal.row.item_type, training_module_id: itemModal.row.training_module_id || "", content_asset_id: itemModal.row.content_asset_id || "", title: itemModal.row.title, description: itemModal.row.description, sequence: itemModal.row.sequence }
              : { item_type: "custom_task", sequence: (stages.find((s) => s.id === itemModal.stageId)?.items.length || 0) + 1 }
          }
          submitLabel={itemModal.mode === "create" ? "Add Item" : "Save Changes"}
          onCancel={() => setItemModal(null)}
          onSubmit={async (values) => {
            if (values.item_type === "training_module" && !values.training_module_id) throw Object.assign(new Error("Select a Training Module."), { field: "training_module_id" });
            const payload = {
              ...values, sequence: Number(values.sequence),
              training_module_id: values.item_type === "training_module" ? values.training_module_id : undefined,
              content_asset_id: values.item_type === "content_block" ? values.content_asset_id || undefined : undefined,
            };
            if (itemModal.mode === "create") await submitJson(`/api/v1/admin/onboarding-stages/${itemModal.stageId}/items`, token, "POST", payload);
            else await submitJson(`/api/v1/admin/onboarding-stage-items/${itemModal.row.id}`, token, "PATCH", payload);
            setToast(itemModal.mode === "create" ? "Item added successfully." : "Item updated successfully.");
            setTimeout(() => setToast(""), 3000);
            setItemModal(null); load();
          }}
        />
      )}
      {confirmDeleteStage && (
        <ConfirmDialog
          title="Delete Stage"
          message={`Are you sure you want to delete the stage "${confirmDeleteStage.name}"? Its items and any employee progress on them will be removed too.`}
          busy={busy}
          onCancel={() => setConfirmDeleteStage(null)}
          onConfirm={async () => {
            setBusy(true);
            try {
              await submitJson(`/api/v1/admin/onboarding-stages/${confirmDeleteStage.id}`, token, "DELETE");
              setConfirmDeleteStage(null); load();
            } finally { setBusy(false); }
          }}
        />
      )}
      {confirmDeleteItem && (
        <ConfirmDialog
          title="Delete Item"
          message={`Are you sure you want to delete the item "${confirmDeleteItem.title}"?`}
          busy={busy}
          onCancel={() => setConfirmDeleteItem(null)}
          onConfirm={async () => {
            setBusy(true);
            try {
              await submitJson(`/api/v1/admin/onboarding-stage-items/${confirmDeleteItem.id}`, token, "DELETE");
              setConfirmDeleteItem(null); load();
            } finally { setBusy(false); }
          }}
        />
      )}
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
    case "candidates": return <CandidatesPanel token={token} />;
    case "matrix": return <MatrixPanel token={token} />;
    case "training": return <TrainingPanel token={token} />;
    case "assignments": return <AssignmentsPanel token={token} />;
    case "content": return <ContentSection token={token} />;
    case "journey": return <OnboardingJourneyPanel token={token} />;
    case "feedback": return <FeedbackPanel token={token} />;
    case "audit": return <AuditPanel token={token} />;
    case "exec": return <ExecPanel token={token} />;
    default: return null;
  }
}
