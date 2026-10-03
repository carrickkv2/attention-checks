// Turn an HTML page into plain text, keeping text that's hidden from human
// readers separate. Hidden text in a job posting is aimed at machines, so any
// instruction in it is treated as a trap for AI tools.
//
// This is a deliberately small, dependency-free approach: it recognises the common
// ways of hiding text (inline styles, the `hidden` attribute, screen-reader-only
// classes) and takes the element's content up to its closing tag. Deeply nested
// hidden elements of the same tag name are not handled.

const HIDING = [
  // inline styles: not displayed, invisible, 0-1px text, fully transparent, or white text
  /style\s*=\s*["'][^"']*(display\s*:\s*none|visibility\s*:\s*hidden|font-size\s*:\s*(0|1px|0?\.\d+\w*)\b|opacity\s*:\s*0(\.0+)?\s*(;|["'])|color\s*:\s*(#fff(fff)?|white)\b)/i,
  /\shidden(\s|=|>)/i,
  /aria-hidden\s*=\s*["']true["']/i,
  /class\s*=\s*["'][^"']*\b(sr-only|visually-hidden|screen-reader-text|hidden)\b/i,
];

function htmlToText(html) {
  return decodeEntities(
    html
      .replace(/<(script|style|noscript)\b[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<br\s*\/?>|<\/(p|div|li|h[1-6]|tr|section|article)>/gi, '\n')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*/g, '\n')
    .trim();
}

function splitVisibleAndHidden(html) {
  const hidden = [];
  let remaining = html;

  // Repeatedly find the next opening tag that hides its content, and cut out
  // everything from it to its closing tag.
  for (;;) {
    const opening = findHidingTag(remaining);
    if (!opening) break;
    const closeAt = remaining.indexOf(`</${opening.tag}`, opening.end);
    const end = closeAt === -1 ? remaining.length : closeAt;
    const text = htmlToText(remaining.slice(opening.end, end));
    if (text) hidden.push(text);
    remaining = remaining.slice(0, opening.start) + ' ' + remaining.slice(end);
  }
  return { visible: htmlToText(remaining), hidden };
}

function findHidingTag(html) {
  for (const match of html.matchAll(/<([a-z][a-z0-9]*)\b([^>]*)>/gi)) {
    const attributes = ' ' + match[2];
    if (HIDING.some((pattern) => pattern.test(attributes))) {
      return { tag: match[1].toLowerCase(), start: match.index, end: match.index + match[0].length };
    }
  }
  return null;
}

function decodeEntities(text) {
  const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”' };
  return text
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&([a-z]+);/gi, (entity, name) => named[name.toLowerCase()] ?? entity);
}

module.exports = { splitVisibleAndHidden, htmlToText };
