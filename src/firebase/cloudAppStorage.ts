import { collection, doc, getDoc, getDocs, serverTimestamp, setDoc, writeBatch } from "firebase/firestore";
import { getGilbertFirestore } from "./firebaseApp";

export interface FirebaseAppStorageEntry {
  key: string;
  value: string;
}

export interface FirebaseAppStorageSnapshot {
  values: Record<string, string>;
}

const APP_STORAGE_COLLECTION = "appStorage";
const MAX_BATCH_WRITES = 450;

export async function loadFirebaseAppStorage(userId: string): Promise<FirebaseAppStorageSnapshot> {
  const db = getGilbertFirestore();
  const snapshot = await getDocs(collection(db, "users", userId, APP_STORAGE_COLLECTION));
  const values: Record<string, string> = {};

  snapshot.forEach((document) => {
    const data = document.data();
    const key = typeof data.key === "string" ? data.key : decodeStorageDocumentId(document.id);
    const value = typeof data.value === "string" ? data.value : "";

    if (key) {
      values[key] = value;
    }
  });

  return { values };
}

export async function saveFirebaseAppStorageValue(userId: string, key: string, value: string) {
  await setDoc(storageDoc(userId, key), {
    key,
    updatedAt: serverTimestamp(),
    value,
  }, { merge: true });
}

export async function saveFirebaseAppStorageValues(userId: string, entries: FirebaseAppStorageEntry[]) {
  if (entries.length === 0) {
    return;
  }

  const db = getGilbertFirestore();
  for (let index = 0; index < entries.length; index += MAX_BATCH_WRITES) {
    const batch = writeBatch(db);
    for (const entry of entries.slice(index, index + MAX_BATCH_WRITES)) {
      batch.set(storageDoc(userId, entry.key), {
        key: entry.key,
        updatedAt: serverTimestamp(),
        value: entry.value,
      }, { merge: true });
    }
    await batch.commit();
  }
}

export async function loadFirebaseUserBillingPlan(userId: string) {
  const snapshot = await getDoc(doc(getGilbertFirestore(), "users", userId));
  const billingPlan = snapshot.exists() ? snapshot.data().billingPlan : null;

  return billingPlan && typeof billingPlan === "object" ? billingPlan : null;
}

function storageDoc(userId: string, key: string) {
  return doc(getGilbertFirestore(), "users", userId, APP_STORAGE_COLLECTION, encodeStorageDocumentId(key));
}

function encodeStorageDocumentId(key: string) {
  return encodeURIComponent(key).replace(/\./g, "%2E");
}

function decodeStorageDocumentId(id: string) {
  try {
    return decodeURIComponent(id.replace(/%2E/g, "."));
  } catch {
    return id;
  }
}
