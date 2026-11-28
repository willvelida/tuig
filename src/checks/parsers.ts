import type { Check } from './config.js';

export type Diagnostic = {
  tool: string;
  file: string | null;
  line: number | null;
  col: number | null;
  rule: string | null;
  severity: 'error' | 'warning' | 'info';
  message: string;
};
export const MAX_REPORT_BYTES = 1024 * 1024;
const MAX_DIAGNOSTICS = 1000;
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const position = (v: unknown): number | null =>
  typeof v === 'number' && Number.isSafeInteger(v) && v > 0 ? v : null;
const text = (v: unknown): string | null => (typeof v === 'string' && v.length ? v : null);
export function diagnostic(
  tool: string,
  message: string,
  extra: Partial<Diagnostic> = {},
): Diagnostic {
  return {
    tool,
    file: null,
    line: null,
    col: null,
    rule: null,
    severity: 'error',
    message: message.slice(0, 8192),
    ...extra,
  };
}

type Element = {
  name: string;
  attrs: Record<string, string>;
  children: Element[];
  content: string;
};
function decode(value: string): string {
  return value.replace(/&([^;]*);|&/g, (whole, entity: string | undefined) => {
    const named: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
    if (entity && Object.hasOwn(named, entity)) return named[entity]!;
    if (entity && /^#(?:[0-9]+|x[0-9a-f]+)$/i.test(entity)) {
      const code =
        entity[1]?.toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
      if (code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff))
        return String.fromCodePoint(code);
    }
    throw new Error('Invalid XML entity: ' + whole);
  });
}
/** Small non-validating XML reader: no DTD, external entities, or expansion. */
export function xml(input: string): Element {
  const document: Element = { name: '', attrs: {}, children: [], content: '' },
    stack = [document];
  const tokens = /<!--[\s\S]*?-->|<\?xml\s[\s\S]*?\?>|<!\[CDATA\[[\s\S]*?\]\]>|<[^>]*>|[^<]+/g;
  let offset = 0,
    count = 0;
  for (const match of input.matchAll(tokens)) {
    if (match.index !== offset || ++count > 100000) throw new Error('Invalid or oversized XML');
    const token = match[0];
    offset += token.length;
    const parent = stack.at(-1)!;
    if (token.startsWith('<!--') || token.startsWith('<?xml ')) continue;
    if (token.startsWith('<![CDATA[')) {
      parent.content += token.slice(9, -3);
      continue;
    }
    if (token.startsWith('</')) {
      if (stack.length < 2 || token !== '</' + parent.name + '>') throw new Error('Mismatched XML');
      stack.pop();
    } else if (token.startsWith('<')) {
      const tag = /^<([A-Za-z_][\w:.-]*)([\s\S]*?)(\/?)>$/.exec(token);
      if (!tag) throw new Error('Unsupported XML markup');
      const attrs: Record<string, string> = {};
      let rest = tag[2]!;
      while (rest.trim()) {
        const attr = /^\s+([A-Za-z_][\w:.-]*)\s*=\s*(?:"([^"<]*)"|'([^'<]*)')/.exec(rest);
        if (!attr || Object.hasOwn(attrs, attr[1]!)) throw new Error('Invalid XML attribute');
        attrs[attr[1]!] = decode(attr[2] ?? attr[3]!);
        rest = rest.slice(attr[0].length);
      }
      const node: Element = { name: tag[1]!, attrs, children: [], content: '' };
      parent.children.push(node);
      if (!tag[3]) {
        stack.push(node);
        if (stack.length > 100) throw new Error('XML nesting limit');
      }
    } else parent.content += decode(token);
  }
  if (
    offset !== input.length ||
    stack.length !== 1 ||
    document.children.length !== 1 ||
    document.content.trim()
  )
    throw new Error('Incomplete XML');
  return document.children[0]!;
}
function junit(tool: string, input: string): Diagnostic[] {
  const root = xml(input);
  if (!['testsuite', 'testsuites'].includes(root.name)) throw new Error('Expected JUnit testsuite');
  const out: Diagnostic[] = [];
  const visit = (node: Element, test?: Element): void => {
    if (['testsuite', 'testsuites'].includes(node.name)) {
      for (const key of ['tests', 'failures', 'errors', 'skipped']) {
        const count = node.attrs[key];
        if (count !== undefined && (!/^\d+$/.test(count) || !Number.isSafeInteger(Number(count))))
          throw new Error('Invalid JUnit counter.');
      }
    }
    if (node.name === 'testcase') test = node;
    if (['failure', 'error'].includes(node.name)) {
      const owner = test ?? node;
      out.push(
        diagnostic(
          tool,
          [owner.attrs.name, node.attrs.message, node.content.trim()].filter(Boolean).join(': ') ||
            'JUnit failure',
          {
            file: text(owner.attrs.file),
            line: position(Number(owner.attrs.line)),
            rule: text(node.attrs.type),
          },
        ),
      );
    }
    const before = out.length;
    for (const child of node.children) visit(child, test);
    if (
      ['testsuite', 'testsuites'].includes(node.name) &&
      out.length === before &&
      (Number(node.attrs.failures ?? 0) > 0 || Number(node.attrs.errors ?? 0) > 0)
    )
      out.push(diagnostic(tool, 'JUnit suite reports failures without failure details.'));
  };
  visit(root);
  return out;
}

