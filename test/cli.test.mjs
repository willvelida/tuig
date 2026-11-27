import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import Ajv from 'ajv';
import { envelope, EXIT_CODES } from '../dist/cli/envelope.js';
import { cliError, ERRORS } from '../dist/cli/errors.js';
import { outputMode, render } from '../dist/cli/output.js';
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const schema = JSON.parse(readFileSync(new URL('../schemas/envelope.schema.json', import.meta.url), 'utf8'));
const validate = new Ajv({ strict: true }).compile(schema);
function invoke(args, override) {
  const env = { ...process.env };
  delete env.TUIG_OUTPUT;
  if (override !== undefined) env.TUIG_OUTPUT = override;
  return spawnSync(process.execPath, [pkg.bin.tuig, ...args], { encoding: 'utf8', env });
}
for (const [args, command, code] of [
  [[], 'help', 0], [['--help'], 'help', 0], [['--version'], 'version', 0],
  [['--unknown'], 'tuig', 1], [['run'], 'tuig', 1],
]) {
  test('schema-valid CLI output: ' + JSON.stringify(args), () => {
    const r = invoke(args);
    assert.equal(r.status, code);
    assert.equal(r.stderr, '');
    const value = JSON.parse(r.stdout);
    assert.ok(validate(value), JSON.stringify(validate.errors));
    assert.equal(value.command, command);
    assert.equal(r.status, EXIT_CODES[value.status]);
    if (command === 'version') assert.equal(value.data.version, pkg.version);
    if (code !== 0) assert.equal(value.error.code, 'TUIG_E_USAGE');
  });
}
test('all statuses have the specified exits and validate', () => {
  for (const [status, exit] of [['ok',0],['degraded',0],['unconfigured',2],['error',1]]) {
    const value = envelope('test', {}, status === 'ok' ? { status } : { status, next_action: 'Review output' });
    assert.equal(EXIT_CODES[status], exit);
    assert.ok(validate(value), JSON.stringify(validate.errors));
  }
});
test('non-ok missing or blank next_action fails builder and schema', () => {
  for (const status of ['degraded','unconfigured','error']) {
    for (const next_action of [undefined, '', '   ']) {
      assert.throws(() => envelope('test', {}, { status, next_action }), /next_action/);
      const value = { schema_version: 1, command: 'test', status, data: {} };
      if (next_action !== undefined) value.next_action = next_action;
      assert.equal(validate(value), false);
    }
  }
});
test('schema rejects unknown fields, statuses, versions and error codes', () => {
  const valid = envelope('test', {}, { status: 'ok' });
  for (const mutation of [{extra:true},{schema_version:2},{status:'unknown'},{command:''},{error:{code:'OTHER',message:'m',fix:'f'}}]) {
    assert.equal(validate({...valid,...mutation}), false);
  }
});
test('all registered errors validate', () => {
  for (const code of Object.keys(ERRORS)) {
    const error = cliError(code);
    assert.ok(validate(envelope('test', {}, {status:'error',error,next_action:error.fix})), JSON.stringify(validate.errors));
  }
});
test('output selection covers TTY, pipes and overrides', () => {
  assert.equal(outputMode(true), 'text');
  assert.equal(outputMode(false), 'json');
  for (const tty of [true,false]) {
    assert.equal(outputMode(tty,'json'), 'json');
    assert.equal(outputMode(tty,'text'), 'text');
  }
  assert.throws(() => outputMode(false,'other'));
});
test('text retains data, error and recovery action', () => {
  const error = cliError('TUIG_E_UNTRUSTED');
  const value = envelope('test', { file: 'example' }, {status:'error',error,next_action:error.fix});
  const text = render(value, 'text');
  for (const field of ['test: error','example',error.code,error.message,error.fix,'Next:']) assert.ok(text.includes(field));
});
test('CLI overrides and invalid output mode', () => {
  assert.match(invoke(['--version'],'text').stdout, /version: ok/);
  assert.ok(validate(JSON.parse(invoke(['--version'],'json').stdout)));
  for (const override of ['invalid','']) {
    const r = invoke(['--version'],override);
    assert.equal(r.status,1);
    const value = JSON.parse(r.stdout);
    assert.ok(validate(value));
    assert.equal(value.error.code,'TUIG_E_OUTPUT');
  }
});
