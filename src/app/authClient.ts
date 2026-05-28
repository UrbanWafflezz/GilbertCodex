import { createUserWithEmailAndPassword, deleteUser, onAuthStateChanged, signInWithEmailAndPassword, signOut, updateProfile, type User } from "firebase/auth";
import { doc, getDoc, runTransaction, serverTimestamp, setDoc } from "firebase/firestore";
import { getGilbertFirebaseAuth, getGilbertFirestore } from "../firebase";
import type { AuthSession, AuthStateResponse, AuthUser, CreateAuthAccountInput, LoginAuthAccountInput } from "../types/auth";

interface CloudUserProfile {
  createdAt: number;
  displayName: string;
  email: string;
  id: string;
  lastLoginAt?: number;
  updatedAt: number;
  username: string;
}

const USERNAME_COLLECTION = "usernames";

export async function getAuthState(): Promise<AuthStateResponse> {
  const auth = getGilbertFirebaseAuth();
  const user = auth.currentUser ?? await waitForFirebaseAuthUser();

  return {
    hasAccounts: true,
    session: user ? await createSessionFromFirebaseUser(user) : null,
  };
}

export async function createAuthAccount(input: CreateAuthAccountInput): Promise<AuthSession> {
  const displayName = normalizeDisplayName(input.displayName);
  const username = normalizeUsername(input.username);
  const email = normalizeEmail(input.email);
  const auth = getGilbertFirebaseAuth();
  let createdUser: User | null = null;

  try {
    const credential = await createUserWithEmailAndPassword(auth, email, input.password);
    createdUser = credential.user;
    await updateProfile(createdUser, { displayName });
    await reserveUsername(createdUser, username, email);
    return createSessionFromFirebaseUser(createdUser, { displayName, username });
  } catch (error) {
    if (createdUser) {
      await deleteUser(createdUser).catch(() => undefined);
    }
    throw normalizeFirebaseAuthError(error, "Could not create your account.");
  }
}

export async function loginAuthAccount(input: LoginAuthAccountInput): Promise<AuthSession> {
  const login = input.login.trim();
  const email = await resolveLoginEmail(login);
  const credential = await signInWithEmailAndPassword(getGilbertFirebaseAuth(), email, input.password)
    .catch((error) => {
      throw normalizeFirebaseAuthError(error, "Could not sign in to your account.");
    });

  return createSessionFromFirebaseUser(credential.user);
}

export async function logoutAuthAccount(): Promise<void> {
  await signOut(getGilbertFirebaseAuth());
}

async function waitForFirebaseAuthUser() {
  return new Promise<User | null>((resolve, reject) => {
    const unsubscribe = onAuthStateChanged(
      getGilbertFirebaseAuth(),
      (user) => {
        unsubscribe();
        resolve(user);
      },
      (error) => {
        unsubscribe();
        reject(error);
      },
    );
  });
}

async function createSessionFromFirebaseUser(user: User, profileOverride?: { displayName?: string; username?: string }): Promise<AuthSession> {
  const profile = await upsertUserProfile(user, profileOverride);

  return {
    createdAt: Date.now(),
    sessionToken: await user.getIdToken(),
    user: profile,
  };
}

async function upsertUserProfile(user: User, profileOverride?: { displayName?: string; username?: string }): Promise<AuthUser> {
  const db = getGilbertFirestore();
  const userRef = doc(db, "users", user.uid);
  const snapshot = await getDoc(userRef);
  const existing = snapshot.exists() ? normalizeCloudUserProfile(snapshot.data(), user) : null;
  const now = Date.now();
  const profile: CloudUserProfile = {
    createdAt: existing?.createdAt ?? readUserCreatedAt(user) ?? now,
    displayName: normalizeDisplayName(profileOverride?.displayName ?? existing?.displayName ?? user.displayName ?? user.email?.split("@")[0] ?? "Gilbert User"),
    email: normalizeEmail(user.email ?? existing?.email ?? ""),
    id: user.uid,
    lastLoginAt: now,
    updatedAt: now,
    username: normalizeUsername(profileOverride?.username ?? existing?.username ?? user.email?.split("@")[0] ?? user.uid),
  };

  const profileWrite: Record<string, unknown> = {
    ...profile,
    authProvider: "firebase",
    lastLoginAt: now,
    serverUpdatedAt: serverTimestamp(),
  };

  if (!existing) {
    profileWrite.billingPlan = {
      source: "firebase",
      status: "active",
      tier: "free",
      updatedAt: now,
    };
  }

  await setDoc(userRef, profileWrite, { merge: true });

  return profile;
}

