export interface GenerateEmailDraftParams {
  ticketNumber: string;
  type: string; // INQUIRY, COMPLAINT, FEEDBACK, GRIEVANCE, SUPPORT
  customerName: string;
  customerEmail: string;
  subject: string;
  message: string;
  roughNotes?: string;
  tone?: "PROFESSIONAL" | "EMPATHETIC" | "TECHNICAL" | "CLOSURE";
}

export interface GeneratedEmailDraft {
  subject: string;
  greeting: string;
  bodyHtml: string;
  bodyText: string;
  keyHighlights: string[];
}

const GEMINI_MODELS = ["gemini-3.7-flash", "gemini-3.5-flash-lite", "gemini-3.6-flash"];

/**
 * Call Gemini API with automatic fallback across supported high-speed models
 */
async function callGeminiApi(prompt: string, apiKey: string): Promise<string> {
  let lastError: Error | null = null;

  for (const model of GEMINI_MODELS) {
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
              temperature: 0.35, // Balanced between natural human empathy and structural consistency
              maxOutputTokens: 2048,
              responseMimeType: "application/json",
            },
          }),
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        console.warn(`[GeminiEmailService] Model ${model} returned ${response.status}:`, errorText.slice(0, 150));
        lastError = new Error(`Gemini API ${model} failed (${response.status})`);
        continue; // Try next fallback model
      }

      const data = await response.json();
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (text) {
        return text;
      }
    } catch (err: any) {
      console.warn(`[GeminiEmailService] Request to ${model} threw:`, err.message);
      lastError = err;
    }
  }

  throw lastError || new Error("Failed to generate response from all available Gemini models");
}

/**
 * Generate an executive, anti-spam, tailored customer email response draft
 */
export async function generateExecutiveEmailDraft(
  params: GenerateEmailDraftParams
): Promise<GeneratedEmailDraft> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not configured on the server.");
  }

  const toneInstruction = getToneGuidelines(params.tone || "PROFESSIONAL", params.type);

  const prompt = `You are the Senior Client Director & Executive Communications Lead at NVIT.SPACE (a premier Digital Engineering, Financial Technology & Lending Solutions Studio, URL: https://nvit.space).

Your responsibility is to craft a personal, authentic, articulate, and empathetic email reply to a customer.

CUSTOMER & TICKET CONTEXT:
- Reference ID: ${params.ticketNumber}
- Category/Type: ${params.type}
- Customer Name: ${params.customerName}
- Customer Email: ${params.customerEmail}
- Original Subject: "${params.subject}"
- Original Message/Concern:
"""
${params.message}
"""

ADMIN'S INTERNAL NOTES / SPECIFIC INSTRUCTIONS FOR THIS REPLY:
${params.roughNotes ? `"""${params.roughNotes}"""` : "(No specific instructions provided — craft a thorough, helpful, and courteous response addressing their query directly)"}

TONE REQUIREMENTS:
${toneInstruction}

STRICT ANTI-SPAM & PROFESSIONALISM CRITERIA:
1. NEVER sound like a generic automated template or marketing blast. Absolutely ZERO marketing buzzwords (e.g. do NOT say "synergy", "game-changing", "revolutionary", "esteemed customer").
2. Sound like a dedicated human engineering/client partner writing personally from their office at NVIT.SPACE.
3. Reference specific details from the customer's query so they know a real human read their message carefully.
4. If admin provided rough notes, integrate all those points smoothly and naturally into the narrative.
5. Provide clear, concrete next steps or timelines (e.g. scheduled review, direct consultation, resolution tracking).
6. Sign off professionally:
   "Warm regards,
   Nishant Bhardwaj & The NVIT.SPACE Client Team
   NVIT.SPACE Digital Solutions | https://nvit.space"

OUTPUT FORMAT:
Respond with ONLY a valid JSON object matching this schema (do NOT wrap with markdown fences \`\`\`json):
{
  "subject": "Clear, contextual subject line referencing their topic and [Ref: ${params.ticketNumber}]",
  "greeting": "Dear ${params.customerName.split(" ")[0] || params.customerName},",
  "bodyHtml": "<p>Clean HTML paragraphs...</p>",
  "bodyText": "Plain text version with polite paragraphs and bullet points where applicable.",
  "keyHighlights": [
    "Key takeaway 1 (e.g. Technical review scheduled for Tuesday)",
    "Key takeaway 2 (e.g. Reference number active in tracker)",
    "Key takeaway 3"
  ]
}`;

  const rawJson = await callGeminiApi(prompt, apiKey);

  // Clean any markdown formatting if present
  const cleanedJson = rawJson
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  try {
    const parsed = JSON.parse(cleanedJson) as GeneratedEmailDraft;
    return {
      subject: parsed.subject || `Re: [Ref: ${params.ticketNumber}] Update on your inquiry`,
      greeting: parsed.greeting || `Dear ${params.customerName},`,
      bodyHtml: parsed.bodyHtml || `<p>${parsed.bodyText?.replace(/\n\n/g, "</p><p>") || "Thank you for reaching out."}</p>`,
      bodyText: parsed.bodyText || "Thank you for reaching out. We have reviewed your request.",
      keyHighlights: parsed.keyHighlights || ["Inquiry acknowledged", "Next steps defined"],
    };
  } catch (parseError: any) {
    console.error("[GeminiEmailService] Failed to parse Gemini response as JSON:", rawJson.slice(0, 200));
    throw new Error("Gemini returned invalid draft format. Please try again.");
  }
}

function getToneGuidelines(tone: string, ticketType: string): string {
  switch (tone) {
    case "EMPATHETIC":
      return `- Tone: Genuine Empathy, Respectful, Apologetic if an issue was faced, Reassuring.
- Acknowledge any inconvenience with sincere humility. Assure the customer that their peace of mind is prioritized.`;

    case "TECHNICAL":
      return `- Tone: Highly Articulate, Objective, Engineering-Focused, Clear & Transparent.
- Break down the architecture, requirements, or technical reasons with clarity without patronizing jargon.`;

    case "CLOSURE":
      return `- Tone: Conclusive, Courteous, Celebratory of Resolution, Forward-Looking.
- Confirm all action items are completed, invite further questions if needed, and thank them warmly for their collaboration.`;

    case "PROFESSIONAL":
    default:
      return ticketType === "INQUIRY" || ticketType === "ENQUIRY"
        ? `- Tone: Executive, Welcoming, Strategic, Consultative.
- Show enthusiasm about their business goals, clarify our digital capabilities, and propose concrete collaboration steps.`
        : `- Tone: Executive, Calm, Diligent, Action-Oriented.
- Validate their feedback directly and outline specific milestones for addressal.`;
  }
}
