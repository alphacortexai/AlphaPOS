import { collection, deleteField, doc, getDocs, runTransaction, setDoc, writeBatch, type DocumentSnapshot, type Firestore } from 'firebase/firestore';

export type StockDelta = { productId: string; delta: number };

const chunk = <T,>(items: T[], size: number) => {
  const groups: T[][] = [];
  for (let index = 0; index < items.length; index += size) groups.push(items.slice(index, index + size));
  return groups;
};

const strip = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(strip);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .map(([key, entry]) => [key, strip(entry)]),
    );
  }
  return value;
};

/** users/{owner}/pos/data/{name}/{id} — six segments, so Firestore accepts it as a document. */
export const ledgerDocumentPath = (ownerUid: string, name: string, id: string) =>
  ['users', ownerUid, 'pos', 'data', name, id] as const;

export const ledgerCollectionPath = (ownerUid: string, name: string) =>
  ['users', ownerUid, 'pos', 'data', name] as const;

export const readNamedRecords = async <T,>(db: Firestore, ownerUid: string, name: string): Promise<T[]> => {
  const snap = await getDocs(collection(db, ...ledgerCollectionPath(ownerUid, name)));
  return snap.docs.map((entry) => entry.data() as T);
};

export const readStockMap = async (db: Firestore, ownerUid: string) => {
  const snap = await getDocs(collection(db, ...ledgerCollectionPath(ownerUid, 'stock')));
  const stock: Record<string, number> = {};
  snap.forEach((entry) => {
    const qty = Number(entry.data().qty);
    if (Number.isFinite(qty)) stock[entry.id] = qty;
  });
  return stock;
};

const roundedQty = (value: number) => Math.round(value * 1000) / 1000;

/** Apply stock changes and write the sale lines in one step, using the latest quantity on the shelf. */
export const commitStockAndRecords = async (
  db: Firestore,
  ownerUid: string,
  collectionName: string,
  records: { id: string }[],
  deltas: StockDelta[],
  fallback: Record<string, number>,
) => {
  const merged = new Map<string, number>();
  deltas.forEach((delta) => merged.set(delta.productId, (merged.get(delta.productId) || 0) + delta.delta));
  const changes = [...merged.entries()].map(([productId, delta]) => ({ productId, delta }));
  return runTransaction(db, async (transaction) => {
    const refs = changes.map((change) => doc(db, ...ledgerDocumentPath(ownerUid, 'stock', change.productId)));
    const snaps: DocumentSnapshot[] = [];
    for (const ref of refs) snaps.push(await transaction.get(ref));
    const next: Record<string, number> = {};
    changes.forEach((change, index) => {
      const snap = snaps[index];
      const current = snap.exists() ? Number(snap.data().qty) : (fallback[change.productId] ?? 0);
      const qty = roundedQty((Number.isFinite(current) ? current : 0) + change.delta);
      if (qty < -0.0005) throw new Error('Not enough stock on the shelf.');
      transaction.set(refs[index], { qty, updatedAt: new Date().toISOString() });
      next[change.productId] = qty;
    });
    records.forEach((record) => {
      transaction.set(doc(db, ...ledgerDocumentPath(ownerUid, collectionName, record.id)), strip(record));
    });
    return next;
  });
};

export const writeRecords = async (db: Firestore, ownerUid: string, name: string, records: { id: string }[]) => {
  for (const group of chunk(records, 400)) {
    const batch = writeBatch(db);
    group.forEach((record) => batch.set(doc(db, ...ledgerDocumentPath(ownerUid, name, record.id)), strip(record)));
    await batch.commit();
  }
};

export const setStockQty = async (db: Firestore, ownerUid: string, productId: string, qty: number) => {
  await setDoc(doc(db, ...ledgerDocumentPath(ownerUid, 'stock', productId)), { qty: roundedQty(qty), updatedAt: new Date().toISOString() });
};

export const migrateShopLedger = async (
  db: Firestore,
  ownerUid: string,
  embedded: {
    sales: { id: string }[];
    expenses: { id: string }[];
    payments: { id: string }[];
    products: { id: string; stock: number }[];
  },
) => {
  const [sales, expenses, payments, stock] = await Promise.all([
    readNamedRecords(db, ownerUid, 'sales'),
    readNamedRecords<{ id: string }>(db, ownerUid, 'expenses'),
    readNamedRecords<{ id: string }>(db, ownerUid, 'payments'),
    readStockMap(db, ownerUid),
  ]);
  if (sales.length === 0 && embedded.sales.length > 0) await writeRecords(db, ownerUid, 'sales', embedded.sales);
  if (expenses.length === 0 && embedded.expenses.length > 0) await writeRecords(db, ownerUid, 'expenses', embedded.expenses);
  if (payments.length === 0 && embedded.payments.length > 0) await writeRecords(db, ownerUid, 'payments', embedded.payments);
  if (Object.keys(stock).length === 0 && embedded.products.length > 0) {
    await writeRecords(db, ownerUid, 'stock', embedded.products.map((product) => ({ id: product.id, qty: product.stock })));
  }
  await runTransaction(db, async (transaction) => {
    const ref = doc(db, 'users', ownerUid, 'pos', 'data');
    transaction.set(ref, {
      ledgerSplit: true,
      sales: deleteField(),
      expenses: deleteField(),
      customerPayments: deleteField(),
    }, { merge: true });
  });
};
