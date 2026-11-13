"use client";

import { useState, type FormEvent } from "react";
import { Button } from "./ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { Input } from "./ui/input";
import { Label } from "./ui/label";

type AccessGateProps = {
  configured: boolean;
  onUnlocked: () => void;
  onBack: () => void;
};

/** Asks for the beta access code; the server checks it and sets an httpOnly cookie. */
export function AccessGate({ configured, onUnlocked, onBack }: AccessGateProps) {
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!code.trim()) {
      setError("Enter your access code.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: code.trim() })
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        setError(data?.error ?? "We couldn't check that code. Please try again.");
        return;
      }
      setCode("");
      onUnlocked();
    } catch {
      setError("We couldn't reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="welcome-grid">
      <Card>
        <CardHeader>
          <CardTitle>Enter your access code</CardTitle>
          <CardDescription>
            Agentic Coach is in private beta. Use the access code you were given to continue.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {configured ? (
            <form className="form-grid" onSubmit={submit} noValidate>
              <div className="field">
                <Label htmlFor="access-code">Access code</Label>
                <Input
                  id="access-code"
                  type="password"
                  autoComplete="one-time-code"
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                  aria-invalid={Boolean(error)}
                  aria-describedby={error ? "access-code-error" : undefined}
                />
              </div>
              {error ? (
                <p className="error" id="access-code-error" role="alert">
                  {error}
                </p>
              ) : null}
              <div className="inline-actions">
                <Button type="submit" disabled={busy}>
                  {busy ? "Checking..." : "Continue"}
                </Button>
                <Button type="button" variant="outline" onClick={onBack}>
                  Back
                </Button>
              </div>
            </form>
          ) : (
            <div className="form-grid">
              <p className="error" role="alert">
                Coaching access isn&apos;t set up yet. Please contact the Agentic Coach team.
              </p>
              <div className="inline-actions">
                <Button type="button" variant="outline" onClick={onBack}>
                  Back
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
