"use client";

import { useActionState, useEffect, useRef, startTransition, type FormEvent, type ReactNode } from "react";
import type { ActionState } from "@/lib/types";

type Action = (state: ActionState, formData: FormData) => Promise<ActionState>;

/**
 * Form bound to a server action. Shows the action's success or error message,
 * disables its controls while the request is in flight and keeps the user's
 * input when validation fails.
 */
export function ActionForm({
  action,
  children,
  className,
  submitLabel,
  submitClass = "btn btn-primary",
  confirm,
  resetOnSuccess = true,
}: {
  action: Action;
  children?: ReactNode;
  className?: string;
  /** Renders a submit button. Omit when the children provide their own buttons. */
  submitLabel?: string;
  submitClass?: string;
  /** Ask for confirmation before submitting (destructive actions). */
  confirm?: string;
  resetOnSuccess?: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state?.ok && resetOnSuccess) formRef.current?.reset();
  }, [state, resetOnSuccess]);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (confirm && !window.confirm(confirm)) return;
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    const formData = new FormData(event.currentTarget, submitter);
    startTransition(() => formAction(formData));
  }

  return (
    <form ref={formRef} onSubmit={onSubmit} className={className} noValidate={false}>
      <fieldset disabled={pending} className="contents">
        {children}
        {submitLabel && (
          <button type="submit" className={submitClass}>
            {pending ? "Working…" : submitLabel}
          </button>
        )}
      </fieldset>
      {state && (
        <p role="status" className={`alert mt-3 ${state.ok ? "alert-success" : "alert-error"}`}>
          {state.message}
        </p>
      )}
    </form>
  );
}
