import assert from 'node:assert/strict';
import test from 'node:test';
import { booksForPermissions, canViewShelf, permissionsFor, permissionsMatchPreset, recordsForAccess, resolveStaffAccess, rowsForBranch, shelfForInvite, staffEmailLists, staffGrants, staffMayWriteShopField } from './staffAccess';

test('saving the shop writes an invite record a cashier can sell with', () => {
  const grants = staffGrants('owner', 'C & E', [
    { email: 'Cashier@Shop.test', role: 'cashier', branchId: 'main' },
    { email: 'cashier@shop.test', role: 'cashier' },
    { email: 'stock@shop.test', role: 'stock', permissions: ['products'] },
    { email: 'owner@shop.test', role: 'shop_owner' },
    { email: '', role: 'cashier' },
  ]);
  assert.deepEqual(grants.map((grant) => grant.email), ['cashier@shop.test', 'stock@shop.test']);
  assert.equal(grants[0].id, 'owner_cashier@shop.test');
  assert.equal(grants[0].permissions.includes('sell'), true);
  assert.equal(grants[0].branchId, 'main');
  assert.equal(grants[1].permissions.includes('sell'), false);
  assert.equal(grants[1].permissions.includes('products'), true);
  const lists = staffEmailLists([
    { email: 'Cashier@Shop.test', role: 'cashier' },
    { email: 'stock@shop.test', role: 'stock' },
  ]);
  assert.deepEqual(lists.sellerEmails, ['cashier@shop.test']);
  assert.deepEqual(lists.editorEmails, ['stock@shop.test']);
  const many = staffEmailLists(Array.from({ length: 8 }, (_, index) => ({ email: `c${index}@shop.test`, role: 'cashier' })));
  assert.equal(many.sellerEmails.length, 6);
});

test('an invite opens as the invited role, not as the owner of that shop', () => {
  const access = resolveStaffAccess({
    userUid: 'cashier-uid',
    shopOwnerUid: 'owner-uid',
    membershipRole: 'cashier',
    membershipPermissions: undefined,
    staffRole: 'shop_owner',
    staffBranchId: 'main',
  });
  assert.equal(access.role, 'cashier');
  assert.equal(access.permissions.includes('reports'), false);
  assert.equal(access.permissions.includes('seeCost'), false);
  assert.equal(access.permissions.includes('sell'), true);
  assert.equal(access.branchId, 'main');
  assert.equal(booksForPermissions(access.permissions, false).expenses, false);
  assert.equal(booksForPermissions(access.permissions, false).sales, true);
});

test('the membership grant beats a higher role saved inside the shop document', () => {
  const access = resolveStaffAccess({
    userUid: 'person',
    shopOwnerUid: 'owner',
    membershipRole: 'cashier',
    staffRole: 'admin',
  });
  assert.equal(access.role, 'cashier');
  assert.equal(access.permissions.includes('manageStaff'), false);
});

test('the owner of the document keeps every function, and a custom list can turn the rest off', () => {
  const owner = resolveStaffAccess({ userUid: 'owner', shopOwnerUid: 'owner', membershipRole: 'cashier', staffRole: 'cashier' });
  assert.equal(owner.role, 'shop_owner');
  assert.equal(owner.permissions.includes('reports'), true);
  assert.equal(staffMayWriteShopField('users', owner.permissions, true), true);

  const custom = permissionsFor('manager', ['sell', 'products']);
  assert.deepEqual(custom, ['sell', 'products']);
  assert.equal(permissionsMatchPreset('cashier', permissionsFor('cashier')), true);
  assert.equal(permissionsMatchPreset('cashier', custom), false);
  assert.equal(booksForPermissions(custom, false).sales, true);
  assert.equal(booksForPermissions(custom, false).expenses, false);
  assert.equal(staffMayWriteShopField('products', custom, false), false);
  assert.equal(staffMayWriteShopField('customers', custom, false), true);
  assert.equal(staffMayWriteShopField('users', custom, false), false);
  assert.equal(staffMayWriteShopField('taxSettings', custom, false), false);
});

test('a person who cannot see the books does not receive the copy stored on the shop document', () => {
  const hidden = recordsForAccess(false, [{ id: 'rent' }], []);
  assert.deepEqual(hidden, []);
  const shown = recordsForAccess(true, [{ id: 'rent' }], [{ id: 'rent' }, { id: 'stock' }]);
  assert.equal(shown.length, 2);
});

test('a cashier, a stock manager, and anyone else invited sees every product on the register', () => {
  const products = [
    { id: 'soap', branchId: 'main' },
    { id: 'rice', branchId: 'stall' },
  ];
  const shelf = shelfForInvite({
    products,
    branches: [{ id: 'main', name: 'Main' }, { id: 'stall', name: 'Stall' }],
    services: [{ id: 'print' }],
  });
  assert.deepEqual(shelf.products.map((product) => product.id), ['soap', 'rice']);
  assert.deepEqual(shelf.branches.map((branch) => branch.id), ['main', 'stall']);
  assert.equal(shelf.services.length, 1);
  assert.equal(canViewShelf(true, []), true);
  assert.equal(canViewShelf(false, []), false);
  assert.equal(canViewShelf(false, ['sell']), true);
  assert.equal(rowsForBranch(products, 'closed', 2).length, 2);
  (['cashier', 'stock', 'manager', 'admin'] as const).forEach((role) => {
    const access = resolveStaffAccess({ userUid: role, shopOwnerUid: 'owner', membershipRole: role, membershipBranchId: 'closed' });
    assert.equal(access.permissions.includes('products') || access.permissions.includes('sell'), true);
  });
  assert.equal(permissionsFor('cashier').includes('manageStaff'), false);
  assert.equal(permissionsFor('manager').includes('manageStaff'), false);
  assert.equal(permissionsFor('manager').includes('products'), true);
});

test('an empty permission list stays empty instead of falling back to the role', () => {
  const access = resolveStaffAccess({
    userUid: 'person',
    shopOwnerUid: 'owner',
    membershipRole: 'admin',
    membershipPermissions: [],
  });
  assert.equal(access.role, 'admin');
  assert.deepEqual(access.permissions, []);
  assert.equal(booksForPermissions(access.permissions, false).sales, false);
});
