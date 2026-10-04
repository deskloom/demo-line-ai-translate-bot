// Lightweight ja/en language detection by script ratio. No external deps.
// Also detects "nothing to translate" text (emoji/stamp-only, pure punctuation, empty).

// Hiragana, katakana (incl. phonetic extensions) and halfwidth katakana.
const KANA_RE = /[぀-ゟ゠-ヿㇰ-ㇿｦ-ﾟ]/;
const KANA_KANJI_RE = /[぀-ゟ゠-ヿ一-鿿]/g;
const LATIN_RE = /[A-Za-z]/g;
// Emoji + LINE stamp placeholder text + pure symbol/whitespace text.
const EMOJI_RE =
  /[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2300}-\u{23FF}]/gu;
const WORDISH_RE = /[\p{L}\p{N}]/u;

/**
 * @param {string} text
 * @returns {"ja" | "en" | "unknown"}
 */
export function detectLang(text) {
  if (!text) return "unknown";
  // Any kana at all means Japanese: Latin brand names ("Google", "iPhone") often
  // outnumber the kana in short Japanese messages, so a pure ratio misjudges
  // them as English. Trade-off: an English sentence quoting one Japanese word
  // is judged "ja" too, which is benign (the model returns it nearly as-is).
  // The ratio below only decides kana-less text (kanji + Latin).
  if (KANA_RE.test(text)) return "ja";
  const kana = (text.match(KANA_KANJI_RE) || []).length;
  const latin = (text.match(LATIN_RE) || []).length;
  if (kana === 0 && latin === 0) return "unknown";
  return kana >= latin ? "ja" : "en";
}

/**
 * True when the text carries nothing worth translating: empty, whitespace,
 * pure emoji/stamp text, or has no letters/digits at all.
 * @param {string} text
 * @returns {boolean}
 */
export function isUntranslatable(text) {
  if (!text) return true;
  const stripped = text.replace(EMOJI_RE, "").trim();
  if (stripped.length === 0) return true;
  if (!WORDISH_RE.test(stripped)) return true;
  return false;
}
