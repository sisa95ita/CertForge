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

Open [http://localhost:3000](http://localhost:3000). The database schema is initialized automatically on first use.

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

The default database is `data/certforge.db`. SQLite creates adjacent WAL/SHM files while the app is running. These files are ignored by Git.

To use another location, set `CERTFORGE_DB_PATH` before starting the app. To reset all local data, stop CertForge and delete `data/certforge.db` plus any `data/certforge.db-wal` and `data/certforge.db-shm` files. The next start creates an empty database.

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
