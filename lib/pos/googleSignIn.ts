import { getRedirectResult, GoogleAuthProvider, signInWithRedirect, type Auth } from 'firebase/auth';

let pendingRedirect: Promise<void> | null = null;

export const startGoogleSignIn = (auth: Auth, loginHint?: string) => {
  const provider = new GoogleAuthProvider();
  const hint = loginHint?.trim().toLowerCase();
  if (hint) provider.setCustomParameters({ login_hint: hint });
  return signInWithRedirect(auth, provider);
};

/** Finish a Google redirect once. A second call in the same page shares the first result. */
export const completeGoogleRedirect = (auth: Auth) => {
  if (!pendingRedirect) {
    pendingRedirect = getRedirectResult(auth).then(() => undefined).catch((error: unknown) => {
      pendingRedirect = null;
      throw error;
    });
  }
  return pendingRedirect;
};

export const googleSignInError = (error: unknown) => {
  const code = typeof error === 'object' && error && 'code' in error ? String((error as { code: string }).code) : '';
  if (code === 'auth/unauthorized-domain') {
    return 'This shop address is not on the Firebase sign-in list yet. Add it under Authentication, then Settings, then Authorized domains.';
  }
  if (code === 'auth/redirect-cancelled-by-user' || code === 'auth/user-cancelled') {
    return 'Google sign-in was cancelled.';
  }
  if (code === 'auth/web-storage-unsupported') {
    return 'This browser is blocking the sign-in. Allow cookies for this shop, then try again.';
  }
  if (error instanceof Error && error.message) return error.message;
  return 'Google sign-in did not finish.';
};
