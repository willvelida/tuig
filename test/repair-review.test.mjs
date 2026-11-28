import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { executeTool } from '../dist/runner/tools/index.js';
import { newErrors } from '../dist/checks/lint-edit.js';
import { appendEvent, createRecord, existingRecord } from '../dist/engine/record.js';
import { resumePoint } from '../dist/runner/resume.js';
import { control, repairMessage } from '../dist/runner/controller.js';
import { replayAdapter } from '../dist/runner/adapter/replay.js';

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'tuig-repair-review-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const root = join(dir, 'workspace');
  mkdirSync(root);
  return { root, store: createRecord(dir, 'run', { env: {} }) };
}

for (const [name, original, search, replace, expected] of [
  ['insertion above a pre-existing error', 'header\nBAD\n', 'header', 'import x;\nheader', 'ok'],
  ['deletion above a pre-existing error', 'import x;\nheader\nBAD\n', 'import x;\n', '', 'ok'],
  ['a second identical error', 'header\nBAD\n', 'header', 'BAD\nheader', 'lint_rejected'],
])
  test('location-independent lint guard: ' + name, async (t) => {
    const f = fixture(t);
    writeFileSync(join(f.root, 'a.js'), original);
    const script =
      "const lines=require('node:fs').readFileSync('a.js','utf8').split('\\n'); const messages=lines.flatMap((text,index)=>text==='BAD'?[{ruleId:'bad',severity:2,message:'Bad token',line:index+1,column:1}]:[]); console.log(JSON.stringify([{filePath:'a.js',messages}]))";
    const checks = [
      {
        name: 'lint',
        kind: 'repair',
        parser: 'eslint-json',
        paths: ['*.js'],
        timeoutSec: 2,
        argv: [process.execPath, '-e', script],
      },
    ];
    const result = await executeTool(
      { id: 'edit', name: 'edit', arguments: { path: 'a.js', search, replace } },
      { ...f, checks, mode: 'auto' },
    );
    assert.equal(result.status, expected);
    assert.equal(
      readFileSync(join(f.root, 'a.js'), 'utf8'),
      expected === 'ok' ? original.replace(search, replace) : original,
    );
    if (expected === 'lint_rejected') {
      assert.match(result.output, /"line":3/);
      assert.match(result.output, /"col":1/);
    }
  });

test('location-independent multiset retains the after-edit location for increased counts', () => {
  const d = {
    tool: 'lint',
    file: 'a.js',
    rule: 'bad',
    severity: 'error',
    message: 'Bad token',
    line: 2,
    col: 1,
  };
  const shifted = { ...d, line: 3, col: 4 };
  const additional = { ...d, line: 5, col: 2 };
  assert.deepEqual(newErrors([{ diagnostics: [d] }], [{ diagnostics: [shifted, additional] }]), [
    additional,
  ]);
});

test('resumed repair feedback redacts a planted sensor secret before reaching a replay adapter', async (t) => {
  const f = fixture(t);
  const secret = 'planted-review-secret-783219';
  const checks = [
    {
      name: 'lint',
      kind: 'repair',
      passed: false,
      diagnostics: [
        {
          tool: 'lint',
          file: 'a.js',
          line: 1,
          col: 1,
          rule: 'bad',
          severity: 'error',
          message: 'Output ' + secret,
        },
      ],
    },
  ];
  appendEvent(f.store, 'run_start', {
    workspace: { id: 'w', branch: 'tuig/run-w', base: 'abc' },
    task: { taskId: null, instruction: 'repair' },
  });
  appendEvent(f.store, 'sensor_result', { checks });
  appendEvent(f.store, 'state_transition', { from: 'VALIDATING', to: 'REPAIRING' });
  appendEvent(f.store, 'checkpoint', { turn: 0, ref: 'ref', commit: 'abc' });
  const key = 'TUIG_REVIEW_PLANTED_SECRET';
  const previous = process.env[key];
  process.env[key] = secret;
  t.after(() => {
    if (previous === undefined) delete process.env[key];
    else process.env[key] = previous;
  });
  const point = resumePoint(dirname(f.root), 'run');
  assert.deepEqual(
    point.conversation[0],
    repairMessage(checks, existingRecord(dirname(f.root), 'run').clean),
  );
  assert.doesNotMatch(JSON.stringify(point.conversation), new RegExp(secret));
  const response = {
    message: 'done',
    stopReason: 'stop',
    toolCalls: [],
    usage: { input: 0, cached: 0, output: 0, reasoning: 0, cost: 0 },
  };
  const replay = replayAdapter([{ type: 'model_response', data: { step: 0, response } }]);
  let observed;
  const adapter = {
    ...replay,
    async complete(request) {
      observed = request.messages;
      return replay.complete(request);
    },
  };
  const result = await control({
    ...f,
    store: createRecord(dirname(f.root), 'resumed'),
    adapter,
    messages: [],
    resume: point,
    handleSIGINT: false,
    validate: async () => ({ checks: [{ name: 'lint', kind: 'repair', passed: true }] }),
  });
  assert.equal(result.state, 'SUCCEEDED');
  assert.doesNotMatch(JSON.stringify(observed), new RegExp(secret));
  assert.match(JSON.stringify(observed), /\[REDACTED\]/);
});
