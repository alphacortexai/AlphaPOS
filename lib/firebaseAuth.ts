export const configuredFirebaseAuthDomain = () =>
  (process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || process.env.VITE_FIREBASE_AUTH_DOMAIN || '').trim();

export const firebaseProjectId = () =>
  (process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || process.env.VITE_FIREBASE_PROJECT_ID || '').trim();

/** Host that actually serves Firebase's /__/auth helper. */
export const firebaseAuthProxyHost = (authDomain = configuredFirebaseAuthDomain(), projectId = firebaseProjectId()) => {
  if (authDomain.endsWith('.firebaseapp.com') || authDomain.endsWith('.web.app')) return authDomain;
  return projectId ? `${projectId}.firebaseapp.com` : '';
};

/**
 * Google sign-in stays on the shop's own address.
 * A helper on firebaseapp.com is a third-party page, and phones block that storage.
 */
export const shopAuthDomain = (pageHost: string, configured = configuredFirebaseAuthDomain()) =>
  pageHost.trim() || configured;
