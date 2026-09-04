import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

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
    const apiKey = process.env["LOVABLE_API_KEY"];
    if (!apiKey) throw new Error("The AI copilot is not configured for this workspace.");

    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: promptFor(data) },
        ],
      }),
    });

    if (res.status === 429) throw new Error("Copilot rate limit reached — try again in a moment.");
    if (res.status === 402) throw new Error("AI credits are exhausted for this workspace.");
    if (!res.ok) throw new Error(`Copilot request failed (${res.status}).`);

    const json = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const text = json.choices?.[0]?.message?.content?.trim() ?? "";
    if (!text) throw new Error("Copilot returned an empty response.");
    return { mode: data.mode, text };
  });
