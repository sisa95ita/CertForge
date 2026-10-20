"use client";

import { Fragment, useId } from "react";
import { useLocale, useTranslations } from "next-intl";
import { correctAnswerIds, matrixSelection } from "@/lib/question-answers";
import type { SimulationQuestionView, SnapshotQuestion, YesNo } from "@/lib/types";

export function CompletionQuestion({ question, selected, disabled, onChange }: {
  question: SnapshotQuestion; selected: readonly string[]; disabled: boolean; onChange: (id: string) => void;
}) {
  const t = useTranslations("Simulation");
  const id = useId();
  const [before, after] = question.question.split("{{blank}}");
  return <label htmlFor={id}>{before}<select id={id} className="mx-1 inline-block max-w-full rounded-lg border-2 border-slate-300 bg-white p-2 text-base font-normal" value={selected[0] ?? ""} disabled={disabled} onChange={(event) => onChange(event.target.value)}>
    <option value="" disabled>{t("selectAnswer")}</option>
    {question.answers.map((answer) => <option key={answer.id} value={answer.id}>{answer.text}</option>)}
  </select>{after}</label>;
}

export function MatrixQuestion({ question, selected, disabled, feedback, onChange }: {
  question: SnapshotQuestion; selected: readonly string[]; disabled: boolean; feedback: boolean;
  onChange?: (statementId: string, answer: YesNo) => void;
}) {
  const t = useTranslations("Simulation");
  const c = useTranslations("Common");
  const r = useTranslations("Results");
  const prefix = useId();
  return <div className="mt-6 overflow-x-auto"><table className="w-full border-collapse text-left">
    <caption className="muted mb-3 text-left text-sm">{t("selectYesNo")}</caption>
    <thead><tr className="border-b border-slate-200"><th scope="col" className="p-2">{t("statement")}</th><th scope="col" className="min-w-16 p-2 text-center">{c("yes")}</th><th scope="col" className="min-w-16 p-2 text-center">{c("no")}</th></tr></thead>
    <tbody>{question.statements?.map((statement, index) => {
      const answer = matrixSelection(selected, statement.id);
      const correct = answer === statement.correctAnswer;
      return <Fragment key={statement.id}>
        <tr className="border-b border-slate-200">
          <th scope="row" className="p-3 font-normal">{statement.text}</th>
          <td colSpan={2} className="p-2"><fieldset className="grid grid-cols-2">
            <legend className="sr-only">{statement.text}</legend>
            {(["yes", "no"] as const).map((value) => <label key={value} className="flex min-h-11 cursor-pointer items-center justify-center p-2">
              <input type="radio" name={`${prefix}-${index}`} checked={answer === value} disabled={disabled} onChange={() => onChange?.(statement.id, value)} />
              <span className="sr-only">{c(value)}</span>
            </label>)}
          </fieldset></td>
        </tr>
        {feedback && <tr><td colSpan={3} className="bg-slate-50 p-3 text-sm">
          <p className={correct ? "good font-bold" : "bad font-bold"}>{c(correct ? "correct" : "incorrect")}</p>
          <p className="mt-1">{r("yourAnswer")}: {answer ? c(answer) : r("noAnswer")} · {r("correctAnswer")}: {c(statement.correctAnswer)}</p>
          <p className="mt-2 leading-7">{statement.explanation}</p>
        </td></tr>}
      </Fragment>;
    })}</tbody>
  </table></div>;
}

export function MatrixCredit({ item }: { item: SimulationQuestionView }) {
  const c = useTranslations("Common");
  const locale = useLocale();
  const correct = correctAnswerIds(item.question).filter((id) => item.selectedAnswers.includes(id)).length;
  const credit = new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(item.evaluation?.score ?? 0);
  return <div className="mt-2 text-sm"><p>{c("statementsCorrect", { correct, total: 3 })}</p><p>{c("questionCredit", { credit })}</p></div>;
}

function completedStatement(question: SnapshotQuestion, selected: readonly string[], noAnswer: string): string {
  const text = question.answers.find((answer) => selected.includes(answer.id))?.text ?? noAnswer;
  return question.question.replace("{{blank}}", () => text);
}

export function CompletionReview({ question, selected }: { question: SnapshotQuestion; selected: readonly string[] }) {
  const r = useTranslations("Results");
  const text = (ids: readonly string[]) => question.answers.find((answer) => ids.includes(answer.id))?.text ?? r("noAnswer");
  return <dl className="mt-4 grid gap-3 text-sm">
    <div><dt className="font-bold">{r("yourAnswer")}</dt><dd className="muted mt-1">{text(selected)}</dd></div>
    <div><dt className="font-bold">{r("correctAnswer")}</dt><dd className="muted mt-1">{text(question.correctAnswers)}</dd></div>
    <div><dt className="font-bold">{r("correctCompletion")}</dt><dd className="mt-1">{completedStatement(question, question.correctAnswers, r("noAnswer"))}</dd></div>
  </dl>;
}
