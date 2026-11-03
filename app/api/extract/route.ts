import { GoogleGenAI, Type } from "@google/genai";
import { NextResponse } from "next/server";

/** Models tried in order. On transient errors (429/503/404) the next is used. */
const MODEL_FALLBACK_CHAIN = [
  "gemini-3.5-flash-lite", // 1. Extremely light token overhead, highest free RPM, rarely congested
  "gemini-3.6-flash",      // 2. High availability, fast OCR extraction
  "gemini-2.5-flash",      // 3. Reliable rock-solid fallback with separate capacity pool
  "gemini-3.8-flash",      // 4. Latest flagship flash (attempt if earlier versions have regional hiccups)
] as const;

/** Transient HTTP status codes that warrant a fallback retry. */
const RETRYABLE_STATUSES = new Set([429, 503, 404]);

/**
 * Attempt generateContent with each model in the fallback chain.
 * Throws only if every model in the chain fails.
 */
async function generateWithFallback(
  ai: GoogleGenAI,
  cleanBase64: string,
  mimeType: string
): Promise<string> {
  let lastError: unknown;

  for (const model of MODEL_FALLBACK_CHAIN) {
    try {
      const response = await ai.models.generateContent({
        model,
        contents: [
          {
            role: "user",
            parts: [
              {
                inlineData: {
                  data: cleanBase64,
                  mimeType: mimeType || "image/jpeg",
                },
              },
              {
                text: "Analyze this document. Extract the document type (Driving Licence, PUC Certificate, Vehicle Insurance, Passport, or Appliance Warranty) and the exact expiry date (YYYY-MM-DD). If any ID numbers or addresses are visible, ignore them completely.",
              },
            ],
          },
        ],
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              docType: {
                type: Type.STRING,
                description:
                  "Must be one of: Driving Licence, PUC Certificate, Vehicle Insurance, Passport, Appliance Warranty",
              },
              expiryDate: {
                type: Type.STRING,
                description: "Expiry date in YYYY-MM-DD format",
              },
            },
            required: ["docType", "expiryDate"],
          },
        },
      });

      return response.text ?? "{}";
    } catch (err: unknown) {
      lastError = err;

      // Only move to the next model for transient / capacity errors.
      const status =
        err instanceof Error && "status" in err
          ? (err as Error & { status: number }).status
          : undefined;

      const isRetryable =
        status !== undefined
          ? RETRYABLE_STATUSES.has(status)
          : // If we can't read a status, be conservative and retry.
            true;

      if (!isRetryable) throw err;

      console.warn(
        `[extract] Model "${model}" failed (status ${status ?? "unknown"}), trying next fallback.`
      );
    }
  }

  throw lastError;
}

export async function POST(req: Request) {
  // ── 1. Guard: API key must be present ──────────────────────────────────────
  if (!process.env.GEMINI_API_KEY) {
    return NextResponse.json(
      { success: false, error: "GEMINI_API_KEY missing from .env.local" },
      { status: 500 }
    );
  }

  // Instantiate inside the handler so a missing key at module-load time never
  // crashes the server before we can return the helpful 500 above.
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

  try {
    // ── 2. Parse & validate payload ─────────────────────────────────────────
    const body: unknown = await req.json();

    if (
      typeof body !== "object" ||
      body === null ||
      !("imageBase64" in body) ||
      typeof (body as Record<string, unknown>).imageBase64 !== "string"
    ) {
      return NextResponse.json(
        { success: false, error: "No image provided" },
        { status: 400 }
      );
    }

    const { imageBase64, mimeType } = body as {
      imageBase64: string;
      mimeType?: string;
    };

    // ── 3. Strip data URI prefix (e.g. "data:image/jpeg;base64,") ───────────
    const cleanBase64 = imageBase64.includes(",")
      ? imageBase64.split(",")[1]
      : imageBase64;

    // ── 4. Call Gemini with model fallback ──────────────────────────────────
    const rawText = await generateWithFallback(
      ai,
      cleanBase64,
      mimeType ?? "image/jpeg"
    );

    // ── 5. Parse structured response ────────────────────────────────────────
    const parsedData = JSON.parse(rawText) as {
      docType: string;
      expiryDate: string;
    };

    // cleanBase64 is local to this request scope and discarded after return.
    return NextResponse.json({ success: true, data: parsedData });
  } catch (error: unknown) {
    // ── 6. Never suppress: log the real error and surface its message ────────
    console.error("Extract route error:", error);
    const message =
      error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}

// Health-check: GET /api/extract — verifies key + model reachability.
export async function GET() {
  if (!process.env.GEMINI_API_KEY) {
    return NextResponse.json(
      { success: false, error: "GEMINI_API_KEY missing from .env.local" },
      { status: 500 }
    );
  }

  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

  try {
    const response = await ai.models.generateContent({
      model: MODEL_FALLBACK_CHAIN[1],
      contents: 'Reply with the exact JSON: {"status": "API key is working!"}',
    });
    return NextResponse.json({
      success: true,
      keyConfigured: true,
      geminiReply: response.text,
    });
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : String(error);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
