// Runs against the Firestore emulator at 127.0.0.1:8080. Start it with `npx firebase emulators:start --only firestore`.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, deleteField, doc, getDoc, getDocs, runTransaction, setDoc, updateDoc } from 'firebase/firestore';

const ownerUid = 'oJBb4d1vszQJr7vqvN192DFD27h2';
const shop = {
  shopName: 'C & E',
  staffEmails: ['cashier@shop.test', 'stock@shop.test', 'limited@shop.test'],
  users: [
    { email: 'Cashier@Shop.test', role: 'cashier' },
    { email: 'stock@shop.test', role: 'stock' },
    { email: 'limited@shop.test', role: 'cashier', permissions: ['products'] },
  ],
  customers: [],
  heldTickets: [],
  cashSessions: [],
  ledgerSplit: true,
  revision: 523,
  sellerEmails: ['cashier@shop.test'],
  editorEmails: ['stock@shop.test'],
};

let testEnv;

test.before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'demo-alphapos-rules',
    firestore: {
      rules: fs.readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8'),
      host: '127.0.0.1',
      port: 8080,
    },
  });
});

test.after(async () => {
  await testEnv.cleanup();
});

const dbFor = (uid, email) => testEnv.authenticatedContext(uid, { email }).firestore();

const expectDenied = async (work) => {
  let message = '';
  try {
    await work();
  } catch (error) {
    message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  }
  assert.match(message, /permission|PERMISSION_DENIED|false for|evaluation error|maximum of 1000/i);
};

test('the owner can open a shop document that is not created yet', async () => {
  const db = dbFor('ozYSmlVtXmSvt9Fgzj0dBW9R5AJ2', 'owner@shop.test');
  await assertSucceeds(getDoc(doc(db, 'users', 'ozYSmlVtXmSvt9Fgzj0dBW9R5AJ2', 'pos', 'data')));
});

test('a cashier saved on the shop can sell, and a stock manager cannot', async () => {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const admin = context.firestore();
    await setDoc(doc(admin, 'users', ownerUid, 'pos', 'data'), shop);
    await setDoc(doc(admin, 'users', ownerUid, 'pos', 'data', 'stock', '38b47dcf-54cf-4fd7-ba1d-1780e4a82c78'), { qty: 4 });
  });

  const cashier = dbFor('cashier-uid', 'cashier@shop.test');
  const stock = dbFor('stock-uid', 'stock@shop.test');
  const limited = dbFor('limited-uid', 'limited@shop.test');
  const stranger = dbFor('stranger-uid', 'stranger@shop.test');
  const stockRef = (db) => doc(db, 'users', ownerUid, 'pos', 'data', 'stock', '38b47dcf-54cf-4fd7-ba1d-1780e4a82c78');
  const shopRef = (db) => doc(db, 'users', ownerUid, 'pos', 'data');

  await assertSucceeds(getDoc(shopRef(cashier)));
  await assertSucceeds(getDoc(stockRef(cashier)));
  await assertSucceeds(getDocs(collection(cashier, 'users', ownerUid, 'pos', 'data', 'stock')));
  await assertSucceeds(setDoc(doc(cashier, 'users', ownerUid, 'pos', 'data', 'sales', 'sale-1'), {
    amount: 2000,
    qty: 1,
    cashierEmail: 'cashier@shop.test',
  }));
  await assertSucceeds(setDoc(stockRef(cashier), { qty: 3, updatedAt: '2026-11-08T04:15:07.246Z' }));
  await assertSucceeds(updateDoc(shopRef(cashier), {
    customers: [{ id: '188e8d00-49a6-4677-a4b3-e97d3bae4831', name: 'Edrine' }],
    heldTickets: [],
    cashSessions: shop.cashSessions,
    ledgerSplit: true,
    revision: 524,
  }));

  await assertSucceeds(getDoc(stockRef(stock)));
  await assertSucceeds(setDoc(stockRef(stock), { qty: 8, updatedAt: '2026-11-08T04:15:07.246Z' }));
  await expectDenied(() => setDoc(doc(stock, 'users', ownerUid, 'pos', 'data', 'sales', 'sale-2'), { amount: 1000, qty: 1 }));
  await expectDenied(() => updateDoc(shopRef(stock), { customers: [], revision: 525 }));
  await expectDenied(() => updateDoc(shopRef(cashier), { products: [] }));

  await assertSucceeds(getDoc(stockRef(limited)));
  await expectDenied(() => setDoc(doc(limited, 'users', ownerUid, 'pos', 'data', 'sales', 'sale-3'), { amount: 1000, qty: 1 }));

  await expectDenied(() => getDoc(shopRef(stranger)));
  await expectDenied(() => getDoc(stockRef(stranger)));
  await expectDenied(() => getDoc(doc(stranger, 'users', 'ozYSmlVtXmSvt9Fgzj0dBW9R5AJ2', 'pos', 'data')));
});

