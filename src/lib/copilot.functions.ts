import { createServerFn } from "@tanstack/react-start";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const MODEL = "claude-opus-5";

const inputSchema = z.object({
  mode: z.enum(["insight", "reply", "article"]),
  subject: z.string().max(400),
  priority: z.string().max(8).default("P3"),
  customer: z.string().max(160).default(""),
  transcript: z.string().max(12000),
  knowledge: z.string().max(8000).default(""),
  instruction: z.string().max(600).default(""),
});

type CopilotInput = z.infer<typeof inputSchema>;

const SYSTEM = `You are the copilot inside a B2B support desk. You are concise, concrete and never invent product facts.
Write in plain text. No markdown headers, no emoji, no filler like "Certainly".`;

function promptFor(data: CopilotInput) {
  const context = [
    `Ticket subject: ${data.subject}`,
    `Priority: ${data.priority}`,
    data.customer ? `Account: ${data.customer}` : "",
    "",
    "Conversation so far:",
    data.transcript || "(no messages yet)",
    data.knowledge ? `\nRelevant knowledge base excerpts:\n${data.knowledge}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  if (data.mode === "insight") {
    return `${context}

Return exactly this shape, nothing else:
SUMMARY: <two sentences on what the customer needs and where the thread stands>
SENTIMENT: <one word: calm, neutral, frustrated or angry>
RISK: <one short line on SLA/escalation risk>
NEXT: <three numbered next actions for the agent, each under 14 words, on one line separated by " | ">`;
  }

  if (data.mode === "reply") {
    return `${context}

${data.instruction ? `Agent guidance: ${data.instruction}\n` : ""}Draft the next agent reply to the customer. Acknowledge the specific problem, state what has been done or is needed, and end with one clear next step or question. 120 words maximum. Sign off as "Support team". Return only the reply body.`;
  }

  return `${context}

Turn this resolved ticket into a reusable knowledge base article. Return exactly:
TITLE: <under 70 characters, problem-oriented>
SUMMARY: <one sentence>
TAGS: <3 comma-separated lowercase tags>
BODY: <the article: a Cause section, a numbered Resolution, and a short Prevention note. Use markdown headings like "## Cause".>`;
}

export const askCopilot = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => inputSchema.parse(data))
  .handler(async ({ data }) => {
    const apiKey = process.env["ANTHROPIC_API_KEY"];
    if (!apiKey) throw new Error("The AI copilot is not configured for this workspace.");

    const client = new Anthropic({ apiKey });

    try {
      const response = await client.messages.create({
        model: MODEL,
        max_tokens: 4096,
        output_config: { effort: "medium" },
        system: SYSTEM,
        messages: [{ role: "user", content: promptFor(data) }],
      });

      const text = response.content
        .filter((block): block is Anthropic.TextBlock => block.type === "text")
        .map((block) => block.text)
        .join("")
        .trim();

      if (!text) throw new Error("Copilot returned an empty response.");
      return { mode: data.mode, text };
    } catch (error) {
      if (error instanceof Anthropic.RateLimitError) {
        throw new Error("Copilot rate limit reached — try again in a moment.");
      }
      if (error instanceof Anthropic.PermissionDeniedError) {
        throw new Error(
          error.type === "billing_error"
            ? "AI credits are exhausted for this workspace."
            : "The AI copilot does not have permission to run.",
        );
      }
      if (error instanceof Anthropic.AuthenticationError) {
        throw new Error("The AI copilot is not configured correctly for this workspace.");
      }
      if (error instanceof Anthropic.APIError) {
        throw new Error(`Copilot request failed (${error.status}).`);
      }
      throw error;
    }
  });
