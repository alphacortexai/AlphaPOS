import assert from 'node:assert/strict';
import test from 'node:test';
import { billForReceipt, creditAllows, dayClose, ledgerReadsForRole, needsReorder, overlayStock, preferShopCatalog, productForReturn, rankProducts, shopCatalog, shopDocumentBody, supplierOwed, tenderTotals, tendersNeedReference } from './shopMath';

test('a cashier loads the shelf and the receipts, not the books', () => {
  const cashier = ledgerReadsForRole('cashier');
  assert.equal(cashier.sales, true);
  assert.equal(cashier.stock, true);
  assert.equal(cashier.expenses, false);
  assert.equal(cashier.supplierBills, false);
  assert.equal(cashier.migrate, false);
  assert.equal(ledgerReadsForRole('shop_owner').expenses, true);
  assert.equal(ledgerReadsForRole('stock').supplierBills, true);
  assert.equal(ledgerReadsForRole('stock').sales, false);
});

test('an empty shelf is on the reorder list', () => {
  assert.equal(needsReorder({ stock: 0, reorderPoint: 10 }), true);
  assert.equal(needsReorder({ stock: 4, reorderPoint: 10 }), true);
  assert.equal(needsReorder({ stock: 10, reorderPoint: 10 }), false);
});

test('live stock from the stock record wins over the shop copy', () => {
  assert.equal(overlayStock([{ id: 'soap', stock: 4 }], { soap: 2 })[0].stock, 2);
  assert.equal(overlayStock([{ id: 'soap', stock: 4 }], {})[0].stock, 4);
});

test('the register shelf comes from the shop document even when receipts have not loaded', () => {
  const catalog = shopCatalog({
    products: [{ id: 'soap', name: 'Soap' }, { id: 'rice', name: 'Rice' }],
    services: [{ id: 'print' }],
    branches: [{ id: 'main' }],
  });
  assert.equal(catalog.products.length, 2);
  assert.equal(catalog.services.length, 1);
  assert.equal(shopCatalog({ shopName: 'Corner' }).products.length, 0);
  assert.equal(overlayStock(catalog.products as { id: string; stock: number }[], {}).length, 2);
  assert.equal(shopCatalog({ products: { soap: { id: 'soap', name: 'Soap' } } }).products[0].id, 'soap');
  const invited = preferShopCatalog({ shopName: 'C & E', products: [] }, { shopName: 'C & E', products: [{ id: 'soap' }], branches: [{ id: 'main' }] });
  assert.equal(shopCatalog(invited).products[0].id, 'soap');
  assert.equal(shopCatalog(invited).branches[0].id, 'main');
  const withBranches = preferShopCatalog(
    { products: [{ id: 'soap' }], branches: [] },
    { products: [{ id: 'soap' }], branches: [{ id: 'main', name: 'Main' }] },
  );
  assert.equal(shopCatalog(withBranches).branches[0].id, 'main');
  assert.equal(shopCatalog(withBranches).products[0].id, 'soap');
});

test('a credit limit stops the sale that would pass it', () => {
  assert.equal(creditAllows(8000, 10000, 3000), false);
  assert.equal(creditAllows(8000, 10000, 2000), true);
  assert.equal(creditAllows(8000, undefined, 50000), true);
});

test('a return finds the product by id when the name changed', () => {
  const products = [{ id: 'soap', name: 'Washing soap', branchId: 'b' }];
  assert.equal(productForReturn(products, { productId: 'soap', branchId: 'b', itemName: 'Soap', type: 'product' })?.name, 'Washing soap');
  assert.equal(productForReturn(products, { branchId: 'b', itemName: 'Soap', type: 'product' }), undefined);
});

test('mobile money needs the transaction code', () => {
  assert.equal(tendersNeedReference([{ method: 'mobile_money' }]), true);
  assert.equal(tendersNeedReference([{ method: 'mobile_money', reference: 'MP123' }]), false);
  assert.equal(tendersNeedReference([{ method: 'cash' }]), false);
});

test('the shop document does not keep the receipt list', () => {
  const body = shopDocumentBody({ shopName: 'Corner', sales: [{ id: '1' }], expenses: [], customers: [] });
  assert.equal('sales' in body, false);
  assert.equal(body.ledgerSplit, true);
  assert.equal(body.shopName, 'Corner');
});

test('close of day splits tenders and lists unconfirmed mobile money', () => {
  const close = dayClose([
    { id: 'a', itemName: 'Soap', type: 'product', qty: 1, amount: 5000, createdAt: '2026-11-06T09:00:00.000Z', paymentMethod: 'cash', saleKind: 'sale' },
    { id: 'b', itemName: 'Rice', type: 'product', qty: 1, amount: 20000, createdAt: '2026-11-06T10:00:00.000Z', paymentMethod: 'mobile_money', paymentReference: 'MP9', moneyStatus: 'unconfirmed', receiptNumber: 'R1', saleKind: 'sale' },
    { id: 'c', itemName: 'Rice', type: 'product', qty: 1, amount: 9000, createdAt: '2026-11-06T11:00:00.000Z', voidedAt: '2026-11-06T12:00:00.000Z', saleKind: 'sale' },
  ], [{ amount: 3000, createdAt: '2026-11-06T08:00:00.000Z' }], '2026-11-06', (iso) => iso.slice(0, 10));
  assert.equal(close.salesTotal, 25000);
  assert.equal(close.expenseTotal, 3000);
  assert.equal(close.unconfirmed.length, 1);
  assert.equal(close.tenders.find((row) => row.method === 'mobile_money')?.amount, 20000);
  const split = tenderTotals([
    { id: 'a', itemName: 'Soap', type: 'product', qty: 1, amount: 5000, createdAt: '', paymentMethod: 'cash', saleKind: 'sale' },
    { id: 'b', itemName: 'Rice', type: 'product', qty: 1, amount: 20000, createdAt: '', paymentMethod: 'mobile_money', saleKind: 'sale' },
    { id: 'c', itemName: 'Rice', type: 'product', qty: 1, amount: 9000, createdAt: '', voidedAt: 'now', saleKind: 'sale' },
  ]);
  assert.equal(split.find((row) => row.method === 'cash')?.amount, 5000);
  assert.equal(split.find((row) => row.method === 'mobile_money')?.amount, 20000);
  assert.equal(split.length, 2);
});

test('product ranking skips voids and a supplier bill is what was received', () => {
  const ranked = rankProducts([
    { id: '1', itemName: 'Soap', type: 'product', qty: 2, amount: 1000, createdAt: '', productId: 'soap', saleKind: 'sale' },
    { id: '2', itemName: 'Soap', type: 'product', qty: 9, amount: 9000, createdAt: '', productId: 'soap', saleKind: 'sale', voidedAt: 'now' },
  ]);
  assert.equal(ranked[0].qty, 2);
  const bill = billForReceipt('Kikuubo', [{ quantity: 4, unitCost: 500 }], 'INV-1', '2026-11-06T00:00:00.000Z');
  assert.equal(bill?.amount, 2000);
  assert.equal(supplierOwed('Kikuubo', bill ? [bill] : [], [{ id: 'p', supplierName: 'Kikuubo', amount: 500, method: 'cash', createdAt: '' }]), 1500);
});
