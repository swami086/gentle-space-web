import { getVertexAccessToken } from "./auth";

function projectId(): string {
  const id = process.env.GOOGLE_CLOUD_PROJECT;
  if (!id) throw new Error("GOOGLE_CLOUD_PROJECT is not set");
  return id;
}

function location(): string {
  return process.env.GOOGLE_CLOUD_LOCATION || "us-central1";
}

function chatModel(): string {
  return process.env.VERTEX_CHAT_MODEL || "gemini-2.5-flash-lite";
}

function modelUrl(model: string): string {
  const base = `https://${location()}-aiplatform.googleapis.com/v1`;
  return `${base}/projects/${projectId()}/locations/${location()}/publishers/google/models/${model}:generateContent`;
}

/** Returns true once both env vars needed to call Vertex AI are set. */
export function isVertexConfigured(): boolean {
  return Boolean(process.env.GOOGLE_CLOUD_PROJECT?.trim() && process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim());
}

export type GeminiPart =
  | { text: string }
  | { functionCall: { name: string; args: Record<string, unknown> } }
  | { functionResponse: { name: string; response: Record<string, unknown> } };

export type GeminiContent = { role: "user" | "model"; parts: GeminiPart[] };

export type FunctionDeclaration = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

export type GenerateContentOptions = {
  systemInstruction?: string;
  contents: GeminiContent[];
  tools?: FunctionDeclaration[];
  /** "any" forces a function call every turn (no plain-text-only replies); default is "auto". */
  toolChoice?: "auto" | "any";
  temperature?: number;
  maxOutputTokens?: number;
  responseMimeType?: "text/plain" | "application/json";
  timeoutMs?: number;
};

export type GeminiResponse = {
  candidates?: { content?: { role?: string; parts?: GeminiPart[] } }[];
};

export async function generateContent(options: GenerateContentOptions): Promise<GeminiResponse> {
  const token = await getVertexAccessToken();
  const res = await fetch(modelUrl(chatModel()), {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      ...(options.systemInstruction
        ? { systemInstruction: { parts: [{ text: options.systemInstruction }] } }
        : {}),
      contents: options.contents,
      ...(options.tools ? { tools: [{ functionDeclarations: options.tools }] } : {}),
      ...(options.toolChoice === "any"
        ? { toolConfig: { functionCallingConfig: { mode: "ANY" } } }
        : {}),
      generationConfig: {
        temperature: options.temperature ?? 0.3,
        maxOutputTokens: options.maxOutputTokens ?? 600,
        ...(options.responseMimeType ? { responseMimeType: options.responseMimeType } : {}),
      },
    }),
    signal: options.timeoutMs ? AbortSignal.timeout(options.timeoutMs) : undefined,
  });
  if (!res.ok) {
    throw new Error(`vertex generateContent failed: ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as GeminiResponse;
}

export function firstTextPart(response: GeminiResponse): string | undefined {
  const parts = response.candidates?.[0]?.content?.parts ?? [];
  for (const part of parts) {
    if ("text" in part && part.text) return part.text.trim();
  }
  return undefined;
}

export function firstFunctionCall(
  response: GeminiResponse,
  name: string,
): { name: string; args: Record<string, unknown> } | undefined {
  const parts = response.candidates?.[0]?.content?.parts ?? [];
  for (const part of parts) {
    if ("functionCall" in part && part.functionCall.name === name) return part.functionCall;
  }
  return undefined;
}

export function responseParts(response: GeminiResponse): GeminiPart[] {
  return response.candidates?.[0]?.content?.parts ?? [];
}
