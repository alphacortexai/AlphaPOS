import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeRegisterSettings } from './retail';

test('a shop with no register setting sells without a drawer', () => {
  assert.deepEqual(normalizeRegisterSettings(undefined), { mode: 'simple' });
  assert.deepEqual(normalizeRegisterSettings({}), { mode: 'simple' });
  assert.deepEqual(normalizeRegisterSettings({ mode: 'drawer' }), { mode: 'drawer' });
  assert.deepEqual(normalizeRegisterSettings({ mode: 'other' }), { mode: 'simple' });
});
