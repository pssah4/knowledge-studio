'use strict';

/* What the surface shows while somebody types, cut out of the text itself.
 *
 * SC-09 names the forms a page carries and SC-10 asks that they take effect in
 * the same moment and in the same place. There is no second view to switch to
 * (ASR-07), so the display cannot be a rendering beside the text: it has to be
 * the text, cut into pieces, with a name on each piece.
 *
 * That is all this file does. marksOf(text) walks the lines and answers one
 * row per line. A row carries the line, its ending, and the pieces the line
 * falls into. A piece is either syntax (mark true) or content (mark false),
 * and the pieces of a row put back together are the line again, character for
 * character. Nothing is replaced, nothing is dropped, nothing is added. The
 * page hides the syntax pieces on every line the caret is not in, which is why
 * the line a person writes in never changes its height while they write.
 *
 * The one rule this file does not carry is where the head ends. A head is read
 * in core.js and nowhere else (ADR-11), so this file asks parseHead for the
 * offset the body starts at and takes every line before it as head. In the
 * page both files stand in the one global scope, in the order index.html loads
 * them; on the bench the driver puts the core into that scope first.
 *
 * ADR-08 fixes the shape: a classic script, no module, no library, no step
 * that builds it. The entry at the very bottom is guarded, so the browser
 * never reaches it. Every name below carries a mark prefix except the three a
 * caller reaches, because the page has one scope and the other scripts of the
 * surface want the plain words.
 *
 *   marksOf(text)     the rows, one per line
 *   joinMarks(rows)   the text again, out of the pieces and never out of a
 *                     copy of the line
 *   FORMS             every name a piece can carry, so a stylesheet is
 *                     measured against a list and not against a guess
 */

/* Every name a piece can carry. A kind that is not in this list reaches no
 * stylesheet, and tests/test_marks.py holds the two against each other.
 */
var FORMS = [
  'head', 'head-fence', 'head-key', 'head-value',
  'fence', 'code-block',
  'rule', 'table', 'table-delimiter', 'table-cell',
  'quote', 'callout', 'callout-name', 'footnote',
  'heading', 'heading-1', 'heading-2', 'heading-3',
  'heading-4', 'heading-5', 'heading-6',
  'list', 'list-ordered', 'task', 'task-open', 'task-done',
  'code', 'math', 'embed', 'image', 'wikilink', 'link', 'footref',
  'bold', 'italic', 'underline', 'strike', 'highlight'
];

// The first character of every inline form. A character that is not one of
// these can never open one, so the walk skips it without asking a rule.
var MARK_OPENERS = '`$![*_~=<';

/* The lines ------------------------------------------------------------- */

/* Cut the text into lines and keep the ending of each one.
 *
 * The ending is kept because it is part of the file: a page written on another
 * device carries a return before its feed, and a display that answers with the
 * lines alone would hand back a file that lost one character per line.
 */
function markLines(text) {
  var rows = [];
  var start = 0;
  var index = 0;
  var line;
  var ending;

  for (index = 0; index < text.length; index += 1) {
    if (text.charAt(index) !== '\n') {
      continue;
    }
    line = text.slice(start, index);
    ending = '\n';
    if (line.length > 0 && line.charAt(line.length - 1) === '\r') {
      line = line.slice(0, line.length - 1);
      ending = '\r\n';
    }
    rows.push({ text: line, ending: ending });
    start = index + 1;
  }
  rows.push({ text: text.slice(start), ending: '' });
  return rows;
}

/* Where the body starts, asked of the one head reader there is.
 *
 * Without the core in scope there is no head, and the file is body from the
 * first line. That is the honest answer: this file will not read a head of its
 * own, because two readers of the same bytes is what ADR-11 forbids.
 */
function markHeadStop(text) {
  var read;
  if (typeof parseHead !== 'function') {
    return 0;
  }
  try {
    read = parseHead(text);
  } catch (failure) {
    return 0;
  }
  if (!read || typeof read.offset !== 'number' || read.offset < 0) {
    return 0;
  }
  return read.offset;
}

/* The pieces ------------------------------------------------------------ */

