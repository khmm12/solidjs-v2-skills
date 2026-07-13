#!/usr/bin/env node
// Skill exam runner. Asks each question under N conditions × models, grades
// each answer against the rubric in questions.json, writes a results JSON and a
// markdown summary. Dependency-free; shells out to the `claude` or `codex` CLI.
//
// Usage:
//   node evals/run.mjs                 # full run (all Q, base+deployed, sonnet+haiku, N=1)
//   node evals/run.mjs --quick         # smoke: 4 Q, base+deployed, haiku only, N=1
//   node evals/run.mjs --conditions base,content,deployed --n 3 --models sonnet,haiku
//   node evals/run.mjs --provider codex --models gpt-5.6-luna --quick
//   node evals/run.mjs --questions A1,B2,C4   # subset by id (or --questions axis:react)
//   node evals/run.mjs --grader sonnet --concurrency 4
//
// Conditions:
//   base     — bare model, no skill (the control)
//   content  — SKILL.md + the ONE topically-routed reference injected as system
//              prompt; isolates content quality (the iteration diagnostic)
//   deployed — Claude: plugin auto-trigger + routing. Codex: an isolated agent is
//              explicitly pointed at SKILL.md and must read/route it with tools.

import { execFile } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { homedir, tmpdir } from 'node:os';

const EVALS_DIR = dirname(fileURLToPath(import.meta.url));
const REPO = dirname(EVALS_DIR);
const RESULTS_DIR = join(EVALS_DIR, 'results');
const REF_DIR = join(REPO, 'skills', 'solidjs-v2', 'references');
const SKILL_MD = join(REPO, 'skills', 'solidjs-v2', 'SKILL.md');
const SOURCE_CODEX_HOME = process.env.CODEX_HOME || join(homedir(), '.codex');
const EVAL_RUN_ROOT = join(tmpdir(), `solidjs-v2-skills-eval-${process.pid}`);
const ISOLATED_CODEX_HOME = join(EVAL_RUN_ROOT, 'codex-home');
// Neutral working dir for every answer call. Critical: `base`/`content` must NOT
// run inside the repo, or the model auto-loads the repo CLAUDE.md / skill content
// off disk and the control is contaminated (observed: haiku reproducing beta.15-only
// reference text verbatim at 1 turn, vs floundering from a real neutral cwd). MUST
// live OUTSIDE the repo tree — hence os.tmpdir(), NOT a path under RESULTS_DIR (which
// is inside the repo). `deployed` reads the skill through an absolute path, so a
// neutral cwd is correct for it too. NB: the user-level ~/.claude/CLAUDE.md still loads
// (it's HOME-based) — that's a uniform contaminant across conditions, not the
// differential repo leak this guards against.
const NEUTRAL_CWD = join(EVAL_RUN_ROOT, 'workspace');

function prepareIsolatedCodexHome() {
  mkdirSync(ISOLATED_CODEX_HOME, { recursive: true, mode: 0o700 });
  const sourceAuth = join(SOURCE_CODEX_HOME, 'auth.json');
  if (existsSync(sourceAuth)) {
    const isolatedAuth = join(ISOLATED_CODEX_HOME, 'auth.json');
    copyFileSync(sourceAuth, isolatedAuth);
    chmodSync(isolatedAuth, 0o600);
  }
}

function cleanupEvalRunRoot() {
  rmSync(EVAL_RUN_ROOT, { recursive: true, force: true });
}
process.once('exit', cleanupEvalRunRoot);

// ---- args -------------------------------------------------------------------
const args = process.argv.slice(2);
const flag = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
const has = (name) => args.includes(`--${name}`);
const quick = has('quick');
const PROVIDER = flag('provider', 'claude');

if (!['claude', 'codex'].includes(PROVIDER)) {
  console.error(`Unknown --provider ${PROVIDER}; expected claude or codex`);
  process.exit(2);
}

const bank = JSON.parse(readFileSync(join(EVALS_DIR, 'questions.json'), 'utf8'));
const PREAMBLE = bank.meta.version_preamble;

const defaultModels = PROVIDER === 'codex' ? 'default' : quick ? 'haiku' : 'sonnet,haiku';
let MODELS = flag('models', defaultModels).split(',');
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

// ---- model shells -----------------------------------------------------------
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

