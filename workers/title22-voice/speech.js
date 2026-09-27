// Turns a briefing into the text Tello speaks.
//
// Order matters and is fixed:
//   1. strip markdown / HTML           (what the model wrote for the screen)
//   2. cap at MAX_CHARS                (on what the reader saw, at a sentence end)
//   3. pronunciation rules             (owner's list, 2026-09-27)
//   4. numbers as words                ("30 days" -> "thirty days")
// The cap is on the cleaned text, before the rewrites, so "1,200 characters"
// means 1,200 characters of the briefing and a rewrite can never cut a word.

export const MAX_CHARS = 1200;

// ------------------------------------------------------------- markdown --
export function stripMarkdown(s) {
  return String(s ?? '')
    .replace(/<[^>]+>/g, ' ')                       // HTML tags
    .replace(/```[\s\S]*?```/g, ' ')                // code blocks
    .replace(/`([^`]*)`/g, '$1')                    // inline code
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')          // images
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')        // links -> their text
    .replace(/^\s{0,3}#{1,6}\s*/gm, '')             // headings
    .replace(/^\s{0,3}>\s?/gm, '')                  // block quotes
    .replace(/^\s*(?:[-*+•]|\d+[.)])\s+/gm, '')     // list markers
    .replace(/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/gm, ' ') // rules
    .replace(/(\*\*|__)(.+?)\1/g, '$2')             // bold
    .replace(/(^|[\s(])[*_]([^*_\n]+)[*_](?=[\s).,;:!?]|$)/g, '$1$2') // italic
    .replace(/[*_~]{1,3}/g, '')                     // stray emphasis marks
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    // A line break in a briefing is a pause; make it one the voice will take.
    .replace(/([^.!?:;,\s])\s*\n+\s*/g, '$1. ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Cuts to max characters, at the last sentence end that fits if there is a
// reasonable one, else at the last word boundary.
export function cap(s, max = MAX_CHARS) {
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
  if (end > max * 0.5) return cut.slice(0, end + 1);
  const sp = cut.lastIndexOf(' ');
  return (sp > 0 ? cut.slice(0, sp) : cut).replace(/[,;:\s]+$/, '') + '.';
}

// -------------------------------------------------------- numbers -> words --
const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
const ORD = { one: 'first', two: 'second', three: 'third', five: 'fifth', eight: 'eighth', nine: 'ninth', twelve: 'twelfth' };

function under1000(n) {
  const h = Math.floor(n / 100), r = n % 100, out = [];
  if (h) out.push(ONES[h] + ' hundred');
  if (r) out.push(r < 20 ? ONES[r] : TENS[Math.floor(r / 10)] + (r % 10 ? '-' + ONES[r % 10] : ''));
  return out.join(' ');
}

export function numberToWords(n) {
  n = Math.floor(Math.abs(n));
  if (n < 20) return ONES[n];
  if (n >= 1e12) return String(n).split('').map((d) => ONES[+d]).join(' ');
  const parts = [];
  for (const [v, name] of [[1e9, 'billion'], [1e6, 'million'], [1e3, 'thousand']]) {
    if (n >= v) { parts.push(under1000(Math.floor(n / v)) + ' ' + name); n %= v; }
  }
  if (n) parts.push(under1000(n));
  return parts.join(' ');
}

export function ordinalWords(n) {
  const w = numberToWords(n);
  const m = w.match(/^(.*?)([a-z]+)$/);
  const [, head, last] = m;
  if (ORD[last]) return head + ORD[last];
  if (last.endsWith('y')) return head + last.slice(0, -1) + 'ieth';
  return w + 'th';
}

// Years are read in pairs: 2026 -> "twenty twenty-six", 2000 -> "two thousand",
// 2005 -> "two thousand five".
export function yearWords(y) {
  if (y % 1000 < 10 || y < 1100 || y > 2999) return numberToWords(y);
  const a = Math.floor(y / 100), b = y % 100;
  return numberToWords(a) + ' ' + (b < 10 ? 'oh ' + ONES[b] : numberToWords(b));
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
  'September', 'October', 'November', 'December'];
const MON_ABBR = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Sept: 8, Oct: 9, Nov: 10, Dec: 11 };

// Form numbers are said the way people in the field say them:
// 622 -> "six twenty-two", 602A -> "six oh two A", 9182 -> "nine one eight two".
function formNumber(num, letter) {
  let w;
  if (num.length === 3) {
    const tail = +num.slice(1);
    w = ONES[+num[0]] + ' ' + (tail === 0 ? 'hundred' : tail < 10 ? 'oh ' + ONES[tail] : numberToWords(tail));
  } else {
    w = num.split('').map((d) => ONES[+d]).join(' ');
  }
  return w + (letter ? ' ' + letter.toUpperCase() : '');
}

// ------------------------------------------------------- pronunciation --
// The owner's list, most specific first so "title22.app" is not first
// turned into "Title twenty-two.app".
export function pronounce(s) {
  return s
    .replace(/\bhttps?:\/\//gi, '')
    .replace(/\bwww\./gi, '')
    .replace(/\btitle22\.app\b/gi, 'title twenty-two dot app')
    .replace(/\btitle-22\.com\b/gi, 'title twenty-two dot com')
    .replace(/\bTitle\s?22\b/gi, 'Title twenty-two')
    .replace(/\bLIC\s?(\d{3,4})([A-Za-z])?\b/g, (_, n, l) => 'L I C ' + formNumber(n, l))
    .replace(/§\s*(\d+)(?:\.(\d+))?/g, (_, a, b) =>
      'section ' + a.split('').map((d) => ONES[+d]).join(' ') + (b ? ' point ' + b.split('').map((d) => ONES[+d]).join(' ') : ''))
    .replace(/\bDSS\b/g, 'D S S')
    .replace(/\bCDSS\b/g, 'C D S S')
    .replace(/\bRCFE(s?)\b/g, (_, p) => 'R C F E' + (p ? "'s" : ''))
    .replace(/\bARF(s?)\b/g, (_, p) => 'A R F' + (p ? "'s" : ''))
    .replace(/\bTB\b/g, 'T B')
    .replace(/\bCPR\b/g, 'C P R')
    .replace(/\bAI\b/g, 'A I')
    .replace(/\s&\s/g, ' and ')
    .replace(/\be\.g\.\s*/gi, 'for example, ')
    .replace(/\bi\.e\.\s*/gi, 'that is, ');
}

export function numbersToWords(s) {
  return s
    // ISO dates: 2026-10-03 -> October third, twenty twenty-six
    .replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, (m, y, mo, d) =>
      +mo >= 1 && +mo <= 12 ? `${MONTHS[+mo - 1]} ${ordinalWords(+d)}, ${yearWords(+y)}` : m)
    // "Oct 3", "October 3rd", "Oct 3, 2026"
    .replace(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sept?|Oct|Nov|Dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,\s*(\d{4}))?\b/g,
      (m, mon, d, y) => `${MONTHS[MON_ABBR[mon]]} ${ordinalWords(+d)}${y ? ', ' + yearWords(+y) : ''}`)
    // US dates 10/3/2026 or 10/3
    .replace(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/g, (m, mo, d, y) =>
      +mo >= 1 && +mo <= 12 && +d >= 1 && +d <= 31
        ? `${MONTHS[+mo - 1]} ${ordinalWords(+d)}${y ? ', ' + yearWords(y.length === 2 ? 2000 + +y : +y) : ''}` : m)
    // times 06:40, 6:05 pm
    .replace(/\b(\d{1,2}):(\d{2})\s*([ap])\.?m\.?\b/gi, (m, h, mi, ap) =>
      numberToWords(+h) + (+mi ? ' ' + (+mi < 10 ? 'oh ' + ONES[+mi] : numberToWords(+mi)) : '') + ' ' + ap.toUpperCase() + ' M')
    .replace(/\b(\d{1,2}):(\d{2})\b/g, (m, h, mi) =>
      numberToWords(+h) + ' ' + (+mi === 0 ? "o'clock" : +mi < 10 ? 'oh ' + ONES[+mi] : numberToWords(+mi)))
    // money $29, $79.50
    .replace(/\$(\d[\d,]*)(?:\.(\d{2}))?\b/g, (m, d, c) =>
      numberToWords(+d.replace(/,/g, '')) + ' dollars' + (c && +c ? ' and ' + numberToWords(+c) + ' cents' : ''))
    // ordinals 1st, 22nd
    .replace(/\b(\d+)(st|nd|rd|th)\b/g, (m, n) => ordinalWords(+n))
    // percentages and decimals
    .replace(/\b(\d+)\.(\d+)\s*%/g, (m, a, b) => numberToWords(+a) + ' point ' + b.split('').map((x) => ONES[+x]).join(' ') + ' percent')
    .replace(/\b(\d[\d,]*)\s*%/g, (m, a) => numberToWords(+a.replace(/,/g, '')) + ' percent')
    .replace(/\b(\d+)\.(\d+)\b/g, (m, a, b) => numberToWords(+a) + ' point ' + b.split('').map((x) => ONES[+x]).join(' '))
    // years standing alone
    .replace(/\b(19\d{2}|20\d{2})\b/g, (m, y) => yearWords(+y))
    // everything else: 1,200 -> one thousand two hundred
    .replace(/\b\d{1,3}(?:,\d{3})+\b|\b\d+\b/g, (m) => numberToWords(+m.replace(/,/g, '')));
}

export function prepare(text) {
  const clean = cap(stripMarkdown(text));
  return numbersToWords(pronounce(clean))
    .replace(/\s+/g, ' ')
    .trim()
    // "Good morning. two staff" -> "Good morning. Two staff"
    .replace(/(^|[.!?]\s+)([a-z])/g, (m, p, c) => p + c.toUpperCase());
}