async function reserveUsername(user: User, username: string, email: string) {
  const db = getGilbertFirestore();
  const usernameRef = doc(db, USERNAME_COLLECTION, username);

  await runTransaction(db, async (transaction) => {
    const usernameSnapshot = await transaction.get(usernameRef);

    if (usernameSnapshot.exists() && usernameSnapshot.data().uid !== user.uid) {
      throw new Error("That username is already used by another Gilbert Codex account.");
    }

    transaction.set(usernameRef, {
      createdAt: serverTimestamp(),
      email,
      uid: user.uid,
      username,
    });
  });
}

async function resolveLoginEmail(login: string) {
  if (!login.trim()) {
    throw new Error("Enter your email or username.");
  }

  if (login.includes("@")) {
    return normalizeEmail(login);
  }

  const username = normalizeUsername(login);
  const snapshot = await getDoc(doc(getGilbertFirestore(), USERNAME_COLLECTION, username));
  const email = snapshot.exists() && typeof snapshot.data().email === "string" ? snapshot.data().email : "";

  if (!email) {
    throw new Error("No Gilbert Codex account matches that username.");
  }

  return normalizeEmail(email);
}

function normalizeCloudUserProfile(value: Record<string, unknown>, user: User): AuthUser {
  const now = Date.now();

  return {
    createdAt: normalizeRequiredTimestamp(value.createdAt, readUserCreatedAt(user) ?? now),
    displayName: normalizeDisplayName(typeof value.displayName === "string" ? value.displayName : user.displayName ?? "Gilbert User"),
    email: normalizeEmail(typeof value.email === "string" ? value.email : user.email ?? ""),
    id: user.uid,
    lastLoginAt: normalizeTimestamp(value.lastLoginAt, undefined),
    updatedAt: normalizeRequiredTimestamp(value.updatedAt, now),
    username: normalizeUsername(typeof value.username === "string" ? value.username : user.email?.split("@")[0] ?? user.uid),
  };
}

function readUserCreatedAt(user: User) {
  const createdAt = user.metadata.creationTime ? Date.parse(user.metadata.creationTime) : Number.NaN;
  return Number.isFinite(createdAt) ? createdAt : undefined;
}

function normalizeTimestamp(value: unknown, fallback: number | undefined) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  return fallback ?? undefined;
}

function normalizeRequiredTimestamp(value: unknown, fallback: number) {
  return normalizeTimestamp(value, fallback) ?? fallback;
}

function normalizeDisplayName(value: string) {
  const displayName = value.trim();

  if (displayName.length < 2) {
    throw new Error("Enter a display name with at least 2 characters.");
  }

  return displayName.slice(0, 80);
}

function normalizeUsername(value: string) {
  const username = value.trim().replace(/^@+/, "").toLowerCase();

  if (username.length < 3) {
    throw new Error("Choose a username with at least 3 characters.");
  }

  if (username.length > 32) {
    throw new Error("Keep the username under 32 characters.");
  }

  if (!/^[a-z0-9_.-]+$/.test(username)) {
    throw new Error("Use only letters, numbers, dots, dashes, or underscores in the username.");
  }

  return username;
}

function normalizeEmail(value: string) {
  const email = value.trim().toLowerCase();

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("Enter a valid email address.");
  }

  return email;
}

function normalizeFirebaseAuthError(error: unknown, fallback: string) {
  if (error instanceof Error && !("code" in error)) {
    return error;
  }

  const code = typeof error === "object" && error && "code" in error ? String((error as { code?: unknown }).code) : "";

  if (code.includes("email-already-in-use")) {
    return new Error("That email is already registered. Sign in instead.");
  }

  if (code.includes("invalid-credential") || code.includes("wrong-password") || code.includes("user-not-found")) {
    return new Error("The email, username, or password did not match a Gilbert Codex account.");
  }

  if (code.includes("weak-password")) {
    return new Error("Use a stronger password before creating the account.");
  }

  if (error instanceof Error && error.message.trim()) {
    return error;
  }

  return new Error(fallback);
}
