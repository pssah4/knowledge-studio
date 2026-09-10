/* The surface a person writes in.
 *
 * app/marks.js cuts a text into pieces and says of each piece whether it is
 * syntax or content. This file is what those pieces become: one element per
 * line, one element per piece, and a way back out of the tree into the text
 * that gets saved.
 *
 * The buffer stays the raw text. Nothing here replaces a character; the
 * markers keep standing in the line and only their display changes, which is
 * what lets a person leave a line and come back to the same characters
 * (FEAT-08-07, SC-10). The line height never changes with it, because a marker
 * that steps back keeps its box.
 *
 * The way back is the risk of the whole layer. What a person typed is read out
 * of the tree, and a piece lost on that way is a paragraph missing from a file
 * somebody wrote by hand. So the way back is built out of the pieces and never
 * out of a remembered text, and tests/test_writing.py measures it against
 * every markdown file this repository holds.
 *
 * Three things are global on purpose, because the page loads classic scripts
 * into one scope (ADR-08): document, marksOf from app/marks.js, and window for
 * the caret. Each is read at call time and each is guarded, so the bench can
 * put a small model of a document in front of this file and measure the way
 * back without a browser.
 */

'use strict';

var WRITING_LINE = 'zeile';
var WRITING_PIECE = 'stueck';
var WRITING_MARK = 'zeichen';
var WRITING_ACTIVE = 'aktiv';
var WRITING_END = 'data-ende';
var WRITING_FORM = 'data-form';

/* The pieces of a text, from app/marks.js. Read at call time, because the
 * order the page loads its scripts in is the page's business and not this
 * file's. A surface without the display rules would eat characters, so this
 * refuses rather than falling back to something simpler.
 */
function writingMarks(text) {
  if (typeof marksOf !== 'function') {
    throw new Error('marks.js is missing; without the forms nothing can be shown');
  }
  return marksOf(text);
}

function writingDocument() {
  return typeof document === 'undefined' ? null : document;
}

/* A line ending, as a short code, because an attribute is a poor place for a
 * control character. Only the carriage return has to be carried: whether a
 * line ends at all follows from whether another line stands after it.
 */
function writingEndCode(ending) {
  return ending === '\r\n' ? 'rn' : '';
}

function writingEnding(line, last) {
  if (last) {
    return '';
  }
  return line.getAttribute(WRITING_END) === 'rn' ? '\r\n' : '\n';
}

/* What a row looks like, as one string, so a redraw can tell in one comparison
 * whether the line standing there is still the right one. The text alone would
 * not do it: the same characters inside a fence are another thing than outside
 * one, and a line whose meaning changed has to be built again even where every
 * character stayed. The value is written as JSON, so no separator can turn up
 * inside a piece and make two different rows look alike.
 */
function writingSign(row) {
  var parts = [writingEndCode(row.ending)];
  var index;
  var piece;

  for (index = 0; index < row.segments.length; index += 1) {
    piece = row.segments[index];
    parts.push(piece.mark ? 1 : 0);
    parts.push(piece.kind);
    parts.push(piece.text);
  }
  return JSON.stringify(parts);
}

/* What the whole line is, as against what one piece of it is. A name every
 * piece carries belongs to the line: a rule, a quote, a heading, a fenced
 * block. A name only some pieces carry stays where it is, because a line whose
 * pieces are partly bold is not a bold line.
 *
 * The stylesheet needs this. A line has a height, and a marker that steps back
 * may not change it (SC-10); that is decidable on the line and not from inside
 * one of its pieces.
 */
function writingKinds(row) {
  var shared = null;
  var kept;
  var names;
  var index;
  var at;

  for (index = 0; index < row.segments.length; index += 1) {
    names = row.segments[index].kind === ''
      ? [] : row.segments[index].kind.split(' ');
    if (shared === null) {
      shared = names;
      continue;
    }
    kept = [];
    for (at = 0; at < shared.length; at += 1) {
      if (names.indexOf(shared[at]) !== -1) {
        kept.push(shared[at]);
      }
    }
    shared = kept;
  }
  return shared === null ? [] : shared;
}

/* One line, built from its pieces. An empty line gets a break, because an
 * element with nothing in it has no height and the line would collapse.
 */
function writingLine(row) {
  var papers = writingDocument();
  var line = papers.createElement('div');
  var index;
  var piece;
  var span;
  var names;

  line.className = [WRITING_LINE].concat(writingKinds(row)).join(' ');
  line.setAttribute(WRITING_END, writingEndCode(row.ending));
  line.setAttribute(WRITING_FORM, writingSign(row));

  if (row.segments.length === 0) {
    line.appendChild(papers.createElement('br'));
    return line;
  }

  for (index = 0; index < row.segments.length; index += 1) {
    piece = row.segments[index];
    names = [WRITING_PIECE];
    if (piece.mark) {
      names.push(WRITING_MARK);
    }
    if (piece.kind) {
      names.push(piece.kind);
    }
    span = papers.createElement('span');
    span.className = names.join(' ');
    span.appendChild(papers.createTextNode(piece.text));
    line.appendChild(span);
  }
  return line;
}

/* The name of the line being written in. It is set and taken away without
 * touching anything under the line, so moving the caret costs one attribute
 * and never a rebuild.
 */
function writingName(line, on) {
  var names = line.className.split(' ');
  var kept = [];
  var index;

  for (index = 0; index < names.length; index += 1) {
    if (names[index] !== '' && names[index] !== WRITING_ACTIVE) {
      kept.push(names[index]);
    }
  }
  if (on) {
    kept.push(WRITING_ACTIVE);
  }
  line.className = kept.join(' ');
}

