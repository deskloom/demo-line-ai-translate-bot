#!/usr/bin/env node
// Evaluation harness: runs each fixture in eval/fixtures/*.json N times against
// the real Gemini provider and scores mechanical checks (regex must/mustNot,
// or "must produce no output"). Requires GEMINI_API_KEY in the environment;
// if absent, prints SKIP and exits 0 (no network calls made).
//
// Usage:
//   node eval/run-eval.js                 # N=5 per case
//   node eval/run-eval.js --runs 3
//
// Writes eval/results/<YYYY-MM-DD>.json and prints a summary table.

import { readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { translateMessage } from "../src/translate.js";
import { isUntranslatable } from "../src/lang.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(__dirname, "fixtures");
const RESULTS_DIR = join(__dirname, "results");
const MODEL = process.env.GEMINI_MODEL || "gemini-3.1-flash-lite";

function parseArgs(argv) {
  const runsIdx = argv.indexOf("--runs");
  const runs = runsIdx >= 0 ? Number(argv[runsIdx + 1]) : 5;
  const caseIdx = argv.indexOf("--case");
  const only = caseIdx >= 0 ? argv[caseIdx + 1] : null;
  return { runs: Number.isFinite(runs) && runs > 0 ? runs : 5, only };
}

function loadFixtures() {
  return readdirSync(FIXTURES_DIR)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => JSON.parse(readFileSync(join(FIXTURES_DIR, f), "utf8")));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// The eval run itself (not the production Worker) retries a transient 503
// ("model overloaded") a few times with backoff, purely so a temporary Gemini
// capacity blip doesn't get mis-scored as a translation-quality failure.
async function callWithRetryOn503(fn, attempts = 6, baseDelayMs = 8000) {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const is503 = /Gemini API error 503/.test(String(err?.message ?? err));
      if (!is503 || attempt === attempts) throw err;
      const delay = baseDelayMs * attempt;
      console.log(`  (503 from Gemini, retrying in ${delay}ms, attempt ${attempt}/${attempts})`);
      await sleep(delay);
    }
  }
}

function checkOutput(fixture, translation) {
  const checks = fixture.checks || {};
  if (checks.mustBeEmpty) {
    return translation.trim() === "";
  }
  const must = checks.mustMatch || [];
  const mustNot = checks.mustNotMatch || [];
  for (const pattern of must) {
    if (!new RegExp(pattern, "i").test(translation)) return false;
  }
  for (const pattern of mustNot) {
    if (new RegExp(pattern, "i").test(translation)) return false;
  }
  return true;
}

async function runCase(fixture, runs, apiKey) {
  const outputs = [];
  let passCount = 0;

  for (let i = 0; i < runs; i++) {
    let translation;
    if (isUntranslatable(fixture.text)) {
      // Mirrors the real pipeline: untranslatable text never reaches the model.
      translation = "";
    } else {
      const result = await callWithRetryOn503(() =>
        translateMessage({
          text: fixture.text,
          sourceLang: fixture.sourceLang,
          targetLang: fixture.targetLang,
          contextMessages: fixture.contextMessages || [],
          apiKey,
          model: MODEL,
        })
      );
      translation = result.translation;
    }
    const pass = checkOutput(fixture, translation);
    if (pass) passCount++;
    outputs.push({ translation, pass });
  }

  return { id: fixture.id, description: fixture.description, runs, passCount, outputs };
}

async function main() {
  const { runs, only } = parseArgs(process.argv.slice(2));
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    console.log("SKIP: GEMINI_API_KEY not set; not calling the real Gemini API.");
    process.exit(0);
  }

  const fixtures = loadFixtures().filter((f) => !only || f.id === only);
  const results = [];
  for (const fixture of fixtures) {
    const result = await runCase(fixture, runs, apiKey);
    results.push(result);
    console.log(`${result.id}: ${result.passCount}/${result.runs}`);
  }

  const date = new Date().toISOString().slice(0, 10);
  mkdirSync(RESULTS_DIR, { recursive: true });
  const outPath = join(RESULTS_DIR, `${date}.json`);
  writeFileSync(
    outPath,
    JSON.stringify({ date, model: MODEL, runsPerCase: runs, results }, null, 2) + "\n",
    "utf8"
  );

  console.log("");
  console.log("case".padEnd(32) + "pass/N");
  console.log("-".repeat(44));
  for (const r of results) {
    console.log(`${r.id.padEnd(32)}${r.passCount}/${r.runs}`);
  }
  console.log("");
  console.log(`Wrote ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
