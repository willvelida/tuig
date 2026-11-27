#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { CLI_NAME, VERSION } from './cli/name.js';
try {
  const { values } = parseArgs({ options: { version: { type: 'boolean' }, help: { type: 'boolean' } } });
  console.log(values.version ? VERSION : `Usage: ${CLI_NAME} [--help | --version]`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
