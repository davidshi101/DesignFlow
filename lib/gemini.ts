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

/**
 * Call Gemini 2.5 Flash Image and return a PNG data URL. Shared by every
 * image-transform stage (sketch, minibody) — only the prompt differs.
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

    throw new Error(raw);
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

export async function generateSketch(
  imageBase64: string,
  mimeType: string,
  promptText: string
): Promise<string> {
  return callGeminiImageEdit(imageBase64, mimeType, promptText);
}

export async function generateMinibody(
  imageBase64: string,
  mimeType: string,
  promptText: string
): Promise<string> {
  return callGeminiImageEdit(imageBase64, mimeType, promptText);
}

export function isGeminiConfigured(): boolean {
  return Boolean(GEMINI_API_KEY);
}

/** Parse a data URL into raw base64 + mime type */
export function parseDataUrl(dataUrl: string): {
  mimeType: string;
  base64: string;
} {
  const match = /^data:([^;]+);base64,([\s\S]+)$/.exec(dataUrl);
  if (!match) {
    throw new Error("Invalid data URL — expected data:<mime>;base64,<data>");
  }
  return { mimeType: match[1], base64: match[2] };
}
