import assert from 'node:assert/strict';
import test from 'node:test';
import { ledgerCollectionPath, ledgerDocumentPath } from './ledger';

test('a receipt and a stock count are documents under the shop', () => {
  const stock = ledgerDocumentPath('owner', 'stock', 'product');
  const sales = ledgerCollectionPath('owner', 'sales');
  assert.equal(stock.length % 2, 0);
  assert.equal(sales.length % 2, 1);
  assert.deepEqual(stock, ['users', 'owner', 'pos', 'data', 'stock', 'product']);
});
