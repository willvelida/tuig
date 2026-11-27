import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DOCS } from '../dist/docs/bundled.js';
import { TEMPLATES } from '../dist/engine/templates.js';

test('embedded docs and templates are LF-only regardless of checkout line endings', () => {
  for (const [name, text] of Object.entries({ ...DOCS, ...TEMPLATES })) {
    assert.equal(text.includes('\r'), false, name + ' contains CR bytes from a CRLF checkout');
  }
});
