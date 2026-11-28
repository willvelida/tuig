import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRecord, readRun } from '../dist/engine/record.js';
import { control } from '../dist/runner/controller.js';
import { replayAdapter } from '../dist/runner/adapter/replay.js';

test('live controller redacts repair diagnostics before adapter requests and recording', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'tuig-live-repair-redaction-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const root = join(directory, 'workspace');
  mkdirSync(root);
  const secret = 'planted-live-repair-secret-853729';
  const store = createRecord(directory, 'live', { env: {}, literals: [secret] });
  const response = {
    message: 'done',
    stopReason: 'stop',
    toolCalls: [],
    usage: { input: 0, cached: 0, output: 0, reasoning: 0, cost: 0 },
  };
  const replay = replayAdapter(
    [0, 1].map((step) => ({ type: 'model_response', data: { step, response } })),
  );
  const requests = [];
  const adapter = {
    ...replay,
    async complete(request) {
      requests.push(structuredClone(request.messages));
      return replay.complete(request);
    },
  };
  let validations = 0;
  const result = await control({
    root,
    store,
    adapter,
    messages: [],
    handleSIGINT: false,
    validate: async () => {
      const passed = validations++ > 0;
      return {
        checks: [
          {
            name: 'lint',
            kind: 'repair',
            passed,
            diagnostics: passed
              ? []
              : [
                  {
                    tool: 'lint',
                    file: 'a.js',
                    line: 1,
                    col: 1,
                    rule: 'bad',
                    severity: 'error',
                    message: 'Diagnostic contains ' + secret,
                  },
                ],
          },
        ],
      };
    },
  });
  assert.equal(result.state, 'SUCCEEDED');
  assert.equal(result.totals.repairs, 1);
  assert.equal(requests.length, 2);
  const feedback = requests[1].filter((message) => message.role === 'user');
  assert.equal(feedback.length, 1);
  assert.match(feedback[0].content, /<untrusted source="sensor">/);
  assert.doesNotMatch(JSON.stringify(requests), new RegExp(secret));
  assert.match(feedback[0].content, /\[REDACTED\]/);
  const { events } = readRun(store);
  assert.doesNotMatch(JSON.stringify(events), new RegExp(secret));
  const recordedFeedback = events
    .filter((event) => event.type === 'model_request')
    .at(-1)
    .data.messages.filter((message) => message.role === 'user');
  assert.deepEqual(recordedFeedback, feedback);
  assert.match(JSON.stringify(recordedFeedback), /\[REDACTED\]/);
  assert.match(
    events.find((event) => event.type === 'sensor_result').data.checks[0].diagnostics[0].message,
    /\[REDACTED\]/,
  );
});
