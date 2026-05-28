import { FormEvent, useEffect, useMemo, useState } from "react";
import { ArrowRight, CheckCircle2, Eye, EyeOff, KeyRound, LockKeyhole, Mail, UserRound } from "lucide-react";
import { createAuthAccount, loginAuthAccount } from "../app/authClient";
import { AuthTopBar } from "../components/chrome/AuthTopBar";
import type { AuthSession } from "../types/auth";

type AuthMode = "create" | "login";

interface AuthPageProps {
  initialError?: string | null;
  loading?: boolean;
  onAuthenticated: (session: AuthSession) => void | Promise<void>;
}

export function AuthPage({ initialError, loading = false, onAuthenticated }: AuthPageProps) {
  const [mode, setMode] = useState<AuthMode>("login");
  const [displayName, setDisplayName] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [error, setError] = useState<string | null>(initialError ?? null);
  const [submitting, setSubmitting] = useState(false);
  const passwordScore = useMemo(() => getPasswordScore(password), [password]);
  const isCreateMode = mode === "create";

  useEffect(() => {
    setError(initialError ?? null);
  }, [initialError]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (loading || submitting) {
      return;
    }

    setError(null);

    try {
      setSubmitting(true);

      if (isCreateMode) {
        validateCreateAccount();
        const session = await createAuthAccount({
          displayName,
          email,
          password,
          username,
        });
        await onAuthenticated(session);
      } else {
        validateLogin();
        const session = await loginAuthAccount({
          login,
          password,
        });
        await onAuthenticated(session);
      }
    } catch (submitError) {
      setError(readErrorMessage(submitError, "The account request failed."));
    } finally {
      setSubmitting(false);
    }
  }

  function validateCreateAccount() {
    if (displayName.trim().length < 2) {
      throw new Error("Enter a display name with at least 2 characters.");
    }

    if (!/^[a-zA-Z0-9_.-]{3,32}$/.test(username.trim())) {
      throw new Error("Choose a 3-32 character username using letters, numbers, dots, dashes, or underscores.");
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      throw new Error("Enter a valid email address.");
    }

    if (password.length < 8) {
      throw new Error("Use a password with at least 8 characters.");
    }

    if (password !== confirmPassword) {
      throw new Error("The password confirmation does not match.");
    }
  }

  function validateLogin() {
    if (!login.trim()) {
      throw new Error("Enter your username or email.");
    }

    if (!password) {
      throw new Error("Enter your password.");
    }
  }

  function switchMode(nextMode: AuthMode) {
    if (nextMode === mode) {
      return;
    }

    setMode(nextMode);
    setError(null);
    setPassword("");
    setConfirmPassword("");
    setShowPassword(false);
    setShowConfirmPassword(false);
  }

  const passwordInputType = showPassword ? "text" : "password";
  const confirmPasswordInputType = showConfirmPassword ? "text" : "password";

  return (
    <div className="auth-root">
      <AuthTopBar activeMode={mode} onModeChange={switchMode} />
      <main className="auth-shell">
        <section className="auth-brand-panel" aria-label="Gilbert Codex account">
          <div className="auth-brand-lockup">
            <div className="auth-brand-mark">
              <img src="/gilbert-codex-logo.svg" alt="" aria-hidden="true" draggable={false} />
            </div>
            <div>
              <span className="auth-kicker">Gilbert Codex</span>
              <h1>One account for your workspace.</h1>
            </div>
          </div>
          <p>Use one Gilbert account for your projects, chats, settings, and usage.</p>
          <div className="auth-account-card" aria-label="Account benefits">
            <div className="auth-account-row">
              <CheckCircle2 size={17} aria-hidden="true" />
              <span>Projects and chats stay attached to your account.</span>
            </div>
            <div className="auth-account-row">
              <CheckCircle2 size={17} aria-hidden="true" />
              <span>Settings and plan details follow the same sign-in.</span>
            </div>
            <div className="auth-account-row">
              <CheckCircle2 size={17} aria-hidden="true" />
              <span>Your workspace opens after account verification.</span>
            </div>
          </div>
        </section>

        <section className="auth-form-panel" aria-label={isCreateMode ? "Create account" : "Sign in"}>
          <div className="auth-form-accent" aria-hidden="true">
            <KeyRound size={15} />
            <span>Account access</span>
          </div>
          <div className="auth-mode-switch" role="tablist" aria-label="Auth mode">
            <button type="button" role="tab" aria-selected={!isCreateMode} data-active={!isCreateMode} onClick={() => switchMode("login")}>
              Sign in
            </button>
            <button type="button" role="tab" aria-selected={isCreateMode} data-active={isCreateMode} onClick={() => switchMode("create")}>
              Create account
            </button>
          </div>

          <div className="auth-form-heading">
            <div className="auth-form-icon" aria-hidden="true">
              {isCreateMode ? <UserRound size={20} /> : <LockKeyhole size={20} />}
            </div>
            <div>
              <h2>{isCreateMode ? "Create your account" : "Welcome back"}</h2>
              <p>{isCreateMode ? "Set up your Gilbert Codex account." : "Sign in to open Gilbert Codex."}</p>
            </div>
          </div>

          <form className="auth-form" onSubmit={handleSubmit}>
            {isCreateMode ? (
              <div className="auth-create-grid">
                <label className="auth-field">
                  <span>Display name</span>
                  <div className="auth-input-wrap">
                    <UserRound size={17} aria-hidden="true" />
                    <input value={displayName} autoComplete="name" placeholder="Your name" onChange={(event) => setDisplayName(event.target.value)} />
                  </div>
                </label>
                <label className="auth-field">
                  <span>Username</span>
                  <div className="auth-input-wrap">
                    <KeyRound size={17} aria-hidden="true" />
                    <input value={username} autoComplete="username" placeholder="your-handle" onChange={(event) => setUsername(event.target.value)} />
                  </div>
                </label>
                <label className="auth-field auth-field-wide">
                  <span>Email</span>
                  <div className="auth-input-wrap">
                    <Mail size={17} aria-hidden="true" />
                    <input value={email} type="email" autoComplete="email" placeholder="you@example.com" onChange={(event) => setEmail(event.target.value)} />
                  </div>
                </label>
                <label className="auth-field">
                  <span>Password</span>
                  <div className="auth-input-wrap auth-input-wrap-action">
                    <LockKeyhole size={17} aria-hidden="true" />
                    <input value={password} type={passwordInputType} autoComplete="new-password" onChange={(event) => setPassword(event.target.value)} />
                    <button
                      aria-label={showPassword ? "Hide password" : "Show password"}
                      className="auth-input-icon-button"
                      title={showPassword ? "Hide password" : "Show password"}
                      type="button"
                      onClick={() => setShowPassword((visible) => !visible)}
                    >
                      {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                    </button>
                  </div>
                </label>
                <label className="auth-field">
                  <span>Confirm password</span>
                  <div className="auth-input-wrap auth-input-wrap-action">
                    <LockKeyhole size={17} aria-hidden="true" />
                    <input value={confirmPassword} type={confirmPasswordInputType} autoComplete="new-password" onChange={(event) => setConfirmPassword(event.target.value)} />
                    <button
                      aria-label={showConfirmPassword ? "Hide confirmation password" : "Show confirmation password"}
                      className="auth-input-icon-button"
                      title={showConfirmPassword ? "Hide confirmation password" : "Show confirmation password"}
                      type="button"
                      onClick={() => setShowConfirmPassword((visible) => !visible)}
                    >
                      {showConfirmPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                    </button>
                  </div>
                </label>
              </div>
            ) : (
              <>
                <label className="auth-field">
                  <span>Email or username</span>
                  <div className="auth-input-wrap">
                    <UserRound size={17} aria-hidden="true" />
                    <input value={login} autoComplete="username" placeholder="you@example.com" onChange={(event) => setLogin(event.target.value)} />
                  </div>
                </label>
                <label className="auth-field">
                  <span>Password</span>
                  <div className="auth-input-wrap auth-input-wrap-action">
                    <LockKeyhole size={17} aria-hidden="true" />
                    <input value={password} type={passwordInputType} autoComplete="current-password" onChange={(event) => setPassword(event.target.value)} />
                    <button
                      aria-label={showPassword ? "Hide password" : "Show password"}
                      className="auth-input-icon-button"
                      title={showPassword ? "Hide password" : "Show password"}
                      type="button"
                      onClick={() => setShowPassword((visible) => !visible)}
                    >
                      {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                    </button>
                  </div>
                </label>
              </>
            )}

            {isCreateMode ? (
              <div className="auth-password-meter" data-score={passwordScore}>
                <span />
                <small>{getPasswordLabel(passwordScore)}</small>
              </div>
            ) : null}

            {error ? <div className="auth-error" role="alert">{error}</div> : null}

            <button className="auth-submit" type="submit" disabled={loading || submitting}>
              <span>{loading ? "Loading account" : submitting ? "Working" : isCreateMode ? "Create account" : "Sign in"}</span>
              <ArrowRight size={17} aria-hidden="true" />
            </button>
          </form>

          <p className="auth-form-footer">
            <span>{isCreateMode ? "Already have an account?" : "New to Gilbert Codex?"}</span>
            <button type="button" onClick={() => switchMode(isCreateMode ? "login" : "create")}>
              {isCreateMode ? "Sign in" : "Create account"}
            </button>
          </p>
        </section>
      </main>
    </div>
  );
}

function getPasswordScore(password: string) {
  let score = 0;

  if (password.length >= 8) {
    score += 1;
  }

  if (password.length >= 12) {
    score += 1;
  }

  if (/[A-Z]/.test(password) && /[a-z]/.test(password)) {
    score += 1;
  }

  if (/\d/.test(password) || /[^a-zA-Z0-9]/.test(password)) {
    score += 1;
  }

  return Math.min(score, 4);
}

function getPasswordLabel(score: number) {
  if (score >= 4) {
    return "Strong password";
  }

  if (score >= 2) {
    return "Good start";
  }

  return "Use 8+ characters";
}

function readErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : typeof error === "string" && error.trim() ? error : fallback;
}
