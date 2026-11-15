import assert from 'node:assert/strict';
import test from 'node:test';
import { booksQuestion, formatShopBalances, shopBooks } from './grokBooks';

const books = () => shopBooks({
  accounts: [
    { id: 'cash', name: 'CASH', openingBalance: 10000, isDefault: true },
    { id: 'bank', name: 'Bank', openingBalance: 0 },
  ],
  sales: [
    { id: 's1', amount: 4000, paymentMethod: 'cash', accountId: 'cash', cashSessionId: 'drawer', customerName: 'Amina', customerPhone: '0700111222' },
    { id: 's2', amount: 8000, paymentMethod: 'on_account', customerId: 'amina', customerName: 'Amina', customerPhone: '0700111222' },
    { id: 's4', amount: 1000, paymentMethod: 'on_account', customerName: 'Amina' },
    { id: 's3', amount: 5000, voidedAt: '2026-11-15T10:00:00.000Z', paymentMethod: 'on_account', customerName: 'Amina' },
  ],
  expenses: [{ id: 'e1', amount: 1500, accountId: 'cash', cashSessionId: 'drawer' }],
  payments: [{ id: 'p1', amount: 3000, method: 'cash', customerId: 'amina', customerName: 'Amina', customerPhone: '0700111222', cashSessionId: 'drawer' }],
  customers: [{ id: 'amina', name: 'Amina', phone: '0700111222' }],
  suppliers: [{ id: 'kikuubo', name: 'Kikuubo' }],
  supplierBills: [{ id: 'b1', supplierName: 'Kikuubo', amount: 2000, createdAt: '2026-11-15T08:00:00.000Z' }],
  supplierPayments: [{ id: 'sp1', supplierName: 'Kikuubo', amount: 500, method: 'cash', createdAt: '2026-11-15T09:00:00.000Z' }],
  cashSessions: [{ id: 'drawer', status: 'open', openingFloat: 20000 }],
});

test('balances cover accounts, what customers owe, and what is owed to suppliers', () => {
  const shop = books();
  assert.equal(shop.accounts.find((account) => account.name === 'CASH')?.balance, 10000 + 4000 + 3000 - 1500);
  assert.equal(shop.customers.filter((customer) => customer.name === 'Amina').length, 1);
  assert.equal(shop.customers.find((customer) => customer.name === 'Amina')?.owed, 6000);
  assert.equal(shop.suppliers.find((supplier) => supplier.name === 'Kikuubo')?.owed, 1500);
  assert.equal(shop.drawer?.expectedCash, 20000 + 4000 + 3000 - 1500);
  const text = formatShopBalances(shop, 'all');
  assert.match(text, /CASH: UGX 15,500/);
  assert.match(text, /Amina: UGX 6,000/);
  assert.match(text, /Kikuubo: UGX 1,500/);
  assert.match(text, /Expected cash in the drawer is UGX 25,500/);
  assert.equal(text.includes('0700111222'), false);
});

test('a balances question that names a day stays a balances question', () => {
  assert.deepEqual(booksQuestion('cash, mobile money, bank and float balances on 15 Nov 2026'), { kind: 'accounts' });
  assert.equal(booksQuestion('sales today'), null);
  assert.deepEqual(booksQuestion('who owes the shop'), { kind: 'customers' });
});

test('a name picks one balance', () => {
  const text = formatShopBalances(books(), 'customers', 'amina');
  assert.match(text, /Amina: UGX 6,000/);
  assert.equal(text.includes('Kikuubo'), false);
});
