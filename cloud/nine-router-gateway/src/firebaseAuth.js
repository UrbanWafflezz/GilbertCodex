import { applicationDefault, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";

export const FIREBASE_ID_TOKEN_HEADER = "x-gilbert-firebase-id-token";

let authClient = null;
let firestoreClient = null;
let storageBucket = null;

export function getFirebaseAuth() {
  if (authClient) {
    return authClient;
  }

  ensureFirebaseApp();

  authClient = getAuth();
  return authClient;
}

export function getFirebaseStorageBucket() {
  if (storageBucket) {
    return storageBucket;
  }

  ensureFirebaseApp();
  storageBucket = getStorage().bucket();
  return storageBucket;
}

export function getFirebaseDb() {
  if (firestoreClient) {
    return firestoreClient;
  }

  ensureFirebaseApp();
  firestoreClient = getFirestore();
  return firestoreClient;
}

function ensureFirebaseApp() {
  if (getApps().length > 0) {
    return;
  }

  const projectId = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || process.env.FIREBASE_PROJECT_ID;
  initializeApp({
    credential: applicationDefault(),
    projectId,
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET || (projectId ? `${projectId}.firebasestorage.app` : undefined),
  });
}

export async function verifyFirebaseRequest(req) {
  const token = readFirebaseIdToken(req);

  if (!token) {
    const error = new Error("Missing Firebase ID token.");
    error.statusCode = 401;
    throw error;
  }

  try {
    return await getFirebaseAuth().verifyIdToken(token);
  } catch (cause) {
    const error = new Error("Invalid Firebase ID token.");
    error.statusCode = 401;
    error.cause = cause;
    throw error;
  }
}

function readFirebaseIdToken(req) {
  const explicitToken = readHeader(req, FIREBASE_ID_TOKEN_HEADER);
  if (explicitToken) {
    return explicitToken;
  }

  const authorization = readHeader(req, "authorization");
  const bearerMatch = /^Bearer\s+(.+)$/i.exec(authorization);

  return bearerMatch?.[1]?.trim() || "";
}

function readHeader(req, name) {
  const value = req.headers[name.toLowerCase()];

  if (Array.isArray(value)) {
    return value[0]?.trim() || "";
  }

  return typeof value === "string" ? value.trim() : "";
}
