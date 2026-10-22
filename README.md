# CertForge

CertForge is a local-first, certification-agnostic exam simulator. Import versioned JSON question banks, run self-paced training or timed exams, and review progress. Question banks, active sessions, answers, and history live in a local SQLite database; there are no accounts or cloud services.

## Requirements

- Node.js 20.9 or newer (Node.js 22 LTS is recommended)
- npm
- A local build toolchain supported by `better-sqlite3` if a prebuilt binary is unavailable

## Run locally

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Pending TypeORM migrations run automatically on first database use.

For a production-style local run:

```bash
npm run build
npm start
```

Useful checks:

```bash
npm run lint
npm run typecheck
npm test
```

## Local database

Persistence uses TypeORM repositories and QueryBuilder with SQLite's `better-sqlite3` driver, WAL mode, and foreign-key enforcement. The default file is `data/certforge.db`; set `CERTFORGE_DB_PATH` to use another location. The parent directory is created automatically. Adjacent WAL/SHM files are ignored by Git.

`synchronize: false` is intentional. Explicit TypeORM migrations run automatically on first use through a shared initialization promise; failures abort initialization. The baseline adopts existing version 1/2 databases in place, preserves historical data, and backfills version 1 binary score contributions. Existing `PRAGMA user_version` values are retained; TypeORM's `migrations` table tracks all future changes. No database deletion or manual SQL is required to upgrade.

```bash
npm run db:migrate
npm run db:migration:generate -- src/lib/persistence/migrations/AddFeature
npm run db:migration:revert
```

The CLI uses `tsx` and the same data source configuration as the app, with the server-only Node condition. Stop the app before CLI schema changes. Legacy SQLite constraints are unnamed, so generated output can include constraint-name changes and table rebuilds; review these and use explicit migrations to avoid unnecessary changes. Register each exported migration class in `src/lib/persistence/data-source.ts` so it is included in production bundles. Give each migration a stable `name` property ending in its timestamp, as in the baseline, to survive Next.js minification. Revert undoes the latest reversible migration; the adoption baseline refuses to revert because doing so would destroy local data. Pending reverted migrations run again on the next app start.

To deliberately reset all local data, stop CertForge and delete the configured database plus its `-wal` and `-shm` files. The next start creates an empty database through the migrations. Tests use isolated in-memory data sources and the same migration files; legacy compatibility tests use a frozen pre-TypeORM fixture.

## Importing question banks

Use **Import Question Banks** and select or drop one or more `.json` files. The complete document is validated with Zod before any rows are written. Every file has its own SQLite transaction, so an invalid file cannot be partially imported.

The top-level `id` is the bank's permanent UUID. Filenames do not define identity:

- A new UUID is imported.
- The same UUID and version is skipped.
- A lower version is skipped when a newer one is installed.
- A higher version becomes current while older immutable versions remain stored.

Simulation questions are additionally snapshotted when a session starts. Consequently, bank updates cannot alter historical questions, options, correct answers, explanations, or references.

## JSON format

