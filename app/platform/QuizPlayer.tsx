"use client";

import { useEffect, useState } from "react";
import styles from "./platform.module.css";
import { request } from "./PlatformApp";

type QuizQuestion = { id: string; prompt: string; options: string[] };
type QuizPayload = { module_id: string; title: string; passing_score: number; questions: QuizQuestion[] };
type AttemptResult = { score: number; passed: boolean; passing_score: number; correct: number; total: number; explanations: string[] };

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

          {!loading && quiz && !result && (
            <div className={styles.quizList}>
              <p className={styles.quizIntro}>
                Answer every question, then submit. You need {quiz.passing_score}% to pass.
              </p>
              {quiz.questions.map((question, index) => (
                <div key={question.id} className={styles.quizQuestion}>
                  <b>
                    {index + 1}. {question.prompt}
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
              <span>{result.passed ? "✓ ASSESSMENT PASSED" : "RETAKE REQUIRED"}</span>
              <h2>
                {result.score}% · {result.correct}/{result.total} correct
              </h2>
              <p>
                {result.passed
                  ? "A certificate has been issued and the next module is now unlocked."
                  : `You need ${result.passing_score}% to pass. Review the explanations below and retake when ready.`}
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
              {!loading && quiz && !allAnswered && (
                <small style={{ marginRight: "auto", alignSelf: "center", color: "#7b7f8f" }}>
                  Select an answer for every question to continue.
                </small>
              )}
              <button type="button" className={styles.secondaryBtn} onClick={onClose} disabled={submitting}>
                Cancel
              </button>
              <button type="button" className={styles.primaryBtn} disabled={!allAnswered || submitting} onClick={submit}>
                {submitting ? "Submitting…" : "Submit assessment"}
              </button>
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