test('an email saved on the shop can sell before a person row exists', async () => {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'users', ownerUid, 'pos', 'data'), {
      staffEmails: ['cashier@shop.test'],
      users: [],
    });
  });
  const cashier = dbFor('cashier-uid', 'cashier@shop.test');
  await assertSucceeds(getDoc(doc(cashier, 'users', ownerUid, 'pos', 'data', 'stock', 'missing-sku')));
  await assertSucceeds(setDoc(doc(cashier, 'users', ownerUid, 'pos', 'data', 'sales', 'sale-4'), { amount: 500, qty: 1 }));
});

test('a cashier listed in sellerEmails can sell past the twelfth saved person', async () => {
  await testEnv.clearFirestore();
  const users = Array.from({ length: 12 }, (_, index) => ({ email: `other${index}@shop.test`, role: 'stock' }));
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'users', ownerUid, 'pos', 'data'), {
      users,
      staffEmails: ['late@shop.test'],
      sellerEmails: ['late@shop.test'],
      editorEmails: [],
    });
  });
  const cashier = dbFor('late-uid', 'late@shop.test');
  await assertSucceeds(setDoc(doc(cashier, 'users', ownerUid, 'pos', 'data', 'sales', 'sale-5'), { amount: 700, qty: 1 }));
  await assertSucceeds(getDoc(doc(cashier, 'users', ownerUid, 'pos', 'data', 'stock', 'sku')));
});

test('the second seller on the list can sell', async () => {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'users', ownerUid, 'pos', 'data'), {
      staffEmails: ['first@shop.test', 'second@shop.test'],
      sellerEmails: ['first@shop.test', 'second@shop.test'],
      editorEmails: ['counter@shop.test'],
    });
  });
  const second = dbFor('second-uid', 'second@shop.test');
  const counter = dbFor('counter-uid', 'counter@shop.test');
  await assertSucceeds(setDoc(doc(second, 'users', ownerUid, 'pos', 'data', 'sales', 'sale-6'), { amount: 100, qty: 1 }));
  await expectDenied(() => setDoc(doc(counter, 'users', ownerUid, 'pos', 'data', 'sales', 'sale-7'), { amount: 100, qty: 1 }));
  await assertSucceeds(setDoc(doc(counter, 'users', ownerUid, 'pos', 'data', 'stock', 'sku'), { qty: 2, updatedAt: 'now' }));
});

test('a third seller can still sell', async () => {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'users', ownerUid, 'pos', 'data'), {
      staffEmails: ['a@shop.test', 'b@shop.test', 'c@shop.test', 'stock@shop.test'],
      sellerEmails: ['a@shop.test', 'b@shop.test', 'c@shop.test'],
      editorEmails: ['stock@shop.test'],
    });
  });
  const third = dbFor('third-uid', 'c@shop.test');
  const stock = dbFor('stock-uid', 'stock@shop.test');
  await assertSucceeds(setDoc(doc(third, 'users', ownerUid, 'pos', 'data', 'sales', 'sale-8'), { amount: 100, qty: 1 }));
  await expectDenied(() => setDoc(doc(stock, 'users', ownerUid, 'pos', 'data', 'sales', 'sale-9'), { amount: 100, qty: 1 }));
});

test('a cashier can save customers inside the same transaction that reads the shop', async () => {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'users', ownerUid, 'pos', 'data'), shop);
  });
  const cashier = dbFor('cashier-uid', 'cashier@shop.test');
  const shopRef = doc(cashier, 'users', ownerUid, 'pos', 'data');
  await assertSucceeds(runTransaction(cashier, async (transaction) => {
    const snap = await transaction.get(shopRef);
    const revision = Number(snap.data().revision) || 0;
    transaction.set(shopRef, {
      ledgerSplit: true,
      revision: revision + 1,
      customers: [{ id: '188e8d00-49a6-4677-a4b3-e97d3bae4831', name: 'Edrine', phone: '0782830524', createdAt: '2026-10-31T17:21:07.249Z' }],
      heldTickets: [],
      cashSessions: [],
    }, { merge: true });
  }));
});

test('a cashier sale transaction still commits', async () => {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'users', ownerUid, 'pos', 'data'), shop);
    await setDoc(doc(context.firestore(), 'users', ownerUid, 'pos', 'data', 'stock', 'soap'), { qty: 4 });
  });
  const cashier = dbFor('cashier-uid', 'cashier@shop.test');
  await assertSucceeds(runTransaction(cashier, async (transaction) => {
    const stockRef = doc(cashier, 'users', ownerUid, 'pos', 'data', 'stock', 'soap');
    const snap = await transaction.get(stockRef);
    const qty = snap.exists() ? Number(snap.data().qty) : 0;
    transaction.set(stockRef, { qty: qty - 1, updatedAt: '2026-11-08T06:37:51.529Z' });
    transaction.set(doc(cashier, 'users', ownerUid, 'pos', 'data', 'sales', 'sale-tx'), {
      amount: 2000,
      qty: 1,
      cashierEmail: 'cashier@shop.test',
    });
  }));
});

