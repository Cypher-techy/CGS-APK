"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Lock, Send } from "lucide-react";

interface Turn {
  role: "user" | "assistant";
  content: string;
  sources?: { id: string; title: string; type: string; readable: boolean }[];
}

const STARTERS = [
  "Explain a concept from my notes in simple terms",
  "Summarise the key points of a topic",
  "Give me five practice questions with answers",
  "Help me make a revision plan",
];

/** Chat with the study assistant. Answers stream in; the portal items used as sources are listed under each answer. */
export function AssistantChat({ departmentName, maxTurns, maxChars }: { departmentName: string; maxTurns: number; maxChars: number }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [turns]);

  async function ask(question: string) {
    const text = question.trim();
    if (!text || busy) return;
    setError("");
    setBusy(true);
    setDraft("");
    const history: Turn[] = [...turns, { role: "user", content: text }];
    setTurns([...history, { role: "assistant", content: "" }]);
    try {
      // Only the most recent turns are sent, within the server's limit, always starting with a question.
      let recent = history.slice(-maxTurns);
      if (recent[0].role !== "user") recent = recent.slice(1);
      const response = await fetch("/api/ferd/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: recent.map(({ role, content }) => ({ role, content })) }),
      });
      if (!response.ok || !response.body) {
        const problem = (await response.json().catch(() => null)) as { error?: string } | null;
        setTurns(history.slice(0, -1));
        setDraft(text);
        setError(problem?.error ?? "The assistant could not be reached.");
        return;
      }
      let sources: Turn["sources"] = [];
      try {
        sources = JSON.parse(atob(response.headers.get("X-Ferd-Sources") ?? "") || "[]");
      } catch {}
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let answer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        answer += decoder.decode(value, { stream: true });
        setTurns([...history, { role: "assistant", content: answer, sources }]);
      }
      if (!answer.trim()) setTurns([...history, { role: "assistant", content: "No answer was returned. Please try again.", sources }]);
    } catch {
      setError("The connection was lost. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    void ask(draft);
  }

  return (
    <div className="card flex h-[min(72vh,44rem)] flex-col overflow-hidden">
      <div className="flex-1 space-y-4 overflow-y-auto p-4 sm:p-6" aria-live="polite">
        {turns.length === 0 && (
          <div className="mx-auto max-w-xl py-6 text-center">
            <p className="font-display text-xl font-bold text-white">Ask about your {departmentName} materials</p>
            <p className="mt-2 text-sm text-muted-grey">
              The assistant reads what your department has published on this portal and that you have access to, and tells you which item an answer came from.
            </p>
            <div className="mt-5 flex flex-wrap justify-center gap-2">
              {STARTERS.map((starter) => (
                <button key={starter} type="button" onClick={() => setDraft(starter)} className="rounded-full border border-subtle-border bg-white/5 px-3 py-1.5 text-xs text-charcoal hover:border-[var(--ferd-accent)]">
                  {starter}
                </button>
              ))}
            </div>
          </div>
        )}
        {turns.map((turn, i) => (
          <div key={i} className={turn.role === "user" ? "flex justify-end" : ""}>
            <div className={turn.role === "user" ? "max-w-[85%] rounded-3xl rounded-br-md bg-white px-4 py-2.5 text-sm text-night" : "max-w-[92%] text-sm text-charcoal"}>
              <p className="whitespace-pre-wrap leading-relaxed">{turn.content || (busy && i === turns.length - 1 ? "Thinking…" : "")}</p>
              {turn.role === "assistant" && turn.sources && turn.content && (
                <p className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-subtle-border pt-2 text-xs text-muted-grey">
                  {turn.sources.length === 0 ? (
                    "No portal material matched this question: the answer is general knowledge, not your department's notes."
                  ) : (
                    <>
                      Portal material given to the assistant:
                      {turn.sources.map((source) => (
                        <Link key={source.id} href={`/ferd/content/${source.id}`} className="inline-flex items-center gap-1 rounded-full border border-subtle-border px-2 py-0.5 text-charcoal hover:border-[var(--ferd-accent)]">
                          {!source.readable && <Lock className="h-3 w-3 text-amber-200" aria-label="Premium, locked" />}
                          {source.title}
                        </Link>
                      ))}
                    </>
                  )}
                </p>
              )}
            </div>
          </div>
        ))}
        <div ref={end} />
      </div>
      {error && <p className="alert alert-error mx-4 mb-2" role="alert">{error}</p>}
      <form onSubmit={submit} className="flex items-end gap-2 border-t border-subtle-border p-3 sm:p-4">
        <label className="flex-1">
          <span className="sr-only">Your question</span>
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void ask(draft);
              }
            }}
            rows={2}
            maxLength={maxChars}
            placeholder="Ask a question about your course material"
            className="input resize-none"
            disabled={busy}
          />
        </label>
        <button type="submit" className="btn btn-accent h-10" disabled={busy || !draft.trim()} aria-label="Send question">
          <Send className="h-4 w-4" />
        </button>
      </form>
    </div>
  );
}
