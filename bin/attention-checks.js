#!/usr/bin/env node
// Usage:
//   attention-checks <posting.html | posting.txt | https://…> [--follow] [--json]
//   cat posting.txt | attention-checks -

const fs = require('node:fs');
const { findAttentionChecks, findAttentionChecksInHtml, scanUrl, suggestedOutcome } = require('../src');

const LABELS = {
  applicant_instruction: '✅ DO THIS     ',
  ai_canary: '🚫 AI TRAP     ',
  prompt_injection: '⚠️  INJECTION  ',
};

async function main() {
  const args = process.argv.slice(2);
  const input = args.find((arg) => !arg.startsWith('--'));
  const asJson = args.includes('--json');
  const follow = args.includes('--follow');

  if (!input) {
    console.error('Usage: attention-checks <file | url | -> [--follow] [--json]');
    process.exit(2);
  }

  const result = await scan(input, { follow });

  if (asJson) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  printChecklist(result);
}

async function scan(input, { follow }) {
  if (/^https?:\/\//i.test(input)) return scanUrl(input, { follow });

  const content = input === '-' ? fs.readFileSync(0, 'utf8') : fs.readFileSync(input, 'utf8');
  const looksLikeHtml = /<\/?(html|body|div|p|span|a)\b/i.test(content);
  const checks = looksLikeHtml
    ? findAttentionChecksInHtml(content, { source: input }).checks
    : findAttentionChecks(content, { source: input });
  return { checks, followed: [], outcome: suggestedOutcome(checks) };
}

function printChecklist({ checks, followed, outcome }) {
  if (!checks.length) {
    console.log('No attention checks found.');
  }
  for (const check of checks) {
    const where = [check.hidden ? 'hidden text' : null, check.source].filter(Boolean).join(' · ');
    console.log(`${LABELS[check.kind]} ${check.quote}`);
    if (check.value) console.log(`               value: "${check.value}"`);
    console.log(`               ${check.action}${where ? `  [${where}]` : ''}`);
  }
  if (followed.length) console.log(`\nAlso scanned: ${followed.join(', ')}`);
  console.log(`\nSuggested outcome: ${outcome}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
