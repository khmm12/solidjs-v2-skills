#!/usr/bin/env node
// Skill exam runner. Asks each question under N conditions × models, grades
// each answer against the rubric in questions.json, writes a results JSON and a
// markdown summary. Dependency-free; shells out to the `claude` CLI.
//
// Usage:
//   node evals/run.mjs                 # full run (all Q, base+deployed, sonnet+haiku, N=1)
//   node evals/run.mjs --quick         # smoke: 4 Q, base+deployed, haiku only, N=1
//   node evals/run.mjs --conditions base,content,deployed --n 3 --models sonnet,haiku
//   node evals/run.mjs --questions A1,B2,C4   # subset by id (or --questions axis:react)
//   node evals/run.mjs --grader sonnet --concurrency 4
//
// Conditions:
//   base     — bare model, no skill (the control)
//   content  — SKILL.md + the ONE topically-routed reference injected as system
//              prompt; isolates content quality (the iteration diagnostic)
//   deployed — `--plugin-dir <repo>` with Read/Glob/Grep; the model auto-triggers
//              and routes the real skill (the actual product — the headline "со skill")

import { execFile } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const EVALS_DIR = dirname(fileURLToPath(import.meta.url));
const REPO = dirname(EVALS_DIR);
const RESULTS_DIR = join(EVALS_DIR, 'results');
const REF_DIR = join(REPO, 'skills', 'solidjs-v2', 'references');
const SKILL_MD = join(REPO, 'skills', 'solidjs-v2', 'SKILL.md');
// Neutral working dir for every claude call. Critical: `base`/`content` must
// NOT run inside the repo, or the model reads the very references we're testing
// straight off disk and the control is contaminated (observed: haiku "knowing"
// a beta.15-only fact). `deployed` reads the skill via the absolute --plugin-dir,
// so an empty cwd is correct for it too.
const NEUTRAL_CWD = join(RESULTS_DIR, '.cwd');

// ---- args -------------------------------------------------------------------
const args = process.argv.slice(2);
const flag = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
const has = (name) => args.includes(`--${name}`);
const quick = has('quick');

const bank = JSON.parse(readFileSync(join(EVALS_DIR, 'questions.json'), 'utf8'));
const PREAMBLE = bank.meta.version_preamble;

let MODELS = flag('models', quick ? 'haiku' : 'sonnet,haiku').split(',');
let CONDITIONS = flag('conditions', 'base,deployed').split(',');
const N = parseInt(flag('n', '1'), 10);
const GRADER = flag('grader', 'sonnet');
const CONCURRENCY = parseInt(flag('concurrency', '4'), 10);
const NOGRADE = has('no-grade'); // delivery-only run: record answers + trigger, skip grading

let questions = bank.questions;
const qsel = flag('questions', quick ? 'A1,A4,B2,D1' : null);
if (qsel) {
  if (qsel.startsWith('axis:')) {
    const ax = qsel.slice(5);
    questions = questions.filter((q) => q.axis === ax);
  } else {
    const ids = new Set(qsel.split(','));
    questions = questions.filter((q) => ids.has(q.id));
  }
}

// ---- claude shell -----------------------------------------------------------
function claude(extraArgs, { timeoutMs = 180000 } = {}) {
  return new Promise((resolve) => {
    execFile(
      'claude',
      extraArgs,
      { maxBuffer: 20 * 1024 * 1024, timeout: timeoutMs, cwd: NEUTRAL_CWD },
      (err, stdout, stderr) => {
        if (err && !stdout) {
          resolve({ ok: false, error: String(err.message || err).slice(0, 300) });
          return;
        }
        try {
          const j = JSON.parse(stdout);
          resolve({ ok: !j.is_error, result: j.result, turns: j.num_turns, cost: j.total_cost_usd });
        } catch {
          resolve({ ok: false, error: 'unparseable: ' + String(stdout).slice(0, 200) });
        }
      },
    );
  });
}

const bundleCache = new Map();
function contentBundle(routedRef) {
  if (bundleCache.has(routedRef)) return bundleCache.get(routedRef);
  const body =
    readFileSync(SKILL_MD, 'utf8') + '\n\n' + readFileSync(join(REF_DIR, routedRef), 'utf8');
  const path = join(RESULTS_DIR, `.bundle-${routedRef}`);
  writeFileSync(path, body);
  bundleCache.set(routedRef, path);
  return path;
}

function answerArgs(q, model, condition) {
  const prompt = PREAMBLE + q.prompt;
  const base = ['-p', prompt, '--model', model, '--output-format', 'json'];
  if (condition === 'base') return base;
  if (condition === 'content')
    return [...base, '--append-system-prompt-file', contentBundle(q.routed_reference)];
  if (condition === 'deployed')
    return [
      ...base,
      '--plugin-dir', REPO,
      '--allowedTools', 'Read,Glob,Grep',
      '--permission-mode', 'bypassPermissions',
      '--max-turns', '8',
    ];
  throw new Error('unknown condition ' + condition);
}