/* One piece. An empty one is never kept: it would separate nothing. */
function markPush(out, text, stack, isMark) {
  if (text === '') {
    return;
  }
  out.push({ text: text, kind: stack.join(' '), mark: isMark === true });
}

/* A name added to the stack, once. A form inside a form of the same name
 * would otherwise write it twice into the class of the piece.
 */
function markWith(stack, name) {
  return stack.indexOf(name) === -1 ? stack.concat([name]) : stack;
}

/* The two forms that carry a target before a bar: the part before the bar is
 * the address and belongs to the syntax, the part after it is what a reader
 * reads. Without a bar the whole inside is what a reader reads.
 */
function markPipe(open, inner, close) {
  var bar = inner.indexOf('|');
  if (bar === -1) {
    return [{ text: open, mark: true },
            { text: inner, mark: false },
            { text: close, mark: true }];
  }
  return [{ text: open + inner.slice(0, bar + 1), mark: true },
          { text: inner.slice(bar + 1), mark: false },
          { text: close, mark: true }];
}

/* The inline forms ------------------------------------------------------ */

/* Each rule reads the rest of the line from one place and answers either
 * nothing or the form that stands there: its name, how far it reaches, and
 * the pieces it falls into. A rule that answers nothing lets the next one ask.
 * The order is the order of the list, and it is a decision: code stands first
 * because no rule holds inside it, and the longer opener of a pair stands
 * before the shorter one.
 */
