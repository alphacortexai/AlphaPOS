import assert from 'node:assert/strict';
import test from 'node:test';
import { decodeFirestoreDocument, fetchFirestoreDocument, fetchMembershipsByEmail, firstShopRecord, shopDocumentPath } from './shopRead';

const shopBody = {
  fields: {
    shopName: { stringValue: 'C & E Supplies' },
    branches: {
      arrayValue: {
        values: [{
          mapValue: {
            fields: {
              id: { stringValue: 'main' },
              name: { stringValue: 'Main Branch' },
            },
          },
        }],
      },
    },
    products: {
      arrayValue: {
        values: [{
          mapValue: {
            fields: {
              id: { stringValue: 'soap' },
              name: { stringValue: 'Soap' },
              salePrice: { integerValue: '2000' },
              stock: { integerValue: '4' },
              branchId: { stringValue: 'main' },
            },
          },
        }],
      },
    },
  },
};

test('a REST shop document becomes the shelf the register can read', () => {
  const shop = decodeFirestoreDocument(shopBody);
  assert.equal(shop?.shopName, 'C & E Supplies');
  assert.equal((shop?.branches as { name: string }[])[0].name, 'Main Branch');
  assert.equal((shop?.products as { name: string; salePrice: number }[])[0].salePrice, 2000);
});

test('the shelf still arrives when the live listen channel fails', async () => {
  const dropped = Promise.reject(new Error('QUIC_TOO_MANY_RTOS'));
  const rest = Promise.resolve({
    shopName: 'C & E Supplies',
    products: [{ id: 'soap', name: 'Soap' }],
    branches: [{ id: 'main', name: 'Main Branch' }],
  });
  const shop = await firstShopRecord([dropped, rest]);
  assert.equal((shop?.products as { id: string }[])[0].id, 'soap');
  assert.equal((shop?.branches as { name: string }[])[0].name, 'Main Branch');
});

test('a direct document read uses the shop path and the signed-in token', async () => {
  let seenUrl = '';
  let seenToken = '';
  const fetchImpl: typeof fetch = async (input, init) => {
    seenUrl = String(input);
    seenToken = new Headers(init?.headers).get('Authorization') || '';
    return new Response(JSON.stringify(shopBody), { status: 200 });
  };
  const shop = await fetchFirestoreDocument('alphamatrixpos', shopDocumentPath('owner'), 'token-1', fetchImpl);
  assert.equal(seenUrl, 'https://firestore.googleapis.com/v1/projects/alphamatrixpos/databases/(default)/documents/users/owner/pos/data');
  assert.equal(seenToken, 'Bearer token-1');
  assert.equal((shop?.products as { name: string }[])[0].name, 'Soap');
});

test('memberships for the invited email are read without the listen channel', async () => {
  const fetchImpl: typeof fetch = async () => new Response(JSON.stringify([
    { document: { fields: { ownerUid: { stringValue: 'owner' }, email: { stringValue: 'cashier@shop.test' }, role: { stringValue: 'cashier' }, shopName: { stringValue: 'C & E Supplies' } } } },
    { readTime: '2026-11-07T00:00:00Z' },
  ]), { status: 200 });
  const rows = await fetchMembershipsByEmail('alphamatrixpos', 'cashier@shop.test', 'token-1', fetchImpl);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].role, 'cashier');
  assert.equal(rows[0].ownerUid, 'owner');
});