/* The text into the sheet. Only the lines whose display changed are built
 * again; the rest keep standing, and with them the caret and the selection
 * inside them. The answer is how many lines were built, which is what the
 * suite holds the promise against.
 */
function writingDraw(root, text, active) {
  var rows = writingMarks(text);
  var built = 0;
  var index;
  var sign;
  var standing;
  var fresh;

  for (index = 0; index < rows.length; index += 1) {
    sign = writingSign(rows[index]);
    standing = index < root.children.length ? root.children[index] : null;
    if (standing !== null && standing.getAttribute(WRITING_FORM) === sign &&
        writingRawText(standing) === rows[index].segments.map(function(piece) { return piece.text; }).join('')) {
      writingName(standing, index === active);
      continue;
    }
    fresh = writingLine(rows[index]);
    writingName(fresh, index === active);
    if (standing !== null) {
      root.replaceChild(fresh, standing);
    } else {
      root.appendChild(fresh);
    }
    built += 1;
  }

  while (root.children.length > rows.length) {
    root.removeChild(root.children[root.children.length - 1]);
  }
  if(root.dispatchEvent && typeof CustomEvent!=='undefined')root.dispatchEvent(new CustomEvent('writing-render'));
  return built;
}

/* The text out of the sheet. It is read out of the elements and never out of
 * a remembered text, because what a person typed stands in the elements and
 * nowhere else.
 */
function writingRawText(node) {
 if(node.nodeType===3)return node.data;
 if(node.getAttribute&&node.getAttribute('data-writing-decoration')!==null)return '';
 return Array.from(node.childNodes||[]).map(writingRawText).join('');
}
function writingTextOf(root) {
  var out = [];
  var lines = root.children;
  var index;

  for (index = 0; index < lines.length; index += 1) {
    out.push(writingRawText(lines[index]));
    out.push(writingEnding(lines[index], index === lines.length - 1));
  }
  return out.join('');
}

/* Every text node of a line, in the order a reader meets them. */
function writingTexts(line) {
  var found = [];

  function walk(one) {
    if(one.getAttribute&&one.getAttribute('data-writing-decoration')!==null)return;
    var kids;
    var index;
    if (one.nodeType === 3) {
      found.push(one);
      return;
    }
    kids = one.childNodes;
    for (index = 0; index < kids.length; index += 1) {
      walk(kids[index]);
    }
  }

  walk(line);
  return found;
}

/* How many characters of the line stand before this node. */
function writingBefore(line, node) {
  var count = 0;
  var found = false;

  function walk(one) {
    if(one.getAttribute&&one.getAttribute('data-writing-decoration')!==null)return;
    var kids;
    var index;
    if (found) {
      return;
    }
    if (one === node) {
      found = true;
      return;
    }
    if (one.nodeType === 3) {
      count += one.data.length;
      return;
    }
    kids = one.childNodes;
    for (index = 0; index < kids.length && !found; index += 1) {
      walk(kids[index]);
    }
  }

  walk(line);
  return found ? count : -1;
}

/* A place in the tree, as a column of the line. The browser hands a node and
 * an offset, and the offset counts characters in a text node but children in
 * an element, so both are answered.
 */
function writingColumn(line, node, offset) {
  var before;
  var count = 0;
  var kids;
  var index;

  if (!node) {
    return 0;
  }
  if (node.nodeType === 3) {
    before = writingBefore(line, node);
    return before < 0 ? 0 : before + offset;
  }
  kids = node.childNodes;
  for (index = 0; index < offset && index < kids.length; index += 1) {
    count += writingRawText(kids[index]).length;
  }
  before = node === line ? 0 : writingBefore(line, node);
  return (before < 0 ? 0 : before) + count;
}

/* A column of the line, as a place in the tree. This is the other half of the
 * caret: the redraw builds new elements, and the caret has to find its way
 * back into them.
 */
function writingPlace(line, column) {
  var texts = writingTexts(line);
  var seen = 0;
  var index;
  var width;
  var last;

  for (index = 0; index < texts.length; index += 1) {
    width = texts[index].data.length;
    if (column <= seen + width) {
      return { node: texts[index], offset: column - seen };
    }
    seen += width;
  }
  if (texts.length > 0) {
    last = texts[texts.length - 1];
    return { node: last, offset: last.data.length };
  }
  return { node: line, offset: 0 };
}

/* Setting a form.
 *
 * SC-09 asks for two things of every form the stock carries: that it is shown
 * and that it can be set. Setting one is writing its characters into the text
 * and nothing else. There is no second representation that could fall out of
 * step, because the text is the only thing there is.
 *
 * A form is either a pair around a stretch or a prefix in front of a line. The
 * same form set twice takes itself away again, which is what makes a control
 * usable at all: a person who set the wrong one is one press away from the
 * text they had.
 */
var WRAPPERS = {
  'bold': ['**', '**'],
  'italic': ['*', '*'],
  'underline': ['<u>', '</u>'],
  'strike': ['~~', '~~'],
  'highlight': ['==', '=='],
  'code': ['`', '`'],
  'math': ['$', '$'],
  /* The four that carry a target. The pair is not symmetrical, because the
   * hole a person types the target into stands in the closing half.
   */
  'wikilink': ['[[', ']]'],
  'embed': ['![[', ']]'],
  'link': ['[', ']()'],
  'image': ['![', ']()'],
  'footref': ['[^', ']']
};

var PREFIXES = {
  'quote': '> ',
  'list': '- ',
  'list-ordered': '1. ',
  'task': '- [ ] ',
  'heading-1': '# ',
  'heading-2': '## ',
  'heading-3': '### ',
  'heading-4': '#### ',
  'heading-5': '##### ',
  'heading-6': '###### ',
  'footnote': '[^1]: '
};