var MARK_RULES = [
  // Code am Stueck. Inside it nothing else is a form.
  function (rest) {
    var found = /^(`+)([^`]+)\1(?!`)/.exec(rest);
    if (found === null) {
      return null;
    }
    return { kind: 'code', literal: true, length: found[0].length,
             parts: [{ text: found[1], mark: true },
                     { text: found[2], mark: false },
                     { text: found[1], mark: true }] };
  },
  // A formula on its own, and a formula in a sentence.
  function (rest) {
    var found = /^(\$\$)([\s\S]+?)(\$\$)/.exec(rest);
    if (found === null) {
      return null;
    }
    return { kind: 'math', literal: true, length: found[0].length,
             parts: [{ text: found[1], mark: true },
                     { text: found[2], mark: false },
                     { text: found[3], mark: true }] };
  },
  function (rest) {
    var found = /^(\$)([^$\n]+)(\$)/.exec(rest);
    if (found === null) {
      return null;
    }
    return { kind: 'math', literal: true, length: found[0].length,
             parts: [{ text: found[1], mark: true },
                     { text: found[2], mark: false },
                     { text: found[3], mark: true }] };
  },
  // A page put into this one, and a picture.
  function (rest) {
    var found = /^(!\[\[)([^[\]]*)(\]\])/.exec(rest);
    if (found === null) {
      return null;
    }
    return { kind: 'embed', literal: true, length: found[0].length,
             parts: markPipe(found[1], found[2], found[3]) };
  },
  function (rest) {
    var found = /^(!\[)([^\]]*)(\]\()([^)]*\))/.exec(rest);
    if (found === null) {
      return null;
    }
    return { kind: 'image', length: found[0].length,
             parts: [{ text: found[1], mark: true },
                     { text: found[2], mark: false },
                     { text: found[3] + found[4], mark: true }] };
  },
  // The three shapes a verweis is written in.
  function (rest) {
    var found = /^(\[\[)([^[\]]*)(\]\])/.exec(rest);
    if (found === null) {
      return null;
    }
    return { kind: 'wikilink', literal: true, length: found[0].length,
             parts: markPipe(found[1], found[2], found[3]) };
  },
  function (rest) {
    var found = /^(\[\^)([^\]\s]+)(\])/.exec(rest);
    if (found === null) {
      return null;
    }
    return { kind: 'footref', literal: true, length: found[0].length,
             parts: [{ text: found[1], mark: true },
                     { text: found[2], mark: false },
                     { text: found[3], mark: true }] };
  },
  function (rest) {
    var found = /^(\[)([^\]]*)(\]\()([^)]*\))/.exec(rest);
    if (found === null) {
      return null;
    }
    return { kind: 'link', length: found[0].length,
             parts: [{ text: found[1], mark: true },
                     { text: found[2], mark: false },
                     { text: found[3] + found[4], mark: true }] };
  },
  // The five that put a weight on a word.
  function (rest) {
    var found = /^(\*\*)([\s\S]+?)(\*\*)/.exec(rest);
    if (found === null) {
      return null;
    }
    return { kind: 'bold', length: found[0].length,
             parts: [{ text: found[1], mark: true },
                     { text: found[2], mark: false },
                     { text: found[3], mark: true }] };
  },
  function (rest, left) {
    var found;
    if (/[A-Za-z0-9_]/.test(left)) {
      return null;
    }
    found = /^(__)([\s\S]+?)(__)(?![A-Za-z0-9_])/.exec(rest);
    if (found === null) {
      return null;
    }
    return { kind: 'bold', length: found[0].length,
             parts: [{ text: found[1], mark: true },
                     { text: found[2], mark: false },
                     { text: found[3], mark: true }] };
  },
  function (rest) {
    var found = /^(\*)([^*\n]+)(\*)/.exec(rest);
    if (found === null) {
      return null;
    }
    return { kind: 'italic', length: found[0].length,
             parts: [{ text: found[1], mark: true },
                     { text: found[2], mark: false },
                     { text: found[3], mark: true }] };
  },
  function (rest, left) {
    var found;
    if (/[A-Za-z0-9_]/.test(left)) {
      return null;
    }
    found = /^(_)([^_\n]+)(_)(?![A-Za-z0-9_])/.exec(rest);
    if (found === null) {
      return null;
    }
    return { kind: 'italic', length: found[0].length,
             parts: [{ text: found[1], mark: true },
                     { text: found[2], mark: false },
                     { text: found[3], mark: true }] };
  },
  function (rest) {
    var found = /^(~~)([\s\S]+?)(~~)/.exec(rest);
    if (found === null) {
      return null;
    }
    return { kind: 'strike', length: found[0].length,
             parts: [{ text: found[1], mark: true },
                     { text: found[2], mark: false },
                     { text: found[3], mark: true }] };
  },
  function (rest) {
    var found = /^(==)([\s\S]+?)(==)/.exec(rest);
    if (found === null) {
      return null;
    }
    return { kind: 'highlight', length: found[0].length,
             parts: [{ text: found[1], mark: true },
                     { text: found[2], mark: false },
                     { text: found[3], mark: true }] };
  },
  function (rest) {
    var found = /^(<u>)([\s\S]*?)(<\/u>)/.exec(rest);
    if (found === null) {
      return null;
    }
    return { kind: 'underline', length: found[0].length,
             parts: [{ text: found[1], mark: true },
                     { text: found[2], mark: false },
                     { text: found[3], mark: true }] };
  }
];

/* What stands at this place of the line, or nothing. */
function markFind(text, at) {
  var rest = text.slice(at);
  var left = at === 0 ? '' : text.charAt(at - 1);
  var index;
  var hit;

  for (index = 0; index < MARK_RULES.length; index += 1) {
    hit = MARK_RULES[index](rest, left);
    if (hit !== null && hit !== undefined) {
      return hit;
    }
  }
  return null;
}

/* Put one found form into the pieces. The syntax of it becomes a marker, and
 * what stands between goes through the walk again, so a form inside a form
 * carries both names. A form that is literal keeps its inside as it is: no
 * rule holds inside code, a formula or an address.
 */
function markEmit(hit, stack, out) {
  var inner = markWith(stack, hit.kind);
  var index;
  var part;
  var kinds;

  for (index = 0; index < hit.parts.length; index += 1) {
    part = hit.parts[index];
    kinds = part.kind ? markWith(inner, part.kind) : inner;
    if (part.mark) {
      markPush(out, part.text, kinds, true);
    } else if (hit.literal) {
      markPush(out, part.text, kinds, false);
    } else {
      markInline(part.text, kinds, out);
    }
  }
}

/* Walk a piece of a line and cut the inline forms out of it. What no rule
 * claims stays one piece of plain content, which is the ordinary case and has
 * to stay the cheap one.
 */
function markInline(text, stack, out) {
  var plain = 0;
  var at = 0;
  var hit;

  while (at < text.length) {
    hit = null;
    if (MARK_OPENERS.indexOf(text.charAt(at)) !== -1) {
      hit = markFind(text, at);
    }
    if (hit === null) {
      at += 1;
      continue;
    }
    markPush(out, text.slice(plain, at), stack, false);
    markEmit(hit, stack, out);
    at += hit.length;
    plain = at;
  }
  markPush(out, text.slice(plain), stack, false);
}

/* The forms of a whole line ---------------------------------------------- */

/* A head line. The name and its colon are content and not syntax: the head is
 * the one place where the names are the point, and hiding them would leave a
 * column of values nobody can read.
 */
function markHead(line, out) {
  var found;

  if (/^-{3,}\s*$/.test(line)) {
    markPush(out, line, ['head', 'head-fence'], false);
    return;
  }
  found = /^([^:\s][^:]*)(:)(\s*)(.*)$/.exec(line);
  if (found === null) {
    markPush(out, line, ['head'], false);
    return;
  }
  markPush(out, found[1] + found[2], ['head', 'head-key'], false);
  markPush(out, found[3] + found[4], ['head', 'head-value'], false);
}

/* Whether a line opens a block of code, and with which characters. */
function markFenceOpens(line) {
  var found = /^\s*(`{3,}|~{3,})(.*)$/.exec(line);
  if (found === null) {
    return null;
  }
  if (found[1].charAt(0) === '`' && found[2].indexOf('`') !== -1) {
    return null;
  }
  return { char: found[1].charAt(0), length: found[1].length };
}

