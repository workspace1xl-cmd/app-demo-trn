"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import styles from "./platform.module.css";
import { request } from "./PlatformApp";

// BUILD PROMPT v4 item 7: extends the existing Claude-grounded search
// (/api/v1/search — already answers "who do I ask about X" from RACI data,
// not just documents, per its context-building in the Edge Function) into
// a persistent, proactive chat affordance available from every screen,
// instead of only the one-shot Knowledge search view. It calls the exact
// same endpoint Knowledge search does — this is a second surface for the
// same verified answers, not a second AI integration.
type ChatTurn = { role: "user" | "assistant" | "nudge"; text: string; unresolved?: boolean };
type Notification = { id: string; kind: string; subject: string; payload: Record<string, unknown> };
type TrainingModule = { id: string; sequence: number; title: string; progress?: { status: string } | null };

export default function AiAssistant({ token, unreadCount, notifications }: { token: string; unreadCount: number; notifications: Notification[] }) {
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [greeted, setGreeted] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Proactive nudges: the first time someone opens the assistant in a
  // session, it leads with what actually needs attention — unread
  // reminders and the next incomplete training module — instead of
  // waiting to be asked. Reuses item 5's notifications (already fetched by
  // the parent) rather than recomputing overdue/expiry logic a third time.
  useEffect(() => {
    if (!open || greeted) return;
    setGreeted(true);
    const nudges: ChatTurn[] = [];
    if (unreadCount > 0) {
      const first = notifications[0];
      nudges.push({
        role: "nudge",
        text: `You have ${unreadCount} unread notification${unreadCount === 1 ? "" : "s"}${first ? ` — most recently "${first.subject}"` : ""}. Check the bell for details.`,
      });
    }
    request<TrainingModule[]>("/api/v1/training/modules", token)
      .then((modules) => {
        const next = modules.filter((m) => m.progress?.status !== "completed").sort((a, b) => a.sequence - b.sequence)[0];
        if (next) nudges.push({ role: "nudge", text: `Your next training module is "${next.title}". Ask me anything, or head to My learning when you're ready.` });
        if (nudges.length === 0) nudges.push({ role: "nudge", text: "You're fully caught up on training and notifications. Ask me anything — who owns a process, what a policy says, or how to do something." });
        setTurns(nudges);
      })
      .catch(() => setTurns(nudges.length ? nudges : [{ role: "nudge", text: "Ask me anything — who owns a process, what a policy says, or how to do something." }]));
  }, [open, greeted, token, unreadCount, notifications]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [turns, busy]);

  async function ask(event: FormEvent) {
    event.preventDefault();
    const q = query.trim();
    if (!q || busy) return;
    setTurns((prev) => [...prev, { role: "user", text: q }]);
    setQuery("");
    setBusy(true);
    try {
      const result = await request<{ answer: string; unresolved?: boolean }>("/api/v1/search", token, {
        method: "POST",
        body: JSON.stringify({ query: q }),
      });
      setTurns((prev) => [...prev, { role: "assistant", text: result.answer, unresolved: result.unresolved }]);
    } catch (e) {
      setTurns((prev) => [...prev, { role: "assistant", text: e instanceof Error ? e.message : "Something went wrong answering that." }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.assistantWrap}>
      {open && (
        <div className={styles.assistantPanel} role="dialog" aria-label="AI assistant">
          <div className={styles.assistantHead}>
            <b>OneWork Assistant</b>
            <button type="button" onClick={() => setOpen(false)} aria-label="Close assistant">
              ✕
            </button>
          </div>
          <div className={styles.assistantBody} ref={scrollRef}>
            {turns.map((t, i) => (
              <div key={i} className={t.role === "user" ? styles.assistantUserTurn : styles.assistantBotTurn} data-nudge={t.role === "nudge" ? "true" : undefined}>
                {t.text}
                {t.unresolved && <small> — This has been logged for the knowledge team to review.</small>}
              </div>
            ))}
            {busy && <div className={styles.assistantBotTurn}>Checking verified sources…</div>}
          </div>
          <form className={styles.assistantForm} onSubmit={ask}>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Ask who owns something, or how to do it…"
              disabled={busy}
            />
            <button type="submit" disabled={busy || !query.trim()}>
              →
            </button>
          </form>
        </div>
      )}
      <button
        type="button"
        className={styles.assistantLauncher}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label="Open AI assistant"
      >
        {open ? "✕" : "✦"}
      </button>
    </div>
  );
}
