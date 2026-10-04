import { test } from "node:test";
import assert from "node:assert/strict";
import { detectLang, isUntranslatable } from "../src/lang.js";

test("detects Japanese text", () => {
  assert.equal(detectLang("今日は学校に行きます"), "ja");
});

test("detects English text", () => {
  assert.equal(detectLang("I am going to school today"), "en");
});

test("mixed text leans on majority script", () => {
  assert.equal(detectLang("Hello 元気ですか"), "ja"); // 5 kana/kanji vs fewer latin letters... see below
});

test("unknown when no script chars at all", () => {
  assert.equal(detectLang("😀😀😀"), "unknown");
  assert.equal(detectLang(""), "unknown");
});

test("emoji/stamp-only text is untranslatable", () => {
  assert.equal(isUntranslatable("😀😀"), true);
});

test("empty and whitespace-only text is untranslatable", () => {
  assert.equal(isUntranslatable(""), true);
  assert.equal(isUntranslatable("   "), true);
});

test("pure punctuation is untranslatable", () => {
  assert.equal(isUntranslatable("!!!"), true);
});

test("short real text is translatable", () => {
  assert.equal(isUntranslatable("電車"), false);
  assert.equal(isUntranslatable("ok"), false);
});

test("any hiragana/katakana makes the text Japanese even when Latin letters outnumber it", () => {
  assert.equal(detectLang("Googleで調べて"), "ja");
  assert.equal(detectLang("Netflix見る？"), "ja");
  assert.equal(detectLang("iPhoneの充電器どこ"), "ja");
  assert.equal(detectLang("ﾃｽﾄ test message"), "ja"); // halfwidth katakana
});

test("kanji + Latin only (no kana) still falls back to the ratio", () => {
  assert.equal(detectLang("会議 meeting schedule"), "en");
  assert.equal(detectLang("会議資料 PDF"), "ja");
});

test("plain English stays English", () => {
  assert.equal(detectLang("Can you check Google Maps for me?"), "en");
});

test("English sentence quoting one Japanese word is judged ja (documented trade-off)", () => {
  // Decision: a single kana is enough for "ja". Misjudging this English sentence
  // as ja is benign (the model returns it essentially unchanged), whereas the
  // opposite error garbles real Japanese like "Googleで調べて".
  assert.equal(detectLang("I love 'すし'"), "ja");
});
