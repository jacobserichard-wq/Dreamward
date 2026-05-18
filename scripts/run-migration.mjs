#!/usr/bin/env node
/**
 * scripts/run-migration.mjs
 *
 * One-shot SQL runner for the project's Railway migrations. Reads the
 * Postgres connection string from `process.env.DATABASE_URL` — load it
 * via Node's --env-file flag pointing at the git-ignored .env.local:
 *
 *   node --env-file=.env.local scripts/run-migration.mjs <sql-file>
 *
 * Why this exists: Phase 4 (May 2026) established that Railway's web
 * query console runs one statement at a time and silently hides errors
 * (sub-session 16 verified). psql is the recommended apply-tool, but
 * not every dev environment has it installed — this script gives an
 * always-available alternative using pg, which is already in
 * node_modules.
 *
 * Why env-file (sub-session 19 redesign): the prior version prompted on
 * stdin and accepted piped input, with the goal of keeping the secret
 * out of shell history. In practice the prompt-on-stdin approach kept
 * causing the connection string to leak — paste-into-chat by mistake,
 * paste-into-command-line by mistake. Reading from a git-ignored env
 * file removes the human-handling step entirely: the secret lives in
 * one place on disk, is never typed or pasted at runtime, and never
 * appears in argv. `--env-file` is a Node 20.6+ built-in and matches
 * how the Next.js dev server already loads .env.local.
 *
 * On a missing or empty DATABASE_URL, exits 1 with a hint to use
 * --env-file=.env.local. On any pg/SQL error, exits 2 with the message
 * to stderr. SELECT results (from verification queries) print to
 * stdout as JSON; status messages go to stderr so stdout stays clean
 * for piping.
 *
 * SSL is set to { rejectUnauthorized: false } to match lib/db.ts —
 * required for Railway's managed Postgres TLS.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";

const sqlPath = process.argv[2];
if (!sqlPath) {
  console.error("Usage: node --env-file=.env.local scripts/run-migration.mjs <path-to-sql-file>");
  process.exit(1);
}

let sql;
try {
  sql = readFileSync(resolve(sqlPath), "utf8");
} catch (err) {
  console.error(`Cannot read ${sqlPath}: ${err.message}`);
  process.exit(1);
}

const connectionString = process.env.DATABASE_URL?.trim();
if (!connectionString) {
  console.error(
    "DATABASE_URL not set. Run with:\n" +
      "  node --env-file=.env.local scripts/run-migration.mjs <sql-file>\n" +
      "and make sure .env.local contains DATABASE_URL=postgresql://..."
  );
  process.exit(1);
}

const { Client } = pg;
const client = new Client({
  connectionString,
  ssl: { rejectUnauthorized: false },
});

try {
  await client.connect();
  console.error(`Applying ${sqlPath}...`);
  const result = await client.query(sql);
  // pg returns an array of results for multi-statement queries, a single
  // QueryResult for a single statement. Print the last statement's rows
  // if any — useful for verification SELECTs run through this same tool.
  if (Array.isArray(result)) {
    const last = result[result.length - 1];
    if (last?.rows?.length) {
      console.log(JSON.stringify(last.rows, null, 2));
    }
  } else if (result?.rows?.length) {
    console.log(JSON.stringify(result.rows, null, 2));
  }
  console.error("✓ Done.");
} catch (err) {
  console.error(`✗ Failed: ${err.message}`);
  process.exit(2);
} finally {
  await client.end();
}
