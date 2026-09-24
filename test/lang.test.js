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
