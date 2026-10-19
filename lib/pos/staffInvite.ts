import { getAuth, isSignInWithEmailLink, signInWithEmailLink, type Auth } from 'firebase/auth';
import { firebaseApp, firebaseConfig } from '../../lib.firebase';

const EMAIL_FOR_SIGN_IN = 'emailForSignIn';
const INVITE_SHOP = 'alphapos.inviteShop';

let emailLinkAttempt: Promise<void> | null = null;

const inviteError = (code: string, message: string) => Object.assign(new Error(message), { code });

export const explainFirebaseInviteError = (serverMessage: string, projectId: string, hostname: string) => {
  const text = serverMessage.trim();
  const upper = text.toUpperCase();
  const project = projectId || 'this Firebase project';
  const detail = text.includes(':') ? text.slice(text.indexOf(':') + 1).trim() : '';
  if (upper.includes('UNAUTHORIZED_DOMAIN') || upper.includes('UNAUTHORIZED_CONTINUE_URI') || upper.includes('DOMAIN_NOT_ALLOWLISTED')) {
    return `Add ${hostname} under Firebase Authentication → Settings → Authorized domains for project ${project}, then send the link again. The person is saved and can still sign in with Google using this address.`;
  }
  if (upper.includes('OPERATION_NOT_ALLOWED') || upper.includes('PASSWORD SIGN-IN') || upper.includes('EMAIL_LINK') || upper.includes('PROVIDER IS DISABLED')) {
    return `Firebase project ${project} refused the sign-in email${detail ? `: ${detail}` : ''}. Open Authentication → Sign-in method → Email/Password and turn on both Email/Password and Email link (passwordless sign-in), then click Save. The person is saved and can still sign in with Google using this address.`;
  }
  if (upper.includes('INVALID_EMAIL')) return 'That email address is not valid.';
  return `Firebase project ${project} did not send the sign-in email${text ? `: ${text}` : ''}. The person is saved and can still sign in with Google using this address.`;
};

const authorizedDomains = async (apiKey: string) => {
  const response = await fetch(`https://www.googleapis.com/identitytoolkit/v3/relyingparty/getProjectConfig?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  if (!response.ok) return null;
  const payload = await response.json() as { authorizedDomains?: string[] };
  return Array.isArray(payload.authorizedDomains) ? payload.authorizedDomains : null;
};

const hostIsAuthorized = (hostname: string, domains: string[]) => domains.some((domain) => {
  if (domain === hostname) return true;
  if (domain.startsWith('*.')) return hostname.endsWith(domain.slice(1));
  return false;
});

export const sendStaffSignInLink = async (email: string, shopOwnerUid: string) => {
  if (!firebaseApp || !firebaseConfig.apiKey) {
    throw inviteError('alphapos/no-firebase', 'This counter has no Firebase project, so it cannot email a sign-in link.');
  }
  const normalized = email.trim();
  const url = new URL(window.location.pathname || '/', window.location.origin);
  url.searchParams.set('email', normalized.toLowerCase());
  url.searchParams.set('shop', shopOwnerUid);
  const projectId = firebaseConfig.projectId || '';
  const hostname = window.location.hostname;
  const domains = await authorizedDomains(firebaseConfig.apiKey).catch(() => null);
  if (domains && !hostIsAuthorized(hostname, domains)) {
    throw inviteError('alphapos/domain', `Add ${hostname} under Firebase Authentication → Settings → Authorized domains for project ${projectId || 'this project'}. Domains already listed: ${domains.join(', ') || 'none'}. The person is saved and can still sign in with Google using this address.`);
  }
  const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=${firebaseConfig.apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      requestType: 'EMAIL_SIGNIN',
      email: normalized,
      continueUrl: url.toString(),
      canHandleCodeInApp: true,
    }),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: { message?: string } } | null;
    throw inviteError('alphapos/firebase', explainFirebaseInviteError(payload?.error?.message || '', projectId, hostname));
  }
  window.localStorage.setItem(EMAIL_FOR_SIGN_IN, normalized);
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