/* The forms that bring lines of their own. They are not a pair and not a
 * prefix: they put something into the text that a person then writes in.
 *
 * That is why they take themselves away only while what they put there still
 * stands untouched. Deleting a line somebody has written in, under the name of
 * a toggle, would be deleting their work.
 */
var BLOCKS = {
  'rule': { after: ['---'] },
  'table': { after: ['| Spalte | Spalte |', '|---|---|', '|  |  |'] },
  'code-block': { around: ['```', '```'] }
};

/* A box is a quote that carries a name, so its first line is marked otherwise
 * than the rest of it.
 */
var CALLOUT_LEAD = '> [!hinweis] ';
var CALLOUT_REST = '> ';
var CALLOUT_PATTERNS = { lead: /^>\s?\[![^\]]*\]\s?/, rest: /^>\s?/ };

/* What already stands in front of a line, per family. A heading is one family
 * over all six levels, because a line carrying two of them would be a line
 * that is two headings.
 */
var PREFIX_PATTERNS = {
  'quote': /^> ?/,
  'list': /^[-*+] (?!\[[ xX]\] )/,
  'list-ordered': /^\d+\. /,
  'task': /^[-*+] \[[ xX]\] /,
  'footnote': /^\[\^[^\]\s]+\]:\s?/,
  'heading': /^#{1,6} /
};

var SETTABLE = Object.keys(WRAPPERS)
  .concat(Object.keys(PREFIXES))
  .concat(['callout'])
  .concat(Object.keys(BLOCKS));

function writingFamily(form) {
  if (form.indexOf('heading-') === 0) {
    return PREFIX_PATTERNS.heading;
  }
  return Object.prototype.hasOwnProperty.call(PREFIX_PATTERNS, form)
    ? PREFIX_PATTERNS[form] : null;
}

/* Where a prefix goes in. A quote stands at the front of the line; everything
 * else stands behind the quote markers, because a list inside a quote is a
 * quoted list and not a listed quote.
 */
function writingAfterQuote(line) {
  var found = /^(?:> ?)*/.exec(line);
  return found === null ? 0 : found[0].length;
}

function writingHasPrefix(line, form) {
  var at = form === 'quote' ? 0 : writingAfterQuote(line);
  var pattern = writingFamily(form);
  var found = pattern === null ? null : pattern.exec(line.slice(at));

  return found !== null && found[0] === PREFIXES[form];
}

function writingPrefixLine(line, form, take) {
  var at = form === 'quote' ? 0 : writingAfterQuote(line);
  var head = line.slice(0, at);
  var rest = line.slice(at);
  var pattern = writingFamily(form);
  var found = pattern === null ? null : pattern.exec(rest);
  var stood = found === null ? 0 : found[0].length;
  var without = rest.slice(stood);

  if (take) {
    return { line: head + without, moved: -stood };
  }
  return {
    line: head + PREFIXES[form] + without,
    moved: PREFIXES[form].length - stood
  };
}

/* The stretch of the text that holds every line the mark touches. */
function writingLineSpan(text, from, to) {
  var start = from <= 0 ? 0 : text.lastIndexOf('\n', from - 1) + 1;
  var stop = text.indexOf('\n', to);

  return { start: start, stop: stop === -1 ? text.length : stop };
}

/* Whether a stretch already stands inside this pair.
 *
 * The single star is the one case that needs a second look: inside a double
 * one it is the marker of a bold word, and taking one off each side would
 * leave a broken word rather than a word with one form less.
 */
function writingWrapped(before, after, pair) {
  var open = pair[0];
  var close = pair[1];

  if (before.slice(-open.length) !== open
      || after.slice(0, close.length) !== close) {
    return false;
  }
  return !(open === '*' && before.slice(-2) === '**' && after.slice(0, 2) === '**');
}

function writingWrap(text, from, to, pair) {
  var open = pair[0];
  var close = pair[1];
  var before = text.slice(0, from);
  var inner = text.slice(from, to);
  var after = text.slice(to);

  if (writingWrapped(before, after, pair)) {
    return {
      text: before.slice(0, before.length - open.length) + inner
        + after.slice(close.length),
      from: from - open.length,
      to: to - open.length
    };
  }
  if (inner.length >= open.length + close.length
      && writingWrapped(inner.slice(0, open.length),
                        inner.slice(inner.length - close.length), pair)
      && !(open === '*' && inner.slice(0, 2) === '**')) {
    return {
      text: before + inner.slice(open.length, inner.length - close.length) + after,
      from: from,
      to: to - open.length - close.length
    };
  }
  return {
    text: before + open + inner + close + after,
    from: from + open.length,
    to: to + open.length
  };
}

function writingSetPrefix(text, from, to, form) {
  var span = writingLineSpan(text, from, to);
  var lines = text.slice(span.start, span.stop).split('\n');
  var take = true;
  var out = [];
  var first = 0;
  var total = 0;
  var index;
  var one;

  for (index = 0; index < lines.length; index += 1) {
    if (!writingHasPrefix(lines[index], form)) {
      take = false;
    }
  }
  for (index = 0; index < lines.length; index += 1) {
    one = writingPrefixLine(lines[index], form, take);
    out.push(one.line);
    if (index === 0) {
      first = one.moved;
    }
    total += one.moved;
  }
  return {
    text: text.slice(0, span.start) + out.join('\n') + text.slice(span.stop),
    from: Math.max(span.start, from + first),
    to: Math.max(span.start, to + total)
  };
}

