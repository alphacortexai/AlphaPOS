import assert from 'node:assert/strict';
import test from 'node:test';
import { branchAfterOnboarding, reviewBranchName, reviewShopName, reviewStaffInvite, shopNeedsOnboarding } from './onboarding';

test('a new owner with no shop document sets up the shop', () => {
  assert.equal(shopNeedsOnboarding(null, true), true);
  assert.equal(shopNeedsOnboarding(undefined, true), true);
});

test('an invited person does not set up the owner’s shop', () => {
  assert.equal(shopNeedsOnboarding(null, false), false);
  assert.equal(shopNeedsOnboarding({ shopName: 'My Shop', branches: [] }, false), false);
});

test('the untouched starter shop still needs a name', () => {
  assert.equal(shopNeedsOnboarding({
    shopName: 'My Shop',
    branches: [{ id: 'b1', name: 'Main Branch', location: 'HQ' }],
    products: [],
    services: [],
    sales: [],
  }, true), true);
  assert.equal(shopNeedsOnboarding({ shopName: '  my shop  ', branches: [] }, true), true);
});

test('a finished setup, a chosen name, or any records skip setup', () => {
  assert.equal(shopNeedsOnboarding({ shopName: 'My Shop', onboardingComplete: true }, true), false);
  assert.equal(shopNeedsOnboarding({ shopName: 'Acacia Grocers', products: [] }, true), false);
  assert.equal(shopNeedsOnboarding({
    shopName: 'My Shop',
    branches: [{ name: 'Owino stall' }],
  }, true), false);
  assert.equal(shopNeedsOnboarding({
    shopName: 'My Shop',
    branches: [{ name: 'Main Branch' }, { name: 'Second' }],
  }, true), false);
  assert.equal(shopNeedsOnboarding({ shopName: 'My Shop', products: [{ id: 'soap' }] }, true), false);
  assert.equal(shopNeedsOnboarding({ shopName: 'My Shop', services: { cut: { id: 'cut' } } }, true), false);
  assert.equal(shopNeedsOnboarding({ shopName: 'My Shop', expenses: [{ id: 'rent' }] }, true), false);
});

test('an unfinished setup stays open even after a name was stored', () => {
  assert.equal(shopNeedsOnboarding({
    shopName: 'Acacia Grocers',
    onboardingComplete: false,
    products: [{ id: 'soap' }],
  }, true), true);
});

test('shop and branch names are required and trimmed', () => {
  assert.equal(reviewShopName('   ').ok, false);
  const named = reviewShopName('  Acacia   Grocers ');
  assert.equal(named.ok ? named.shopName : '', 'Acacia Grocers');
  assert.equal(reviewShopName('a'.repeat(81)).ok, false);
  const branch = reviewBranchName(' Main counter ', '');
  assert.equal(branch.ok ? branch.branchName : '', 'Main counter');
  assert.equal(branch.ok ? branch.branchLocation : '', 'Main counter');
  const placed = reviewBranchName('Main counter', '  Kampala Road ');
  assert.equal(placed.ok ? placed.branchLocation : '', 'Kampala Road');
});

test('a staff invite needs someone else’s email and can be reviewed', () => {
  assert.equal(reviewStaffInvite({ name: '', email: '', role: 'cashier' }).ok, false);
  assert.equal(reviewStaffInvite({ name: 'Amina', email: 'not-an-email', role: 'cashier' }).ok, false);
  const own = reviewStaffInvite({ name: 'Amina', email: 'Owner@Shop.com', role: 'cashier', ownerEmail: 'owner@shop.com' });
  assert.equal(own.ok, false);
  const invite = reviewStaffInvite({ name: '  Amina  Nakato ', email: 'Amina@Shop.com', role: 'manager', ownerEmail: 'owner@shop.com' });
  assert.deepEqual(invite.ok ? invite.staff : null, { name: 'Amina Nakato', email: 'amina@shop.com', role: 'manager' });
  const fallback = reviewStaffInvite({ name: 'Amina', email: 'amina@shop.com', role: 'owner' });
  assert.equal(fallback.ok ? fallback.staff.role : '', 'cashier');
});

test('the first branch is renamed and an empty shop gets one branch', () => {
  const renamed = branchAfterOnboarding(
    [{ id: 'b1', name: 'Main Branch', location: 'HQ', createdAt: 'then' }],
    'Owino',
    'Kampala',
    { id: 'new', name: 'unused', location: 'unused' },
  );
  assert.deepEqual(renamed, [{ id: 'b1', name: 'Owino', location: 'Kampala', createdAt: 'then' }]);
  const created = branchAfterOnboarding([], 'Owino', 'Kampala', { id: 'new', name: 'Owino', location: 'Kampala' });
  assert.deepEqual(created, [{ id: 'new', name: 'Owino', location: 'Kampala' }]);
});
