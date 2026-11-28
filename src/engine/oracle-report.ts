import { parseDiagnostics, xml } from '../checks/parsers.js';

/** Oracle-specific rules; visible JUnit checks retain their existing semantics. */
export function oracleReportPassed(report: string): boolean {
  const diagnostics = parseDiagnostics('junit', 'hidden_oracle', report);
  const root = xml(report);
  type Node = ReturnType<typeof xml>;
  let prohibited = false;
  const walk = (node: Node): { tests: number; passed: number } => {
    const marked =
      /(?:xfail|xpass|skipped)/i.test(node.name) ||
      Object.entries(node.attrs).some(
        ([key, value]) =>
          /(?:status|result|type)/i.test(key) && /(?:xfail|xpass|skipped)/i.test(value),
      );
    if (marked || ['skipped', 'failure', 'error'].includes(node.name)) prohibited = true;
    if (node.name === 'testcase') {
      let adverse = marked;
      const descendants = (current: Node): void => {
        for (const child of current.children) {
          if (['testcase', 'testsuite', 'testsuites'].includes(child.name))
            throw new Error('Nested oracle testcase.');
          if (
            ['failure', 'error', 'skipped'].includes(child.name) ||
            /(?:xfail|xpass)/i.test(child.name) ||
            Object.values(child.attrs).some((value) => /(?:xfail|xpass)/i.test(value))
          )
            adverse = true;
          descendants(child);
        }
      };
      descendants(node);
      if (adverse) prohibited = true;
      return { tests: 1, passed: adverse ? 0 : 1 };
    }
    let tests = 0,
      passed = 0;
    for (const child of node.children) {
      if (
        ['testcase', 'testsuite', 'testsuites'].includes(child.name) &&
        !['testsuite', 'testsuites'].includes(node.name)
      )
        throw new Error('Oracle testcase outside a suite.');
      const result = walk(child);
      tests += result.tests;
      passed += result.passed;
    }
    if (['testsuite', 'testsuites'].includes(node.name)) {
      for (const key of ['tests', 'skipped', 'failures', 'errors', 'xfail', 'xpass']) {
        const value = node.attrs[key];
        if (value === undefined) continue;
        if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)))
          throw new Error('Invalid oracle suite count.');
        const count = Number(value);
        if (key === 'tests' && count !== tests)
          throw new Error('Oracle testcase count differs from suite count.');
        if (key !== 'tests' && count > 0) prohibited = true;
        if (key !== 'tests' && count > tests)
          throw new Error('Oracle outcome count exceeds test count.');
      }
      const outcomes = ['skipped', 'failures', 'errors'].reduce(
        (n, key) => n + Number(node.attrs[key] ?? 0),
        0,
      );
      if (outcomes > tests) throw new Error('Inconsistent oracle outcome counts.');
    }
    return { tests, passed };
  };
  const totals = walk(root);
  return totals.passed > 0 && totals.passed === totals.tests && !prohibited && !diagnostics.length;
}
