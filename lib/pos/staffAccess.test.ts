import assert from 'node:assert/strict';
import test from 'node:test';
import { booksForPermissions, permissionsFor, permissionsMatchPreset, recordsForAccess, resolveStaffAccess, rowsForBranch, staffMayWriteShopField } from './staffAccess';

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

test('a cashier still sees products when their branch does not match the shelf', () => {
  const products = [
    { id: 'soap', branchId: 'main' },
    { id: 'rice', branchId: 'stall' },
  ];
  assert.equal(rowsForBranch(products, 'other', 1).length, 2);
  assert.deepEqual(rowsForBranch(products, 'main', 2).map((product) => product.id), ['soap']);
  assert.equal(rowsForBranch(products, 'closed', 2).length, 2);
  const access = resolveStaffAccess({ userUid: 'cashier', shopOwnerUid: 'owner', membershipRole: 'cashier' });
  assert.equal(access.permissions.includes('products'), true);
  assert.equal(access.permissions.includes('allBranches'), true);
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