/* A box: the name on the first line, the sign on every further one. */
function writingSetCallout(text, from, to) {
  var span = writingLineSpan(text, from, to);
  var lines = text.slice(span.start, span.stop).split('\n');
  var take = CALLOUT_PATTERNS.lead.test(lines[0]);
  var out = [];
  var first = 0;
  var total = 0;
  var index;
  var pattern;
  var want;
  var found;
  var stood;
  var moved;

  for (index = 1; index < lines.length && take; index += 1) {
    take = CALLOUT_PATTERNS.rest.test(lines[index]);
  }
  for (index = 0; index < lines.length; index += 1) {
    pattern = index === 0 ? CALLOUT_PATTERNS.lead : CALLOUT_PATTERNS.rest;
    want = index === 0 ? CALLOUT_LEAD : CALLOUT_REST;
    found = pattern.exec(lines[index]);
    stood = found === null ? 0 : found[0].length;
    out.push((take ? '' : want) + lines[index].slice(stood));
    moved = (take ? 0 : want.length) - stood;
    if (index === 0) {
      first = moved;
    }
    total += moved;
  }
  return {
    text: text.slice(0, span.start) + out.join('\n') + text.slice(span.stop),
    from: Math.max(span.start, from + first),
    to: Math.max(span.start, to + total)
  };
}

/* A line without the carriage return that may end it. */
function writingBare(line) {
  return line.charAt(line.length - 1) === '\r'
    ? line.slice(0, line.length - 1) : line;
}

/* A form that brings lines: put them in, or take them out again while they
 * stand exactly as they were put in.
 */
function writingSetBlock(text, from, to, form) {
  var shape = BLOCKS[form];
  var span = writingLineSpan(text, from, to);
  var head = text.slice(0, span.start);
  var body = text.slice(span.start, span.stop);
  var tail = text.slice(span.stop);
  var brought;
  var above;
  var below;
  var all;
  var first;
  var last;
  var moved;

  if (shape.around) {
    /* The fence stands outside the marked lines, so this one counts in lines
     * of the whole text and not in the stretch the mark covers.
     */
    above = shape.around[0];
    below = shape.around[1];
    all = text.split('\n');
    first = writingLineAt(text, from);
    last = writingLineAt(text, to);
    if (first > 0 && last < all.length - 1
        && writingBare(all[first - 1]) === above
        && writingBare(all[last + 1]) === below) {
      moved = all[first - 1].length + 1;
      return {
        text: all.slice(0, first - 1)
          .concat(all.slice(first, last + 1))
          .concat(all.slice(last + 2))
          .join('\n'),
        from: Math.max(0, from - moved),
        to: Math.max(0, to - moved)
      };
    }
    moved = above.length + 1;
    return {
      text: all.slice(0, first)
        .concat([above])
        .concat(all.slice(first, last + 1))
        .concat([below])
        .concat(all.slice(last + 1))
        .join('\n'),
      from: from + moved,
      to: to + moved
    };
  }
  brought = '\n' + shape.after.join('\n');
  if (tail.slice(0, brought.length) === brought
      && (tail.length === brought.length
          || tail.charAt(brought.length) === '\n'
          || tail.charAt(brought.length) === '\r')) {
    return { text: head + body + tail.slice(brought.length), from: from, to: to };
  }
  return { text: head + body + brought + tail, from: from, to: to };
}

/* One form, written into the text. The answer is the text and where the mark
 * stands in it afterwards, so a person keeps the words they had marked. A form
 * this module does not carry changes nothing, because a control that half
 * works is worse than one that does not.
 */
function writingSet(text, from, to, form) {
  var start = Math.max(0, Math.min(from, to));
  var stop = Math.min(text.length, Math.max(from, to));

  if (Object.prototype.hasOwnProperty.call(WRAPPERS, form)) {
    return writingWrap(text, start, stop, WRAPPERS[form]);
  }
  if (Object.prototype.hasOwnProperty.call(PREFIXES, form)) {
    return writingSetPrefix(text, start, stop, form);
  }
  if (form === 'callout') {
    return writingSetCallout(text, start, stop);
  }
  if (Object.prototype.hasOwnProperty.call(BLOCKS, form)) {
    return writingSetBlock(text, start, stop, form);
  }
  return { text: text, from: from, to: to };
}

/* Upper and lower case made the same, character by character.
 *
 * A whole text folded at once would be shorter than the text it came from,
 * because there are letters whose lower case is two characters. Every place
 * behind such a letter would then sit one character too far left, and a place
 * that sits one character too far left writes over the letter beside the word.
 * So a letter that does not fold to a single character keeps its own shape.
 * That costs a missed match on a letter almost nobody searches for; the other
 * way costs somebody their text.
 */
function writingFold(text) {
  var out = '';
  var index;
  var one;
  var low;

  for (index = 0; index < text.length; index += 1) {
    one = text.charAt(index);
    low = one.toLowerCase();
    out += low.length === 1 ? low : one;
  }
  return out;
}

/* Every place a needle stands, left to right and never overlapping.
 *
 * The needle is characters and never a pattern. Whoever searches for ** means
 * two stars, and on a surface that shows its markers that is a thing people
 * search for; a rule that read them as syntax would find the wrong places or
 * none. indexOf takes characters, so the walk is indexOf and nothing else.
 *
 * An empty needle stands between every two characters, which is a walk that
 * never ends, so it stands nowhere.
 */
function writingFinds(text, needle, fold) {
  var said = text === null || text === undefined ? '' : String(text);
  var want = needle === null || needle === undefined ? '' : String(needle);
  var over = fold === true ? writingFold(said) : said;
  var seek = fold === true ? writingFold(want) : want;
  var out = [];
  var at = 0;
  var found;

  if (seek === '') {
    return out;
  }
  while (at <= over.length - seek.length) {
    found = over.indexOf(seek, at);
    if (found === -1) {
      return out;
    }
    out.push({ from: found, to: found + seek.length });
    at = found + seek.length;
  }
  return out;
}

