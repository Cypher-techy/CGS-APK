import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { adminConfigured, createAdminClient } from "@/lib/supabase/admin";
import { ASSISTANT_LIMITS, assistantConfig, findSources, systemPrompt, withSources } from "@/modules/ferd/assistant";
import { getFerdSession } from "@/modules/ferd/session";

// Answers stream for up to two minutes; the default serverless limit would cut long answers off.
export const maxDuration = 120;

const body = z.object({
  messages: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().trim().min(1).max(ASSISTANT_LIMITS.maxMessageChars) }))
    .min(1)
    .max(ASSISTANT_LIMITS.maxTurns),
});
const deny = (status: number, message: string) => NextResponse.json({ error: message }, { status });

type GeminiChunk = {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> }; finishReason?: string }>;
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number };
};

/**
 * FERD study assistant. Verified students (and staff previewing) only, with the module switched on for
 * their department. The answer is streamed as plain text; the titles of the portal items given to
 * the model travel in the X-Ferd-Sources header. The API key stays on the server.
 */
export async function POST(request: NextRequest) {
  const session = await getFerdSession();
  if (!session) return deny(401, "Authentication required");
  const { supabase, user, student, role, departments, staffDepartmentId } = session;
  const department = student?.status === "verified"
    ? departments.find((d) => d.id === student.department_id)
    : role
      ? (departments.find((d) => d.id === staffDepartmentId) ?? departments[0])
      : undefined;
  if (!department) return deny(403, "The study assistant is for verified students.");

  const [{ data: module }, { data: override }] = await Promise.all([
    supabase.from("ferd_modules").select("is_enabled").eq("key", "assistant").maybeSingle(),
    supabase.from("ferd_department_modules").select("is_enabled").eq("department_id", department.id).eq("module_key", "assistant").maybeSingle(),
  ]);
  if (!module?.is_enabled || override?.is_enabled === false) return deny(404, "The study assistant is not available for your department.");

  const config = assistantConfig();
  if (!config.configured || !adminConfigured()) return deny(503, "The study assistant is not set up on this server yet.");

  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return deny(400, `Send between 1 and ${ASSISTANT_LIMITS.maxTurns} messages of at most ${ASSISTANT_LIMITS.maxMessageChars} characters each.`);
  const history = parsed.data.messages;
  const last = history[history.length - 1];
  if (last.role !== "user" || history[0].role !== "user") return deny(400, "The conversation must start and end with your own message.");

  // Rate limits, counted from the usage log.
  const admin = createAdminClient();
  const since = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
  const count = async (minutes: number) =>
    (await admin.from("ferd_assistant_usage").select("id", { count: "exact", head: true }).eq("user_id", user.id).gte("created_at", since(minutes))).count ?? 0;
  const [day, burst] = await Promise.all([count(24 * 60), count(10)]);
  if (day >= ASSISTANT_LIMITS.perDay) return deny(429, `You have reached today's limit of ${ASSISTANT_LIMITS.perDay} questions. It resets over the next 24 hours.`);
  if (burst >= ASSISTANT_LIMITS.perTenMinutes) return deny(429, "You are asking questions very quickly. Please wait a few minutes.");

  // Only material this user may read is retrieved under their own database permissions.
  const sources = await findSources(supabase, department.id, last.content);
  const messages = [...history.slice(0, -1), { role: "user" as const, content: withSources(last.content, sources) }];
  // The request is recorded before the model is called, so a dropped connection still counts.
  const { data: usage } = await admin.from("ferd_assistant_usage").insert({ user_id: user.id, source_count: sources.length }).select("id").single();

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return deny(503, "The study assistant is not set up on this server yet.");

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const say = (text: string) => controller.enqueue(encoder.encode(text));
      try {
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.model)}:streamGenerateContent?alt=sse`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
            body: JSON.stringify({
              systemInstruction: { parts: [{ text: systemPrompt(department) }] },
              contents: messages.map((message) => ({
                role: message.role === "assistant" ? "model" : "user",
                parts: [{ text: message.content }],
              })),
              generationConfig: { maxOutputTokens: 8192, temperature: 0.4 },
            }),
            cache: "no-store",
          },
        );

        if (!response.ok) {
          // Log only the HTTP status, never the key or the provider's raw response.
          console.error("FERD Gemini request failed: status", response.status);
          if (response.status === 429) say("\n\nThe assistant is busy right now. Please try again in a minute.");
          else if (response.status === 400) say("\n\nThe assistant request was rejected. Check the configured Gemini model and request settings.");
          else if (response.status === 401 || response.status === 403) say("\n\nThe assistant is not configured correctly on this server. Please tell FERD support.");
          else say("\n\nThe assistant could not complete the answer. Please try again.");
          return;
        }
        if (!response.body) {
          say("\n\nThe assistant returned no response stream. Please try again.");
          return;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let inputTokens = 0;
        let outputTokens = 0;
        let finishReason = "";
        const processLine = (line: string) => {
          if (!line.startsWith("data:")) return;
          const payload = line.slice(5).trim();
          if (!payload || payload === "[DONE]") return;
          try {
            const chunk = JSON.parse(payload) as GeminiChunk;
            const candidate = chunk.candidates?.[0];
            const text = candidate?.content?.parts?.map((part) => part.text ?? "").join("") ?? "";
            if (text) say(text);
            if (candidate?.finishReason) finishReason = candidate.finishReason;
            if (chunk.usageMetadata) {
              inputTokens = chunk.usageMetadata.promptTokenCount ?? inputTokens;
              outputTokens = chunk.usageMetadata.candidatesTokenCount ?? outputTokens;
            }
          } catch {
            // Ignore an incomplete or non-JSON SSE line; the buffer is processed line by line.
          }
        };

        for (;;) {
          const { done, value } = await reader.read();
          buffer += decoder.decode(value, { stream: !done });
          const lines = buffer.split(/\r?\n/);
          buffer = lines.pop() ?? "";
          for (const line of lines) processLine(line);
          if (done) break;
        }
        if (buffer.trim()) processLine(buffer);
        if (finishReason === "MAX_TOKENS") say("\n\n[The answer was cut off because it reached the length limit. Ask for the rest.]");
        if (usage) {
          await admin.from("ferd_assistant_usage").update({
            input_tokens: inputTokens || null,
            output_tokens: outputTokens || null,
          }).eq("id", usage.id);
        }
      } catch (error) {
        console.error("FERD Gemini assistant failed:", error instanceof Error ? error.name : "unknown");
        say("\n\nThe connection to the assistant was lost. Please try again.");
      } finally {
        controller.close();
      }
    },
  });

  const listed = sources.map((s) => ({ id: s.id, title: s.title, type: s.type, readable: s.readable }));
  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Ferd-Sources": Buffer.from(JSON.stringify(listed)).toString("base64"),
    },
  });
}
