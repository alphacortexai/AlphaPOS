import assert from 'node:assert/strict';
import test from 'node:test';
import { accessDenied, chooseShopId, openedRole, ownShopIsReal, saveWasInterrupted, shopsForSignedInUser } from './shopAccess';

test('a cashier invite does not also make them the owner of an empty shop', () => {
  const shops = shopsForSignedInUser({
    userUid: 'cashier',
    ownShopExists: false,
    memberships: [{ ownerUid: 'owner', shopName: 'C & E Supplies', role: 'cashier' }],
  });
  assert.deepEqual(shops, [{ ownerUid: 'owner', shopName: 'C & E Supplies', role: 'cashier' }]);
  assert.equal(chooseShopId(shops, { remembered: 'cashier' }), 'owner');
});

test('an invited shop opens before a shop this person owns', () => {
  const shops = shopsForSignedInUser({
    userUid: 'cashier',
    ownShopExists: true,
    ownShopName: 'My stall',
    memberships: [{ ownerUid: 'other', shopName: 'Night stall', role: 'cashier' }],
  });
  assert.equal(shops[0].ownerUid, 'other');
  assert.equal(shops[0].role, 'cashier');
  assert.equal(chooseShopId(shops, {}), 'other');
  assert.equal(chooseShopId(shops, { invited: 'other', remembered: 'cashier' }), 'other');
  assert.equal(chooseShopId(shops, { remembered: 'cashier' }), 'cashier');
});

test('opening another shop keeps the invited role', () => {
  assert.equal(openedRole({
    userUid: 'cashier',
    shopOwnerUid: 'owner',
    membershipRole: 'shop_owner',
    staffRole: 'cashier',
  }), 'cashier');
  assert.equal(openedRole({
    userUid: 'cashier',
    shopOwnerUid: 'owner',
    membershipRole: 'cashier',
    staffRole: 'admin',
  }), 'cashier');
  assert.equal(openedRole({
    userUid: 'owner',
    shopOwnerUid: 'owner',
    staffRole: 'cashier',
  }), 'shop_owner');
});

test('a blocked shop read is not treated as an empty shop', () => {
  assert.equal(accessDenied({ code: 'permission-denied' }), true);
  assert.equal(accessDenied({ code: 'firestore/permission-denied' }), true);
  assert.equal(accessDenied(new Error('Missing or insufficient permissions.')), true);
  assert.equal(accessDenied(new Error('offline')), false);
});

test('a shop saved by someone else is a version clash, not a broken save', () => {
  assert.equal(saveWasInterrupted(new Error('the stored version (1794300766204334) does not match the required base version (1794300764606048)')), true);
  assert.equal(saveWasInterrupted(new Error('Missing or insufficient permissions.')), false);
  assert.equal(saveWasInterrupted(new Error('offline')), false);
});

test('a copied shop name does not make an invited person the owner', () => {
  assert.equal(ownShopIsReal(undefined), false);
  assert.equal(ownShopIsReal({ shopName: 'My Shop', products: [], sales: [] }), false);
  assert.equal(ownShopIsReal({ shopName: 'C & E Supplies', branches: [{ id: 'main', name: 'Main Branch' }] }), false);
  assert.equal(ownShopIsReal({ shopName: 'C & E Supplies', products: [{ id: 'soap' }] }), true);
  const shops = shopsForSignedInUser({
    userUid: 'cashier',
    ownShopExists: ownShopIsReal({ shopName: 'C & E Supplies', products: [] }),
    ownShopName: 'C & E Supplies',
    memberships: [{ ownerUid: 'owner', shopName: 'C & E Supplies', role: 'manager' }],
  });
  assert.deepEqual(shops.map((shop) => ({ ownerUid: shop.ownerUid, role: shop.role })), [{ ownerUid: 'owner', role: 'manager' }]);
  assert.equal(chooseShopId(shops, { remembered: 'cashier', active: 'cashier' }), 'owner');
});
