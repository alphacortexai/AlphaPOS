import assert from 'node:assert/strict';
import test from 'node:test';
import { embeddedWithout, ledgerCollectionPath, ledgerDocumentPath } from './ledger';

test('a receipt and a stock count are documents under the shop', () => {
  const stock = ledgerDocumentPath('owner', 'stock', 'product');
  const sales = ledgerCollectionPath('owner', 'sales');
  assert.equal(stock.length % 2, 0);
  assert.equal(sales.length % 2, 1);
  assert.deepEqual(stock, ['users', 'owner', 'pos', 'data', 'stock', 'product']);
});

test('a removed expense leaves the copy that still sits on the shop document', () => {
  const next = embeddedWithout([{ id: 'rent', amount: 5000 }, { id: 'wages', amount: 1000 }], 'rent');
  assert.deepEqual(next, [{ id: 'wages', amount: 1000 }]);
  assert.equal(embeddedWithout([{ id: 'wages', amount: 1000 }], 'rent'), null);
  assert.equal(embeddedWithout(undefined, 'rent'), null);
  assert.deepEqual(embeddedWithout([{ id: 'rent' }], 'rent'), []);
});
