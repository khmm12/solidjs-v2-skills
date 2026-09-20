// Offline runner contract: batching, resumability, invalid grading and controls.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, cpSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = mkdtempSync(join(tmpdir(), 'solid-eval-test-'));
try {
  const repo = dirname(dirname(fileURLToPath(import.meta.url)));
  mkdirSync(join(root, 'evals'));
  mkdirSync(join(root, 'bin'));
  cpSync(join(repo, 'skills'), join(root, 'skills'), { recursive: true });
  cpSync(join(repo, 'evals/run.mjs'), join(root, 'evals/run.mjs'));
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
if (prompt.includes('Grade each entry independently')) {
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
  const args = [join(root, 'evals/run.mjs'), '--questions', 'A1,A2,A3,A4,A5', '--concurrency', '2'];
  const env = { ...process.env, CODEX_HOME: join(root, 'empty-auth'), PATH: join(root, 'bin') + ':' + process.env.PATH };
  const run = (extra = [], changes = {}) => spawnSync(process.execPath, [...args, ...extra], { env: { ...env, ...changes }, encoding: 'utf8' });
  const latest = () => join(root, 'evals/results', readdirSync(join(root, 'evals/results')).filter(f => f.endsWith('.json')).sort().at(-1));
  const good = run();
  assert.equal(good.status, 0, good.stderr);
  const path = latest();
  const data = JSON.parse(readFileSync(path));
  assert.equal(data.records.length, 10);
  assert.equal(data.grader_calls, 2);
  assert(data.records.every(r => r.grade.pass === true));
  assert(data.records.filter(r => r.condition === 'with-skill').every(r => r.triggered));
  assert.equal(run(['--resume', path]).status, 0);
  assert.equal(JSON.parse(readFileSync(path)).grader_calls, 2);
  assert.notEqual(run(['--resume', path, '--reasoning', 'high']).status, 0);
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
  console.log('PASS: implicit discovery, condition isolation, batching, resume, input drift, quote validation, contaminated controls');
} finally {
  rmSync(root, { recursive: true, force: true });
}
