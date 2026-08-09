"use client";

import { useEffect, useState } from "react";
import styles from "./platform.module.css";
import { request } from "./PlatformApp";

// QA REMEDIATION BLOCKER 2: weight_percent — how much this question
// counts toward the overall score. Always present (defaults to 100 on
// the backend), only shown to the employee when it differs from the
// equal-weight default so a legacy all-100 quiz looks unchanged.
type QuizQuestion = { id: string; prompt: string; options: string[]; weight_percent: number };
// BUILD PROMPT v5 BLOCK F: max_attempts/attempts_used/attempts_remaining/
// onboarding_blocked are shown upfront — before the employee starts —
// not just discovered after they've already failed enough times to hit
// a surprise block.
type QuizPayload = { module_id: string; title: string; passing_score: number; questions: QuizQuestion[]; max_attempts: number; attempts_used: number; attempts_remaining: number; onboarding_blocked: boolean };
type AttemptResult = { score: number; passed: boolean; passing_score: number; correct: number; total: number; explanations: string[]; max_attempts: number; attempts_used: number; attempts_remaining: number; onboarding_blocked: boolean };

export default function QuizPlayer({
  moduleId,
  token,
  onClose,
  onCompleted,
}: {
  moduleId: string;
  token: string;
  onClose: () => void;
  onCompleted: (result: AttemptResult) => void;
}) {
  const [quiz, setQuiz] = useState<QuizPayload | null>(null);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<AttemptResult | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setLoading(true);
      request<QuizPayload>(`/api/v1/training/modules/${moduleId}/quiz`, token)
        .then(setQuiz)
        .catch((e) => setError(e instanceof Error ? e.message : "Could not load the assessment."))
        .finally(() => setLoading(false));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [moduleId, token]);

  const allAnswered = quiz ? quiz.questions.every((q) => answers[q.id] !== undefined) : false;

  async function submit() {
    if (!quiz || !allAnswered) return;
    setSubmitting(true);
    setError("");
    try {
      const payload = quiz.questions.map((q) => answers[q.id]);
      const response = await request<AttemptResult>(`/api/v1/training/modules/${moduleId}/attempt`, token, {
        method: "POST",
        body: JSON.stringify({ answers: payload }),
      });
      setResult(response);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not submit the assessment.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className={styles.modalOverlay} onMouseDown={(e) => { if (e.target === e.currentTarget && !submitting) onClose(); }}>
      <div className={styles.modalPanel} data-wide="true">
        <div className={styles.modalHeader}>
          <h3>{quiz ? quiz.title : "Assessment"}</h3>
          <button type="button" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className={styles.modalBody}>
          {loading && <div className={styles.loading}>Loading the assessment…</div>}
          {error && <div className={styles.error}>{error}</div>}

          {!loading && quiz && !result && quiz.onboarding_blocked && (
            <div className={styles.quizResult} data-passed="false">
              <span>ATTEMPTS EXHAUSTED</span>
              <h2>You&apos;ve used all {quiz.max_attempts} attempts without passing.</h2>
              <p>Ask your admin or manager to reset your attempts for this assessment before trying again.</p>
            </div>
          )}
          {!loading && quiz && !result && !quiz.onboarding_blocked && (
            <div className={styles.quizList}>
              {/* BUILD PROMPT v5 BLOCK F: labelled score display — the
                  scale, what it measures and the threshold, all stated
                  up front, not just a bare number. */}
              <p className={styles.quizIntro}>
                Answer every question, then submit. Some questions count more toward your score than others — you
                need {quiz.passing_score}% to pass. Attempts remaining: {quiz.attempts_remaining} of {quiz.max_attempts}.
              </p>
              {quiz.questions.map((question, index) => (
                <div key={question.id} className={styles.quizQuestion}>
                  <b>
                    {index + 1}. {question.prompt}
                    {question.weight_percent !== 100 && (
                      <small style={{ fontWeight: 400, color: "#8b8f9e", marginLeft: 8 }}>
                        (counts {question.weight_percent}% toward your score)
                      </small>
                    )}
                  </b>
                  <div className={styles.quizOptions}>
                    {question.options.map((option, optionIndex) => (
                      <label key={optionIndex} className={styles.quizOption} data-selected={answers[question.id] === optionIndex ? "true" : "false"}>
                        <input
                          type="radio"
                          name={`question-${question.id}`}
                          checked={answers[question.id] === optionIndex}
                          onChange={() => setAnswers((prev) => ({ ...prev, [question.id]: optionIndex }))}
                        />
                        {option}
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {result && (
            <div className={styles.quizResult} data-passed={result.passed ? "true" : "false"}>
              <span>{result.passed ? "✓ ASSESSMENT PASSED" : result.onboarding_blocked ? "ATTEMPTS EXHAUSTED" : "RETAKE REQUIRED"}</span>
              {/* Labelled score display: the scale (percentage of
                  questions answered correctly), what it measures
                  (correct/total), and the threshold it's judged
                  against — not a bare number. */}
              <h2>
                Score: {result.score}% ({result.correct} of {result.total} correct) · Passing threshold: {result.passing_score}%
              </h2>
              <p>
                {result.passed
                  ? "A certificate has been issued and the next module is now unlocked."
                  : result.onboarding_blocked
                    ? "You've used all your attempts without passing. Ask your admin or manager to reset your attempts before trying again."
                    : `You need ${result.passing_score}% to pass. Review the explanations below and retake when ready — attempts remaining: ${result.attempts_remaining} of ${result.max_attempts}.`}
              </p>
              <ol className={styles.quizExplanations}>
                {result.explanations.map((explanation, index) => (
                  <li key={index}>{explanation}</li>
                ))}
              </ol>
            </div>
          )}
        </div>
        <div className={styles.modalFooter}>
          {!result ? (
            <>
              {!loading && quiz && !quiz.onboarding_blocked && !allAnswered && (
                <small style={{ marginRight: "auto", alignSelf: "center", color: "#7b7f8f" }}>
                  Select an answer for every question to continue.
                </small>
              )}
              <button type="button" className={styles.secondaryBtn} onClick={onClose} disabled={submitting}>
                {quiz?.onboarding_blocked ? "Close" : "Cancel"}
              </button>
              {!quiz?.onboarding_blocked && (
                <button type="button" className={styles.primaryBtn} disabled={!allAnswered || submitting} onClick={submit}>
                  {submitting ? "Submitting…" : "Submit assessment"}
                </button>
              )}
            </>
          ) : (
            <button type="button" className={styles.primaryBtn} onClick={() => onCompleted(result)}>
              Done
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
