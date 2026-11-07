import { initializeApp, getApps, getApp } from 'firebase/app';
import { getFirestore, initializeFirestore } from 'firebase/firestore';
import { shopAuthDomain } from './lib/firebaseAuth';

const pageHost = typeof window === 'undefined' ? '' : window.location.host;

export const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || process.env.VITE_FIREBASE_API_KEY,
  authDomain: shopAuthDomain(pageHost),
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || process.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || process.env.VITE_FIREBASE_STORAGE_BUCKET,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID || process.env.VITE_FIREBASE_APP_ID,
};

export const isFirebaseConfigured =
  !!firebaseConfig.apiKey &&
  !!firebaseConfig.authDomain &&
  !!firebaseConfig.projectId &&
  !!firebaseConfig.storageBucket &&
  !!firebaseConfig.appId;

export const firebaseApp = isFirebaseConfigured
  ? getApps().length
    ? getApp()
    : initializeApp(firebaseConfig)
  : null;

const browserDb = () => {
  if (!firebaseApp || typeof window === 'undefined') return null;
  try {
    // The live Listen channel dies on some networks with QUIC_TOO_MANY_RTOS and the shelf never arrives.
    return initializeFirestore(firebaseApp, {
      experimentalForceLongPolling: true,
      experimentalLongPollingOptions: { timeoutSeconds: 10 },
    });
  } catch {
    return getFirestore(firebaseApp);
  }
};

export const db = browserDb();
