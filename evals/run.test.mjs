// Offline runner contract: batching, resumability, invalid grading and controls.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, cpSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import './facts.test.mjs';

const root = mkdtempSync(join(tmpdir(), 'solid-eval-test-'));
try {
  const repo = dirname(dirname(fileURLToPath(import.meta.url)));
  const bank = JSON.parse(readFileSync(join(repo, 'evals/questions.json'), 'utf8'));
  const skill = readFileSync(join(repo, 'skills/solidjs-v2/SKILL.md'), 'utf8');
  assert.match(skill, /^Reference target: `solid-js@[^`]+` and `@solidjs\/web@[^`]+`\.$/m);
  assert(bank.meta.rubric_revision);
  assert.equal(new Set(bank.questions.map(q => q.id)).size, bank.questions.length);
  for (const q of bank.questions) {
    assert.equal(q.axis, { A: 'api', B: 'pattern', C: 'react', D: 'v1' }[q.id[0]]);
    assert(q.must_include.length > 0 && q.must_include.every(c => typeof c === 'string' && c.trim()));
    assert.equal(new Set(q.must_include).size, q.must_include.length, q.id);
    assert(!/SKILL\.md|\/references\/|\$solidjs-v2/.test(q.prompt), q.id);
    const refs = q.source.match(/[a-z-]+\.md/g);
    assert(refs?.length, `missing source: ${q.id}`);
    for (const ref of refs) {
      const text = readFileSync(join(repo, 'skills/solidjs-v2/references', ref), 'utf8');
      assert.match(text, /^# /);
      assert(!text.includes('Verified against'));
    }
  }
  mkdirSync(join(root, 'evals'));
  mkdirSync(join(root, 'bin'));
  cpSync(join(repo, 'skills'), join(root, 'skills'), { recursive: true });
  cpSync(join(repo, 'evals/run.mjs'), join(root, 'evals/run.mjs'));
  cpSync(join(repo, 'evals/facts.mjs'), join(root, 'evals/facts.mjs'));
  cpSync(join(repo, 'evals/questions.json'), join(root, 'evals/questions.json'));
  writeFileSync(join(root, 'bin/codex'), `#!/usr/bin/env node
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const prompt = process.argv.at(-1);
const cwd = process.argv[process.argv.indexOf('--cd') + 1];
const skill = path.join(cwd, '.agents/skills/solidjs-v2/SKILL.md');
const withSkill = prompt.startsWith('Use only local read-only');
assert.equal(fs.existsSync(skill), withSkill, 'skills must be isolated from controls and judges');
assert(!prompt.includes('SKILL.md') && !prompt.includes('/references/'), 'question must not point to skill');
let text = 'fixture evidence';
if (prompt.includes('Assess each entry independently')) {
  const entries = JSON.parse(prompt.slice(prompt.lastIndexOf('\\n\\n[{') + 2));
  const sources = JSON.parse(prompt.split('Shared sources:\\n')[1].split('\\n\\n[{')[0]);
  assert(sources.length === 9 && sources.every(s => s.text.startsWith('# ')));
  const sourceEvidence = sources[0].text.split('\\n').find(Boolean);
  assert(entries.every(e => !e.sources), 'shared references appear once per batch');
  text = JSON.stringify({grades: entries.map(e => ({id: e.id,
    checks: e.required_claims.map((_, i) => ({ i: i + 1, status: process.env.UNRESOLVED ? 'unresolved' : 'supported',
      evidence: process.env.UNRESOLVED ? '' : 'fixture evidence', critical: false,
      reason: process.env.UNRESOLVED ? 'Conflicting rubric.' : '', ...(process.env.UNRESOLVED ? { cause: 'rubric-defect' } : {}) })),
    audit: {status: process.env.INCOMPLETE_AUDIT ? 'incomplete' : 'complete', reason: process.env.INCOMPLETE_AUDIT ? 'Review unfinished.' : '', findings: process.env.EXTRA_ERROR ? [{
      kind: 'code', status: 'incorrect', evidence: 'fixture evidence', reason: 'Fixture code violates the supplied contract.', critical: true,
      source: { id: sources[0].id, evidence: process.env.BAD_SOURCE ? 'made-up source quote' : sourceEvidence },
    }] : []},
  }))});
} else if (prompt.includes('Grade each entry independently')) {
  const entries = JSON.parse(prompt.slice(prompt.indexOf('\\n\\n[{') + 2));
  if (process.env.CHECK_FEEDBACK) assert(entries.every(e => e.previous_invalid_grade?.error === 'evidence is not a verbatim answer quote'));
  text = JSON.stringify({grades: entries.map(e => ({id: e.id, checks: e.required_claims.map((_, i) => ({i: i + 1, met: !process.env.UNMET, evidence: process.env.UNMET ? '' : process.env.BAD_JUDGE ? 'invented quote' : 'fixture evidence', reason: process.env.UNMET && !process.env.NO_REASON ? 'missing fixture behavior' : ''}))}))});
} else if (process.env.BAD_ANSWER) {
  process.exit(1);
} else if (process.env.BAD_CONTROL && prompt.startsWith('Answer without')) {
  console.log(JSON.stringify({type:'item.completed', item:{id:'tool',type:'command_execution',command:'pwd'}}));
}
if (withSkill) console.log(JSON.stringify({type:'item.completed', item:{id:'skill',type:'command_execution',command:'cat ' + skill,exit_code:0}}));
console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text}}));
console.log(JSON.stringify({type:'turn.completed',usage:{input_tokens:1,output_tokens:1}}));
`, { mode: 0o755 });
  const args = [join(root, 'evals/run.mjs'), '--questions', 'A1,A2,A3,A4,A5', '--concurrency', '2', '--grading', 'legacy'];
  const env = { ...process.env, CODEX_HOME: join(root, 'empty-auth'), PATH: join(root, 'bin') + ':' + process.env.PATH };
  const run = (extra = [], changes = {}) => spawnSync(process.execPath, [...args, ...extra], { env: { ...env, ...changes }, encoding: 'utf8' });
  const latest = () => join(root, 'evals/results', readdirSync(join(root, 'evals/results')).filter(f => f.endsWith('.json')).sort().at(-1));
  const defaults = spawnSync(process.execPath, args.slice(0, -2), { env, encoding: 'utf8' });
  assert.equal(defaults.status, 0, defaults.stderr);
  const defaultData = JSON.parse(readFileSync(latest()));
  assert.equal(defaultData.config.GRADING, 'facts');
  assert.equal(defaultData.config.GRADER, 'gpt-6-astra');
  assert.equal(defaultData.factual_summary.answers.passed, 10);
  const good = run();
  assert.equal(good.status, 0, good.stderr);
  const path = latest();
  const data = JSON.parse(readFileSync(path));
  assert.equal(data.records.length, 10);
  assert.equal(data.bank_version.rubric_revision, bank.meta.rubric_revision);
  assert.equal(data.grader_calls, 2);
  assert(data.records.every(r => r.grade.pass === true));
  assert(data.records.filter(r => r.condition === 'with-skill').every(r => r.triggered));
  assert.equal(run(['--resume', path]).status, 0);
  assert.equal(JSON.parse(readFileSync(path)).grader_calls, 2);
  assert.notEqual(run(['--resume', path, '--reasoning', 'high']).status, 0);
  const bankPath = join(root, 'evals/questions.json');
  const originalBank = readFileSync(bankPath, 'utf8');
  for (const field of ['prompt', 'must_include', 'rubric_revision']) {
    const changedBank = JSON.parse(originalBank);
    if (field === 'prompt') changedBank.questions[0].prompt += ' Changed question.';
    else if (field === 'must_include') changedBank.questions[0].must_include[0] += ' Changed rubric.';
    else changedBank.meta.rubric_revision += '-changed';
    writeFileSync(bankPath, JSON.stringify(changedBank));
    const drift = run(['--resume', path]);
    assert.notEqual(drift.status, 0);
    assert(drift.stderr.includes('Resume inputs changed'), drift.stderr);
    assert.equal(JSON.parse(readFileSync(path)).grader_calls, 2);
    writeFileSync(bankPath, originalBank);
  }
  assert.equal(run([], { BAD_JUDGE: '1' }).status, 1);
  const broken = latest();
  assert(JSON.parse(readFileSync(broken)).records.every(r => r.grade.pass === null));
  assert.equal(run(['--resume', broken], { BAD_ANSWER: '1', CHECK_FEEDBACK: '1' }).status, 0);
  assert.equal(JSON.parse(readFileSync(broken)).grader_calls, 4);
  assert.equal(run([], { UNMET: '1' }).status, 0);
  assert(JSON.parse(readFileSync(latest())).records.every(r => r.grade.pass === false && r.grade.reason.includes('missing fixture behavior')));
  assert.equal(run([], { UNMET: '1', NO_REASON: '1' }).status, 1);
  assert(JSON.parse(readFileSync(latest())).records.every(r => r.grade.by === 'grader-error'));
  assert.equal(run([], { BAD_CONTROL: '1' }).status, 1);
  assert.equal(JSON.parse(readFileSync(latest())).records.filter(r => r.grade.by === 'contaminated-control').length, 5);
  assert.equal(run(['--conditions', 'content']).status, 2);
  assert.equal(run(['--questions', 'A1,missing']).status, 2);
  assert.equal(run(['--n', '1.5']).status, 2);
  assert.equal(run(['--no-grade']).status, 0);
  assert.equal(JSON.parse(readFileSync(latest())).grader_calls, 0);
  const factual = run(['--grading', 'facts']);
  assert.equal(factual.status, 0, factual.stderr);
  const factualPath = latest();
  const factualData = JSON.parse(readFileSync(factualPath));
  assert.equal(factualData.factual_summary.answers.complete, 10);
  assert.equal(factualData.factual_summary.coverage.percent, 100);
  assert.equal(factualData.factual_summary.answers.passed, 10);
  assert.equal(factualData.factual_summary.score.percent, 100);
  assert.equal(factualData.inputs.questions.length, 5);
  assert.equal(factualData.inputs.PREAMBLE, bank.meta.version_preamble);
  assert.equal(factualData.inputs.facts, readFileSync(join(repo, 'evals/facts.mjs'), 'utf8'));
  assert(factualData.inputs.skills.some(([name]) => name === 'solidjs-v2'));
  assert(factual.stdout.includes('Factual assessment') && factual.stdout.includes('Legacy checklist only'));
  assert.equal(run(['--grading', 'facts', '--resume', factualPath]).status, 0);
  assert.equal(JSON.parse(readFileSync(factualPath)).grader_calls, 2);
  assert.notEqual(run(['--grading', 'legacy', '--resume', factualPath]).status, 0);
  const factsPath = join(root, 'evals/facts.mjs');
  const factsSource = readFileSync(factsPath, 'utf8');
  writeFileSync(factsPath, factsSource + '\n// Changed assessment contract.\n');
  assert.notEqual(run(['--grading', 'facts', '--resume', factualPath]).status, 0);
  writeFileSync(factsPath, factsSource);
  assert.equal(run(['--grading', 'facts'], { UNRESOLVED: '1' }).status, 1);
  const uncertainPath = latest();
  assert.equal(JSON.parse(readFileSync(uncertainPath)).factual_summary.answers.unresolved, 10);
  assert.equal(JSON.parse(readFileSync(uncertainPath)).factual_summary.score.percent, null);
  assert.equal(run(['--grading', 'facts', '--resume', uncertainPath]).status, 1, 'resume must not silently retry semantic uncertainty');
  assert.equal(JSON.parse(readFileSync(uncertainPath)).grader_calls, 2);
  assert.equal(run(['--grading', 'facts'], { INCOMPLETE_AUDIT: '1' }).status, 1);
  assert.equal(run(['--grading', 'facts'], { EXTRA_ERROR: '1' }).status, 0);
  const extraData = JSON.parse(readFileSync(latest()));
  assert(extraData.records.every(r => r.grade.pass), 'legacy checklist result is retained');
  assert.equal(extraData.factual_summary.answers.with_critical_errors, 10);
  assert.equal(extraData.factual_summary.answers.passed, 0);
  assert.equal(run(['--grading', 'facts'], { EXTRA_ERROR: '1', BAD_SOURCE: '1' }).status, 1);
  assert.equal(JSON.parse(readFileSync(latest())).factual_summary.answers.excluded, 10);
  assert.equal(run(['--grading', 'facts', '--no-grade']).status, 0);
  assert.equal(JSON.parse(readFileSync(latest())).grader_calls, 0);
  assert.equal(run(['--grading', 'unsupported']).status, 2);
  console.log('PASS: implicit discovery, isolation, batching, resume/input drift, legacy/factual grading, source validation, unresolved assessments');
} finally {
  rmSync(root, { recursive: true, force: true });
}