// ---- grading ----------------------------------------------------------------
const GRADER_SYSTEM =
  'You grade an exam answer against a FIXED rubric. Judge ONLY whether the ' +
  'answer asserts each listed claim. Do NOT use your own knowledge of Solid, ' +
  'React, or JavaScript to decide what is true — the rubric is the sole source ' +
  'of truth, even if a claim looks wrong to you. For each required claim mark ' +
  'met=true only if the answer clearly states it, with a short verbatim quote ' +
  'from the answer as evidence (empty string if not met). Separately, the FORBIDDEN ' +
  'list names APIs/patterns the answer must not RECOMMEND or USE in its own ' +
  'solution — set forbidden_used=true ONLY if the answer actually adopts one as the ' +
  'recommended approach or in its example code. Mentioning a forbidden item to warn ' +
  'against it ("there is no createResource", "batch() is gone", "unlike React\'s ' +
  'useEffect") is CORRECT and must NOT set forbidden_used. Output STRICT JSON only, ' +
  'no prose, no markdown fences: ' +
  '{"checks":[{"i":1,"met":true,"evidence":"..."}],"forbidden_used":false,"forbidden_evidence":"","notes":""}';

// Non-fatal audit: which forbidden token literally appears (recommend OR mention).
// Recorded for human spot-checks; does NOT decide pass — the grader judges intent.
function regexFlags(answer, patterns) {
  const hits = [];
  for (const p of patterns || []) {
    try {
      if (new RegExp(p, 'i').test(answer)) hits.push(p);
    } catch {
      /* bad regex in bank — ignore rather than crash the run */
    }
  }
  return hits;
}

async function grade(q, answer) {
  const claims = q.must_include.map((c, i) => `${i + 1}. ${c}`).join('\n');
  const forbidden = (q.must_not || []).map((p) => `- ${p}`).join('\n') || '(none)';
  const user =
    `QUESTION:\n${q.prompt}\n\nREQUIRED CLAIMS (the answer must assert each):\n${claims}\n\n` +
    `FORBIDDEN (must not be recommended/used in the answer's own solution; ` +
    `contrasting against them is fine):\n${forbidden}\n\n` +
    `ANSWER TO GRADE:\n"""\n${answer}\n"""`;
  const r = await claude([
    '-p', user,
    '--model', GRADER,
    '--append-system-prompt', GRADER_SYSTEM,
    '--output-format', 'json',
  ]);
  const flags = regexFlags(answer, q.must_not);
  if (!r.ok) return { pass: false, by: 'grader-error', reason: r.error, checks: [], flags };
  let parsed;
  try {
    const txt = String(r.result).replace(/^```(?:json)?/m, '').replace(/```\s*$/m, '').trim();
    parsed = JSON.parse(txt);
  } catch {
    return { pass: false, by: 'grader-unparseable', reason: String(r.result).slice(0, 200), checks: [], flags };
  }
  const checks = parsed.checks || [];
  const allMet = checks.length === q.must_include.length && checks.every((c) => c.met);
  const pass = allMet && !parsed.forbidden_used;
  const reason = !allMet
    ? 'missing ' + checks.filter((c) => !c.met).map((c) => `#${c.i}`).join(',')
    : parsed.forbidden_used
    ? `forbidden used: ${parsed.forbidden_evidence || ''}`.slice(0, 160)
    : '';
  return { pass, by: 'llm', checks, forbidden_used: !!parsed.forbidden_used, reason, notes: parsed.notes || '', flags };
}

