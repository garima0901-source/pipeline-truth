// Vercel serverless function: turns aggregated pipeline statistics into a short CRO brief.
// It never receives deal rows, deal names, accounts or rep names (the browser sends labels like "Rep A").
import Anthropic from "@anthropic-ai/sdk";

const SYSTEM = `You are a senior RevOps analyst. You receive aggregated statistics from a CRM pipeline data-quality check and write a brief a CRO can read in 30 seconds.

Rules:
- Use only the numbers in the data. Do not invent causes, deals, people or benchmarks. If you suggest a likely cause, say it is a possibility.
- Refer to reps only by the labels given (e.g. "Rep A").
- Money: use the currency symbol given and compact numbers (e.g. $1.2M).
- Format: plain text, no headings, no bold, no tables.
  1. Two sentences: overall data health and what it means for the forecast.
  2. A blank line, then 3 to 5 lines that each start with "- ", each with one number and one concrete action for this week.
  3. A blank line, then one line starting "Biggest single fix:".
- Under 170 words.
- If checks were not measured, mention in one short clause that the score may be optimistic.`;

// Keep only plain data: numbers, booleans, short strings, small arrays/objects.
function clean(v, depth = 0) {
  if (depth > 4) return null;
  if (v === null || typeof v === "boolean") return v;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") return v.slice(0, 60);
  if (Array.isArray(v)) return v.slice(0, 20).map((x) => clean(x, depth + 1));
  if (typeof v === "object") {
    const out = {};
    for (const k of Object.keys(v).slice(0, 30)) out[k.slice(0, 40)] = clean(v[k], depth + 1);
    return out;
  }
  return null;
}

const client = new Anthropic();

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST." });
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(503).json({ error: "The AI brief isn't switched on for this deployment." });
  }

  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch { return res.status(400).json({ error: "Invalid JSON." }); }
  }
  const stats = clean(body && body.stats);
  const json = JSON.stringify(stats);
  if (!stats || typeof stats !== "object" || json.length > 12000) {
    return res.status(400).json({ error: "Expected a small 'stats' object." });
  }

  try {
    const msg = await client.beta.messages.create({
      model: "claude-opus-5-5",
      max_tokens: 2000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low" },
      system: SYSTEM,
      messages: [{ role: "user", content: `Pipeline data-quality statistics (JSON):\n${json}` }],
    });
    if (msg.stop_reason === "refusal") {
      return res.status(422).json({ error: "The model declined to write this brief." });
    }
    const text = msg.content.filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
    if (!text) return res.status(502).json({ error: "The model returned an empty brief." });
    return res.status(200).json({ text });
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) return res.status(429).json({ error: "Too many requests right now. Try again in a minute." });
    if (err instanceof Anthropic.APIError) return res.status(502).json({ error: "The AI service returned an error." });
    return res.status(500).json({ error: "Something went wrong writing the brief." });
  }
}
