"use client";

import { useActionState } from "react";
import { signIn, type LoginState } from "./actions";

export interface LoginLabels {
  email: string;
  password: string;
  submit: string;
  submitting: string;
  errors: Record<NonNullable<LoginState["error"]>, string>;
}

export default function LoginForm({ labels, initialError }: { labels: LoginLabels; initialError: LoginState["error"] }) {
  const [state, action, pending] = useActionState(signIn, { error: initialError, email: "" });

  return (
    <form action={action} noValidate>
      {state.error ? (
        <p className="cp-alert cp-alert-error" role="alert">
          {labels.errors[state.error]}
        </p>
      ) : null}
      <label className="cp-field">
        <span className="erp-label">{labels.email}</span>
        <input className="cp-input" name="email" type="email" autoComplete="username" defaultValue={state.email} required />
      </label>
      <label className="cp-field">
        <span className="erp-label">{labels.password}</span>
        <input className="cp-input" name="password" type="password" autoComplete="current-password" required />
      </label>
      <button className="cp-button" type="submit" disabled={pending}>
        {pending ? labels.submitting : labels.submit}
      </button>
    </form>
  );
}
