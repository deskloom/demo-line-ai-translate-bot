// Gemini-backed ja<->en translator with mechanical (non-"if confident") prompt rules,
// structured JSON output, and a deterministic mock fallback for when no API key is set.

const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    translation: { type: "STRING" },
  },
  required: ["translation"],
};

const SYSTEM_INSTRUCTION = `You are a translation engine for a casual LINE group chat between a Japanese
host family and an English-speaking exchange student (or friends). Translate the
LATEST MESSAGE only, from its source language to the target language given below.
Use the CONTEXT (previous messages, oldest first) only to resolve references —
do not translate or repeat the context.

Mechanical rules (apply exactly, do not use "if confident" style judgment):
1. If the latest message is a short fragment (1-3 words) with no verb/predicate,
   and one of the last few context messages is a question from a different speaker,
   translate the fragment as a direct answer to that question, restoring the
   omitted predicate from the question. Example: after "How do you usually get
   to school?", the fragment "電車" translates to "By train." / "I take the
   train.", not a literal noun dump.
2. If the latest message omits its subject, and the most recent context is about
   a third person (someone other than the two speakers), do NOT assume the
   speaker is the subject. Keep the third person as subject unless the sentence
   has an explicit first-person marker. Japanese sentence-final particles (e.g.
   〜わ, 〜よ) and hedges (e.g. 〜と思う, たぶん) are NOT evidence that the subject
   is the speaker; ignore them for subject inference.
3. Keep proper nouns (names of people and places) exactly as written; do not
   translate, transliterate, or alter them.
4. If there is truly nothing to translate (empty, symbols/emoji only), return an
   empty string for "translation".

Return ONLY the JSON object matching the schema. Do not include commentary.`;

/**
 * @param {object} params
 * @param {string} params.text - the latest message text
 * @param {"ja"|"en"} params.sourceLang
 * @param {"ja"|"en"} params.targetLang
 * @param {{speakerLabel: string, lang: string, text: string}[]} params.contextMessages - oldest first
 * @param {string} [params.apiKey] - GEMINI_API_KEY; if absent, uses deterministic mock
 * @param {string} [params.model]
 * @param {typeof fetch} [params.fetchImpl]
 * @returns {Promise<{ translation: string, mocked: boolean }>}
 */
export async function translateMessage({
  text,
  sourceLang,
  targetLang,
  contextMessages = [],
  apiKey,
  model = "gemini-3.1-flash-lite",
  fetchImpl = fetch,
}) {
  if (!apiKey) {
    return { translation: mockTranslate({ text, sourceLang, targetLang }), mocked: true };
  }

  const prompt = buildUserPrompt({ text, sourceLang, targetLang, contextMessages });
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    model
  )}:generateContent`;

  const res = await fetchImpl(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        response_mime_type: "application/json",
        response_schema: RESPONSE_SCHEMA,
        temperature: 0.2,
      },
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Gemini API error ${res.status}: ${body.slice(0, 300)}`);
  }

  const data = await res.json();
  const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!rawText) return { translation: "", mocked: false };

  let parsed;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    return { translation: "", mocked: false };
  }
  const translation = typeof parsed?.translation === "string" ? parsed.translation.trim() : "";
  return { translation, mocked: false };
}

function buildUserPrompt({ text, sourceLang, targetLang, contextMessages }) {
  const contextBlock = contextMessages.length
    ? contextMessages
        .map((m) => `[${m.lang}] ${m.speakerLabel}: ${m.text}`)
        .join("\n")
    : "(no prior context)";
  return [
    `Source language: ${sourceLang}`,
    `Target language: ${targetLang}`,
    "",
    "CONTEXT (oldest first, do not translate this):",
    contextBlock,
    "",
    "LATEST MESSAGE TO TRANSLATE:",
    text,
  ].join("\n");
}

/**
 * Deterministic mock translation used when GEMINI_API_KEY is not configured,
 * so the Worker still runs end-to-end (e.g. local `wrangler dev` without secrets).
 * Not intended to be linguistically correct.
 */
function mockTranslate({ text, sourceLang, targetLang }) {
  if (!text || !text.trim()) return "";
  const tag = `[mock ${sourceLang}->${targetLang}]`;
  return `${tag} ${text}`;
}