function codex(prompt, model, { timeoutMs = 180000 } = {}) {
  const modelArgs = model === 'default' ? [] : ['--model', model];
  const cliArgs = [
    'exec',
    '--ignore-user-config',
    '--ignore-rules',
    '--ephemeral',
    '--sandbox', 'read-only',
    '--skip-git-repo-check',
    '--cd', NEUTRAL_CWD,
    ...modelArgs,
    '--json',
    prompt,
  ];
  return new Promise((resolve) => {
    const child = execFile(
      'codex',
      cliArgs,
      {
        maxBuffer: 20 * 1024 * 1024,
        timeout: timeoutMs,
        cwd: NEUTRAL_CWD,
        env: { ...process.env, CODEX_HOME: ISOLATED_CODEX_HOME },
      },
      (err, stdout, stderr) => {
        const events = String(stdout)
          .split(/\r?\n/)
          .filter(Boolean)
          .flatMap((line) => {
            try {
              return [JSON.parse(line)];
            } catch {
              return [];
            }
          });
        const messages = events
          .filter((e) => e.type === 'item.completed' && e.item?.type === 'agent_message')
          .map((e) => e.item.text);
        // Treat every observed item except pure model output/reasoning as tool
        // activity. This includes command/MCP calls, web searches, file changes,
        // browser/computer use, and future item types unknown to this runner.
        const passiveItemTypes = new Set(['agent_message', 'reasoning']);
        const toolItemsById = new Map();
        for (const event of events) {
          if (!['item.started', 'item.completed'].includes(event.type)) continue;
          if (!event.item?.type || passiveItemTypes.has(event.item.type)) continue;
          toolItemsById.set(event.item.id || `${event.item.type}-${toolItemsById.size}`, event.item);
        }
        const toolItems = [...toolItemsById.values()];
        const toolCalls = toolItems.length;
        const toolCommands = toolItems.map((item) => {
          const detail = item.command || item.query || item.name || item.tool_name || item.server;
          return typeof detail === 'string' ? detail : item.type;
        });
        const completedToolItems = events
          .filter(
            (event) =>
              event.type === 'item.completed' &&
              event.item?.type &&
              !passiveItemTypes.has(event.item.type),
          )
          .map((event) => event.item);
        const consultedSkill = completedToolItems.some((item) => {
          const serialized = JSON.stringify(item);
          return serialized.includes(SKILL_MD) || serialized.includes('/skills/solidjs-v2/');
        });
        const completed = [...events].reverse().find((e) => e.type === 'turn.completed');
        if (!messages.length) {
          resolve({
            ok: false,
            error: String(err?.message || stderr || stdout || 'codex produced no answer').slice(0, 500),
            toolCalls,
            toolCommands,
            consultedSkill,
          });
          return;
        }
        resolve({
          ok: !err,
          result: messages.at(-1),
          turns: events.filter((e) => e.type === 'turn.completed').length,
          toolCalls,
          toolCommands,
          consultedSkill,
          usage: completed?.usage || null,
          cost: null,
          error: err ? String(err.message || err).slice(0, 500) : undefined,
        });
      },
    );
    // `codex exec` accepts extra prompt input from non-TTY stdin. execFile leaves
    // that pipe open by default, so explicitly send EOF or the child waits forever.
    child.stdin.end();
  });
}

const bundleCache = new Map();
const bundleTextCache = new Map();
function contentText(routedRef) {
  if (bundleTextCache.has(routedRef)) return bundleTextCache.get(routedRef);
  const body =
    readFileSync(SKILL_MD, 'utf8') + '\n\n' + readFileSync(join(REF_DIR, routedRef), 'utf8');
  bundleTextCache.set(routedRef, body);
  return body;
}

function contentBundle(routedRef) {
  if (bundleCache.has(routedRef)) return bundleCache.get(routedRef);
  const path = join(RESULTS_DIR, `.bundle-${routedRef}`);
  writeFileSync(path, contentText(routedRef));
  bundleCache.set(routedRef, path);
  return path;
}

function codexPrompt(q, condition) {
  const question = PREAMBLE + q.prompt;
  const noTools =
    'Answer without using tools, shell commands, web search, or external files. ' +
    'Use only the information already in the prompt and your prior knowledge.\n\n';
  if (condition === 'base') return noTools + question;
  if (condition === 'content')
    return (
      noTools +
      'Use the following fixed skill instructions and routed reference as authoritative context. ' +
      'Answer the question after the context.\n\n<skill-context>\n' +
      contentText(q.routed_reference) +
      '\n</skill-context>\n\n<question>\n' + question + '\n</question>'
    );
  if (condition === 'deployed')
    return (
      `Use the SolidJS 2.0 skill at ${SKILL_MD}. Read that SKILL.md first with your tools, ` +
      `follow its routing table, and read the relevant reference under ${REF_DIR} before answering. ` +
      'Use only local read-only file commands; do not use web search or other external sources. ' +
      'Do not rely only on prior knowledge. Then answer this question:\n\n' + question
    );
  throw new Error('unknown condition ' + condition);
}

