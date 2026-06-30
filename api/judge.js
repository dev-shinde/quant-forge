// Vercel serverless function — POST /api/judge
// Reads ANTHROPIC_API_KEY from the environment. The key never reaches the browser.
// Returns: { correct:boolean, verdict:string, hint:string, tags:string[] }

const MODEL = "claude-sonnet-4-6";

// Cached grading rubric (module scope = reused across warm invocations).
const RUBRIC = `You are a rigorous interview coach grading a candidate's METHOD, not just the final number.
The candidate is prepping for data/analytics/quant interview rounds and aptitude OAs.

Grade by REASONING quality, catching conceptual errors even when the final answer happens to be right,
and flagging a wrong method even when the number is close. For SQL, judge correctness against the
expected result and call out Postgres-vs-MySQL dialect traps. Give a Socratic, first-principles
verdict: name what they did well, pinpoint the single most important error, and offer ONE progressive
hint that nudges without handing over the answer.

You MUST return tags from this CLOSED vocabulary only (category:topic). Tag every genuine weakness the
attempt reveals; if the attempt is clean, return just the problem's own tag.

Output STRICT JSON, no markdown, no preamble:
{"correct": <true|false>, "verdict": "<2-4 sentences>", "hint": "<one progressive hint>", "tags": ["category:topic", ...]}`;

function flatVocab(vocab) {
  const out = [];
  for (const c of Object.keys(vocab || {})) for (const t of vocab[c]) out.push(c + ":" + t);
  return out;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "POST only" });
    return;
  }
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    res.status(500).json({ error: "ANTHROPIC_API_KEY is not set in the environment." });
    return;
  }

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
  body = body || {};

  const vocabList = flatVocab(body.vocab).join(", ");
  const expected = JSON.stringify(body.expected || {});
  const playbook = JSON.stringify(body.playbook || {});

  const userMsg =
`PROBLEM (${body.category} / ${body.tag}): ${body.title}
STATEMENT: ${body.statement}
${body.dialectNote ? "DIALECT NOTE: " + body.dialectNote + "\n" : ""}EXPECTED: ${expected}
REFERENCE PLAYBOOK (do not reveal verbatim): ${playbook}
CLOSED TAG VOCABULARY: ${vocabList}

CANDIDATE'S ATTEMPT:
${body.userWork || "(empty)"}

Grade the method. Return STRICT JSON only.`;

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 700,
        system: RUBRIC,
        messages: [{ role: "user", content: userMsg }]
      })
    });

    if (!r.ok) {
      const t = await r.text().catch(() => "");
      res.status(502).json({ error: "Anthropic API error", status: r.status, detail: t.slice(0, 300) });
      return;
    }

    const data = await r.json();
    const text = (data.content || [])
      .filter(b => b.type === "text")
      .map(b => b.text)
      .join("\n")
      .trim();

    let parsed;
    try {
      parsed = JSON.parse(text.replace(/^```json\s*|\s*```$/g, "").trim());
    } catch {
      const m = text.match(/\{[\s\S]*\}/);
      parsed = m ? JSON.parse(m[0]) : { correct: false, verdict: text.slice(0, 400), hint: "", tags: [] };
    }

    const allowed = new Set(flatVocab(body.vocab));
    parsed.tags = Array.isArray(parsed.tags) ? parsed.tags.filter(t => allowed.has(t)) : [];
    parsed.correct = !!parsed.correct;
    parsed.verdict = String(parsed.verdict || "");
    parsed.hint = String(parsed.hint || "");

    res.status(200).json(parsed);
  } catch (e) {
    res.status(500).json({ error: "judge failed", detail: String(e && e.message || e) });
  }
}
