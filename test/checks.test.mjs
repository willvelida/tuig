import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
  existsSync,
  symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import Ajv from 'ajv';
import { initialize } from '../dist/engine/init.js';
import { trustRepository } from '../dist/engine/trust.js';
import { parseChecks } from '../dist/checks/config.js';
import { parseDiagnostics } from '../dist/checks/parsers.js';
import { executeCheck, executeChecks } from '../dist/checks/execute.js';
import { createRecord, readRun } from '../dist/engine/record.js';
import { executeTool } from '../dist/runner/tools/index.js';
import { detectSandbox } from '../dist/sandbox/index.js';

const data = (name) => readFileSync(new URL('./data/checks/' + name, import.meta.url), 'utf8');
const ajv = new Ajv();
const diagnosticValid = ajv.compile(
  JSON.parse(readFileSync('schemas/diagnostic.schema.json', 'utf8')),
);
const checksValid = ajv.compile(JSON.parse(readFileSync('schemas/checks.schema.json', 'utf8')));
const check = (extra = {}) =>
  parseChecks({
    schema_version: 1,
    checks: [{ name: 'visible', argv: [process.execPath, '-e', '// visible'], ...extra }],
  })[0];
function temporary(t) {
  const root = mkdtempSync(join(tmpdir(), 'tuig-checks-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}
function repo(t) {
  const root = temporary(t),
    path = join(root, 'repo');
  mkdirSync(path);
  const git = (args) => {
    const result = spawnSync('git', ['-c', 'core.hooksPath=/dev/null', ...args], {
      cwd: path,
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
  };
  git(['init']);
  initialize(path);
  const configFile = join(path, '.tuig/config.json');
  const config = JSON.parse(readFileSync(configFile, 'utf8'));
  // CLI checks is a deliberate human command; it can run in plan mode.
  config.mode = 'plan';
  writeFileSync(configFile, JSON.stringify(config));
  git(['add', '.']);
  git([
    '-c',
    'user.name=Test',
    '-c',
    'user.email=test@example.invalid',
    '-c',
    'commit.gpgsign=false',
    'commit',
    '-m',
    'test',
  ]);
  const old = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = join(root, 'state');
  t.after(() => {
    if (old === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = old;
  });
  return { root, path };
}

test('schema and runtime preserve version 1 defaults and validate additions', () => {
  const legacy = { schema_version: 1, checks: [{ name: 'test', argv: ['node', 'test.js'] }] };
  assert.equal(checksValid(legacy), true, JSON.stringify(checksValid.errors));
  assert.deepEqual(parseChecks(legacy), [
    { ...legacy.checks[0], kind: 'gate', parser: 'exit-code', timeoutSec: 10 },
  ]);
  for (const extra of [
    { kind: 'bad' },
    { parser: 'bad' },
    { timeoutSec: 61 },
    { timeoutSec: null },
    { argv: [''] },
    { argv: ['a\0b'] },
    { name: ' ' },
    { paths: ['../secret'] },
    { paths: ['/absolute'] },
    { paths: ['C:\\absolute'] },
    { paths: ['a/../b'] },
    { parser: 'junit' },
    { reportPath: 'report.xml' },
    { parser: 'junit', reportPath: '../report.xml' },
  ]) {
    const value = { schema_version: 1, checks: [{ name: 'x', argv: ['node'], ...extra }] };
    assert.equal(checksValid(value), false, JSON.stringify(extra));
    assert.throws(() => parseChecks(value), /Configuration/);
  }
  assert.ok(
    checksValid({
      schema_version: 1,
      checks: [check({ paths: ['src/**/*.ts'], parser: 'junit', reportPath: 'out/report.xml' })],
    }),
  );
  assert.throws(() => parseChecks({ schema_version: 1, checks: [check(), check()] }));
});

for (const [parser, file, rule] of [
  ['junit', 'pytest.xml', null],
  ['ruff-json', 'ruff.json', 'F401'],
  ['eslint-json', 'eslint.json', '@typescript-eslint/no-unused-vars'],
  ['tsc-text', 'tsc.txt', 'TS2322'],
]) {
  test('parses recorded real ' + parser + ' output into the published Diagnostic schema', () => {
    const diagnostics = parseDiagnostics(parser, 'recorded', data(file));
    assert.ok(diagnostics.length);
    for (const d of diagnostics)
      assert.ok(diagnosticValid(d), JSON.stringify(diagnosticValid.errors));
    if (rule)
      assert.ok(
        diagnostics.some((d) => d.rule === rule),
        JSON.stringify(diagnostics),
      );
    if (parser === 'tsc-text')
      assert.deepEqual(diagnostics[0], {
        tool: 'recorded',
        file: 'sample.ts',
        line: 1,
        col: 7,
        rule: 'TS2322',
        severity: 'error',
        message: "Type 'string' is not assignable to type 'number'.",
      });
    if (parser === 'junit') assert.match(diagnostics[0].message, /assert 1 == 2/);
  });
}
test('installed tsc recording verifies JSON mode is unsupported', () => {
  assert.match(data('tsc-json-probe.txt'), /TS5023: Unknown compiler option '--json'/);
  assert.match(JSON.parse(data('versions.json')).tscJsonMode, /No --json/);
});
test('parsers reject malformed, unsupported, and oversized reports', () => {
  for (const [parser, input] of [
    ['junit', '<testsuite><testcase></testsuite>'],
    ['junit', '<!DOCTYPE x [<!ENTITY e SYSTEM "file:///secret">]><testsuite/>'],
    ['junit', '<testsuite>&unknown;</testsuite>'],
    ['junit', '<html/>'],
    ['eslint-json', '{}'],
    ['eslint-json', '[{"filePath":"a","messages":[{}]}]'],
    ['ruff-json', '[{}]'],
    ['tsc-text', 'not compiler output'],
  ])
    assert.throws(() => parseDiagnostics(parser, 'tool', input));
  assert.throws(() => parseDiagnostics('junit', 'tool', ' '.repeat(1024 * 1024 + 1)));
});
test('JUnit handles CDATA, entities, errors, nested suites and suite counters', () => {
  const parsed = parseDiagnostics(
    'junit',
    'pytest',
    '<testsuites><testsuite><testcase name="a &amp; b" file="a.py" line="7"><error type="ValueError" message="bad &quot;value&quot;"><![CDATA[x < y]]></error></testcase></testsuite><testsuite failures="1"/></testsuites>',
  );
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].file, 'a.py');
  assert.equal(parsed[0].line, 7);
  assert.match(parsed[0].message, /a & b: bad "value": x < y/);
});
test('JUnit validates counters and never ignores aggregate failures', () => {
  assert.throws(() => parseDiagnostics('junit', 'pytest', '<testsuite failures="invalid"/>'));
  assert.throws(() => parseDiagnostics('junit', 'pytest', '<testsuite errors="-1"/>'));
  assert.equal(
    parseDiagnostics('junit', 'pytest', '<testsuites failures="1"><testsuite/></testsuites>')
      .length,
    1,
  );
});
test('exit-code checks retain the original bounded output allowance', async (t) => {
  const result = await executeCheck(
    temporary(t),
    check({ argv: [process.execPath, '-e', 'process.stdout.write("x".repeat(1024 * 1024 + 1))'] }),
  );
  assert.equal(result.passed, true);
});
test('structured diagnostics enforce count and message bounds', () => {
  const message = { severity: 2, message: 'x'.repeat(9000) };
  assert.equal(
    parseDiagnostics(
      'eslint-json',
      'eslint',
      JSON.stringify([{ filePath: 'a', messages: [message] }]),
    )[0].message.length,
    8192,
  );
  assert.throws(() =>
    parseDiagnostics(
      'eslint-json',
      'eslint',
      JSON.stringify([
        {
          filePath: 'a',
          messages: Array.from({ length: 1001 }, () => ({ severity: 2, message: 'x' })),
        },
      ]),
    ),
  );
});
test('tsc supports global diagnostics and multiline messages; ESLint warnings stay warnings', () => {
  const parsed = parseDiagnostics(
    'tsc-text',
    'tsc',
    'error TS5023: Unknown option.\na.ts(2,3): error TS2322: Wrong type.\n  Detail.\n',
  );
  assert.equal(parsed[0].file, null);
  assert.equal(parsed[1].message, 'Wrong type.\n  Detail.');
  assert.equal(
    parseDiagnostics(
      'eslint-json',
      'eslint',
      '[{"filePath":"a.js","messages":[{"severity":1,"message":"warn"}]}]',
    )[0].severity,
    'warning',
  );
});
test('checks run sequentially, retain order and aggregate gate versus repair failures', async (t) => {
  const root = temporary(t);
  const argv = (n) => [
    process.execPath,
    '-e',
    `require('fs').appendFileSync('order', '${n}');process.exit(${n === 2 ? 1 : 0})`,
  ];
  const checks = [
    check({ name: 'first', argv: argv(1) }),
    check({ name: 'second', kind: 'repair', argv: argv(2) }),
    check({ name: 'third', argv: argv(3) }),
  ];
  const result = await executeChecks(root, checks);
  assert.equal(readFileSync(join(root, 'order'), 'utf8'), '123');
  assert.equal(result.verdict, 'degraded');
  assert.deepEqual(
    result.checks.map((c) => c.passed),
    [true, false, true],
  );
  assert.equal((await executeChecks(root, [{ ...checks[1], kind: 'gate' }])).verdict, 'error');
});
test('structured parsers read stdout separately from stderr and fail closed on invalid success output', async (t) => {
  const root = temporary(t);
  const c = check({
    parser: 'eslint-json',
    argv: [process.execPath, '-e', 'console.log("[]");console.error("warning on stderr")'],
  });
  assert.equal((await executeCheck(root, c)).passed, true);
  const invalid = await executeCheck(root, {
    ...c,
    argv: [process.execPath, '-e', 'console.log("broken")'],
  });
  assert.equal(invalid.passed, false);
  assert.equal(invalid.status, 'invalid_report');
  assert.ok(invalid.diagnostics.length);
});
test('valid parser errors cannot pass with a zero exit code', async (t) => {
  const result = await executeCheck(
    temporary(t),
    check({
      parser: 'tsc-text',
      argv: [process.execPath, '-e', 'console.log("a.ts(1,2): error TS2322: Wrong type.")'],
    }),
  );
  assert.equal(result.passed, false);
  assert.equal(result.exitCode, 0);
});
test('JUnit removes stale reports and missing, invalid or oversized reports never pass', async (t) => {
  const root = temporary(t),
    c = check({ parser: 'junit', reportPath: 'report.xml' });
  writeFileSync(join(root, 'report.xml'), '<testsuite/>');
  assert.equal((await executeCheck(root, c)).passed, false);
  for (const contents of ['not xml', ' '.repeat(1024 * 1024 + 1), '<testsuite/>']) {
    const expression =
      contents.length > 1024 * 1024 ? "' '.repeat(1024 * 1024 + 1)" : JSON.stringify(contents);
    const result = await executeCheck(root, {
      ...c,
      argv: [process.execPath, '-e', `require('fs').writeFileSync('report.xml', ${expression})`],
    });
    assert.equal(result.passed, contents === '<testsuite/>');
  }
});
test(
  'JUnit refuses report traversal and symlink escapes without touching outside files',
  { skip: process.platform === 'win32' },
  async (t) => {
    const root = temporary(t),
      workspace = join(root, 'workspace');
    mkdirSync(workspace);
    writeFileSync(join(root, 'outside.xml'), '<testsuite/>');
    symlinkSync(root, join(workspace, 'escape'));
    const result = await executeCheck(
      workspace,
      check({ parser: 'junit', reportPath: 'escape/outside.xml' }),
    );
    assert.equal(result.passed, false);
    assert.equal(readFileSync(join(root, 'outside.xml'), 'utf8'), '<testsuite/>');
    symlinkSync(join(root, 'outside.xml'), join(workspace, 'link.xml'));
    assert.equal(
      (await executeCheck(workspace, check({ parser: 'junit', reportPath: 'link.xml' }))).passed,
      false,
    );
  },
);
test('timeouts, cancellation, and spawn failures cannot pass', async (t) => {
  const root = temporary(t),
    c = check({ timeoutSec: 0.05, argv: [process.execPath, '-e', 'setInterval(()=>{},1000)'] });
  const result = await executeCheck(root, c, { graceMs: 10 });
  assert.equal(result.passed, false);
  assert.equal(result.status, 'timeout');
  const controller = new AbortController();
  controller.abort();
  assert.equal(
    (await executeCheck(root, c, { signal: controller.signal, graceMs: 10 })).passed,
    false,
  );
  assert.equal(
    (await executeCheck(root, { ...c, argv: ['tuig-nonexistent-command'] })).passed,
    false,
  );
});
test('tuig checks --json has a portable deterministic envelope and refuses untrusted execution', (t) => {
  const f = repo(t),
    entry = resolve('dist/main.js');
  writeFileSync(
    join(f.path, '.tuig/checks.json'),
    JSON.stringify({
      schema_version: 1,
      checks: [
        {
          name: 'visible',
          argv: [process.execPath, '-e', 'require("fs").writeFileSync("ran", "yes")'],
        },
      ],
    }),
  );
  const invoke = () =>
    spawnSync(process.execPath, [entry, 'checks', '--json'], {
      cwd: f.path,
      encoding: 'utf8',
      env: { ...process.env, TUIG_OUTPUT: 'text' },
    });
  const denied = invoke();
  assert.equal(JSON.parse(denied.stdout).error.code, 'TUIG_E_UNTRUSTED');
  assert.equal(existsSync(join(f.path, 'ran')), false);
  trustRepository(f.path);
  const result = invoke();
  const expected = {
    schema_version: 1,
    command: 'checks',
    data: {
      verdict: 'ok',
      checks: [
        { name: 'visible', kind: 'gate', passed: true, status: 'ok', exitCode: 0, diagnostics: [] },
      ],
    },
    status: 'ok',
  };
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), expected);
  assert.equal(readFileSync(join(f.path, 'ran'), 'utf8'), 'yes');
  assert.deepEqual(JSON.parse(invoke().stdout), expected);
  for (const [kind, verdict, exit] of [
    ['repair', 'degraded', 0],
    ['gate', 'error', 1],
  ]) {
    writeFileSync(
      join(f.path, '.tuig/checks.json'),
      JSON.stringify({
        schema_version: 1,
        checks: [{ name: 'fails', kind, argv: [process.execPath, '-e', 'process.exit(1)'] }],
      }),
    );
    const failed = invoke(),
      envelope = JSON.parse(failed.stdout);
    assert.equal(failed.status, exit);
    assert.equal(envelope.status, verdict);
    assert.equal(envelope.data.verdict, verdict);
    assert.ok(envelope.next_action);
  }
});
test('run_checks uses only pinned checks, preserves untrusted output boundaries, and enforces policy', async (t) => {
  const root = temporary(t),
    store = createRecord(root, 'tool-checks');
  const checks = [
    check({
      argv: [process.execPath, '-e', 'require("fs").writeFileSync("ran", "yes");process.exit(1)'],
    }),
  ];
  mkdirSync(join(root, '.tuig'), { recursive: true });
  writeFileSync(join(root, '.tuig/checks.json'), 'hostile replacement is never loaded');
  const call = { id: 'check', name: 'run_checks', arguments: {} };
  const invalid = await executeTool(
    { ...call, arguments: { argv: ['anything'] } },
    { root, store, checks, mode: 'ask' },
  );
  assert.equal(invalid.status, 'invalid_args');
  const denied = await executeTool(call, { root, store, checks, mode: 'plan' });
  assert.equal(denied.status, 'policy_denied');
  assert.equal(existsSync(join(root, 'ran')), false);
  assert.ok(readRun(store).events.some((e) => e.type === 'policy_denied'));
  const result = await executeTool(call, { root, store, checks, mode: 'ask' });
  assert.equal(result.status, 'nonzero_exit');
  assert.match(result.output, /<untrusted source="tool:run_checks">/);
  assert.match(result.output, /"verdict":"error"/);
  assert.equal(readFileSync(join(root, 'ran'), 'utf8'), 'yes');
});
test('run_checks obeys command denies and refuses calls without host checks', async (t) => {
  const root = temporary(t),
    store = createRecord(root, 'policy-checks');
  const call = { id: 'check', name: 'run_checks', arguments: {} };
  assert.equal((await executeTool(call, { root, store, mode: 'auto' })).status, 'policy_denied');
  const checks = [check({ argv: ['sudo', 'true'] })];
  assert.equal(
    (await executeTool(call, { root, store, checks, mode: 'auto' })).status,
    'policy_denied',
  );
});
const sandbox = detectSandbox();
test(
  'run_checks uses the existing OS sandbox to block writes outside the workspace',
  { skip: !sandbox && process.env.TUIG_REQUIRE_SANDBOX !== '1' },
  async (t) => {
    assert.ok(sandbox, 'TUIG_REQUIRE_SANDBOX requires a working sandbox');
    const root = temporary(t),
      workspace = join(root, 'workspace');
    mkdirSync(workspace);
    const outsideRoot = mkdtempSync('/var/tmp/tuig-checks-outside-');
    t.after(() => rmSync(outsideRoot, { recursive: true, force: true }));
    const outside = join(outsideRoot, 'outside'),
      store = createRecord(workspace, 'sandbox-checks');
    writeFileSync(outside, 'original');
    const checks = [
      check({
        argv: [
          process.execPath,
          '-e',
          `require('fs').writeFileSync(${JSON.stringify(outside)}, 'escaped')`,
        ],
      }),
    ];
    const result = await executeTool(
      { id: 'check', name: 'run_checks', arguments: {} },
      { root: workspace, store, checks, mode: 'auto', sandbox },
    );
    assert.equal(result.status, 'nonzero_exit');
    assert.equal(readFileSync(outside, 'utf8'), 'original');
    const control = await executeTool(
      { id: 'control', name: 'run_checks', arguments: {} },
      { root: workspace, store, checks, mode: 'auto' },
    );
    assert.equal(control.status, 'ok');
    assert.equal(readFileSync(outside, 'utf8'), 'escaped');
  },
);
