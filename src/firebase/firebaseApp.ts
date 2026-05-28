import { getAnalytics, isSupported as isAnalyticsSupported, type Analytics } from "firebase/analytics";
import { getApp, getApps, initializeApp, type FirebaseApp } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";
import { getFirestore, type Firestore } from "firebase/firestore";
import { firebaseWebConfig } from "./firebaseConfig";

let firebaseApp: FirebaseApp | null = null;
let firebaseAuth: Auth | null = null;
let firebaseFirestore: Firestore | null = null;
let firebaseAnalytics: Promise<Analytics | null> | null = null;

export function getGilbertFirebaseApp() {
  if (firebaseApp) {
    return firebaseApp;
  }

  firebaseApp = getApps().length > 0 ? getApp() : initializeApp(firebaseWebConfig);
  return firebaseApp;
}

export function getGilbertFirebaseAuth() {
  if (!firebaseAuth) {
    firebaseAuth = getAuth(getGilbertFirebaseApp());
  }

  return firebaseAuth;
}

export function getGilbertFirestore() {
  if (!firebaseFirestore) {
    firebaseFirestore = getFirestore(getGilbertFirebaseApp());
  }

  return firebaseFirestore;
}

export function getGilbertFirebaseAnalytics() {
  if (typeof window === "undefined") {
    return Promise.resolve(null);
  }

  if (!firebaseAnalytics) {
    firebaseAnalytics = isAnalyticsSupported()
      .then((supported) => supported ? getAnalytics(getGilbertFirebaseApp()) : null)
      .catch(() => null);
  }

  return firebaseAnalytics;
}

export function initializeGilbertFirebase() {
  return {
    app: getGilbertFirebaseApp(),
    auth: getGilbertFirebaseAuth(),
    firestore: getGilbertFirestore(),
  };
}
