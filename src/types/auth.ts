export interface AuthUser {
  createdAt: number;
  displayName: string;
  email: string;
  id: string;
  lastLoginAt?: number;
  updatedAt: number;
  username: string;
}

export interface AuthSession {
  createdAt: number;
  sessionToken: string;
  user: AuthUser;
}

export interface AuthStateResponse {
  hasAccounts: boolean;
  session: AuthSession | null;
}

export interface CreateAuthAccountInput {
  displayName: string;
  email: string;
  password: string;
  username: string;
}

export interface LoginAuthAccountInput {
  login: string;
  password: string;
}