/* Whether a line closes the block that is open. The closing line carries the
 * same character, at least as many of them, and nothing else.
 */
function markFenceCloses(line, fence) {
  var found = /^\s*(`{3,}|~{3,})\s*$/.exec(line);
  if (found === null) {
    return false;
  }
  return found[1].charAt(0) === fence.char && found[1].length >= fence.length;
}

/* Whether a row of a table is the one that only separates the head of it. */
function markIsDelimiter(line) {
  return /^\s*\|[\s:|-]*\|?\s*$/.test(line) && line.indexOf('-') !== -1;
}

/* A row of a table, cut at its bars. Each cell goes through the inline walk,
 * so a verweis inside a cell is a verweis.
 */
function markTable(line, stack, out) {
  var kinds = markWith(stack, 'table');
  var cells = line.split('|');
  var index;

  for (index = 0; index < cells.length; index += 1) {
    if (index > 0) {
      markPush(out, '|', kinds, true);
    }
    markInline(cells[index], markWith(kinds, 'table-cell'), out);
  }
}

/* What a whole line is. The order below is the order of the questions, and it
 * matters: a line of dashes is a line and not a list, and a row of a table is
 * a row before anything inside it is asked about.
 */
function markBlock(line, stack, out) {
  var found;
  var kinds;
  var rest;

  // A line across the page.
  if (/^\s{0,3}(?:(?:-\s*){3,}|(?:\*\s*){3,}|(?:_\s*){3,})$/.test(line)) {
    markPush(out, line, markWith(stack, 'rule'), true);
    return;
  }

  // A table, and the row that only separates its head.
  if (/^\s*\|/.test(line)) {
    if (markIsDelimiter(line)) {
      markPush(out, line, markWith(markWith(stack, 'table'), 'table-delimiter'),
               true);
      return;
    }
    markTable(line, stack, out);
    return;
  }

  // The text of a footnote, under the page.
  found = /^(\[\^[^\]\s]+\]:)(\s*)(.*)$/.exec(line);
  if (found !== null) {
    kinds = markWith(stack, 'footnote');
    markPush(out, found[1] + found[2], kinds, true);
    markInline(found[3], kinds, out);
    return;
  }

  // A quote, and the kind of quote that carries a name in brackets. What
  // stands behind the sign is asked all over again, so a list inside a quote
  // is a list.
  found = /^(\s*>\s?)(.*)$/.exec(line);
  if (found !== null) {
    rest = found[2];
    kinds = markWith(stack, 'quote');
    markPush(out, found[1], kinds, true);
    found = /^(\[![^\]]*\])(.*)$/.exec(rest);
    if (found !== null) {
      kinds = markWith(kinds, 'callout');
      markPush(out, found[1], markWith(kinds, 'callout-name'), true);
      markInline(found[2], kinds, out);
      return;
    }
    markBlock(rest, kinds, out);
    return;
  }

  // A heading, at one of six depths.
  found = /^(\s*)(#{1,6})(\s+)(.*)$/.exec(line);
  if (found !== null) {
    kinds = markWith(markWith(stack, 'heading'), 'heading-' + found[2].length);
    markPush(out, found[1] + found[2] + found[3], kinds, true);
    markInline(found[4], kinds, out);
    return;
  }

  // A task, which is a point of a list that carries a box.
  found = /^(\s*)([-*+]|\d+[.)])(\s+)(\[[ xX]\])(\s+)(.*)$/.exec(line);
  if (found !== null) {
    kinds = markWith(stack, found[2].length === 1 ? 'list' : 'list-ordered');
    kinds = markWith(kinds, 'task');
    kinds = markWith(kinds, found[4].charAt(1) === ' ' ? 'task-open' : 'task-done');
    markPush(out, found[1] + found[2] + found[3] + found[4] + found[5], kinds,
             true);
    markInline(found[6], kinds, out);
    return;
  }

  // A point of a list, counted or not.
  found = /^(\s*)([-*+]|\d+[.)])(\s+)(.*)$/.exec(line);
  if (found !== null) {
    kinds = markWith(stack, found[2].length === 1 ? 'list' : 'list-ordered');
    markPush(out, found[1] + found[2] + found[3], kinds, true);
    markInline(found[4], kinds, out);
    return;
  }

  markInline(line, stack, out);
}

/* One line, with the state the lines before it left behind. */
function markSegments(line, state) {
  var out = [];
  var opened;

  if (state.fence !== null) {
    if (markFenceCloses(line, state.fence)) {
      state.fence = null;
      markPush(out, line, ['fence'], true);
    } else {
      markPush(out, line, ['code-block'], false);
    }
    return out;
  }
  opened = markFenceOpens(line);
  if (opened !== null) {
    state.fence = opened;
    markPush(out, line, ['fence'], true);
    return out;
  }
  markBlock(line, [], out);
  return out;
}

/* What a caller reaches --------------------------------------------------- */

/* The rows of a text: one per line, each cut into its pieces.
 *
 * Two things span more than one line and are therefore states and not rules:
 * the head, which reaches to the offset the one head reader answers with, and
 * a block of code, which reaches to its closing line or, where none stands,
 * to the end of the file.
 */
function marksOf(text) {
  var lines = markLines(text);
  var stop = markHeadStop(text);
  var state = { fence: null };
  var rows = [];
  var at = 0;
  var index;
  var line;
  var pieces;

  for (index = 0; index < lines.length; index += 1) {
    line = lines[index];
    if (at < stop) {
      pieces = [];
      markHead(line.text, pieces);
    } else {
      pieces = markSegments(line.text, state);
    }
    rows.push({ text: line.text, ending: line.ending, segments: pieces });
    at += line.text.length + line.ending.length;
  }
  return rows;
}

/* The text again, put together out of the pieces.
 *
 * Out of the pieces and never out of the line the row also carries: what is
 * saved is what the display was made of, so a piece that lost a character has
 * to show up here and not in a file somebody wrote by hand.
 */
function joinMarks(rows) {
  var out = '';
  var index;
  var inner;
  var pieces;

  for (index = 0; index < rows.length; index += 1) {
    pieces = rows[index].segments;
    for (inner = 0; inner < pieces.length; inner += 1) {
      out += pieces[inner].text;
    }
    out += rows[index].ending;
  }
  return out;
}

/* The bench entry. The browser never reaches this line: from the file system
 * the page loads this file as a classic script, where module is not defined.
 */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    marksOf: marksOf,
    joinMarks: joinMarks,
    FORMS: FORMS
  };
}
