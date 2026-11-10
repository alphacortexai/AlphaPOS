import assert from 'node:assert/strict';
import test from 'node:test';
import { postedExpense, stockWorth } from './books';

test('adds cost and selling price for units on hand', () => {
  const worth = stockWorth([
    { stock: 4, purchasePrice: 500, salePrice: 800 },
    { stock: 2, purchasePrice: 1000, salePrice: 1500 },
  ]);
  assert.deepEqual(worth, { units: 6, atCost: 4000, atSalePrice: 6200 });
});

test('ignores empty or invalid stock', () => {
  const worth = stockWorth([
    { stock: 0, purchasePrice: 500, salePrice: 800 },
    { stock: -3, purchasePrice: 500, salePrice: 800 },
    { stock: Number.NaN, purchasePrice: 500, salePrice: 800 },
  ]);
  assert.deepEqual(worth, { units: 0, atCost: 0, atSalePrice: 0 });
});

test('editing an expense keeps the day it was recorded', () => {
  const saved = postedExpense(
    { id: 'rent', title: 'Rent', amount: 1000, createdAt: '2026-11-01T08:00:00.000Z', createdByUid: 'owner' },
    { id: 'rent', title: 'Shop rent', amount: 1500, createdAt: '2026-11-10T08:00:00.000Z', updatedAt: '2026-11-10T08:00:00.000Z' },
  );
  assert.equal(saved.createdAt, '2026-11-01T08:00:00.000Z');
  assert.equal(saved.createdByUid, 'owner');
  assert.equal(saved.title, 'Shop rent');
  assert.equal(saved.amount, 1500);
  assert.equal(saved.updatedAt, '2026-11-10T08:00:00.000Z');
});

test('a new expense keeps the time it was entered', () => {
  const saved = postedExpense(undefined, { id: 'tea', title: 'Tea', amount: 2000, createdAt: '2026-11-10T08:00:00.000Z' });
  assert.equal(saved.createdAt, '2026-11-10T08:00:00.000Z');
  assert.equal(saved.title, 'Tea');
});

test('treats a missing price as zero', () => {
  const worth = stockWorth([
    { stock: 3, purchasePrice: Number.NaN, salePrice: 200 },
  ]);
  assert.deepEqual(worth, { units: 3, atCost: 0, atSalePrice: 600 });
});
