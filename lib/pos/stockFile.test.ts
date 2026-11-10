import assert from 'node:assert/strict';
import test from 'node:test';
import { applyStockFile, parseStockFile, stockFileCsv, type StockFileRow } from './stockFile';

const soap: StockFileRow = {
  id: 'soap',
  name: 'Washing soap',
  sku: 'SOAP-0001',
  barcode: '123',
  branch: 'Main Branch',
  category: 'Cleaning',
  variant: 'Bar',
  unit: 'piece',
  stock: 12,
  cost: 800,
  salePrice: 1500,
  wholesalePrice: 1200,
  reorderPoint: 4,
  expiry: '',
};

test('a stock file round-trips the product name, quantity, and prices', () => {
  const parsed = parseStockFile(stockFileCsv([soap, { ...soap, id: 'rice', name: 'Rice, 5kg', sku: 'RICE-0001', stock: 3.5, unit: 'kg' }]));
  assert.deepEqual(parsed.errors, []);
  assert.equal(parsed.rows[0].name, 'Washing soap');
  assert.equal(parsed.rows[0].stock, 12);
  assert.equal(parsed.rows[0].salePrice, 1500);
  assert.equal(parsed.rows[0].cost, 800);
  assert.equal(parsed.rows[1].name, 'Rice, 5kg');
  assert.equal(parsed.rows[1].stock, 3.5);
  assert.equal(parsed.rows[1].unit, 'kg');
});

test('a sheet with only name and quantity updates stock and keeps the price', () => {
  const parsed = parseStockFile('Product,Qty\nWashing soap,9\n');
  assert.deepEqual(parsed.errors, []);
  assert.equal(parsed.rows[0].salePrice, undefined);
  const applied = applyStockFile(
    [{ id: 'soap', name: 'Washing soap', branchId: 'main', stock: 12, purchasePrice: 800, salePrice: 1500, sku: 'SOAP-0001' }],
    [{ id: 'main', name: 'Main Branch', location: 'Counter' }],
    parsed.rows,
    () => 'new',
  );
  assert.equal(applied.updated, 1);
  assert.equal(applied.added, 0);
  assert.equal(applied.products[0].stock, 9);
  assert.equal(applied.products[0].salePrice, 1500);
  assert.equal(applied.products[0].sku, 'SOAP-0001');
  assert.deepEqual(applied.stockWrites, [{ id: 'soap', qty: 9 }]);
});

test('a product the shelf does not have is added, and a missing product stays', () => {
  const applied = applyStockFile(
    [{ id: 'soap', name: 'Washing soap', branchId: 'main', stock: 4, purchasePrice: 800, salePrice: 1500 }],
    [{ id: 'main', name: 'Main Branch', location: 'Counter' }],
    [{ id: '', name: 'Rice', sku: 'RICE-0001', barcode: '', branch: 'Store', category: '', variant: '', unit: 'kg', stock: 2, cost: 1000, salePrice: 1800, expiry: '' }],
    () => 'rice-id',
  );
  assert.equal(applied.added, 1);
  assert.equal(applied.products.length, 2);
  assert.equal(applied.products[0].id, 'soap');
  assert.equal(applied.products[1].name, 'Rice');
  assert.equal(applied.products[1].branchId, 'rice-id');
  assert.equal(applied.branches[1].name, 'Store');
});

test('a row without a quantity is reported and the other rows are kept', () => {
  const parsed = parseStockFile('name,stock,sale price\nSoap,4,1500\nRice,,1800\nOil,-1,900\n');
  assert.equal(parsed.rows.length, 1);
  assert.equal(parsed.rows[0].name, 'Soap');
  assert.equal(parsed.errors.length, 2);
});

test('matching by sku updates that product even when the name changed', () => {
  const applied = applyStockFile(
    [{ id: 'soap', name: 'Old soap', branchId: 'main', stock: 1, purchasePrice: 500, salePrice: 900, sku: 'SOAP-0001' }],
    [{ id: 'main', name: 'Main Branch', location: 'Counter' }],
    [{ ...soap, id: '', name: 'Washing soap', stock: 20 }],
    () => 'unused',
  );
  assert.equal(applied.updated, 1);
  assert.equal(applied.added, 0);
  assert.equal(applied.products[0].id, 'soap');
  assert.equal(applied.products[0].name, 'Washing soap');
  assert.equal(applied.products[0].stock, 20);
});
