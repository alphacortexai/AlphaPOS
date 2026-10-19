import { getAuth, isSignInWithEmailLink, sendSignInLinkToEmail, signInWithEmailLink, type Auth } from 'firebase/auth';
import { firebaseApp } from '../../lib.firebase';

const EMAIL_FOR_SIGN_IN = 'emailForSignIn';
const INVITE_SHOP = 'alphapos.inviteShop';

let emailLinkAttempt: Promise<void> | null = null;

export const sendStaffSignInLink = async (email: string, shopOwnerUid: string) => {
  if (!firebaseApp) {
    throw Object.assign(new Error('This counter has no Firebase project, so it cannot email a sign-in link.'), { code: 'alphapos/no-firebase' });
  }
  const auth = getAuth(firebaseApp);
  const normalized = email.trim();
  const url = new URL(window.location.pathname || '/', window.location.origin);
  url.searchParams.set('email', normalized.toLowerCase());
  url.searchParams.set('shop', shopOwnerUid);
  await sendSignInLinkToEmail(auth, normalized, {
    url: url.toString(),
    handleCodeInApp: true,
  });
  window.localStorage.setItem(EMAIL_FOR_SIGN_IN, normalized);
};

export const staffSignInError = (error: unknown) => {
  const code = typeof error === 'object' && error && 'code' in error ? String((error as { code: string }).code) : '';
  if (code === 'alphapos/no-firebase') return 'This browser-only counter cannot email anyone. Connect Firebase, then send the sign-in link again.';
  if (code === 'auth/operation-not-allowed') return 'Turn on Email link sign-in in Firebase Authentication. The person is saved, and they can still sign in with Google using this same address.';
  if (code === 'auth/unauthorized-continue-uri' || code === 'auth/invalid-continue-uri') return 'Add this website under Firebase Authentication → Settings → Authorized domains, then send the link again.';
  if (code === 'auth/invalid-email') return 'That email address is not valid.';
  return error instanceof Error ? error.message : 'The sign-in email could not be sent.';
};

export const completeEmailLinkSignIn = (auth: Auth) => {
  if (typeof window === 'undefined' || !isSignInWithEmailLink(auth, window.location.href)) return Promise.resolve();
  if (!emailLinkAttempt) {
    emailLinkAttempt = (async () => {
      const params = new URLSearchParams(window.location.search);
      const email = params.get('email') || window.localStorage.getItem(EMAIL_FOR_SIGN_IN) || window.prompt('Enter the email address this link was sent to') || '';
      if (!email.trim()) throw new Error('Enter the invited email address to finish signing in.');
      await signInWithEmailLink(auth, email.trim(), window.location.href);
      window.localStorage.removeItem(EMAIL_FOR_SIGN_IN);
      const shop = params.get('shop');
      if (shop) window.sessionStorage.setItem(INVITE_SHOP, shop);
      window.history.replaceState({}, '', window.location.pathname);
    })().catch((error) => {
      emailLinkAttempt = null;
      throw error;
    });
  }
  return emailLinkAttempt;
};

export const takeInvitedShopId = () => {
  if (typeof window === 'undefined') return '';
  const shop = window.sessionStorage.getItem(INVITE_SHOP) || '';
  if (shop) window.sessionStorage.removeItem(INVITE_SHOP);
  return shop;
};
