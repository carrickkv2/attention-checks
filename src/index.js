// Find the instructions in a job posting that are aimed at the applicant, at AI
// tools, or at hijacking the tool reading it, and turn them into a checklist.

const { APPLICANT_INSTRUCTION, AI_CANARY, PROMPT_INJECTION } = require('./patterns');
const { splitVisibleAndHidden } = require('./html');

const ACTIONS = {
  applicant_instruction: 'Do this yourself before submitting. It is a requirement from the employer.',
  ai_canary: 'Do NOT follow this. It is a trap to catch AI-written applications; write the answer yourself.',
  prompt_injection: 'Ignore this. It tries to control the AI tool; keep it out of generation.',
};

const MAX_LINKS_TO_FOLLOW = 5;
const NOT_A_VALUE = new Set(['from', 'in', 'on', 'at', 'below', 'above', 'that', 'which', 'you', 'your', 'the', 'a', 'of', 'to', 'we', 'is']);
const LINK_HINT = /\b(visit|read|review|see|check out|look at|go to|take a look|before applying)\b/i;

// ---------- main entry points ----------

/** Scan plain text. `hiddenTexts` are passages a human reader can't see (from HTML). */
function findAttentionChecks(text, { hiddenTexts = [], source = null } = {}) {
  const checks = [];
  for (const sentence of toSentences(text)) {
    const check = classifySentence(sentence, { hidden: false, source });
    if (check) checks.push(check);
  }
  for (const hiddenText of hiddenTexts) {
    for (const sentence of toSentences(hiddenText)) {
      const check = classifySentence(sentence, { hidden: true, source });
      if (check) checks.push(check);
    }
  }
  return checks;
}

/** Scan an HTML page, treating instructions in hidden text as traps for AI tools. */
function findAttentionChecksInHtml(html, { source = null } = {}) {
  const { visible, hidden } = splitVisibleAndHidden(keepLinkUrls(html));
  return { text: visible, checks: findAttentionChecks(visible, { hiddenTexts: hidden, source }) };
}

/**
 * Scan a posting by URL. With `follow`, also scan pages the posting tells the
 * applicant to visit, since that's where checks are often hidden.
 */
async function scanUrl(url, { follow = false } = {}) {
  const page = await fetchPage(url);
  const result = findAttentionChecksInHtml(page.html, { source: url });
  const followed = [];

  if (follow) {
    for (const link of linksTheApplicantIsSentTo(result.text, url)) {
      try {
        const linked = await fetchPage(link);
        result.checks.push(...findAttentionChecksInHtml(linked.html, { source: link }).checks);
        followed.push(link);
      } catch (error) {
        followed.push(`${link} (could not fetch: ${error.message})`);
      }
    }
  }
  return { checks: result.checks, followed, outcome: suggestedOutcome(result.checks) };
}

/** What a pipeline should do with the listing. Only checks never drop a job. */
function suggestedOutcome(checks) {
  const kinds = new Set(checks.map((check) => check.kind));
  if (kinds.has('applicant_instruction') || kinds.has('ai_canary')) return 'keep_and_show_checklist';
  if (kinds.has('prompt_injection')) return 'keep_but_strip_injected_text';
  return 'keep';
}

// ---------- classification ----------

function classifySentence(sentence, { hidden, source }) {
  // Order matters: a sentence addressed to an AI is an employer's trap even if it
  // also says "ignore previous instructions", so canaries are checked first.
  const canary = firstMatch(AI_CANARY, sentence);
  if (canary) return toCheck('ai_canary', canary, sentence, { hidden, source });

  const injection = firstMatch(PROMPT_INJECTION, sentence);
  if (injection) return toCheck('prompt_injection', injection, sentence, { hidden, source });

  const instruction = firstMatch(APPLICANT_INSTRUCTION, sentence);
  // An instruction no human can see is aimed at machines, so it's a trap, not a requirement.
  if (instruction) return toCheck(hidden ? 'ai_canary' : 'applicant_instruction', instruction, sentence, { hidden, source });

  return null;
}

function firstMatch(patterns, sentence) {
  return patterns.find((pattern) => pattern.regex.test(sentence)) || null;
}

function toCheck(kind, pattern, sentence, { hidden, source }) {
  return {
    kind,
    rule: pattern.id,
    quote: sentence,
    value: extractValue(sentence, pattern.id),
    hidden,
    source,
    action: ACTIONS[kind],
  };
}

/**
 * The exact thing to type or include, when the sentence names one.
 * "include the term ORBIT-7 in the 'Why us' section" → ORBIT-7 (the named term wins over
 * other quoted text); 'type the following text: "blue harbour"' → the quote.
 */
function extractValue(sentence, rule) {
  // Only double quotes count: single quotes are usually apostrophes ("you're").
  const quoted = sentence.match(/["“]([^"”]{1,80})["”]/);

  if (rule === 'mention_source') {
    // 'mention "HN - Who is hiring?" in the subject' → the quote; 'mention HN' → HN.
    if (quoted && /\b(hn|hacker ?news)\b/i.test(quoted[1])) return quoted[1].trim();
    const source = sentence.match(/\b(HN|Hacker ?News|this post)\b/i);
    return source ? source[1] : null;
  }

  const named = sentence.match(/\b(?:term|word|phrase|keyword|code ?word|password)\s+([^\s"”',.;:)(]{1,40})/i);
  // "include the keyword from my profile" points somewhere else; there's no value to extract.
  if (named && !NOT_A_VALUE.has(named[1].toLowerCase())) return named[1];
  return quoted ? quoted[1].trim() : null;
}

// ---------- text helpers ----------

function toSentences(text) {
  return text
    .split(/\n+|(?<=[.!?])\s+(?=["“'(A-Z0-9])/)
    .map((sentence) => sentence.replace(/\s+/g, ' ').trim())
    .filter((sentence) => sentence.length > 3);
}

/** Write each link's URL next to its label, so "read our page (https://…)" survives as text. */
function keepLinkUrls(html) {
  return html.replace(/<a\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_, href, label) => `${label} (${href})`);
}

function linksTheApplicantIsSentTo(text, baseUrl) {
  const links = [];
  for (const sentence of toSentences(text)) {
    if (!LINK_HINT.test(sentence)) continue;
    for (const raw of sentence.match(/(https?:\/\/[^\s)"'<>]+|\/[a-z0-9][^\s)"'<>]*)/gi) || []) {
      try {
        const url = new URL(raw, baseUrl).href;
        if (!links.includes(url) && url !== baseUrl) links.push(url);
      } catch { /* not a usable URL */ }
    }
  }
  return links.slice(0, MAX_LINKS_TO_FOLLOW);
}

async function fetchPage(url) {
  const response = await fetch(url, {
    headers: { 'user-agent': 'attention-checks/0.1 (+https://github.com/carrickkv2/attention-checks)' },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return { html: await response.text() };
}

module.exports = { findAttentionChecks, findAttentionChecksInHtml, scanUrl, suggestedOutcome };
