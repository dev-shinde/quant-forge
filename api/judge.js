// Vercel serverless function — POST /api/judge
// Reads ANTHROPIC_API_KEY from the environment. The key never reaches the browser.
// Returns: { correct, verdict, implementation, overall, hint, tags[], commandsWellUsed[] }

const MODEL = "claude-sonnet-4-6";

// Cached grading rubric (module scope = reused across warm invocations).
const RUBRIC = `You are a rigorous interview coach grading a candidate's METHOD, not just the final answer.
The candidate is prepping data/analytics/quant interview rounds and is NEW TO SQL — a big goal is
building the habit of reaching for the right commands (COALESCE, aggregates, joins, window functions,
CTEs, set ops) and using them idiomatically.

Grade by REASONING and CRAFT quality. Catch conceptual errors even when the final answer is right, and
flag a wrong method even when the result is close. For SQL, judge correctness against the expected
result set, comment on whether the query is idiomatic, and call out Postgres-vs-MySQL dialect traps and
NULL pitfalls. Be specific and encouraging — like a mentor who names exactly what was done well.

Return these fields:
- "correct": did the attempt actually solve it (right method AND right result/answer)?
- "verdict": a 3-6 word tag of the outcome, e.g. "clean fixed-window solution" or "off-by-one in HAVING".
- "implementation": 1-3 sentences on the CRAFT — for SQL, how idiomatic the query is, good command choices,
  and any recurring slips; for quant, the soundness of the method and setup. Be concrete.
- "overall": one warm closing sentence of assessment (this is the encouragement line).
- "hint": ONE progressive hint that nudges toward the fix WITHOUT handing over the answer (only meaningful if not correct; still provide a sharpening tip if correct).
- "tags": weaknesses from the CLOSED vocabulary (category:topic). Tag every genuine weakness; if clean, return just the problem's own tag.
- "commandsWellUsed": for SQL only, the array of SQL command names (from COMMAND TARGETS, upper-case, exactly as given) that the candidate used correctly and idiomatically in THIS attempt. Empty array if none or if not SQL.

Output STRICT JSON, no markdown, no preamble:
{"correct":<true|false>,"verdict":"...","implementation":"...","overall":"...","hint":"...","tags":["category:topic"],"commandsWellUsed":["CMD"]}`;

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
  const cmdTargets = Array.isArray(body.commandTargets) ? body.commandTargets.join(", ") : "";

  const userMsg =
`PROBLEM (${body.category} / ${body.tag}${body.difficulty ? " / " + body.difficulty : ""}): ${body.title}
STATEMENT: ${body.statement}
${body.dialectNote ? "DIALECT NOTE: " + body.dialectNote + "\n" : ""}${cmdTargets ? "COMMAND TARGETS (candidate commands to look for): " + cmdTargets + "\n" : ""}EXPECTED: ${expected}
REFERENCE PLAYBOOK (do not reveal verbatim): ${playbook}
CLOSED TAG VOCABULARY: ${vocabList}

CANDIDATE'S ATTEMPT:
${body.userWork || "(empty)"}

Grade the method and craft. Return STRICT JSON only.`;

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
        max_tokens: 900,
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
      parsed = m ? JSON.parse(m[0]) : { correct: false, verdict: "", implementation: text.slice(0, 400), overall: "", hint: "", tags: [], commandsWellUsed: [] };
    }

    const allowed = new Set(flatVocab(body.vocab));
    parsed.tags = Array.isArray(parsed.tags) ? parsed.tags.filter(t => allowed.has(t)) : [];
    const targetSet = new Set((body.commandTargets || []).map(s => String(s).toUpperCase()));
    parsed.commandsWellUsed = Array.isArray(parsed.commandsWellUsed)
      ? parsed.commandsWellUsed.map(s => String(s).toUpperCase()).filter(s => targetSet.has(s))
      : [];
    parsed.correct = !!parsed.correct;
    parsed.verdict = String(parsed.verdict || "");
    parsed.implementation = String(parsed.implementation || "");
    parsed.overall = String(parsed.overall || "");
    parsed.hint = String(parsed.hint || "");

    res.status(200).json(parsed);
  } catch (e) {
    res.status(500).json({ error: "judge failed", detail: String(e && e.message || e) });
  }
}
