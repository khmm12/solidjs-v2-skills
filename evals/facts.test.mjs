import assert from 'node:assert/strict';
import { validateFactsGrade, summarizeFacts, factsReport } from './facts.mjs';

const q = { must_include: ['Reads remain old until flush.', 'flush makes writes visible.'] };
const sources = [{ id: 'reference', text: 'Reads remain old until flush. flush makes writes visible. Cancel must wake the waiting consumer.' }];
const decision = (i, status, evidence = '', extra = {}) => ({
  i, status, evidence, reason: status === 'supported' ? '' : `Specific ${status} behavior.`, critical: false, ...extra,
});
const audit = (findings = [], status = 'complete') => ({ status, findings, reason: status === 'complete' ? '' : 'Code audit not finished.' });
const grade = (answer, checks, review = audit()) => validateFactsGrade({ checks, audit: review }, q, answer, sources);
const record = g => ({ q: 'A2', model: 'fixture', condition: 'with-skill', axis: 'api', grade: g });
const stats = g => summarizeFacts([record(g)]);

const concise = grade('Old until flush; flush exposes writes.', [
  decision(1, 'supported', 'Old until flush'), decision(2, 'supported', 'flush exposes writes'),
]);
assert.equal(concise.pass, true);
assert.equal(stats(concise).coverage.percent, 100);
assert.equal(stats(concise).balance, 2);
assert.equal(stats(concise).answers.passed, 1);
assert.equal(stats(concise).score.percent, 100);
assert.equal(stats(concise).answers.supported_error_free, 1);

const partial = grade('Old until flush.', [decision(1, 'supported', 'Old until flush.'), decision(2, 'missing')]);
assert.equal(partial.pass, false);
assert.equal(stats(partial).coverage.percent, 50);
assert.equal(stats(partial).balance, 1);
assert.equal(stats(partial).answers.with_errors, 0);
assert.equal(stats(partial).score.percent, 50);
assert.equal(stats(partial).answers.supported_error_free, 1);

const silence = grade('', [decision(1, 'missing'), decision(2, 'missing')]);
assert.equal(silence.pass, false);
assert.equal(stats(silence).coverage.percent, 0);
assert.equal(stats(silence).balance, 0);
assert.equal(stats(silence).answers.with_errors, 0);
assert.equal(stats(silence).score.percent, 0);
assert.equal(stats(silence).answers.supported_error_free, 0);

const wrong = grade('Reads update immediately. flush exposes writes.', [
  decision(1, 'incorrect', 'Reads update immediately.', { critical: true }),
  decision(2, 'supported', 'flush exposes writes.'),
]);
assert.equal(stats(wrong).required.incorrect, 1);
assert.equal(stats(wrong).answers.with_critical_errors, 1);
assert.equal(stats(wrong).balance, 0);

const brokenCode = grade('Old until flush; flush exposes writes. const cancel = () => unsubscribe();', concise.checks, audit([{
  kind: 'code', status: 'incorrect', evidence: 'const cancel = () => unsubscribe();',
  reason: 'Cancellation leaves a waiting consumer blocked because it never wakes it.', critical: true,
  source: { id: 'reference', evidence: 'Cancel must wake the waiting consumer.' },
}]));
assert.equal(brokenCode.pass, true, 'legacy checklist can pass while the additional code audit fails');
assert.equal(stats(brokenCode).coverage.percent, 100);
assert.equal(stats(brokenCode).answers.with_critical_errors, 1);
assert.equal(stats(brokenCode).answers.passed, 0);
assert.equal(stats(brokenCode).score.percent, 50);
assert.equal(stats(brokenCode).answers.supported_error_free, 0);
assert.equal(stats(brokenCode).balance, 1, 'positive balance must not hide a critical error');

const extraFalseClaim = grade('Old until flush; flush exposes writes. Cancel never needs to wake a consumer.', concise.checks, audit([{
  kind: 'claim', status: 'incorrect', evidence: 'Cancel never needs to wake a consumer.',
  reason: 'Cancellation must wake a waiting consumer.', critical: true,
  source: { id: 'reference', evidence: 'Cancel must wake the waiting consumer.' },
}]));
assert.equal(stats(extraFalseClaim).additional.incorrect, 1);
assert.equal(stats(extraFalseClaim).answers.with_errors, 1);

