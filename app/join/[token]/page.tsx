"use client";

// BUILD PROMPT v5 BLOCK A: Pre-Joining Portal — genuinely public,
// unauthenticated page. A candidate has no account yet, so this never
// touches PlatformApp's session/auth machinery; it talks straight to
// the public /api/v1/public/preview/{token} routes.

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import styles from "./join.module.css";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

type Preview = {
  candidate_name: string;
  org_name: string;
  department_name: string | null;
  welcome: string;
  expectations_from_you: string;
  expectations_from_us: string;
  rules_available: boolean;
  already_acknowledged: boolean;
  acknowledged_at: string | null;
};

export default function JoinPreviewPage() {
  const params = useParams<{ token: string }>();
  const token = params?.token;
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);

  useEffect(() => {
    if (!token) return;
    fetch(`${API}/api/v1/public/preview/${token}`)
      .then(async (res) => {
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || "This invite link isn't valid.");
        return res.json();
      })
      .then((data: Preview) => {
        setPreview(data);
        setAcknowledged(data.already_acknowledged);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "This invite link isn't valid."));
  }, [token]);

  async function acknowledge() {
    if (!token) return;
    setBusy(true);
    try {
      const res = await fetch(`${API}/api/v1/public/preview/${token}/acknowledge`, { method: "POST" });
      if (!res.ok) throw new Error("Could not record your acknowledgment. Please try again.");
      setAcknowledged(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not record your acknowledgment.");
    } finally {
      setBusy(false);
    }
  }

  if (error) {
    return (
      <main className={styles.shell}>
        <div className={styles.card}>
          <span className={styles.mark}>1</span>
          <h1>Link not found</h1>
          <p>{error}</p>
        </div>
      </main>
    );
  }

  if (!preview) {
    return (
      <main className={styles.shell}>
        <div className={styles.card}>
          <span className={styles.mark}>1</span>
          <p className={styles.loading}>Loading your invitation…</p>
        </div>
      </main>
    );
  }

  return (
    <main className={styles.shell}>
      <div className={styles.card}>
        <span className={styles.mark}>1</span>
        <small className={styles.eyebrow}>{preview.org_name.toUpperCase()} · BEFORE YOU JOIN</small>
        <h1>Hi {preview.candidate_name.split(" ")[0]}, welcome.</h1>
        {preview.department_name && <p className={styles.deptTag}>You&apos;re being considered for {preview.department_name}</p>}

        <section className={styles.block}>
          <h2>Welcome</h2>
          <p>{preview.welcome}</p>
        </section>
        <section className={styles.block}>
          <h2>What we expect from you</h2>
          <p>{preview.expectations_from_you}</p>
        </section>
        <section className={styles.block}>
          <h2>What you can expect from us</h2>
          <p>{preview.expectations_from_us}</p>
        </section>

        {!preview.rules_available && (
          <div className={styles.note}>
            The detailed rules &amp; regulations list isn&apos;t published to this preview yet — you&apos;ll get the full,
            department-specific list as part of onboarding once you join.
          </div>
        )}

        <div className={styles.ackRow}>
          {acknowledged ? (
            <div className={styles.ackDone}>✓ You&apos;ve confirmed you understand these expectations. Thank you.</div>
          ) : (
            <button type="button" className={styles.ackButton} disabled={busy} onClick={acknowledge}>
              {busy ? "Recording…" : "I have read and understand these expectations, and I want to proceed with joining"}
            </button>
          )}
        </div>
      </div>
    </main>
  );
}
