import { withMinibodyGuardrail, withSketchGuardrail } from "@/lib/prompts";

/**
 * Gemini 2.5 Flash Image — REST fetch (no SDK).
 * Server-only — do not import from client components.
 */

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_ENDPOINT =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent";

type GeminiPart = {
  text?: string;
  inlineData?: { mimeType?: string; data?: string };
  inline_data?: { mime_type?: string; data?: string };
};

function isTransientGeminiError(status: number, message: string): boolean {
  if (status === 503 || status === 500) return true;
  return /high demand|try again later|temporarily|unavailable/i.test(message);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Call Gemini 2.5 Flash Image and return a PNG data URL. Shared by every
 * image-transform stage (sketch, minibody) — only the prompt differs.
 * Retries a few times on transient capacity / high-demand errors.
 * @param imageBase64 - raw base64 (no data: prefix)
 * @param mimeType - e.g. "image/jpeg"
 * @param promptText - generation instructions
 */
async function callGeminiImageEdit(
  imageBase64: string,
  mimeType: string,
  promptText: string
): Promise<string> {
  if (!GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is not set in environment");
  }

  const maxAttempts = 3;
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const res = await fetch(`${GEMINI_ENDPOINT}?key=${GEMINI_API_KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: promptText },
              {
                inline_data: {
                  mime_type: mimeType,
                  data: imageBase64,
                },
              },
            ],
          },
        ],
      }),
    });

    const json = await res.json();

    if (!res.ok) {
      const raw =
        json?.error?.message ||
        json?.error?.status ||
        `Gemini API error (${res.status})`;

      // Google returns 429 with "limit: 0" when image models aren't enabled
      // for this project — usually missing billing, not actual overuse.
      if (
        res.status === 429 &&
        /limit:\s*0/i.test(raw) &&
        /free_tier/i.test(raw)
      ) {
        throw new Error(
          "Gemini image generation isn’t available on this API key’s free tier (quota limit is 0 — not that you used it up). " +
            "Enable billing on the Google AI Studio / Cloud project that owns this key, then try again. " +
            "See https://ai.google.dev/gemini-api/docs/rate-limits"
        );
      }

      lastError = new Error(raw);
      if (attempt < maxAttempts && isTransientGeminiError(res.status, raw)) {
        await sleep(1500 * attempt);
        continue;
      }
      throw lastError;
    }

    const parts: GeminiPart[] =
      json?.candidates?.[0]?.content?.parts ?? [];

    for (const part of parts) {
      const inline = part.inlineData ?? part.inline_data;
      const data = inline?.data;
      if (data) {
        return `data:image/png;base64,${data}`;
      }
    }

    const blockReason =
      json?.candidates?.[0]?.finishReason ||
      json?.promptFeedback?.blockReason;
    throw new Error(
      blockReason
        ? `No image in Gemini response (finish/block: ${blockReason})`
        : "No image part found in Gemini response — expected inlineData.data in candidates[0].content.parts"
    );
  }

  throw lastError ?? new Error("Gemini request failed");
}

export async function generateSketch(
  imageBase64: string,
  mimeType: string,
  promptText: string
): Promise<string> {
  return callGeminiImageEdit(
    imageBase64,
    mimeType,
    withSketchGuardrail(promptText)
  );
}

export async function generateMinibody(
  imageBase64: string,
  mimeType: string,
  promptText: string
): Promise<string> {
  return callGeminiImageEdit(
    imageBase64,
    mimeType,
    withMinibodyGuardrail(promptText)
  );
}

export function isGeminiConfigured(): boolean {
  return Boolean(GEMINI_API_KEY);
}
