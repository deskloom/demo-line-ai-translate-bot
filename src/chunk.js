// Splits long text into paragraph-based chunks under a character budget.
//
// Requirement (see SPEC): the function that decides "can we process this
// within budget" must be the SAME function that computes the allocation,
// so the two can never disagree. computeChunkPlan() is that single source
// of truth; both fitsBudget() and planChunks() call it.

/**
 * Split text into paragraphs (blank-line separated), then greedily pack
 * paragraphs into chunks no longer than `budget` characters. A single
 * paragraph longer than the budget is hard-split on the budget boundary
 * (falling back to a space if one is nearby) so no chunk ever exceeds it.
 *
 * @param {string} text
 * @param {number} budget - max characters per chunk (must be >= 1)
 * @returns {{ chunks: string[] }}
 */
export function computeChunkPlan(text, budget) {
  if (budget < 1) throw new RangeError("budget must be >= 1");
  const normalized = (text ?? "").replace(/\r\n/g, "\n");
  if (normalized.length === 0) return { chunks: [] };

  const paragraphs = normalized.split(/\n{2,}/).filter((p) => p.length > 0);
  const chunks = [];
  let current = "";

  const flush = () => {
    if (current.length > 0) {
      chunks.push(current);
      current = "";
    }
  };

  for (const para of paragraphs) {
    if (para.length > budget) {
      // Paragraph itself exceeds budget: flush what we have, then hard-split.
      flush();
      let rest = para;
      while (rest.length > budget) {
        let cut = rest.lastIndexOf(" ", budget);
        if (cut <= 0) cut = budget; // no good boundary, hard cut
        chunks.push(rest.slice(0, cut).trimEnd());
        rest = rest.slice(cut).trimStart();
      }
      current = rest;
      continue;
    }

    const candidate = current.length === 0 ? para : `${current}\n\n${para}`;
    if (candidate.length <= budget) {
      current = candidate;
    } else {
      flush();
      current = para;
    }
  }
  flush();

  return { chunks };
}

/**
 * @param {string} text
 * @param {number} budget
 * @param {number} maxChunks
 * @returns {boolean} whether the text fits within maxChunks chunks of `budget` chars
 */
export function fitsBudget(text, budget, maxChunks) {
  return computeChunkPlan(text, budget).chunks.length <= maxChunks;
}

/**
 * @param {string} text
 * @param {number} budget
 * @returns {string[]}
 */
export function planChunks(text, budget) {
  return computeChunkPlan(text, budget).chunks;
}
