import { getAuth, isSignInWithEmailLink, signInWithEmailLink, type Auth } from 'firebase/auth';
import { firebaseApp, firebaseConfig } from '../../lib.firebase';

const EMAIL_FOR_SIGN_IN = 'emailForSignIn';
const INVITE_SHOP = 'alphapos.inviteShop';

let emailLinkAttempt: Promise<void> | null = null;

export const createStaffInviteLink = async (email: string, shopOwnerUid: string) => {
  const normalized = email.trim().toLowerCase();
  const url = new URL(window.location.pathname || '/', window.location.origin);
  url.searchParams.set('email', normalized);
  url.searchParams.set('shop', shopOwnerUid);
  const appLink = url.toString();
  if (!firebaseApp || !firebaseConfig.apiKey) return { link: appLink, directSignIn: false };
  try {
    const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=${firebaseConfig.apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(8000),
      body: JSON.stringify({
        requestType: 'EMAIL_SIGNIN',
        email: normalized,
        continueUrl: appLink,
        canHandleCodeInApp: true,
        returnOobLink: true,
      }),
    });
    const payload = await response.json().catch(() => null) as { oobLink?: string } | null;
    if (response.ok && typeof payload?.oobLink === 'string' && payload.oobLink.startsWith('https://')) {
      return { link: payload.oobLink, directSignIn: true };
    }
  } catch {
    // The shop still emails the app link through Resend.
  }
  return { link: appLink, directSignIn: false };
};

export const staffSignInError = (error: unknown) => {
  const code = typeof error === 'object' && error && 'code' in error ? String((error as { code: string }).code) : '';
  if (code === 'alphapos/no-firebase') return 'This browser-only counter cannot email anyone. Connect Firebase, then send the sign-in link again.';
  if (error instanceof Error && error.message) return error.message;
  return 'The sign-in email could not be sent.';
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

export const rememberInviteFromUrl = () => {
  if (typeof window === 'undefined' || !firebaseApp) return;
  const params = new URLSearchParams(window.location.search);
  const shop = params.get('shop');
  if (!shop || isSignInWithEmailLink(getAuth(firebaseApp), window.location.href)) return;
  window.sessionStorage.setItem(INVITE_SHOP, shop);
};

export const takeInvitedShopId = () => {
  if (typeof window === 'undefined') return '';
  const shop = window.sessionStorage.getItem(INVITE_SHOP) || '';
  if (shop) window.sessionStorage.removeItem(INVITE_SHOP);
  return shop;
};
