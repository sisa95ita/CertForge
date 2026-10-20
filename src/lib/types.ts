export interface EvaluationResult {
  status: "correct" | "partial" | "incorrect";
  score: number;
}

export type QuestionType = "single-choice" | "multiple-choice" | "yes-no-matrix" | "statement-completion";
export type SimulationMode = "training" | "exam";

export type YesNo = "yes" | "no";
export interface MatrixStatement { id: string; text: string; correctAnswer: YesNo; explanation: string }

export interface SnapshotQuestion {
  bankTitle: string;
  certification: { name: string; code: string };
  id: string;
  domain: string;
  topic: string;
  difficulty: string;
  type: QuestionType;
  question: string;
  answers: { id: string; text: string }[];
  correctAnswers: string[];
  statements?: MatrixStatement[];
  explanation: string;
  learnReference?: { title: string; url: string };
}

export interface SimulationQuestionView {
  position: number;
  question: SnapshotQuestion;
  selectedAnswers: string[];
  locked: boolean;
  correct: boolean | null;
  evaluation: EvaluationResult | null;
  forReview: boolean;
}

export interface SimulationView {
  id: string;
  mode: SimulationMode;
  status: "in-progress" | "completed";
  createdAt: string;
  startedAt: string;
  completedAt: string | null;
  durationLimitSeconds: number | null;
  currentPosition: number;
  retriedFromSimulationId: string | null;
  questions: SimulationQuestionView[];
}
