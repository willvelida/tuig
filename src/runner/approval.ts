/**
 * A consequential action awaiting a human decision. Every field is derived by
 * the harness from the validated call, never from model-written prose.
 */
export type ApprovalRequest = {
  id: string;
  tool: string;
  cwd: string;
  rule: string;
  argv?: string[];
  path?: string;
  diffStat?: string;
};

export type ApprovalDecision = 'allow_once' | 'allow_run' | 'deny';

/** Decides one request. Non-interactive runs have no approver and always deny. */
export type Approver = (request: ApprovalRequest) => ApprovalDecision;