/* How many names an offer carries at most. A list longer than a glance is a
 * list nobody reads: whoever has to scroll through the offer is faster typing
 * the name out. Eight fit under the line without covering the sentence they
 * belong to.
 */
var WRITING_OFFERS = 8;

/* One place written over. */
function writingReplaceAt(text, from, to, into) {
  var said = text === null || text === undefined ? '' : String(text);
  var put = into === null || into === undefined ? '' : String(into);

  return said.slice(0, from) + put + said.slice(to);
}

/* Every place written over, in one pass over the places that were found.
 *
 * The pass builds a new text beside the old one rather than writing into the
 * old one again and again, so what was just written is never walked a second
 * time. Replacing aa by aaa the other way gives a text that grows while it is
 * being read, and the walk ends where it runs out of patience.
 */
function writingReplaceAll(text, needle, into, fold) {
  var said = text === null || text === undefined ? '' : String(text);
  var put = into === null || into === undefined ? '' : String(into);
  var places = writingFinds(said, needle, fold);
  var out = '';
  var last = 0;
  var at = 0;
  var index;

  for (index = 0; index < places.length; index += 1) {
    out += said.slice(at, places[index].from) + put;
    last = out.length;
    at = places[index].to;
  }
  return { text: out + said.slice(at), count: places.length, last: last };
}

/* The caret, where the browser has one. Everything below answers with nothing
 * where there is no browser, because the way back through the text does not
 * need one and is what the suite measures.
 */
/* What somebody has begun to type as a link target, and nothing where they
 * have not begun one.
 *
 * The question is asked of the characters left of the caret and never of a
 * memory of what was pressed. Somebody puts a target down half-written, walks
 * away, comes back an hour later with the mouse and goes on typing; a rule
 * that watched two brackets go by would offer nothing then, and a rule that
 * remembered the last pair would offer in the wrong place. The text carries
 * everything the rule needs, and the text is what survives.
 *
 * The walk stops on four characters. A line break stops it because a target
 * does not run over a line, and without that one forgotten pair would turn
 * the whole rest of the page into one target. A closing bracket stops it
 * because the pair before it is shut. A bar stops it because what stands
 * behind the bar is what a reader sees and not where the reference goes. And
 * a single opening bracket stops it, because one bracket is not a pair.
 */
function writingTypedTarget(text, caret) {
  var said = text === null || text === undefined ? '' : String(text);
  var index;
  var one;

  if (typeof caret !== 'number' || caret < 0 || caret > said.length) {
    return null;
  }
  for (index = caret - 1; index >= 0; index -= 1) {
    one = said.charAt(index);
    if (one === '\n' || one === '|' || one === ']') {
      return null;
    }
    if (one === '[') {
      if (index > 0 && said.charAt(index - 1) === '[') {
        return { from: index + 1, to: caret,
                 said: said.slice(index + 1, caret) };
      }
      return null;
    }
  }
  return null;
}

/* Which of the names on the shelf fit what has been typed so far.
 *
 * The names are handed over and never looked for, because the shelf belongs
 * to the page and the page knows which bundle is open.
 *
 * What this rule owns is the order. A name that begins with what was typed
 * stands before one that carries it somewhere in the middle, and that is the
 * difference between the first offer being right and the first offer being a
 * coincidence. Among equals the shelf decides, because it arrives sorted and
 * a second sort here would fight it.
 *
 * Nothing typed offers everything there is, up to the bound: somebody who
 * typed the pair and stopped is asking what there is.
 */
function writingOffers(names, said, limit) {
  var list = names && typeof names.length === 'number' ? names : [];
  var want = writingFold(said === null || said === undefined ? '' : String(said));
  var most = typeof limit === 'number' && limit > 0 ? limit : WRITING_OFFERS;
  var front = [];
  var rest = [];
  var index;
  var one;
  var where;

  for (index = 0; index < list.length; index += 1) {
    one = String(list[index]);
    where = writingFold(one).indexOf(want);
    if (where === 0) {
      front.push(one);
    } else if (where > 0) {
      rest.push(one);
    }
  }
  return front.concat(rest).slice(0, most);
}

function writingChoice() {
  if (typeof window === 'undefined' || !window) {
    return null;
  }
  if (typeof window.getSelection !== 'function') {
    return null;
  }
  return window.getSelection();
}

function writingLineOf(root, node) {
  var one = node;

  while (one && one !== root) {
    if (one.parentNode === root) {
      return one;
    }
    one = one.parentNode;
  }
  return null;
}

function writingSpot(root) {
  var chosen = writingChoice();
  var range;
  var line;
  var lines;
  var index;

  if (!chosen || chosen.rangeCount === 0) {
    return null;
  }
  range = chosen.getRangeAt(0);
  line = writingLineOf(root, range.startContainer);
  if (!line) {
    return null;
  }
  lines = root.children;
  for (index = 0; index < lines.length; index += 1) {
    if (lines[index] === line) {
      return {
        line: index,
        column: writingColumn(line, range.startContainer, range.startOffset)
      };
    }
  }
  return null;
}

function writingSeat(root, spot) {
  var chosen = writingChoice();
  var papers = writingDocument();
  var lines = root.children;
  var place;
  var range;

  if (!chosen || !spot || !papers || typeof papers.createRange !== 'function') {
    return false;
  }
  if (spot.line < 0 || spot.line >= lines.length) {
    return false;
  }
  place = writingPlace(lines[spot.line], spot.column);
  range = papers.createRange();
  range.setStart(place.node, place.offset);
  range.collapse(true);
  chosen.removeAllRanges();
  chosen.addRange(range);
  return true;
}