function runAnswer(q, model, condition) {
  if (PROVIDER === 'claude') return claude(answerArgs(q, model, condition));
  return codex(codexPrompt(q, condition), model);
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
if (PROVIDER === 'codex') prepareIsolatedCodexHome();

const cells = [];
for (const q of questions)
  for (const model of MODELS)
    for (const condition of CONDITIONS)
      for (let rep = 0; rep < N; rep++) cells.push({ q, model, condition, rep });

console.error(
  `Running ${cells.length} cells: ${questions.length}Q × ${MODELS.length}m × ${CONDITIONS.length}cond × N${N} ` +
  `(provider=${PROVIDER}, grader=${NOGRADE ? 'OFF (delivery-only)' : `claude/${GRADER}`}, concurrency=${CONCURRENCY})`,
);

let done = 0;
const records = await pool(
  cells,
  async (cell) => {
    const ans = await runAnswer(cell.q, cell.model, cell.condition);
    const answer = ans.ok ? ans.result : `[ERROR] ${ans.error}`;
    const contaminated =
      PROVIDER === 'codex' &&
      (cell.condition === 'base' || cell.condition === 'content') &&
      (ans.toolCalls || 0) > 0;
    // Claude deployed: >1 turn means the auto-triggered skill was consulted.
    // Codex deployed: the skill path appearing in a completed tool item means the
    // explicitly named skill was consulted. These use different labels below.
    const triggered = cell.condition === 'deployed'
      ? PROVIDER === 'claude' ? ans.turns > 1 : ans.consultedSkill
      : null;
    let g;
    if (contaminated)
      g = {
        pass: null,
        by: 'contaminated-control',
        reason: `excluded: observed ${ans.toolCalls} tool item(s) in ${cell.condition}`,
        checks: [],
      };
    else if (!ans.ok) g = { pass: false, by: 'answer-error', reason: ans.error, checks: [] };
    else if (NOGRADE) g = { pass: null, by: 'skipped', checks: [] };
    else g = await grade(cell.q, answer);
    done++;
    const mark = contaminated
      ? 'CONTAM'
      : g.pass == null ? (triggered ? 'trig' : '----') : g.pass ? 'PASS' : 'fail';
    process.stderr.write(
      `\r[${done}/${cells.length}] ${cell.q.id} ${cell.model}/${cell.condition} → ${mark}   `,
    );
    return {
      ...cell,
      q: cell.q.id,
      axis: cell.q.axis,
      provider: PROVIDER,
      answer,
      cost: ans.cost,
      usage: ans.usage || null,
      turns: ans.turns,
      tool_calls: ans.toolCalls ?? null,
      tool_commands: ans.toolCommands || null,
      contaminated,
      triggered,
      grade: g,
    };
  },
  CONCURRENCY,
);
process.stderr.write('\n');

// ---- aggregate + write ------------------------------------------------------
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const rawPath = join(RESULTS_DIR, `run-${stamp}.json`);
writeFileSync(
  rawPath,
  JSON.stringify(
    {
      config: {
        PROVIDER,
        MODELS,
        CONDITIONS,
        N,
        GRADER,
        CODEX_HOME_MODE: PROVIDER === 'codex' ? 'isolated-auth-only' : null,
      },
      records,
    },
    null,
    2,
  ),
);

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
const pct = (s) => s.total
  ? Math.round((100 * s.pass) / s.total) + `% (${s.pass}/${s.total})`
  : '— (0/0)';
const contaminatedRecords = records.filter((r) => r.contaminated);

let md = `# Skill exam — ${stamp}\n\n`;
md += `Config: provider=${PROVIDER}, models=${MODELS.join(',')}, conditions=${CONDITIONS.join(',')}, N=${N}, grader=${NOGRADE ? 'off' : `claude/${GRADER}`}\n\n`;
if (contaminatedRecords.length) {
  md += `## Invalid control cells — excluded from pass rates\n\n`;
  md += `Codex used tools in a tool-free control condition. The run exits non-zero so this contamination cannot pass silently.\n\n`;
  for (const r of contaminatedRecords)
    md += `- **${r.q}** ${r.model}/${r.condition} — ${r.grade.reason}; ${r.tool_commands.join(', ') || 'unknown tool'}\n`;
  md += `\n`;
}
if (Object.keys(trigStats).length) {
  const deliveryTitle = PROVIDER === 'claude'
    ? 'skill trigger rate (deployed; >1 turn = consulted)'
    : 'explicit skill retrieval rate (deployed; skill path observed in tool call)';
  md += `## Delivery — ${deliveryTitle}\n\n`;
  md += PROVIDER === 'claude'
    ? `This is the auto-attachment axis, separate from content quality. Low here means the model answered from priors without opening the skill.\n\n`
    : `Codex deployed mode explicitly names the skill path; this measures retrieval compliance, not automatic skill discovery.\n\n`;
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
if (contaminatedRecords.length) process.exitCode = 1;
