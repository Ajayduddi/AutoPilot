const MIGRATIONS_DIR = "apps/backend/src/db/migrations";
const JOURNAL_PATH = `${MIGRATIONS_DIR}/meta/_journal.json`;

type JournalEntry = {
  idx: number;
  version: string;
  when: number;
  tag: string;
  breakpoints: boolean;
};

type Journal = {
  version: string;
  dialect: string;
  entries: JournalEntry[];
};

const journalFile = Bun.file(JOURNAL_PATH);
if (!(await journalFile.exists())) {
  console.error(`[migration-journal] Missing journal file: ${JOURNAL_PATH}`);
  process.exit(1);
}

let journal: Journal;
try {
  journal = (await journalFile.json()) as Journal;
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[migration-journal] Invalid JSON in ${JOURNAL_PATH}: ${message}`);
  process.exit(1);
}

if (!Array.isArray(journal.entries)) {
  console.error(`[migration-journal] Invalid journal format: 'entries' must be an array.`);
  process.exit(1);
}

const missing: string[] = [];
for (const entry of journal.entries) {
  const migrationFile = `${MIGRATIONS_DIR}/${entry.tag}.sql`;
  if (!(await Bun.file(migrationFile).exists())) {
    missing.push(`${entry.tag} -> ${migrationFile}`);
  }
}

if (missing.length > 0) {
  console.error("[migration-journal] Missing SQL migration files for journal tags:");
  for (const line of missing) {
    console.error(` - ${line}`);
  }
  console.error(
    "[migration-journal] Hard-failing to prevent CI migration drift. Restore or regenerate matching *.sql files."
  );
  process.exit(1);
}

console.log(`[migration-journal] OK: ${journal.entries.length} journal entries have matching SQL files.`);