/* The whole text as one ruler.
 *
 * A stretch somebody marked runs across lines, and a line knows nothing about
 * that. The tree counts in lines and columns, the text counts in characters,
 * and setting a form needs both to say the same thing about the same place.
 *
 * The one place where they cannot agree is the middle of a carriage return:
 * between the two characters that end a line there is no place in the tree, so
 * an offset falling there belongs to the end of the line it terminates.
 */
function writingOffset(root, line, column) {
  var lines = root.children;
  var total = 0;
  var index;

  for (index = 0; index < line && index < lines.length; index += 1) {
    total += writingRawText(lines[index]).length
      + writingEnding(lines[index], index === lines.length - 1).length;
  }
  return total + Math.max(0, column);
}

function writingSpotAt(root, offset) {
  var lines = root.children;
  var left = Math.max(0, offset);
  var width;
  var ending;
  var index;

  for (index = 0; index < lines.length; index += 1) {
    width = writingRawText(lines[index]).length;
    ending = writingEnding(lines[index], index === lines.length - 1).length;
    if (left <= width || index === lines.length - 1) {
      return { line: index, column: Math.max(0, Math.min(left, width)) };
    }
    if (left < width + ending) {
      return { line: index, column: width };
    }
    left -= width + ending;
  }
  return { line: 0, column: 0 };
}

/* Which line an offset of the text falls in, counted in the text itself. It is
 * asked before the tree is built, so it cannot ask the tree.
 */
function writingLineAt(text, offset) {
  return text.slice(0, Math.max(0, offset)).split('\n').length - 1;
}

function writingWhere(root, node, offset) {
  if (node === root) return writingOffset(root, Math.min(offset, root.children.length), 0);
  var line = writingLineOf(root, node);
  var lines = root.children;
  var index;

  if (!line) {
    return null;
  }
  for (index = 0; index < lines.length; index += 1) {
    if (lines[index] === line) {
      return writingOffset(root, index, writingColumn(line, node, offset));
    }
  }
  return null;
}

/* Both ends of what a person marked, as offsets of the whole text. */
function writingSpan(root) {
  var chosen = writingChoice();
  var range;
  var head;
  var tail;

  if (!chosen || chosen.rangeCount === 0) {
    return null;
  }
  range = chosen.getRangeAt(0);
  head = writingWhere(root, range.startContainer, range.startOffset);
  tail = writingWhere(root, range.endContainer, range.endOffset);
  if (head === null || tail === null) {
    return null;
  }
  return { from: Math.min(head, tail), to: Math.max(head, tail) };
}

function writingSeatSpan(root, from, to) {
  var chosen = writingChoice();
  var papers = writingDocument();
  var lines = root.children;
  var head;
  var tail;
  var range;

  if (!chosen || !papers || typeof papers.createRange !== 'function') {
    return false;
  }
  if (from.line < 0 || from.line >= lines.length) {
    return false;
  }
  if (to.line < 0 || to.line >= lines.length) {
    return false;
  }
  head = writingPlace(lines[from.line], from.column);
  tail = writingPlace(lines[to.line], to.column);
  range = papers.createRange();
  range.setStart(head.node, head.offset);
  range.setEnd(tail.node, tail.offset);
  chosen.removeAllRanges();
  chosen.addRange(range);
  return true;
}

/* How many steps back the surface keeps. A step holds a whole text, and a
 * page of this stock measures around 25 KB, so two hundred of them is a few
 * megabytes in the worst case and the oldest one is dropped rather than the
 * newest refused.
 */
var WRITING_STEPS = 200;

/* What changed between two texts, as one stretch: where it begins, what went
 * away and what came in. Two texts one keystroke apart differ in exactly one
 * place, so the head they share and the tail they share say the rest. This is
 * not a general comparison of two files and never claims to be; it is the
 * question a history has to answer after every keystroke, and the answer to
 * that question is always one stretch.
 */
function writingChange(before, after) {
  var head = 0;
  var tailBefore = before.length;
  var tailAfter = after.length;

  while (head < before.length && head < after.length
      && before.charAt(head) === after.charAt(head)) {
    head += 1;
  }
  while (tailBefore > head && tailAfter > head
      && before.charAt(tailBefore - 1) === after.charAt(tailAfter - 1)) {
    tailBefore -= 1;
    tailAfter -= 1;
  }
  return {
    at: head,
    took: before.slice(head, tailBefore),
    put: after.slice(head, tailAfter)
  };
}

function writingNothingChanged(change) {
  return change.took === '' && change.put === '';
}

/* A space closes the step it lands in. That is what makes the way back run
 * word by word instead of letter by letter, and word by word is what a person
 * pressing the key twice in a row expects.
 */
function writingCloses(change) {
  return /\s/.test(change.put) || /\s/.test(change.took);
}

/* Whether a change carries on the one before it. Two insertions carry on each
 * other where the second begins exactly where the first ended; two deletions
 * where the second takes away what now stands next to the first, from either
 * side, because a person deleting backwards and a person deleting forwards are
 * both deleting. An insertion after a deletion never carries on, because a
 * person who wrote over something means those as two things.
 */
function writingCarriesOn(last, next) {
  if (!last) {
    return false;
  }
  if (last.took === '' && next.took === '') {
    return next.at === last.at + last.put.length;
  }
  if (last.put === '' && next.put === '') {
    return next.at + next.took.length === last.at || next.at === last.at;
  }
  return false;
}

/* The one thing the rest of the surface reaches. It carries a value that reads
 * and sets like the field it replaces, so a caller that only wants the text of
 * the page stays the caller it was.
 */
