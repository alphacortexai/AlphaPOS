import assert from 'node:assert/strict';
import test from 'node:test';
import { shopDocumentBody } from './shopMath';
import {
  needsOwnerOnboarding,
  onboardBranchError,
  onboardLocationError,
  onboardShopError,
  onboardStaffError,
} from './onboarding';

const untouched = {
  shopName: 'My Shop',
  branches: [{ id: 'main', name: 'Main Branch', location: 'HQ' }],
  products: [],
  services: [],
  sales: [],
};

test('a first sign-in with no shop yet asks the owner to set it up', () => {
  assert.equal(needsOwnerOnboarding({ ownsShop: true, shop: null }), true);
  assert.equal(needsOwnerOnboarding({ ownsShop: true, shop: undefined }), true);
  assert.equal(needsOwnerOnboarding({ ownsShop: true, shop: untouched }), true);
  assert.equal(needsOwnerOnboarding({
    ownsShop: true,
    shop: { shopName: 'My Shop', branches: [{ name: 'Main Branch', location: 'Counter' }] },
  }), true);
});

test('an invited person never sets up a shop of their own from this screen', () => {
  assert.equal(needsOwnerOnboarding({ ownsShop: false, shop: null }), false);
  assert.equal(needsOwnerOnboarding({ ownsShop: false, shop: untouched }), false);
});

test('a shop that already has a name, a branch, or any work skips setup', () => {
  assert.equal(needsOwnerOnboarding({ ownsShop: true, shop: { ...untouched, onboardingComplete: true } }), false);
  assert.equal(needsOwnerOnboarding({ ownsShop: true, shop: { ...untouched, shopName: 'C & E Supplies' } }), false);
  assert.equal(needsOwnerOnboarding({
    ownsShop: true,
    shop: { shopName: 'My Shop', branches: [{ name: 'Owino' }] },
  }), false);
  assert.equal(needsOwnerOnboarding({
    ownsShop: true,
    shop: { shopName: 'My Shop', branches: [{ name: 'Main Branch', location: 'Nakawa' }] },
  }), false);
  assert.equal(needsOwnerOnboarding({
    ownsShop: true,
    shop: { ...untouched, branches: [{ name: 'Main Branch' }, { name: 'Second' }] },
  }), false);
  assert.equal(needsOwnerOnboarding({ ownsShop: true, shop: { ...untouched, products: [{ id: 'soap' }] } }), false);
  assert.equal(needsOwnerOnboarding({ ownsShop: true, shop: { ...untouched, services: [{ id: 'repair' }] } }), false);
  assert.equal(needsOwnerOnboarding({ ownsShop: true, shop: { ...untouched, sales: [{ id: '1' }] } }), false);
  assert.equal(needsOwnerOnboarding({ ownsShop: true, shop: { ...untouched, users: [{ email: 'a@shop.test' }] } }), false);
  assert.equal(needsOwnerOnboarding({ ownsShop: true, shop: { ...untouched, customers: [{ id: 'ada' }] } }), false);
  assert.equal(needsOwnerOnboarding({ ownsShop: true, shop: { ...untouched, suppliers: { s1: { name: 'Kikuubo' } } } }), false);
  assert.equal(needsOwnerOnboarding({
    ownsShop: true,
    shop: { shopName: 'My Shop', products: { soap: { id: 'soap' } } },
  }), false);
  assert.equal(needsOwnerOnboarding({
    ownsShop: true,
    shop: { shopName: 'My Shop', branches: { main: { name: 'Owino' } } },
  }), false);
});

test('shop and branch names are required, and a staff invite can be left blank', () => {
  assert.equal(onboardShopError('  '), 'Enter the shop name.');
  assert.equal(onboardShopError('C & E Supplies'), '');
  assert.equal(onboardBranchError(''), 'Enter the branch name.');
  assert.equal(onboardBranchError('Owino'), '');
  assert.equal(onboardLocationError(''), '');
  assert.equal(onboardLocationError('x'.repeat(81)).length > 0, true);
  assert.equal(onboardStaffError({ name: 'Amina', email: 'amina@shop.test' }), '');
  assert.equal(onboardStaffError({ name: '', email: '' }), 'Enter their name, or skip this step.');
  assert.equal(onboardStaffError({ name: 'Amina', email: 'amina' }), 'Enter their email, or skip this step.');
  assert.equal(onboardStaffError({
    name: 'Amina',
    email: 'Owner@Shop.test',
    ownerEmail: 'owner@shop.test',
  }), 'That is your email. Invite someone else, or skip this step.');
});

test('finishing setup is kept on the shop document', () => {
  const body = shopDocumentBody({ shopName: 'C & E Supplies', onboardingComplete: true, sales: [{ id: '1' }] });
  assert.equal(body.onboardingComplete, true);
  assert.equal(body.shopName, 'C & E Supplies');
  assert.equal('sales' in body, false);
});
