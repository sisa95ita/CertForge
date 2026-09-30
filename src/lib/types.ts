export type QuestionType = "single-choice" | "multiple-choice";
export type SimulationMode = "training" | "exam";

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
  explanation: string;
  learnReference?: { title: string; url: string };
}

export interface SimulationQuestionView {
  position: number;
  question: SnapshotQuestion;
  selectedAnswers: string[];
  locked: boolean;
  correct: boolean | null;
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
  questions: SimulationQuestionView[];
}
