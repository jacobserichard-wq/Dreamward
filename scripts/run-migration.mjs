#!/usr/bin/env node
/**
 * scripts/run-migration.mjs
 *
 * One-shot SQL runner for the project's Railway migrations. Reads the
 * Postgres connection string from stdin (interactive prompt or piped)
 * so it never lands in shell history. Runs the given .sql file as a
 * single query — pg's underlying protocol supports multi-statement
 * queries when no parameters are bound, which matches the migrations
 * in db/migrations/.
 *
 * Why this exists: Phase 4 (May 2026) established that Railway's web
 * query console runs one statement at a time and silently hides errors
 * (sub-session 16 verified). psql is the recommended apply-tool, but
 * not every dev environment has it installed — this script gives an
 * always-available alternative using pg, which is already in
 * node_modules.
 *
 * Usage:
 *
 *   # Interactive — prompt appears on stderr, paste + Enter:
 *   node scripts/run-migration.mjs db/migrations/0005_add_mileage_fields.sql
 *
 *   # Piped — connection string never echoed to the terminal:
 *   echo "$DATABASE_URL" | node scripts/run-migration.mjs db/migrations/0005_xxx.sql
 *
 *   # From a file (also keeps it out of shell history):
 *   node scripts/run-migration.mjs db/migrations/0005_xxx.sql < .pg-conn
 *
 * On stdin EOF without input, exits with code 1. On any pg/SQL error,
 * exits with code 2 and prints the message to stderr. SELECT results
 * (from verification queries) print to stdout as JSON; the prompt and
 * status messages go to stderr so stdout stays clean for piping.
 *
 * SSL is set to { rejectUnauthorized: false } to match lib/db.ts —
 * required for Railway's managed Postgres TLS.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createInterface } from "node:readline";
import pg from "pg";

const sqlPath = process.argv[2];
if (!sqlPath) {
  console.error("Usage: node scripts/run-migration.mjs <path-to-sql-file>");
  process.exit(1);
}

let sql;
try {
  sql = readFileSync(resolve(sqlPath), "utf8");
} catch (err) {
  console.error(`Cannot read ${sqlPath}: ${err.message}`);
  process.exit(1);
}

// Prompt → stderr so stdout stays clean for SELECT result piping.
// `terminal` defaults to whether stdin is a TTY, which suppresses the
// readline prompt rewrite when piped — exactly the behavior we want.
const rl = createInterface({
  input: process.stdin,
  output: process.stderr,
  terminal: process.stdin.isTTY,
});

const connectionString = await new Promise((resolveP) => {
  rl.question("Connection string: ", (answer) => {
    rl.close();
    resolveP(answer.trim());
  });
});

if (!connectionString) {
  console.error("Empty connection string — aborting.");
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