Schema version 1 supports `single-choice` and `multiple-choice`. Multiple-choice questions require at least two correct answer IDs. Answer IDs must be unique within a question, and every `correctAnswers` value must reference an answer. Learn references, when present, must use a valid `https://learn.microsoft.com/...` URL.

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "schemaVersion": 1,
  "version": 1,
  "title": "Example Practice Set",
  "description": "Example questions",
  "certification": { "name": "Example Certification", "code": "EX-100" },
  "questions": [
    {
      "id": "example-q001",
      "domain": "Domain name",
      "topic": "Topic name",
      "difficulty": "medium",
      "type": "single-choice",
      "question": "Question text?",
      "answers": [
        { "id": "a", "text": "First answer" },
        { "id": "b", "text": "Second answer" }
      ],
      "correctAnswers": ["b"],
      "explanation": "Why this answer is correct.",
      "learnReference": {
        "title": "Related Microsoft Learn page",
        "url": "https://learn.microsoft.com/..."
      }
    }
  ]
}
```

[`examples/demo-question-bank.json`](examples/demo-question-bank.json) is a small generic bank demonstrating both question types, domains, topics, explanations, and references. It is demo data—not certification study content.


### Schema version 2

V2 retains the same bank UUID/version semantics and also supports `yes-no-matrix` and `statement-completion`. V1 banks remain supported as imported; no conversion or database reset is needed. V2 difficulty is one of `easy`, `medium`, or `hard`. See [`examples/demo-question-bank-v2.json`](examples/demo-question-bank-v2.json) for an importable example.

- A matrix contains exactly three `statements`, each with a unique stable `id`, non-empty `text` and `explanation`, and a `correctAnswer` of `yes` or `no`. The overall explanation is optional. Each correct row earns one third of a point; unanswered rows earn zero. Training requires all rows before confirmation. Exams allow partial answers and submission.
- A completion question has exactly one `{{blank}}` token, at least two unique answer options, and exactly one correct option ID. Its inline dropdown displays answer text and scores either zero or one point. Its explanation is required.

Training locks confirmed answers and reveals feedback, explanations, and Learn references. Exams reveal feedback in results. Both new types use the existing normalized score and domain/topic statistics.

The explicit `QuestionTypesV21792454400000` TypeORM migration expands the question-type constraint and adds nullable `questions.statements_json`. TypeORM manages the SQLite table rebuild and preserves existing rows, indexes, options, answers, and historical scores. Matrix selections use collision-safe statement-ID/Yes-No pairs in the existing saved-answer records. Simulation snapshots preserve all matrix content and statement order; completion snapshots preserve the shuffled option order and stable IDs across navigation, refresh, and restart. Retry uses historical snapshots, clears selections, and reshuffles completion options. The migration refuses downgrade to avoid losing V2 question data.

## Simulations and scoring (V1.1)

Choose **All available** to include the entire filtered pool, or **Custom** for exposure-aware selection within the existing domain/topic composition. Question and answer option orders are randomized at creation and saved in each simulation snapshot.

History lists individual completed attempts with **Review**, **Retry**, and **Delete**. Retry creates a fresh attempt in the same mode, with the same time limit and historical question content, even after bank updates. Question and option order are shuffled again; answers, review flags, and timing start fresh. Progress separately aggregates completed attempts.

Single-choice scoring remains binary. Multiple-choice questions allow at most the required number of selections and earn credit for each correctly selected component, without negative marking. Training evaluates only after confirmation. Overall, domain, and topic percentages use earned credit divided by question count.

The TypeORM baseline preserves imported banks, historical snapshots, and previously recorded scores. Existing version 1 evaluated questions retain their original binary credit; new attempts use fractional credit.

## UI languages

CertForge uses next-intl with Italian as the default UI language. `/` redirects to `/it`; English is available at `/en`. The header language switcher preserves the current route (including simulation IDs), query string and fragment. Existing page paths keep their names under `/it` and `/en`; API paths remain under `/api`.

UI messages live in `messages/it.json` and `messages/en.json`. Question-bank text and metadata retain their imported language and are independent of the UI language. Locale changes do not write to the database or create simulations.

## Catalog management and exposure-aware selection

The Import page lists installed banks with their current version and question count. Deletion removes the bank and every imported catalog version, question and option in one transaction. Historical active/completed snapshots, answers, scoring, explanations and Learn references survive; Retry still uses those snapshots. The same UUID/version can subsequently be imported again.

History supports confirmed deletion of completed attempts. Snapshot and answer ownership cascades remove attempt data; retry descendants remain independent through `ON DELETE SET NULL`. Progress and exposure derive from remaining attempts and update automatically.

Exposure is the grouped count of distinct persisted simulation IDs per `(source_bank_id, source_question_id)`, independent of the imported bank version. Both active and completed attempts count; Retry creates another exposure. No counter is stored on catalog questions. Existing legacy and TypeORM snapshots already contain both source identities, so no backfill or snapshot edits are needed. Empty/unresolvable legacy identities are excluded instead of guessed. Deleting and reimporting a bank retains exposure when UUID and question IDs match.

New Simulation preserves the existing randomized round-robin domain composition and its topic slots, then fills each domain/topic slot from the least-exposed eligible candidates, randomizing ties. A final replacement pass only uses unused lower-exposure candidates in the same domain/topic. `QUESTION_REPEAT_THRESHOLD` centrally defines the threshold of 3. All Available retains the entire eligible pool. Exposure counts stay out of question-taking screens.

Unavoidable repeated questions return a read-only signed selection preview, without creating any database rows. Back discards it and retains form state. Continue anyway submits the same ordered bank/version/question identities and original filters; the server revalidates eligibility and immutable content before atomic creation, without selecting again. Previews expire after 30 minutes or a server restart; stale or edited previews ask the user to go back. Retry bypasses selection and warnings.

The explicit `ExposureAndDeletion1792540800000` migration adds the logical-exposure index and changes the retry foreign key to `SET NULL`. It preserves existing data with `synchronize: false`; no database reset is required.
