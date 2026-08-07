"use client";

import { FormEvent, useState } from "react";
import styles from "./platform.module.css";
import { API } from "./PlatformApp";

type SignupSession = {
  access_token: string;
  user: { name: string; email: string; role: string };
};

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63);
}

export default function OrgSignup({
  onSignedUp,
  onBack,
}: {
  onSignedUp: (session: SignupSession) => void;
  onBack: () => void;
}) {
  const [organizationName, setOrganizationName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [banner, setBanner] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const nextErrors: Record<string, string> = {};
    if (organizationName.trim().length < 2) nextErrors.organization_name = "Organisation Name is required.";
    if (!slug || slug.length < 2) nextErrors.organization_slug = "Organisation URL is required.";
    if (fullName.trim().length < 2) nextErrors.full_name = "Full Name is required.";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) nextErrors.email = "Enter a valid Email ID.";
    if (password.length < 8) nextErrors.password = "Password must be at least 8 characters.";
    if (Object.keys(nextErrors).length) { setErrors(nextErrors); return; }

    setBusy(true); setBanner(""); setErrors({});
    try {
      const response = await fetch(`${API}/api/v1/organizations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organization_name: organizationName.trim(),
          organization_slug: slug,
          full_name: fullName.trim(),
          email,
          password,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const detail = typeof data.detail === "object" ? data.detail : data;
        const message: string = detail?.detail || "Could not create the organisation.";
        const field: string | undefined = detail?.field;
        if (field) setErrors({ [field]: message.endsWith(".") ? message : `${message}.` });
        else setBanner(message.endsWith(".") ? message : `${message}.`);
        return;
      }
      onSignedUp(data as SignupSession);
    } catch {
      setBanner("Could not reach the API. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className={styles.loginCard} onSubmit={handleSubmit}>
      <a href="#" onClick={(e) => { e.preventDefault(); onBack(); }}>← Back to sign in</a>
      <span className={styles.mark}>+</span>
      <h2>Create your organisation</h2>
      <p>Your own tenant, starter training curriculum and administrator account — ready in seconds.</p>
      {banner && <div className={styles.error}>{banner}</div>}
      <div className={styles.field} data-invalid={errors.organization_name ? "true" : "false"}>
        <label>Organisation Name<span className={styles.required}>*</span></label>
        <input
          value={organizationName}
          placeholder="Enter Organisation Name"
          onChange={(e) => {
            setOrganizationName(e.target.value);
            if (!slugTouched) setSlug(slugify(e.target.value));
          }}
        />
        {errors.organization_name && <p className={styles.fieldError}>{errors.organization_name}</p>}
      </div>
      <div className={styles.field} data-invalid={errors.organization_slug ? "true" : "false"}>
        <label>Organisation URL<span className={styles.required}>*</span></label>
        <input
          value={slug}
          placeholder="e.g. acme-robotics"
          onChange={(e) => { setSlugTouched(true); setSlug(slugify(e.target.value)); }}
        />
        {errors.organization_slug && <p className={styles.fieldError}>{errors.organization_slug}</p>}
      </div>
      <div className={styles.field} data-invalid={errors.full_name ? "true" : "false"}>
        <label>Full Name<span className={styles.required}>*</span></label>
        <input value={fullName} placeholder="Enter Full Name" onChange={(e) => setFullName(e.target.value)} />
        {errors.full_name && <p className={styles.fieldError}>{errors.full_name}</p>}
      </div>
      <div className={styles.field} data-invalid={errors.email ? "true" : "false"}>
        <label>Email ID<span className={styles.required}>*</span></label>
        <input type="email" value={email} placeholder="Enter Email ID" onChange={(e) => setEmail(e.target.value)} />
        {errors.email && <p className={styles.fieldError}>{errors.email}</p>}
      </div>
      <div className={styles.field} data-invalid={errors.password ? "true" : "false"}>
        <label>Password<span className={styles.required}>*</span></label>
        <input type="password" value={password} placeholder="Enter Password" minLength={8} onChange={(e) => setPassword(e.target.value)} />
        {errors.password ? <p className={styles.fieldError}>{errors.password}</p> : <small>At least 8 characters.</small>}
      </div>
      <button disabled={busy}>{busy ? "Creating your organisation…" : "Create organisation →"}</button>
    </form>
  );
}
