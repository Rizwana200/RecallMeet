"use client";
// Login page.

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { isAxiosError } from "axios";
import { apiClient } from "@/lib/api-client";
import { useAuthStore } from "@/lib/auth-store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";
import { AuthShell } from "@/components/auth/AuthShell";
import { PasswordInput } from "@/components/auth/PasswordInput";
import { GoogleSignIn } from "@/components/auth/GoogleSignIn";
import { cn } from "@/lib/utils";

// Pure CSS animations (no extra dependencies). Each block fades up in turn,
// errors shake once, and everything is switched off for users who prefer
// reduced motion.
const ANIMATION_CSS = `
@keyframes rm-rise {
  from { opacity: 0; transform: translateY(14px); }
  to   { opacity: 1; transform: translateY(0); }
}
@keyframes rm-shake {
  0%, 100% { transform: translateX(0); }
  20%, 60% { transform: translateX(-6px); }
  40%, 80% { transform: translateX(6px); }
}
@keyframes rm-error-in {
  from { opacity: 0; transform: translateY(-6px); }
  to   { opacity: 1; transform: translateY(0); }
}
@keyframes rm-line-grow {
  from { transform: scaleX(0); }
  to   { transform: scaleX(1); }
}
.rm-rise {
  opacity: 0;
  animation: rm-rise 0.55s cubic-bezier(0.22, 1, 0.36, 1) forwards;
  animation-delay: var(--rm-delay, 0ms);
}
.rm-error {
  animation: rm-error-in 0.25s ease-out, rm-shake 0.4s ease-in-out 0.05s;
}
.rm-line {
  transform-origin: center;
  animation: rm-line-grow 0.7s cubic-bezier(0.22, 1, 0.36, 1) both;
  animation-delay: var(--rm-delay, 0ms);
}
.rm-press {
  transition: transform 0.15s ease, box-shadow 0.2s ease;
}
.rm-press:not(:disabled):hover {
  transform: translateY(-1px);
  box-shadow: 0 6px 18px -6px rgba(0, 0, 0, 0.35);
}
.rm-press:not(:disabled):active {
  transform: translateY(0) scale(0.98);
}
.rm-field input {
  transition: box-shadow 0.2s ease, border-color 0.2s ease;
}
.rm-field:focus-within label {
  color: var(--primary);
}
.rm-field label {
  transition: color 0.2s ease;
}
@media (prefers-reduced-motion: reduce) {
  .rm-rise, .rm-error, .rm-line {
    animation: none !important;
    opacity: 1 !important;
    transform: none !important;
  }
  .rm-press { transition: none !important; }
}
`;

function delay(ms: number): React.CSSProperties {
  return { ["--rm-delay" as string]: `${ms}ms` } as React.CSSProperties;
}

export default function LoginPage() {
  const router = useRouter();
  const setAccessToken = useAuthStore((state) => state.setAccessToken);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    document.title = "Log in — RecallMeet";

    // Read sessionExpired in an effect (not in a useState initializer). Reading
    // it during the initial render would make the client's first paint differ
    // from the server-rendered HTML and cause React hydration mismatches.
    try {
      if (sessionStorage.getItem("sessionExpired") === "1") {
        sessionStorage.removeItem("sessionExpired");
        // Defer so the update happens after first paint (fixes hydration mismatch
        // and satisfies react-hooks/set-state-in-effect).
        window.setTimeout(() => {
          setError("Your session expired. Please log in again.");
        }, 0);
      }
    } catch {
      // Storage unavailable; skip the info banner.
    }
  }, []);

  const handleGoogleCredential = useCallback(async (credential: string) => {
    setError("");
    setIsLoading(true);
    try {
      const response = await apiClient.post("/api/v1/auth/google", { credential });
      setAccessToken(response.data.access_token);
      router.push("/dashboard");
    } catch (err) {
      const message =
        (isAxiosError(err) ? err.response?.data?.detail : undefined) ||
        "Google sign-in failed. Please try again.";
      setError(message);
      toast.error(message);
    } finally {
      setIsLoading(false);
    }
  }, [router, setAccessToken]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setIsLoading(true);

    try {
      const response = await apiClient.post("/api/v1/auth/login", {
        email,
        password,
      });
      setAccessToken(response.data.access_token);
      router.push("/dashboard");
    } catch (err) {
      const status = isAxiosError(err) ? err.response?.status : undefined;
      const detail = isAxiosError(err) ? err.response?.data?.detail : undefined;
      let message: string;
      if (status === 429) {
        message = "Too many login attempts. Please try again in a few minutes.";
      } else if (Array.isArray(detail)) {
        message = detail[0]?.msg || "Please check your input.";
      } else {
        message =
          detail && typeof detail === "string"
            ? detail
            : "Invalid email or password.";
      }
      setError(message);
      toast.error(message);
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <AuthShell
      title="Log in"
      description="Welcome back — your meeting intelligence is waiting."
      footer={
        <span className="rm-rise inline-block" style={delay(450)}>
          Don&apos;t have an account?{" "}
          <Link
            href="/signup"
            className="font-medium text-primary underline-offset-4 transition-colors hover:underline"
          >
            Sign up
          </Link>
        </span>
      }
    >
      <style>{ANIMATION_CSS}</style>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="rm-rise rm-field flex flex-col gap-2" style={delay(80)}>
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-invalid={!!error}
            required
          />
        </div>

        <div className="rm-rise rm-field flex flex-col gap-2" style={delay(160)}>
          <Label htmlFor="password">Password</Label>
          <PasswordInput
            id="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-invalid={!!error}
            required
          />
        </div>

        {error && (
          // key={error} remounts the node so the shake replays on every new error.
          <p key={error} role="alert" className="rm-error text-sm text-destructive">
            {error}
          </p>
        )}

        <div className="rm-rise" style={delay(240)}>
          <Button
            type="submit"
            disabled={isLoading}
            className={cn("rm-press w-full")}
          >
            {isLoading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> Logging in...
              </>
            ) : (
              "Log in"
            )}
          </Button>
        </div>
      </form>

      <div className="my-4 flex items-center gap-2">
        <div className="rm-line h-px flex-1 bg-border" style={delay(320)} />
        <span
          className="rm-rise text-xs text-muted-foreground"
          style={delay(340)}
        >
          OR
        </span>
        <div className="rm-line h-px flex-1 bg-border" style={delay(320)} />
      </div>

      <div className="rm-rise" style={delay(400)}>
        <GoogleSignIn
          onCredential={handleGoogleCredential}
          isLoading={isLoading}
          label="Sign in with Google"
        />
      </div>
    </AuthShell>
  );
}