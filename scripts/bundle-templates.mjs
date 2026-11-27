import { readFileSync, writeFileSync } from 'node:fs';
const files = { '.tuig/config.json': 'config.json', '.tuig/checks.json': 'checks.json', 'AGENTS.md': 'agents-section.md' };
const templates = Object.fromEntries(Object.entries(files).map(([target, file]) => [target, readFileSync(new URL('../templates/init/v1/' + file, import.meta.url), 'utf8').replaceAll('\r\n','\n')]));
writeFileSync(new URL('../src/engine/templates.ts', import.meta.url), '// Generated from templates/init/v1/.\nexport const TEMPLATES: Readonly<Record<string, string>> = ' + JSON.stringify(templates, null, 2) + ';\n');
