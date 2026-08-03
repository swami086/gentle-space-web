async function call(label: string, body: Record<string, unknown>) {
  const base = (process.env.BIFROST_BASE_URL || "http://localhost:8080").replace(/\/$/, "");
  const res = await fetch(`${base}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  console.log(`\n=== ${label} ===`);
  console.log("status:", res.status);
  console.log(text.slice(0, 800));
  if (!res.ok) process.exitCode = 1;
}

async function main() {
  await call("cheap / simple", {
    model: "vertex/gemini-2.5-flash-lite",
    messages: [{ role: "user", content: "Say hello in one short sentence." }],
    max_tokens: 40,
    fallbacks: ["vertex/gemini-2.5-flash", "vertex/gemini-2.5-pro"],
  });

  await call("complex-ish prompt (routing may escalate)", {
    model: "vertex/gemini-2.5-flash-lite",
    messages: [
      {
        role: "user",
        content:
          "Draft a campaign architecture tradeoffs analysis step by step for Bangalore office RSA headlines and descriptions, including CPL budget constraints.",
      },
    ],
    max_tokens: 200,
    fallbacks: ["vertex/gemini-2.5-flash", "vertex/gemini-2.5-pro"],
  });

  await call("json_schema controlled generation", {
    model: "vertex/gemini-2.5-flash-lite",
    messages: [{ role: "user", content: 'Return JSON with assistantReply="ok" and headlines=["Hello Bangalore Office"].' }],
    max_tokens: 200,
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "draft",
        schema: {
          type: "object",
          properties: {
            assistantReply: { type: "string" },
            headlines: { type: "array", items: { type: "string" } },
          },
          required: ["assistantReply"],
        },
      },
    },
    fallbacks: ["vertex/gemini-2.5-flash", "vertex/gemini-2.5-pro"],
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
