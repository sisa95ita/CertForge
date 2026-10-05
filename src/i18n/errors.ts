import type { useTranslations } from "next-intl";

type Translator = ReturnType<typeof useTranslations>;

const messages: Record<string, string> = {
  "Import failed": "importFailed",
  "Could not create simulation": "createFailed",
  "Could not retry simulation": "retryFailed",
  "Could not save your progress": "saveProgress",
  "Could not submit": "submitFailed",
  "Could not save answer": "saveAnswer",
  "Could not save position": "savePosition",
  "Could not confirm answer": "confirmAnswer",
  "Could not save review flag": "saveReview",
  "No questions match these filters": "noQuestions",
  "Choose at least one JSON file": "chooseFile",
  "Only .json files are supported": "jsonOnly",
  "Could not read this file": "readFile",
  "The import could not be processed": "processImport",
  "Database import failed": "databaseImport",
  "Simulation not found": "simulationNotFound",
  "Could not load simulation": "loadSimulation",
  "Could not update simulation": "updateSimulation",
  "Invalid action": "invalidAction",
  "Only completed simulations can be retried": "retryCompleted",
  "Simulation has no questions": "emptySimulation",
  "Simulation is already complete": "alreadyComplete",
  "Time expired; the exam was submitted": "timeExpired",
  "Question not found": "questionNotFound",
  "This answer is locked": "locked",
  "This answer is already locked": "alreadyLocked",
  "An answer option is invalid": "invalidOption",
  "Select only one answer": "oneAnswer",
  "Review flags are only available in exam mode": "reviewExam",
  "Answers are confirmed only in training mode": "confirmTraining",
  "Select at least one answer before confirming": "selectBeforeConfirm",
  "Question count must be a positive integer": "positiveCount",
  "Option id is required": "optionId",
  "Option text is required": "optionText",
  "Reference URL must be an HTTPS learn.microsoft.com URL": "referenceUrl",
  "Answer option ids must be unique": "uniqueOptions",
  "Correct answers must be unique": "uniqueCorrect",
  "A single-choice question must have exactly one correct answer": "singleCorrect",
  "A multiple-choice question must have at least two correct answers": "multipleCorrect",
  "Only schema version 1 is supported": "schemaVersion",
  "Question bank cannot be empty": "emptyBank"
};

// The service layer retains its original errors and validation behavior.
// Only displayed errors are localized; question-bank content never passes here.
export function translateError(t: Translator, message: string, fallback = "unexpected"): string {
  if (t.has(message)) return t(message);
  const key = messages[message];
  if (key) return t(key);
  if (message.startsWith("Malformed JSON:")) return t("malformedJson");
  const field = message.match(/^([^:]+): (.+)$/s);
  if (field && !message.startsWith("Invalid ") && !message.startsWith("Too ")) return t("field", { path: field[1] === "document" ? t("document") : field[1], message: translateError(t, field[2], "validationFailed") });
  const available = message.match(/^Only (\d+) questions are available for the selected filters$/);
  if (available) return t("availableQuestions", { count: Number(available[1]) });
  const answers = message.match(/^Select at most (\d+) answers$/);
  if (answers) return t("atMostAnswers", { count: Number(answers[1]) });
  const schema = message.match(/^Database schema version (\d+) is newer than this CertForge build supports$/);
  if (schema) return t("schemaTooNew", { version: Number(schema[1]) });
  const missing = message.match(/^Correct answer '(.+)' does not reference an option$/);
  if (missing) return t("missingOption", { id: missing[1] });
  const duplicate = message.match(/^Duplicate question id '(.+)'$/);
  if (duplicate) return t("duplicateQuestion", { id: duplicate[1] });
  const minimum = message.match(/^Too small: .*?>=(\d+)/);
  if (minimum) return t("tooSmall", { minimum: Number(minimum[1]) });
  const maximum = message.match(/^Too big: .*?<=(\d+)/);
  if (maximum) return t("tooBig", { maximum: Number(maximum[1]) });
  if (message.startsWith("Invalid ")) return t("invalidValue");
  return t(fallback);
}
