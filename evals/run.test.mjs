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
const prompt = process.argv.at(-1);
let text = 'fixture evidence';
if (prompt.includes('Grade each entry independently')) {
  const entries = JSON.parse(prompt.slice(prompt.indexOf('\\n\\n[{') + 2));
  text = JSON.stringify({grades: entries.map(e => ({id: e.id, checks: e.required_claims.map((_, i) => ({i: i + 1, met: true, evidence: process.env.BAD_JUDGE ? 'invented quote' : 'fixture evidence'}))}))});
} else if (process.env.BAD_ANSWER) {
  process.exit(1);
} else if (process.env.BAD_CONTROL && prompt.startsWith('Answer without')) {
  console.log(JSON.stringify({type:'item.completed', item:{id:'tool',type:'command_execution',command:'pwd'}}));
}
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
  assert.equal(run(['--resume', path]).status, 0);
  assert.equal(JSON.parse(readFileSync(path)).grader_calls, 2);
  assert.notEqual(run(['--resume', path, '--reasoning', 'high']).status, 0);
  assert.equal(run([], { BAD_JUDGE: '1' }).status, 1);
  const broken = latest();
  assert(JSON.parse(readFileSync(broken)).records.every(r => r.grade.pass === null));
  assert.equal(run(['--resume', broken], { BAD_ANSWER: '1' }).status, 0);
  assert.equal(JSON.parse(readFileSync(broken)).grader_calls, 4);
  assert.equal(run([], { BAD_CONTROL: '1' }).status, 1);
  assert.equal(JSON.parse(readFileSync(latest())).records.filter(r => r.grade.by === 'contaminated-control').length, 5);
  assert.equal(run(['--conditions', 'content']).status, 2);
  assert.equal(run(['--questions', 'A1,missing']).status, 2);
  assert.equal(run(['--n', '1.5']).status, 2);
  assert.equal(run(['--no-grade']).status, 0);
  assert.equal(JSON.parse(readFileSync(latest())).grader_calls, 0);
  console.log('PASS: batching, resume, input drift, quote validation, contaminated controls, conditions');
} finally {
  rmSync(root, { recursive: true, force: true });
}