/** Malformed structured output throws; callers must turn it into a failed check. */
export function parseDiagnostics(
  parser: Check['parser'],
  tool: string,
  input: string,
): Diagnostic[] {
  let out: Diagnostic[] = [];
  if (parser === 'exit-code') return out;
  if (Buffer.byteLength(input) > MAX_REPORT_BYTES) throw new Error('Report exceeds 1 MiB.');
  if (parser === 'junit') out = junit(tool, input);
  else if (parser === 'tsc-text') {
    for (const line of input.replace(/\x1b\[[0-9;]*m/g, '').split(/\r?\n/)) {
      const match = /^(?:(.+)\((\d+),(\d+)\):\s*|\s*)(error|warning) TS(\d+): (.*)$/.exec(line);
      if (match)
        out.push(
          diagnostic(tool, match[6]!, {
            file: text(match[1]),
            line: position(Number(match[2])),
            col: position(Number(match[3])),
            rule: 'TS' + match[5],
            severity: match[4] as 'error' | 'warning',
          }),
        );
      else if (line.trim() && out.length)
        out.at(-1)!.message = (out.at(-1)!.message + '\n' + line).slice(0, 8192);
      else if (line.trim()) throw new Error('Unrecognized tsc text output; use --pretty false.');
    }
  } else {
    const value: unknown = JSON.parse(input);
    if (!Array.isArray(value)) throw new Error('Expected a JSON array.');
    for (const entry of value) {
      if (!object(entry)) throw new Error('Invalid diagnostic entry.');
      if (parser === 'eslint-json') {
        if (typeof entry.filePath !== 'string' || !Array.isArray(entry.messages))
          throw new Error('Invalid ESLint result.');
        for (const message of entry.messages) {
          if (
            !object(message) ||
            typeof message.message !== 'string' ||
            ![1, 2].includes(Number(message.severity))
          )
            throw new Error('Invalid ESLint message.');
          out.push(
            diagnostic(tool, message.message, {
              file: text(entry.filePath),
              line: position(message.line),
              col: position(message.column),
              rule: text(message.ruleId),
              severity: message.severity === 1 ? 'warning' : 'error',
            }),
          );
        }
      } else {
        if (
          typeof entry.filename !== 'string' ||
          typeof entry.message !== 'string' ||
          !object(entry.location)
        )
          throw new Error('Invalid Ruff result.');
        out.push(
          diagnostic(tool, entry.message, {
            file: text(entry.filename),
            line: position(entry.location.row),
            col: position(entry.location.column),
            rule: text(entry.code),
          }),
        );
      }
    }
  }
  if (out.length > MAX_DIAGNOSTICS)
    out = [
      ...out.slice(0, MAX_DIAGNOSTICS),
      diagnostic(tool, 'Diagnostic list truncated after 1000 entries.'),
    ];
  return out;
}
