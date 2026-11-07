import assert from 'node:assert/strict';
import test from 'node:test';
import { chooseShopId, openedRole, ownShopIsReal, shopsForSignedInUser } from './shopAccess';

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
    userUid: 'owner',
    ownShopExists: true,
    ownShopName: 'C & E Supplies',
    memberships: [{ ownerUid: 'other', shopName: 'Night stall', role: 'cashier' }],
  });
  assert.equal(shops[0].role, 'shop_owner');
  assert.equal(chooseShopId(shops, { invited: 'other', remembered: 'owner' }), 'other');
});

test('opening another shop keeps the invited role', () => {
  assert.equal(openedRole({
    userUid: 'cashier',
    shopOwnerUid: 'owner',
    membershipRole: 'shop_owner',
    staffRole: 'cashier',
  }), 'cashier');
  assert.equal(openedRole({
    userUid: 'owner',
    shopOwnerUid: 'owner',
    staffRole: 'cashier',
  }), 'shop_owner');
});

test('a blank browser shop is not treated as a real business', () => {
  assert.equal(ownShopIsReal(undefined), false);
  assert.equal(ownShopIsReal({ shopName: 'My Shop', products: [], sales: [] }), false);
  assert.equal(ownShopIsReal({ shopName: 'C & E Supplies' }), true);
});
