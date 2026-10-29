import assert from 'node:assert/strict';
import test from 'node:test';
import { stockWorth } from './books';

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

test('treats a missing price as zero', () => {
  const worth = stockWorth([
    { stock: 3, purchasePrice: Number.NaN, salePrice: 200 },
  ]);
  assert.deepEqual(worth, { units: 3, atCost: 0, atSalePrice: 600 });
});