const conflictingCode = grade('Reads remain old until flush. assert.equal(count(), newValue);', [
  decision(1, 'incorrect', 'assert.equal(count(), newValue);', { critical: true, reason: 'Code expects the new value before flushing despite the correct prose.' }),
  decision(2, 'missing'),
]);
assert.equal(stats(conflictingCode).required.incorrect, 1);
assert.equal(stats(conflictingCode).required.supported, 0);

const unsupportedExtra = grade('Old until flush; flush exposes writes. inventedAPI();', concise.checks, audit([{
  kind: 'claim', status: 'unresolved', evidence: 'inventedAPI();',
  reason: 'The supplied source is not an exhaustive export list.', critical: false,
}]));
assert.equal(unsupportedExtra.complete, false);
assert.equal(stats(unsupportedExtra).additional.incorrect, 0);
assert.equal(stats(unsupportedExtra).additional.unresolved, 1);
assert.equal(stats(unsupportedExtra).answers.passed, 0);
assert.equal(stats(unsupportedExtra).score.percent, null);
assert.equal(stats(unsupportedExtra).answers.supported_error_free, 0);

const badRubric = grade('', [decision(1, 'missing'), decision(2, 'unresolved', '', {
  cause: 'rubric-defect', reason: 'The requirement is outside the requested scope.',
})]);
assert.equal(badRubric.pass, null);
assert.equal(stats(badRubric).required.rubric_defects, 1);
assert.equal(stats(badRubric).required.incorrect, 0);
assert.equal(stats(badRubric).answers.unresolved, 1);
assert.equal(stats(badRubric).coverage.denominator, 2, 'do not silently shrink the coverage denominator');

assert.equal(grade('Old until flush; flush exposes writes.', concise.checks, audit([], 'incomplete')).complete, false);
const excluded = summarizeFacts([record({ by: 'grader-error', pass: null }), record(concise)]);
assert.equal(excluded.answers.excluded, 1);
assert.equal(excluded.answers.total, 2);
assert.equal(excluded.score.percent, null);
assert.equal(summarizeFacts([]).coverage.percent, null);
assert.equal(summarizeFacts([]).score.percent, null);
const mixed = summarizeFacts([record(concise), record(partial), record(silence), record(wrong), record(brokenCode), record(badRubric)]);
assert.deepEqual(mixed.required, { supported: 6, missing: 4, incorrect: 1, unresolved: 1, total: 12, rubric_defects: 1 });
assert.equal(mixed.coverage.percent, 50);
assert.equal(mixed.answers.with_errors, 2);
assert.equal(mixed.balance, 4);
assert(factsReport([record(brokenCode)]).includes('Cancellation leaves a waiting consumer blocked'));
assert(factsReport([record(brokenCode)]).includes('fixture/with-skill/api'));
assert(factsReport([record({ by: 'grader-error', pass: null })]).includes('N/A'));

const shorterQuestion = validateFactsGrade({ checks: [concise.checks[0]], audit: audit() },
  { must_include: [q.must_include[0]] }, 'Old until flush', sources);
const unequalSizes = summarizeFacts([record(shorterQuestion), record(silence)]);
assert.equal(unequalSizes.macro_coverage_percent, 50, 'each answer has equal weight in macro coverage');
assert.equal(unequalSizes.coverage.percent, 100 / 3, 'micro coverage counts atomic requirements');

const invalid = mutate => {
  const candidate = structuredClone(brokenCode);
  mutate(candidate);
  assert.throws(() => validateFactsGrade(candidate, q,
    'Old until flush; flush exposes writes. const cancel = () => unsubscribe();', sources));
};
invalid(g => { g.checks.pop(); });
invalid(g => { g.checks[1].i = 1; });
invalid(g => { g.checks[0].evidence = 'invented quote'; });
invalid(g => { g.checks[0].evidence = ''; });
invalid(g => { g.checks[0].critical = true; });
invalid(g => { g.checks[0].status = 'unknown'; });
invalid(g => { g.audit.findings[0].source.id = 'unknown'; });
invalid(g => { g.audit.findings[0].source.evidence = 'invented source'; });
invalid(g => { g.audit.findings[0].evidence = 'invented answer'; });
invalid(g => { g.audit.findings[0].reason = ''; });
invalid(g => { g.audit.findings.push(g.audit.findings[0]); });
invalid(g => { g.audit = undefined; });
assert.throws(() => grade('', [decision(1, 'missing'), decision(2, 'unresolved')]));
console.log('PASS: factual coverage, omissions, silence, contradictions, code audit, uncertainty, rubric defects and evidence validation');
