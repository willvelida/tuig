import { closeSync, openSync, readSync, writeSync } from 'node:fs';
import type { ApprovalDecision, ApprovalRequest, Approver } from '../runner/approval.js';

/** Line-oriented terminal access; injectable so tests need no real TTY. */
export type TerminalIO = { write(text: string): void; readLine(): string | null; close?(): void };

/**
 * Make text safe to print: escape C0/C1 controls (including ESC, so no ANSI
 * sequences), DEL, and bidi or zero-width characters that could disguise text.
 */
export function displaySafe(text: string): string {
  return text.replace(
    /[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩﻿]/g,
    (char) => '\\u' + char.charCodeAt(0).toString(16).padStart(4, '0'),
  );
}

/**
 * Render the prompt from harness-derived request fields only. Model prose
 * (assistant messages, reasons) is never part of an ApprovalRequest.
 */
export function renderApproval(request: ApprovalRequest, worktreeStat?: string): string {
  const lines = ['', 'tuig approval required'];
  const field = (name: string, value: string | undefined): void => {
    if (value !== undefined) lines.push('  ' + (name + ':').padEnd(10) + displaySafe(value));
  };
  field('rule', request.rule);
  field('tool', request.tool);
  if (request.argv) field('argv', JSON.stringify(request.argv));
  field('path', request.path);
  field('cwd', request.cwd);
  field('change', request.diffStat);
  field('worktree', worktreeStat === undefined ? undefined : worktreeStat || 'no changes yet');
  lines.push('[o] allow once   [r] allow for this run   [d] deny (default)', '> ');
  return lines.join('\n');
}

/** Map an answer to a decision; anything unrecognised is a denial. */
export function parseChoice(answer: string | null): ApprovalDecision {
  switch ((answer ?? '').trim().toLowerCase()) {
    case 'o':
    case 'once':
      return 'allow_once';
    case 'r':
    case 'run':
      return 'allow_run';
    default:
      return 'deny';
  }
}

function actionKey(request: ApprovalRequest): string {
  return JSON.stringify([
    request.tool,
    request.rule,
    request.argv ?? null,
    request.path ?? null,
    request.cwd,
  ]);
}

/**
 * An approver that asks on the terminal. "Allow for this run" is remembered
 * in this closure only, for the identical action, and dies with the run.
 */
export function terminalApprover(io: TerminalIO, worktreeStat?: () => string): Approver {
  const allowedForRun = new Set<string>();
  return (request) => {
    const key = actionKey(request);
    if (allowedForRun.has(key)) return 'allow_run';
    io.write(renderApproval(request, worktreeStat?.()));
    const decision = parseChoice(io.readLine());
    io.write(
      decision === 'deny'
        ? 'denied\n'
        : decision === 'allow_run'
          ? 'allowed for this run\n'
          : 'allowed once\n',
    );
    if (decision === 'allow_run') allowedForRun.add(key);
    return decision;
  };
}

/**
 * Open the controlling terminal for synchronous prompts, or null when the run
 * is non-interactive (no TTY, or CI set). The envelope keeps stdout to itself.
 */
export function openTerminal(env: NodeJS.ProcessEnv = process.env): TerminalIO | null {
  if (!process.stdin.isTTY || !process.stderr.isTTY || env.CI) return null;
  let fd: number;
  try {
    fd = openSync('/dev/tty', 'r+');
  } catch {
    return null;
  }
  return {
    write: (text) => {
      writeSync(fd, text);
    },
    readLine: () => {
      const buffer = Buffer.alloc(1024);
      let line = '';
      for (;;) {
        const count = readSync(fd, buffer, 0, buffer.length, null);
        if (count === 0) return line || null;
        line += buffer.subarray(0, count).toString('utf8');
        if (line.includes('\n')) return line.slice(0, line.indexOf('\n'));
      }
    },
    close: () => closeSync(fd),
  };
}
