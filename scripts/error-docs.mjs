import { readFileSync, writeFileSync } from 'node:fs';
import { ERRORS } from '../dist/cli/errors.js';
const target = new URL('../docs/reference/error-codes.md', import.meta.url);
const content =
  '# Error codes\n\nGenerated from src/cli/errors.ts. Run npm run docs:errors to regenerate.\n\n' +
  '| Code | Message | Fix |\n|---|---|---|\n' +
  Object.entries(ERRORS)
    .map(([code, e]) => '| ' + code + ' | ' + e.message + ' | ' + e.fix + ' |')
    .join('\n') +
  '\n';
const schemaPath = new URL('../schemas/envelope.schema.json', import.meta.url);
const schema = JSON.parse(readFileSync(schemaPath, 'utf8'));
schema.properties.error.properties.code.enum = Object.keys(ERRORS);
const schemaContent = JSON.stringify(schema, null, 2) + '\n';
if (process.argv.includes('--check')) {
  for (const [file, expected] of [
    [target, content],
    [schemaPath, schemaContent],
  ]) {
    if (readFileSync(file, 'utf8').replaceAll('\r\n', '\n') !== expected) {
      console.error('Generated reference is stale. Run npm run docs:errors.');
      process.exitCode = 1;
    }
  }
} else {
  writeFileSync(target, content);
  writeFileSync(schemaPath, schemaContent);
}
