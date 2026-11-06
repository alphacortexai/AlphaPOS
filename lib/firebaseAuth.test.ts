import assert from 'node:assert/strict';
import test from 'node:test';
import { firebaseAuthProxyHost, shopAuthDomain } from './firebaseAuth';
import { googleSignInError } from './pos/googleSignIn';

test('the shop uses its own address for Google sign-in', () => {
  assert.equal(shopAuthDomain('www.alphapos.store', 'alphamatrixpos.firebaseapp.com'), 'www.alphapos.store');
  assert.equal(shopAuthDomain('', 'alphamatrixpos.firebaseapp.com'), 'alphamatrixpos.firebaseapp.com');
});

test('the auth helper is proxied to the Firebase host', () => {
  assert.equal(firebaseAuthProxyHost('alphamatrixpos.firebaseapp.com', 'alphamatrixpos'), 'alphamatrixpos.firebaseapp.com');
  assert.equal(firebaseAuthProxyHost('www.alphapos.store', 'alphamatrixpos'), 'alphamatrixpos.firebaseapp.com');
  assert.equal(firebaseAuthProxyHost('', ''), '');
});

test('a cancelled Google redirect is explained in plain words', () => {
  assert.equal(googleSignInError({ code: 'auth/redirect-cancelled-by-user' }), 'Google sign-in was cancelled.');
  assert.match(googleSignInError({ code: 'auth/unauthorized-domain' }), /Authorized domains/);
});
