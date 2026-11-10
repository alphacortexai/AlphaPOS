import assert from 'node:assert/strict';
import test from 'node:test';
import { HISTORICAL_DAYS, planHistoricalEntry } from './historicalEntry';
import { businessDayKey } from './reports';

const clock = { timezoneOffsetMinutes: 180, dayStartTime: '00:00' };
const now = new Date('2026-11-10T09:00:00.000Z');

test('a sale entered today is not a missed sale', () => {
  const plan = planHistoricalEntry({ dayKey: '2026-11-10', now, clock, reason: '' });
  assert.equal(plan.ok, true);
  if (!plan.ok) return;
  assert.equal(plan.backdated, false);
  assert.equal(plan.createdAt, now.toISOString());
  assert.equal(plan.backdateReason, undefined);
});

test('a missed sale stays on the day it happened and keeps when it was typed', () => {
  const plan = planHistoricalEntry({
    dayKey: '2026-11-09',
    now,
    clock,
    reason: 'Sale omitted during yesterday\'s operations.',
  });
  assert.equal(plan.ok, true);
  if (!plan.ok) return;
  assert.equal(plan.backdated, true);
  assert.equal(businessDayKey(new Date(plan.createdAt), clock), '2026-11-09');
  assert.equal(plan.enteredAt, now.toISOString());
  assert.equal(plan.backdateReason, 'Sale omitted during yesterday\'s operations.');
});

test('a missed sale needs a reason, and it cannot be in the future or too old', () => {
  assert.equal(planHistoricalEntry({ dayKey: '2026-11-09', now, clock, reason: 'missed' }).ok, false);
  assert.equal(planHistoricalEntry({ dayKey: '2026-11-11', now, clock, reason: 'Sale omitted during the day.' }).ok, false);
  const tooOld = planHistoricalEntry({ dayKey: '2025-01-01', now, clock, reason: 'Sale omitted during the day.' });
  assert.equal(tooOld.ok, false);
  if (tooOld.ok) return;
  assert.match(tooOld.error, new RegExp(String(HISTORICAL_DAYS)));
});
