import { test } from "node:test";
import assert from "node:assert/strict";
import { translateMessage } from "../src/translate.js";

test("uses deterministic mock provider when no API key is given", async () => {
  const { translation, mocked } = await translateMessage({
    text: "こんにちは",
    sourceLang: "ja",
    targetLang: "en",
    contextMessages: [],
  });
  assert.equal(mocked, true);
  assert.match(translation, /^\[mock ja->en\] こんにちは$/);
});

test("mock provider returns empty for empty text", async () => {
  const { translation } = await translateMessage({
    text: "",
    sourceLang: "ja",
    targetLang: "en",
    contextMessages: [],
  });
  assert.equal(translation, "");
});

test("parses structured JSON response from Gemini", async () => {
  const fakeFetch = async (url, init) => {
    assert.match(url, /generateContent$/);
    const body = JSON.parse(init.body);
    assert.equal(body.generationConfig.response_mime_type, "application/json");
    return new Response(
      JSON.stringify({
        candidates: [
          { content: { parts: [{ text: JSON.stringify({ translation: "By train." }) }] } },
        ],
      }),
      { status: 200 }
    );
  };

  const { translation, mocked } = await translateMessage({
    text: "電車",
    sourceLang: "ja",
    targetLang: "en",
    contextMessages: [
      { speakerLabel: "student", lang: "en", text: "How do you usually get to school?" },
    ],
    apiKey: "fake-key",
    model: "gemini-3.1-flash-lite",
    fetchImpl: fakeFetch,
  });

  assert.equal(mocked, false);
  assert.equal(translation, "By train.");
});

test("throws on non-2xx Gemini response", async () => {
  const fakeFetch = async () => new Response("boom", { status: 500 });
  await assert.rejects(
    translateMessage({
      text: "hi",
      sourceLang: "en",
      targetLang: "ja",
      apiKey: "fake-key",
      fetchImpl: fakeFetch,
    })
  );
});

test("returns empty translation when Gemini returns malformed JSON text", async () => {
  const fakeFetch = async () =>
    new Response(
      JSON.stringify({ candidates: [{ content: { parts: [{ text: "not json" }] } }] }),
      { status: 200 }
    );
  const { translation } = await translateMessage({
    text: "hi",
    sourceLang: "en",
    targetLang: "ja",
    apiKey: "fake-key",
    fetchImpl: fakeFetch,
  });
  assert.equal(translation, "");
});