test('a manager can record an expense and a cashier cannot', async () => {
  await testEnv.clearFirestore();
  const managerPermissions = ['sell', 'salesHistory', 'customers', 'products', 'editCatalog', 'seeCost', 'expenses', 'reports', 'accounts', 'activity', 'allBranches'];
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const admin = context.firestore();
    await setDoc(doc(admin, 'users', ownerUid, 'pos', 'data'), {
      ...shop,
      staffEmails: ['cashier@shop.test', 'manager@shop.test', 'legacy@shop.test'],
      sellerEmails: ['cashier@shop.test', 'manager@shop.test', 'legacy@shop.test'],
      editorEmails: ['manager@shop.test', 'legacy@shop.test'],
      expenses: [{ id: 'old-rent', title: 'Old rent', amount: 1000 }],
    });
    await setDoc(doc(admin, 'shopMemberships', `${ownerUid}_manager@shop.test`), {
      ownerUid,
      email: 'manager@shop.test',
      role: 'manager',
      permissions: managerPermissions,
    });
    await setDoc(doc(admin, 'shopMemberships', `${ownerUid}_cashier@shop.test`), {
      ownerUid,
      email: 'cashier@shop.test',
      role: 'cashier',
      permissions: ['sell', 'salesHistory', 'customers', 'products', 'allBranches'],
    });
    await setDoc(doc(admin, 'shopMemberships', `${ownerUid}_legacy@shop.test`), {
      ownerUid,
      email: 'legacy@shop.test',
      role: 'manager',
    });
  });

  const manager = dbFor('manager-uid', 'manager@shop.test');
  const cashier = dbFor('cashier-uid', 'cashier@shop.test');
  const legacy = dbFor('legacy-uid', 'legacy@shop.test');
  const owner = dbFor(ownerUid, 'owner@shop.test');
  const expense = {
    id: 'rent',
    title: 'Rent',
    amount: 5000,
    branchId: 'main',
    accountId: 'cash',
    createdAt: '2026-11-10T08:00:00.000Z',
  };
  await assertSucceeds(setDoc(doc(manager, 'users', ownerUid, 'pos', 'data', 'expenses', 'rent'), expense));
  await assertSucceeds(getDoc(doc(manager, 'users', ownerUid, 'pos', 'data', 'expenses', 'rent')));
  await assertSucceeds(setDoc(doc(owner, 'users', ownerUid, 'pos', 'data', 'expenses', 'wages'), { ...expense, id: 'wages', title: 'Wages' }));
  await assertSucceeds(getDoc(doc(owner, 'users', ownerUid, 'pos', 'data', 'expenses', 'wages')));
  await assertSucceeds(setDoc(doc(legacy, 'users', ownerUid, 'pos', 'data', 'expenses', 'power'), { ...expense, id: 'power', title: 'Power' }));
  await assertSucceeds(setDoc(doc(manager, 'users', ownerUid, 'pos', 'data', 'expenses', 'airtime'), { ...expense, id: 'airtime', title: 'Airtime' }));
  const listed = await assertSucceeds(getDocs(collection(manager, 'users', ownerUid, 'pos', 'data', 'expenses')));
  assert.equal(listed.size, 4);
  await assertSucceeds(setDoc(doc(manager, 'users', ownerUid, 'pos', 'data'), {
    removedExpenseIds: ['old-rent'],
    expenses: deleteField(),
    updatedAt: '2026-11-10T08:05:00.000Z',
  }, { merge: true }));
  await expectDenied(() => setDoc(doc(cashier, 'users', ownerUid, 'pos', 'data', 'expenses', 'tea'), { ...expense, id: 'tea', title: 'Tea' }));
  await expectDenied(() => getDoc(doc(cashier, 'users', ownerUid, 'pos', 'data', 'expenses', 'rent')));
  await expectDenied(() => setDoc(doc(cashier, 'users', ownerUid, 'pos', 'data'), {
    removedExpenseIds: ['rent'],
  }, { merge: true }));

  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'users', ownerUid, 'pos', 'data'), shop);
    await setDoc(doc(context.firestore(), 'users', ownerUid, 'pos', 'data', 'stock', 'soap'), { qty: 4 });
  });
});

test('the shop owner still reads and writes the shop', async () => {
  const owner = dbFor(ownerUid, 'alphacortexai@gmail.com');
  await assertSucceeds(getDoc(doc(owner, 'users', ownerUid, 'pos', 'data')));
  await assertSucceeds(setDoc(doc(owner, 'users', ownerUid, 'pos', 'data', 'stock', 'sku'), { qty: 1, updatedAt: 'now' }));
  await assertSucceeds(updateDoc(doc(owner, 'users', ownerUid, 'pos', 'data'), { shopName: 'C & E Supplies', users: shop.users }));
});