// ---- concurrency pool -------------------------------------------------------
async function pool(items, worker, size) {
  const out = new Array(items.length);
  let next = 0;
  async function run() {
    while (next < items.length) {
      const i = next++;
      out[i] = await worker(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, run));
  return out;
}

// ---- run --------------------------------------------------------------------
if (!existsSync(RESULTS_DIR)) mkdirSync(RESULTS_DIR, { recursive: true });
if (!existsSync(NEUTRAL_CWD)) mkdirSync(NEUTRAL_CWD, { recursive: true });

const cells = [];
for (const q of questions)
  for (const model of MODELS)
    for (const condition of CONDITIONS)
      for (let rep = 0; rep < N; rep++) cells.push({ q, model, condition, rep });

console.error(
  `Running ${cells.length} cells: ${questions.length}Q × ${MODELS.length}m × ${CONDITIONS.length}cond × N${N} ` +
  `(grader=${NOGRADE ? 'OFF (delivery-only)' : GRADER}, concurrency=${CONCURRENCY})`,
);

let done = 0;
const records = await pool(
  cells,
  async (cell) => {
    const ans = await claude(answerArgs(cell.q, cell.model, cell.condition));
    const answer = ans.ok ? ans.result : `[ERROR] ${ans.error}`;
    // Trigger proxy: in deployed mode the skill is read via tools, so >1 turn
    // means the model actually consulted it (vs answering from priors at 1 turn).
    const triggered = cell.condition === 'deployed' ? ans.turns > 1 : null;
    let g;
    if (!ans.ok) g = { pass: false, by: 'answer-error', reason: ans.error, checks: [] };
    else if (NOGRADE) g = { pass: null, by: 'skipped', checks: [] };
    else g = await grade(cell.q, answer);
    done++;
    const mark = g.pass == null ? (triggered ? 'trig' : '----') : g.pass ? 'PASS' : 'fail';
    process.stderr.write(
      `\r[${done}/${cells.length}] ${cell.q.id} ${cell.model}/${cell.condition} → ${mark}   `,
    );
    return { ...cell, q: cell.q.id, axis: cell.q.axis, answer, cost: ans.cost, turns: ans.turns, triggered, grade: g };
  },
  CONCURRENCY,
);
process.stderr.write('\n');

// ---- aggregate + write ------------------------------------------------------
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const rawPath = join(RESULTS_DIR, `run-${stamp}.json`);
writeFileSync(rawPath, JSON.stringify({ config: { MODELS, CONDITIONS, N, GRADER }, records }, null, 2));

const key = (m, c) => `${m}/${c}`;
const cellStats = {};
const axisStats = {};
const trigStats = {}; // delivery: trigger rate per model (deployed only)
for (const r of records) {
  if (r.triggered != null) {
    (trigStats[r.model] ??= { pass: 0, total: 0 }).total++;
    if (r.triggered) trigStats[r.model].pass++;
  }
  if (r.grade.pass == null) continue; // ungraded (delivery-only run) — not a pass/fail
  const k = key(r.model, r.condition);
  (cellStats[k] ??= { pass: 0, total: 0 }).total++;
  if (r.grade.pass) cellStats[k].pass++;
  const ak = `${r.axis}|${k}`;
  (axisStats[ak] ??= { pass: 0, total: 0 }).total++;
  if (r.grade.pass) axisStats[ak].pass++;
}
const pct = (s) => (s.total ? Math.round((100 * s.pass) / s.total) : 0) + `% (${s.pass}/${s.total})`;

let md = `# Skill exam — ${stamp}\n\n`;
md += `Config: models=${MODELS.join(',')}, conditions=${CONDITIONS.join(',')}, N=${N}, grader=${NOGRADE ? 'off' : GRADER}\n\n`;
if (Object.keys(trigStats).length) {
  md += `## Delivery — skill trigger rate (deployed; ≥1 tool turn = consulted)\n\n`;
  md += `This is the auto-attachment axis, separate from content quality. Low here means the model answered from priors without opening the skill.\n\n`;
  md += `| model | triggered |\n|---|---|\n`;
  for (const m of MODELS) if (trigStats[m]) md += `| ${m} | ${pct(trigStats[m])} |\n`;
  md += `\n`;
}
if (!NOGRADE) {
  md += `## Quality — pass rate by model × condition\n\n| model | ${CONDITIONS.join(' | ')} |\n|---|${CONDITIONS.map(() => '---').join('|')}|\n`;
  for (const m of MODELS) md += `| ${m} | ${CONDITIONS.map((c) => pct(cellStats[key(m, c)] || { pass: 0, total: 0 })).join(' | ')} |\n`;
}
if (!NOGRADE) {
  md += `\n## Pass rate by axis (model × condition)\n\n`;
  const axes = [...new Set(questions.map((q) => q.axis))];
  for (const m of MODELS) {
    md += `### ${m}\n\n| axis | ${CONDITIONS.join(' | ')} |\n|---|${CONDITIONS.map(() => '---').join('|')}|\n`;
    for (const ax of axes)
      md += `| ${ax} | ${CONDITIONS.map((c) => pct(axisStats[`${ax}|${key(m, c)}`] || { pass: 0, total: 0 })).join(' | ')} |\n`;
    md += `\n`;
  }
  md += `## Failures (id · model/condition · why)\n\n`;
  for (const r of records)
    if (r.grade.pass === false)
      md += `- **${r.q}** ${r.model}/${r.condition} — ${r.grade.by}: ${r.grade.reason || (r.grade.checks || []).filter((c) => !c.met).map((c) => `#${c.i}`).join(',') || '?'}\n`;
}

const sumPath = join(RESULTS_DIR, `summary-${stamp}.md`);
writeFileSync(sumPath, md);

console.error(`\nRaw:     ${rawPath}\nSummary: ${sumPath}\n`);
console.log(md);