function writingSurface(root) {
  var state = {
    active: -1,
    hear: [],
    text: '',
    back: [],
    forward: [],
    last: null,
    open: false
  };
  var surface;

  /* One change, seen and filed. What goes on the pile is the text as it stood
   * before, so a step back is a text and never a set of instructions to run
   * backwards; a text that is put back is the text that stood there, and
   * nothing has to be undone correctly for that to hold.
   */
  function note(next) {
    var change = writingChange(state.text, next);

    if (writingNothingChanged(change)) {
      return false;
    }
    if (!(state.open && writingCarriesOn(state.last, change))) {
      state.back.push(state.text);
      if (state.back.length > WRITING_STEPS) {
        state.back.shift();
      }
      state.forward = [];
    }
    state.open = !writingCloses(change);
    state.last = change;
    state.text = next;
    return true;
  }

  /* A text put back, from either pile. The caret goes to the end of what came
   * back, because that is where the hand was when the text last looked like
   * this.
   */
  function put(text, historyAction) {
    var change = writingChange(state.text, text);
    var spot = change.at + change.put.length;

    state.text = text;
    state.last = null;
    state.open = false;
    state.active = writingLineAt(text, spot);
    writingDraw(root, text, state.active);
    writingSeatSpan(root, writingSpotAt(root, spot), writingSpotAt(root, spot));
    state.hear.forEach(function (one) {
      one(text, historyAction);
    });
    return true;
  }

  function undo() {
    if (state.back.length === 0) {
      return false;
    }
    state.forward.push(state.text);
    return put(state.back.pop(), 'undo');
  }

  function redo() {
    if (state.forward.length === 0) {
      return false;
    }
    state.back.push(state.text);
    return put(state.forward.pop(), 'redo');
  }

  function history() {
    return { back: state.back.length, forward: state.forward.length };
  }

  function draw(text, active) {
    return writingDraw(root, text, active === undefined ? state.active : active);
  }

  /* After a person typed: read the text out of the tree, remember where the
   * caret was, build the lines that changed, and put the caret back.
   */
  function refresh() {
    var spot = writingSpot(root);
    var text = writingTextOf(root);
    var built;

    note(text);
    state.active = spot ? spot.line : -1;
    built = writingDraw(root, text, state.active);
    if (spot && built > 0) {
      writingSeat(root, spot);
    }
    state.hear.forEach(function (one) {
      one(text);
    });
    return built;
  }

  /* After a person moved: only the name of the active line changes, so the
   * markers of the line left behind step back and the line kept its height.
   */
  function follow() {
    var spot = writingSpot(root);
    var next = spot ? spot.line : -1;
    var lines;
    var index;

    if (next === state.active) {
      return false;
    }
    state.active = next;
    lines = root.children;
    for (index = 0; index < lines.length; index += 1) {
      writingName(lines[index], index === state.active);
    }
    return true;
  }

  /* A text that changed, put in place in one step. Four things belong to it,
   * and a page that does three of them has moved under the hand: the old text
   * goes on the pile, the lines that changed are drawn, the mark ends up where
   * it was asked for, and everybody listening hears the new text.
   */
  function settle(text, from, to) {
    note(text);
    state.open = false;
    state.active = writingLineAt(text, to);
    writingDraw(root, text, state.active);
    writingSeatSpan(root, writingSpotAt(root, from), writingSpotAt(root, to));
    state.hear.forEach(function (one) {
      one(text);
    });
    return { text: text, from: from, to: to };
  }

  /* Where the text says something. It is asked of the surface rather than
   * computed beside it, because the text stands in the elements and a copy
   * kept somewhere else is a copy that goes stale between two keystrokes.
   */
  function finds(needle, fold) {
    return writingFinds(writingTextOf(root), needle, fold);
  }

  /* One place shown: the mark goes over it, and the line it stands in becomes
   * the line being written in, so its markers step forward like any other line
   * somebody's caret is in. Nothing is written, so nothing goes on the pile.
   */
  function show(span) {
    var text = writingTextOf(root);

    if (!span || span.from < 0 || span.to > text.length || span.from > span.to) {
      return false;
    }
    state.active = writingLineAt(text, span.from);
    writingDraw(root, text, state.active);
    writingSeatSpan(root, writingSpotAt(root, span.from),
                    writingSpotAt(root, span.to));
    return true;
  }

  /* One place written over, with the caret behind what was written, which is
   * where a hand would be after typing it.
   */
  function replace(span, into) {
    var text = writingTextOf(root);
    var put = into === null || into === undefined ? '' : String(into);

    if (!span || span.from < 0 || span.to > text.length || span.from > span.to) {
      return false;
    }
    return settle(writingReplaceAt(text, span.from, span.to, put),
                  span.from, span.from + put.length);
  }

  /* Every place written over, and one step on the pile for all of them.
   * Replacing twelve places is one act as a person means it, so taking it back
   * is one press. A pass that filed twelve steps would be correct and
   * unusable. A pass that found nothing files nothing, because an empty step
   * back is a press that does nothing and looks broken.
   */
  function replaceAll(needle, into, fold) {
    var done = writingReplaceAll(writingTextOf(root), needle, into, fold);

    if (done.count === 0) {
      return 0;
    }
    settle(done.text, done.last, done.last);
    return done.count;
  }

  /* What somebody has begun to type as a link target at the caret. Where no
   * caret is handed over it is asked of the selection, because the page has
   * one and the bench has not.
   */
  function typed(caret) {
    var where = typeof caret === 'number' ? caret : null;
    var span;

    if (where === null) {
      span = writingSpan(root);
      if (!span) {
        return null;
      }
      where = span.to;
    }
    return writingTypedTarget(writingTextOf(root), where);
  }

  /* A name taken from the offer, put where it was being typed, with the caret
   * behind the closing pair so the sentence goes on.
   *
   * The closing pair is written only where none stands. Some hands type both
   * pairs first and the target afterwards, and writing a second one would
   * leave two behind for them to clean up.
   */
  function complete(name, caret) {
    var open = typed(caret);
    var put = name === null || name === undefined ? '' : String(name);
    var text;
    var shut;
    var behind;

    if (!open) {
      return false;
    }
    text = writingTextOf(root);
    shut = text.slice(open.to, open.to + 2) === ']]' ? '' : ']]';
    behind = open.from + put.length + 2;
    return settle(writingReplaceAt(text, open.from, open.to, put + shut),
                  behind, behind);
  }

  /* One form, set over what a person marked. Three things happen in one step,
   * because a page that does two of them has moved under the hand: the
   * characters go into the text, the lines that changed are drawn, and the
   * mark ends up on the words it was set for.
   */
  function apply(form, span) {
    var where = span || writingSpan(root);
    var text;
    var done;

    if (!where) {
      return false;
    }
    text = writingTextOf(root);
    done = writingSet(text, where.from, where.to, form);
    if (done.text === text) {
      return { text: text, from: where.from, to: where.to };
    }
    settle(done.text, done.from, done.to);
    return done;
  }

  function listen(one) {
    if (typeof one === 'function') {
      state.hear.push(one);
    }
  }

  /* A text set from outside, treated the way a typed one is.
   *
   * The setter of ``value`` is for loading a page: it empties both piles,
   * because what stood there belonged to another page and a step back into it
   * would be a step into somebody else's text. A relation somebody entered,
   * or a side they took over from the comparison, is neither of those. It is a
   * change to the page in front of them, so it goes onto the pile and reaches
   * whoever is listening. The draft store hangs on exactly that (SC-06):
   * without it the relation was missing from the draft after a closed window,
   * and one step back did not take it either.
   */
  function place(text) {
    var said = text === null || text === undefined ? '' : String(text);
    note(said);
    return put(said);
  }

  surface = {
    root: root,
    draw: draw,
    refresh: refresh,
    follow: follow,
    apply: apply,
    finds: finds,
    show: show,
    replace: replace,
    replaceAll: replaceAll,
    typed: typed,
    complete: complete,
    settable: SETTABLE,
    listen: listen,
    place: place,
    undo: undo,
    redo: redo,
    history: history,
    get value() {
      return writingTextOf(root);
    },
    set value(text) {
      var said = text === null || text === undefined ? '' : String(text);
      state.active = -1;
      state.text = said;
      state.back = [];
      state.forward = [];
      state.last = null;
      state.open = false;
      writingDraw(root, said, -1);
    }
  };

  if (root && typeof root.addEventListener === 'function') {
    // Own text transactions instead of reinterpreting the browser's nested
    // div/br mutations. Native composition must finish before any redraw.
    var composing = false;
    root.addEventListener('compositionstart', function () { composing = true; });
    root.addEventListener('compositionend', function () { composing = false; refresh(); });
    root.addEventListener('beforeinput', function (event) {
      if (composing || event.isComposing || !event.cancelable || root.contentEditable === 'false') return;
      var span = writingSpan(root), type = event.inputType, text = writingTextOf(root), inserted;
      if (!span) return;
      if (type === 'historyUndo' || type === 'historyRedo') { event.preventDefault(); if (type === 'historyUndo') undo(); else redo(); return; }
      if (type === 'insertText' && typeof event.data === 'string') inserted = event.data;
      else if (type === 'insertParagraph' || type === 'insertLineBreak') inserted = text.indexOf('\r\n') >= 0 ? '\r\n' : '\n';
      else if (type === 'deleteContentBackward' || type === 'deleteContentForward') {
        inserted = '';
        if (span.from === span.to) {
          if (type === 'deleteContentBackward' && span.from > 0) span.from -= text.slice(0,span.from).endsWith('\r\n') ? 2 : (typeof Intl.Segmenter==='function'?Array.from(new Intl.Segmenter(undefined,{granularity:'grapheme'}).segment(text.slice(0,span.from))).pop().segment:Array.from(text.slice(0,span.from)).pop()).length;
          if (type === 'deleteContentForward' && span.to < text.length) span.to += text.slice(span.to).startsWith('\r\n') ? 2 : (typeof Intl.Segmenter==='function'?Array.from(new Intl.Segmenter(undefined,{granularity:'grapheme'}).segment(text.slice(span.to)))[0].segment:Array.from(text.slice(span.to))[0]).length;
        }
      } else return;
      event.preventDefault();
      settle(text.slice(0,span.from) + inserted + text.slice(span.to), span.from + inserted.length, span.from + inserted.length);
    });
    root.addEventListener('paste', function (event) {
      var span = writingSpan(root);
      if (!span || !event.clipboardData || root.contentEditable === 'false') return;
      event.preventDefault();
      var text = writingTextOf(root), inserted = event.clipboardData.getData('text/plain');
      settle(text.slice(0,span.from) + inserted + text.slice(span.to), span.from + inserted.length, span.from + inserted.length);
    });
    root.addEventListener('input', function () {
      if (!composing) refresh();
    });
    root.addEventListener('keyup', function () {
      follow();
    });
    root.addEventListener('mouseup', function () {
      follow();
    });
  }
  return surface;
}

/* The bench entry. The browser never reaches this line: from the file system
 * the page loads this file as a classic script, where module is not defined.
 */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    writingDraw: writingDraw,
    writingTextOf: writingTextOf,
    writingPlace: writingPlace,
    writingColumn: writingColumn,
    writingOffset: writingOffset,
    writingSpotAt: writingSpotAt,
    writingSet: writingSet,
    writingFold: writingFold,
    writingFinds: writingFinds,
    writingReplaceAt: writingReplaceAt,
    writingReplaceAll: writingReplaceAll,
    writingTypedTarget: writingTypedTarget,
    writingOffers: writingOffers,
    writingSurface: writingSurface,
    SETTABLE: SETTABLE
  };
}
