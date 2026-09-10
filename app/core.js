'use strict';

/* The shared core of the surface: block split, three way comparison, head reader.
 *
 * The same rules as llmwiki/shared/blocks.py, llmwiki/shared/merge.py and
 * llmwiki/shared/frontmatter.py, in the language the browser speaks. Not a
 * second design of them. Every boundary, every line of the decision table and
 * every span of head lines is the Python one, and tests/test_js_core.py holds
 * both sides against the same material until they answer the same.
 *
 * ADR-08 fixes the shape of this file. It is a classic script, never a module,
 * because from file:// a page loads a neighbouring <script src> and nothing
 * else: no library, no network, no build step. The entry for the bench at the
 * very bottom is guarded, so the browser never reaches it. The comparison runs
 * in the page while a person waits, which is why a block key is plain string
 * work and not a digest from the asynchronous crypto interface.
 *
 * What a caller reaches, and what it answers:
 *
 *   splitBlocks / joinBlocks     ADR-09, ADR-18. joinBlocks(splitBlocks(t)) === t
 *   mergeBlocks                  ADR-18. Three block lists in, one text plus
 *                                the open spots out
 *   parseHead and its writers    ADR-11. A field is a span of lines; setting it
 *                                replaces that span and nothing else
 *
 * Every name here stands in the one global scope the page has, so what is not
 * in that list carries a block or head prefix and leaves the plain words to
 * the other scripts of the surface.
 *
 * Two things separate this file from an ordinary port. Python indexes strings
 * by code point and cuts lines on more characters than JavaScript does, so the
 * few places where that shows carry their own helpers below. And the three way
 * walk needs the exact matching blocks of Python difflib, tie breaking
 * included, because a different alignment is a different question put to a
 * person; findLongestMatch is that algorithm, not a shortest edit script.
 */

/* Python string rules ------------------------------------------------------
 *
 * Python str.strip() takes every character str.isspace() calls space, which is
 * a wider set than the one JavaScript trim() takes, and it leaves the byte
 * order mark alone where trim() drops it. The head reader decides field names
 * and values with those rules, so they are written out here rather than
 * approximated.
 */

var PY_SPACE = '[ \\t\\n\\r\\v\\f\\x1c-\\x1f\\x85\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000]';
var PY_SPACE_LEAD = new RegExp('^' + PY_SPACE + '+');
var PY_SPACE_TRAIL = new RegExp(PY_SPACE + '+$');

function pyStrip(text) {
  return text.replace(PY_SPACE_LEAD, '').replace(PY_SPACE_TRAIL, '');
}

function pyRStrip(text) {
  return text.replace(PY_SPACE_TRAIL, '');
}

function lstripSpacesAndTabs(text) {
  return text.replace(/^[ \t]+/, '');
}

function stripNewlines(text) {
  return text.replace(/^\n+/, '').replace(/\n+$/, '');
}

/* Python len() counts code points, JavaScript length counts UTF-16 units. The
 * head reader hands out where the body begins, and that number is read by a
 * caller that counts the Python way.
 */
function pyLength(text) {
  var count = 0;
  var index = 0;
  while (index < text.length) {
    var code = text.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff && index + 1 < text.length) {
      var low = text.charCodeAt(index + 1);
      if (low >= 0xdc00 && low <= 0xdfff) {
        index += 1;
      }
    }
    index += 1;
    count += 1;
  }
  return count;
}

/* Python str.splitlines(keepends=True) cuts on ten characters, not on two.
 * A page carrying a form feed would otherwise be cut into different blocks
 * here than in the run, and that is a byte lost on the way back.
 */
function pySplitLines(text) {
  var lines = [];
  var start = 0;
  var index = 0;
  while (index < text.length) {
    var code = text.charCodeAt(index);
    var end = 0;
    if (code === 0x0d) {
      end = text.charCodeAt(index + 1) === 0x0a ? index + 2 : index + 1;
    } else if (
      code === 0x0a || code === 0x0b || code === 0x0c ||
      code === 0x1c || code === 0x1d || code === 0x1e ||
      code === 0x85 || code === 0x2028 || code === 0x2029
    ) {
      end = index + 1;
    }
    if (end) {
      lines.push(text.slice(start, end));
      start = end;
      index = end;
    } else {
      index += 1;
    }
  }
  if (start < text.length) {
    lines.push(text.slice(start));
  }
  return lines;
}

/* Two values are the same when they carry the same text, the same entries in
 * the same order, the same pairs. The head writer compares that way before it
 * decides that there is nothing to write.
 */
function sameValue(one, other) {
  if (one === other) {
    return true;
  }
  if (one === null || other === null) {
    return false;
  }
  if (Array.isArray(one) || Array.isArray(other)) {
    if (!Array.isArray(one) || !Array.isArray(other) || one.length !== other.length) {
      return false;
    }
    for (var index = 0; index < one.length; index += 1) {
      if (!sameValue(one[index], other[index])) {
        return false;
      }
    }
    return true;
  }
  if (typeof one === 'object' && typeof other === 'object') {
    var here = Object.keys(one);
    var there = Object.keys(other);
    if (here.length !== there.length) {
      return false;
    }
    for (var at = 0; at < here.length; at += 1) {
      var name = here[at];
      if (!Object.prototype.hasOwnProperty.call(other, name)) {
        return false;
      }
      if (!sameValue(one[name], other[name])) {
        return false;
      }
    }
    return true;
  }
  return false;
}

/* Blocks, ADR-09 -----------------------------------------------------------
 *
 * Where a block ends: the run between two blank lines, and a list item, a
 * table row and a head field line each on their own. A fenced block stays
 * whole. Blank lines belong to the block above them, which is what keeps the
 * round trip exact without a separate list of separators.
 *
 * Two texts per block. raw carries the exact characters and is what gets
 * written back, key carries the comparison form and is what decides whether
 * two blocks are the same.
 */

var BLOCK_FENCE = new RegExp('^' + PY_SPACE + '{0,3}(`{3,}|~{3,})');
var BLOCK_LIST_ITEM = new RegExp('^' + PY_SPACE + '*(?:[-*+]|\\p{Nd}+[.)])(' + PY_SPACE + '|$)', 'u');
var BLOCK_TABLE_ROW = new RegExp('^' + PY_SPACE + '*\\|');
var BLOCK_FRONT_MATTER = new RegExp('^---' + PY_SPACE + '*$');

function Block(raw) {
  this.raw = raw;
  this.key = blockKeyOf(raw);
}

Block.prototype.toString = function () {
  return 'Block(' + this.key.slice(0, 40) + ')';
};

/* The comparison form: line endings unified, trailing space dropped. */
function blockKeyOf(raw) {
  var lines = raw.split('\r\n').join('\n').split('\r').join('\n').split('\n');
  var kept = [];
  for (var index = 0; index < lines.length; index += 1) {
    kept.push(pyRStrip(lines[index]));
  }
  return stripNewlines(kept.join('\n'));
}

function blockIsBlank(line) {
  return pyStrip(line) === '';
}

/* Cuts text into blocks. joinBlocks(splitBlocks(text)) === text, always. */
function splitBlocks(text) {
  if (!text) {
    return [];
  }

  var lines = pySplitLines(text);
  var groups = [];
  var current = [];
  var index = 0;
  var total = lines.length;

  function flush() {
    if (current.length) {
      groups.push(current);
      current = [];
    }
  }

  // The head is only a head at the very top, and every line in it stands alone.
  if (total && BLOCK_FRONT_MATTER.test(lines[0])) {
    groups.push([lines[0]]);
    index = 1;
    while (index < total) {
      groups.push([lines[index]]);
      var closed = BLOCK_FRONT_MATTER.test(lines[index]);
      index += 1;
      if (closed) {
        break;
      }
    }
  }

  while (index < total) {
    var line = lines[index];

    if (blockIsBlank(line)) {
      // A blank line closes the block above it and travels with it. When the
      // block above is already closed, it joins that one rather than standing
      // alone, so a separator never counts as a block of its own.
      if (current.length) {
        current.push(line);
        flush();
      } else if (groups.length) {
        groups[groups.length - 1].push(line);
      } else {
        groups.push([line]);
      }
      index += 1;
      continue;
    }

    var fence = BLOCK_FENCE.exec(line);
    if (fence) {
      flush();
      var marker = fence[1].charAt(0);
      current.push(line);
      index += 1;
      while (index < total) {
        current.push(lines[index]);
        var closing = BLOCK_FENCE.exec(lines[index]);
        index += 1;
        if (closing && closing[1].charAt(0) === marker) {
          break;
        }
      }
      flush();
      continue;
    }

    if (BLOCK_LIST_ITEM.test(line) || BLOCK_TABLE_ROW.test(line)) {
      flush();
      current.push(line);
      index += 1;
      // A list item keeps its indented continuation lines.
      while (index < total && !blockIsBlank(lines[index])) {
        var next = lines[index];
        if (BLOCK_LIST_ITEM.test(next) || BLOCK_TABLE_ROW.test(next) || BLOCK_FENCE.test(next)) {
          break;
        }
        if (BLOCK_TABLE_ROW.test(line) || !(next.charAt(0) === ' ' || next.charAt(0) === '\t')) {
          break;
        }
        current.push(next);
        index += 1;
      }
      flush();
      continue;
    }

    current.push(line);
    index += 1;
    while (index < total && !blockIsBlank(lines[index])) {
      var following = lines[index];
      if (
        BLOCK_LIST_ITEM.test(following) ||
        BLOCK_TABLE_ROW.test(following) ||
        BLOCK_FENCE.test(following)
      ) {
        break;
      }
      current.push(following);
      index += 1;
    }
    flush();
  }

  flush();

  var blocks = [];
  for (var group = 0; group < groups.length; group += 1) {
    blocks.push(new Block(groups[group].join('')));
  }
  return blocks;
}

/* Puts the blocks back together. The inverse of splitBlocks. */
function joinBlocks(blocks) {
  var out = [];
  for (var index = 0; index < blocks.length; index += 1) {
    out.push(blocks[index].raw);
  }
  return out.join('');
}

/* Alignment ----------------------------------------------------------------
 *
 * The three way walk matches both sides against the common version, and the
 * matching has to be the one the run makes. This is the algorithm of Python
 * difflib.SequenceMatcher without junk heuristics: the longest matching run
 * wins, ties go to the one starting earliest in the first sequence and then
 * to the one starting earliest in the second, and the regions left and right
 * of it are matched again the same way. A shortest edit script would align
 * repeated paragraphs differently and put a different question to a person.
 */

function placesOf(items) {
  var found = new Map();
  for (var index = 0; index < items.length; index += 1) {
    var seen = found.get(items[index]);
    if (seen === undefined) {
      seen = [];
      found.set(items[index], seen);
    }
    seen.push(index);
  }
  return found;
}

function findLongestMatch(a, b, indices, alo, ahi, blo, bhi) {
  var besti = alo;
  var bestj = blo;
  var bestsize = 0;
  var lengths = new Map();

  for (var i = alo; i < ahi; i += 1) {
    var next = new Map();
    var places = indices.get(a[i]);
    if (places !== undefined) {
      for (var at = 0; at < places.length; at += 1) {
        var j = places[at];
        if (j < blo) {
          continue;
        }
        if (j >= bhi) {
          break;
        }
        var previous = lengths.get(j - 1);
        var k = (previous === undefined ? 0 : previous) + 1;
        next.set(j, k);
        if (k > bestsize) {
          besti = i - k + 1;
          bestj = j - k + 1;
          bestsize = k;
        }
      }
    }
    lengths = next;
  }

  // Python extends the match over junk and over popular elements here. With
  // no junk function and the popularity heuristic switched off, as the run
  // switches it off, both extensions can only find what the walk above
  // already took, so there is nothing left to extend.
  return [besti, bestj, bestsize];
}

function matchingBlocks(a, b) {
  var indices = placesOf(b);
  var queue = [[0, a.length, 0, b.length]];
  var found = [];

  while (queue.length) {
    var region = queue.pop();
    var alo = region[0];
    var ahi = region[1];
    var blo = region[2];
    var bhi = region[3];
    var match = findLongestMatch(a, b, indices, alo, ahi, blo, bhi);
    var i = match[0];
    var j = match[1];
    var k = match[2];
    if (k) {
      found.push(match);
      if (alo < i && blo < j) {
        queue.push([alo, i, blo, j]);
      }
      if (i + k < ahi && j + k < bhi) {
        queue.push([i + k, ahi, j + k, bhi]);
      }
    }
  }

  found.sort(function (one, other) {
    return (one[0] - other[0]) || (one[1] - other[1]) || (one[2] - other[2]);
  });

  var joined = [];
  var i1 = 0;
  var j1 = 0;
  var k1 = 0;
  for (var index = 0; index < found.length; index += 1) {
    var i2 = found[index][0];
    var j2 = found[index][1];
    var k2 = found[index][2];
    if (i1 + k1 === i2 && j1 + k1 === j2) {
      k1 += k2;
    } else {
      if (k1) {
        joined.push([i1, j1, k1]);
      }
      i1 = i2;
      j1 = j2;
      k1 = k2;
    }
  }
  if (k1) {
    joined.push([i1, j1, k1]);
  }
  joined.push([a.length, b.length, 0]);
  return joined;
}

function alignmentOps(a, b) {
  var blocks = matchingBlocks(a, b);
  var out = [];
  var i = 0;
  var j = 0;
  for (var index = 0; index < blocks.length; index += 1) {
    var ai = blocks[index][0];
    var bj = blocks[index][1];
    var size = blocks[index][2];
    var tag = '';
    if (i < ai && j < bj) {
      tag = 'replace';
    } else if (i < ai) {
      tag = 'delete';
    } else if (j < bj) {
      tag = 'insert';
    }
    if (tag) {
      out.push([tag, i, ai, j, bj]);
    }
    i = ai + size;
    j = bj + size;
    if (size) {
      out.push(['equal', ai, i, bj, j]);
    }
  }
  return out;
}

/* Three way comparison, ADR-18 ---------------------------------------------
 *
 * A block only I changed is taken silently, a block only the other one
 * changed is taken silently, and a block both of us changed differently is an
 * open spot. Inside a block nothing is ever merged: two people in the same
 * paragraph is a question, even when the words look like they would fit
 * together, because word level merging yields text nobody wrote.
 */

function OpenSpot(base, mine, theirs, index) {
  this.base = base;
  this.mine = mine;
  this.theirs = theirs;
  this.index = index;
}

function MergeResult() {
  this.blocks = [];
  this.openSpots = [];
  this.takenMine = 0;
  this.takenTheirs = 0;
  this.unchanged = 0;
}

Object.defineProperty(MergeResult.prototype, 'hasOpenSpots', {
  get: function () {
    return this.openSpots.length > 0;
  }
});

/* For every position in the common version, the matching position on one side. */
function sideBoundaries(ops) {
  var bound = new Map();
  for (var index = 0; index < ops.length; index += 1) {
    var tag = ops[index][0];
    var i1 = ops[index][1];
    var i2 = ops[index][2];
    var j1 = ops[index][3];
    var j2 = ops[index][4];
    if (tag === 'equal') {
      for (var step = 0; step <= i2 - i1; step += 1) {
        bound.set(i1 + step, j1 + step);
      }
    } else {
      bound.set(i1, j1);
      bound.set(i2, j2);
    }
  }
  if (!bound.has(0)) {
    bound.set(0, 0);
  }
  return bound;
}

/* The stretches of the common version that this side did not leave alone. */
function unstableSpans(ops) {
  var spans = [];
  for (var index = 0; index < ops.length; index += 1) {
    if (ops[index][0] !== 'equal') {
      spans.push([ops[index][1], ops[index][2]]);
    }
  }
  return spans;
}

/* Two stretches belong together when they meet, not when they merely touch.
 *
 * Touching is the case that matters: one person changed the paragraph above,
 * the other the paragraph below. Coalescing those would turn two independent
 * edits into one question. A zero width stretch is an insertion and does
 * attach to whatever it sits inside or beside, because two people inserting
 * at the same place do collide.
 */
function spansOverlap(one, other) {
  var a1 = one[0];
  var a2 = one[1];
  var b1 = other[0];
  var b2 = other[1];
  if (a1 === a2 || b1 === b2) {
    return (b1 <= a1 && a1 <= b2) || (a1 <= b1 && b1 <= a2);
  }
  return a1 < b2 && b1 < a2;
}

/* Merges the stretches of both sides into the places that need deciding. */
function regionsOf(spans) {
  var ordered = spans.slice().sort(function (one, other) {
    return (one[0] - other[0]) || (one[1] - other[1]);
  });
  var merged = [];
  for (var index = 0; index < ordered.length; index += 1) {
    var span = ordered[index];
    var last = merged.length ? merged[merged.length - 1] : null;
    if (last && spansOverlap(last, span)) {
      merged[merged.length - 1] = [
        Math.min(last[0], span[0]),
        Math.max(last[1], span[1])
      ];
    } else {
      merged.push(span);
    }
  }
  return merged;
}

function sameKeyRun(one, other) {
  if (one.length !== other.length) {
    return false;
  }
  for (var index = 0; index < one.length; index += 1) {
    if (one[index] !== other[index]) {
      return false;
    }
  }
  return true;
}

function keysOf(blocks) {
  var keys = [];
  for (var index = 0; index < blocks.length; index += 1) {
    keys.push(blocks[index].key);
  }
  return keys;
}

/* Runs the table in ADR-18 over three block lists. */
function mergeBlocks(base, mine, theirs) {
  var baseKeys = keysOf(base);
  var opsMine = alignmentOps(baseKeys, keysOf(mine));
  var opsTheirs = alignmentOps(baseKeys, keysOf(theirs));

  var toMine = sideBoundaries(opsMine);
  var toTheirs = sideBoundaries(opsTheirs);
  var regions = regionsOf(unstableSpans(opsMine).concat(unstableSpans(opsTheirs)));

  var result = new MergeResult();
  var at = 0;
  for (var index = 0; index < regions.length; index += 1) {
    var start = regions[index][0];
    var end = regions[index][1];
    takeStableRun(result, mine, toMine, at, start);
    decideRun(
      result,
      base.slice(start, end),
      mine.slice(toMine.get(start), toMine.get(end)),
      theirs.slice(toTheirs.get(start), toTheirs.get(end)),
      start
    );
    at = end;
  }
  takeStableRun(result, mine, toMine, at, base.length);
  return result;
}

/* A stretch nobody touched. The raw text comes from my side.
 *
 * By key the three versions are the same here, so any of them would do. Mine
 * is chosen because it carries the separators as my editor last wrote them;
 * taking the common version instead would leave an orphaned blank line behind
 * a paragraph that I deleted right after it.
 */
function takeStableRun(result, mine, toMine, start, end) {
  if (start >= end) {
    return;
  }
  var run = mine.slice(toMine.get(start), toMine.get(end));
  for (var index = 0; index < run.length; index += 1) {
    result.blocks.push(run[index]);
  }
  result.unchanged += run.length;
}

/* One stretch that at least one side changed, decided as a whole. */
function decideRun(result, baseRun, mineRun, theirsRun, index) {
  var baseKeys = keysOf(baseRun);
  var mineKeys = keysOf(mineRun);
  var theirsKeys = keysOf(theirsRun);

  function take(run, counter) {
    for (var at = 0; at < run.length; at += 1) {
      result.blocks.push(run[at]);
    }
    result[counter] += run.length;
  }

  if (sameKeyRun(mineKeys, baseKeys) && sameKeyRun(theirsKeys, baseKeys)) {
    take(baseRun, 'unchanged');
    return;
  }
  if (sameKeyRun(theirsKeys, baseKeys)) {
    take(mineRun, 'takenMine');
    return;
  }
  if (sameKeyRun(mineKeys, baseKeys)) {
    take(theirsRun, 'takenTheirs');
    return;
  }
  if (sameKeyRun(mineKeys, theirsKeys)) {
    // Both did the same thing. Nobody needs to be asked about that.
    take(mineRun, 'unchanged');
    return;
  }
  result.openSpots.push(new OpenSpot(baseRun, mineRun, theirsRun, index));
}

/* The head of a page, ADR-11 -----------------------------------------------
 *
 * A library parses a head into values and serialises the values back, and
 * that round trip alters almost every head of the target inventory although
 * not one value changes. So the write path here is line based: a field is a
 * span of lines, setting it replaces that span and nothing else, and every
 * other field keeps its order, indentation, quotes and comments byte for
 * byte. The reader is deliberately forgiving and the writer is not.
 */

var HEAD_OPEN = /^---[ \t]*$/;
var HEAD_CLOSE = /^(?:---|\.\.\.)[ \t]*$/;
var HEAD_BLOCK_SCALAR = /^[|>][0-9]*[+-]?[ \t]*(?:#.*)?$/;

// Read as nothing, the way a common parser reads them. A value that is meant
// to be the word has to be quoted, and this reader keeps such quotes.
var HEAD_NULLS = ['~', 'null', 'Null', 'NULL'];

var HEAD_UNESCAPE = {
  n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', '0': '\0',
  '"': '"', '\\': '\\', '/': '/', "'": "'", ' ': ' '
};
var HEAD_ESCAPE = { '\\': '\\\\', '"': '\\"', '\n': '\\n', '\r': '\\r', '\t': '\\t' };

// A plain value starting with one of these would be read as something else.
var HEAD_LEADING = '-?:,[]{}#&*!|>\'"%@`';

// One half of a name this writer may add. The profile form joins two of these
// with a colon.
var HEAD_NAME = /^[A-Za-z0-9_][A-Za-z0-9_. -]{0,127}$/;

// A field of one of these names would land on the prototype of the object
// that carries the head rather than in the head itself.
var HEAD_RESERVED = ['__proto__', 'constructor', 'prototype'];

/* The head cannot carry the write that was asked for. The three below say
 * which of the three reasons it is, and they stay one family so a caller can
 * catch them together the way the run catches HeadError.
 */
class HeadError extends Error {
  constructor(message) {
    super(message);
    this.name = 'HeadError';
  }
}

/* There is no head to change, and this module never creates one. */
class MissingHead extends HeadError {
  constructor(message) {
    super(message);
    this.name = 'MissingHead';
  }
}

/* The field stands more than once, so its span is not decidable. */
class AmbiguousField extends HeadError {
  constructor(message) {
    super(message);
    this.name = 'AmbiguousField';
  }
}

/* The name is not one this writer adds to a head. */
class UnsafeName extends HeadError {
  constructor(message) {
    super(message);
    this.name = 'UnsafeName';
  }
}

function HeadRepeated(key, lines) {
  this.key = key;
  this.lines = lines.slice();
}

HeadRepeated.prototype.toString = function () {
  return this.key + ' stands on lines ' + this.lines.join(', ');
};

function HeadField(key, value, start, end, raw) {
  this.key = key;
  this.value = value;
  this.start = start;
  this.end = end;
  this.raw = raw;
}

// The line number of the key line, counted from one, for a finding.
Object.defineProperty(HeadField.prototype, 'line', {
  get: function () {
    return this.start + 1;
  }
});

/* Read the head. Returns the fields by name and where the body starts.
 *
 * A file without a head is not an error here. It comes back with no fields
 * and an offset of zero, and the caller decides what that means. Where a name
 * stands twice, the first one is the one that is read, and the repeat comes
 * back as a finding in repeated; a write into such a field is refused,
 * because there its span is not decidable.
 */
function parseHead(text) {
  var state = headLines(text);
  if (state === null) {
    return { fields: Object.create(null), offset: 0, repeated: [] };
  }
  var raw = state.raw;
  var bare = state.bare;
  var fields = Object.create(null);
  var places = new Map();
  var found = headWalk(bare, 0, 1, state.close);

  for (var index = 0; index < found.length; index += 1) {
    var entry = found[index];
    var seen = places.get(entry.key);
    if (seen === undefined) {
      seen = [];
      places.set(entry.key, seen);
    }
    seen.push(entry.start + 1);
    if (fields[entry.key] !== undefined) {
      continue;
    }
    var value = headValue(entry.inline, bare.slice(entry.start + 1, entry.end));
    fields[entry.key] = new HeadField(
      entry.key, value, entry.start, entry.end,
      raw.slice(entry.start, entry.end).join('')
    );
  }

  var repeated = [];
  places.forEach(function (lines, key) {
    if (lines.length > 1) {
      repeated.push(new HeadRepeated(key, lines));
    }
  });

  return { fields: fields, offset: state.offset, repeated: repeated };
}

/* The value of one head field, or the fallback when the field is absent.
 *
 * A field that stands there without a value is present and reads as null,
 * which is not the same answer as an absent field.
 */
function headField(text, key, fallback) {
  var field = parseHead(text).fields[key];
  if (field === undefined) {
    return fallback === undefined ? null : fallback;
  }
  return field.value;
}

/* The entries of a list field, as an array, whatever form it was written in.
 *
 * A single scalar counts as one entry. That is what a person means who types
 * related: one-page.
 */
function headEntries(text, key) {
  var field = parseHead(text).fields[key];
  if (field === undefined || field.value === null) {
    return [];
  }
  if (Array.isArray(field.value)) {
    return field.value.slice();
  }
  return [field.value];
}

/* Set one head field and return the new text. Only its lines change.
 *
 * An unchanged value writes nothing at all. A field that is not there yet is
 * added as the last line of the head, which moves no existing line either;
 * its name is checked before that, and isSafeHeadName says what passes.
 */
function setHeadField(text, key, value) {
  headCheckValue(value);
  var state = headForWriting(text);
  var raw = state.raw;
  var bare = state.bare;
  var close = state.close;
  var found = headSingleField(bare, close, key);

  if (found === null) {
    headRequireSafeName(key, close + 1);
    var newEnding = headLineEnding(raw[close - 1]) || headLineEnding(raw[0]) || '\n';
    var added = headRenderField(key, value, new HeadForm(), newEnding);
    return raw.slice(0, close).concat(added, raw.slice(close)).join('');
  }

  if (sameValue(headValue(found.inline, bare.slice(found.start + 1, found.end)), value)) {
    return text;
  }
  var form = headFormOf(
    raw.slice(found.start, found.end),
    bare.slice(found.start, found.end),
    found.inline
  );
  var ending = headLineEnding(raw[found.start]) || headLineEnding(raw[0]) || '\n';
  return raw.slice(0, found.start)
    .concat(headRenderField(key, value, form, ending), raw.slice(found.end))
    .join('');
}

/* Remove one head field and return the new text. Only its lines go.
 *
 * Setting a field to no value leaves the name standing, which is what a head
 * says when a field is there and empty. Deleting, renaming and mapping a
 * foreign name onto a core name need the other answer. The whole span goes,
 * however many lines it covers, and the blank line that separates the field
 * from the next one is not part of it.
 *
 * A field that is not there is not an error. A name no writer would add is
 * removed all the same, because it stands in the head and the head belongs to
 * whoever wrote it.
 */
function removeHeadField(text, key) {
  var state = headForWriting(text);
  var found = headSingleField(state.bare, state.close, key);
  if (found === null) {
    return text;
  }
  return state.raw.slice(0, found.start).concat(state.raw.slice(found.end)).join('');
}

/* Whether this writer may add a field of that name.
 *
 * Asked of a new name only. What it rules out is a name the reader would give
 * back as something other than what went in: a line break, a comment mark, a
 * quote, a leading dash, an empty name. The profile form prefix:name passes
 * as two names joined by one colon.
 */
function isSafeHeadName(key) {
  if (typeof key !== 'string' || key !== pyStrip(key)) {
    return false;
  }
  var parts = key.split(':');
  if (parts.length > 2) {
    return false;
  }
  for (var index = 0; index < parts.length; index += 1) {
    var part = parts[index];
    if (part !== pyStrip(part) || !HEAD_NAME.test(part)) {
      return false;
    }
    if (HEAD_RESERVED.indexOf(part) >= 0) {
      return false;
    }
  }
  return true;
}

/* Lines -------------------------------------------------------------------- */

/* The line without its ending, whichever ending it uses. */
function headBareLine(line) {
  if (line.slice(-2) === '\r\n') {
    return line.slice(0, -2);
  }
  var last = line.charAt(line.length - 1);
  if (line && (last === '\n' || last === '\r')) {
    return line.slice(0, -1);
  }
  return line;
}

function headLineEnding(line) {
  if (line.slice(-2) === '\r\n') {
    return '\r\n';
  }
  var last = line.charAt(line.length - 1);
  if (line && (last === '\n' || last === '\r')) {
    return last;
  }
  return '';
}

function headIndentOf(line) {
  return line.length - lstripSpacesAndTabs(line).length;
}

function headIsDashLine(line) {
  var text = lstripSpacesAndTabs(line);
  return text === '-' || text.slice(0, 2) === '- ' || text.slice(0, 2) === '-\t';
}

/* The lines of the file, the closing line, and where the body begins. */
function headLines(text) {
  var raw = pySplitLines(text);
  if (!raw.length || !HEAD_OPEN.test(headBareLine(raw[0]))) {
    return null;
  }
  for (var index = 1; index < raw.length; index += 1) {
    if (HEAD_CLOSE.test(headBareLine(raw[index]))) {
      var offset = 0;
      for (var at = 0; at <= index; at += 1) {
        offset += pyLength(raw[at]);
      }
      var bare = [];
      for (var line = 0; line < raw.length; line += 1) {
        bare.push(headBareLine(raw[line]));
      }
      return { raw: raw, bare: bare, close: index, offset: offset };
    }
  }
  return null;
}

/* Keys --------------------------------------------------------------------- */

/* Where the key ends, or -1 when the line carries no field.
 *
 * A colon ends the key only when a space or the end of the line follows it.
 * That single rule keeps the prefix of a profile field and keeps a colon
 * inside a title where it belongs.
 */
function headKeyEnd(text) {
  if (!text || text.charAt(0) === '#') {
    return -1;
  }
  if (text.charAt(0) === '"' || text.charAt(0) === "'") {
    var closing = headClosingQuote(text, 0);
    if (closing === null) {
      return -1;
    }
    var rest = text.slice(closing + 1);
    if (rest.charAt(0) === ':' && (rest.length === 1 || rest.charAt(1) === ' ' || rest.charAt(1) === '\t')) {
      return closing + 1;
    }
    return -1;
  }
  var index = 0;
  for (;;) {
    index = text.indexOf(':', index);
    if (index < 0) {
      return -1;
    }
    var next = text.slice(index + 1, index + 2);
    if (next === '' || next === ' ' || next === '\t') {
      return pyStrip(text.slice(0, index)) ? index : -1;
    }
    index += 1;
  }
}

/* The name of the field on this line and the value that follows it. */
function headKeyOf(line) {
  var text = lstripSpacesAndTabs(line);
  var at = headKeyEnd(text);
  if (at < 0) {
    return null;
  }
  var name = pyStrip(text.slice(0, at));
  if (name.charAt(0) === '"' || name.charAt(0) === "'") {
    name = headUnquote(name);
  }
  var inline = pyStrip(text.slice(at + 1));
  if (inline.charAt(0) === '#') {
    inline = '';
  }
  return { key: name, inline: inline };
}

/* The key exactly as it stands, quotes and padding included. */
function headKeyText(line) {
  var text = lstripSpacesAndTabs(line);
  var at = headKeyEnd(text);
  return at >= 0 ? text.slice(0, at) : text;
}

/* Structure ---------------------------------------------------------------- */

/* The fields at one indentation level, each with the lines it owns. */
function headWalk(lines, base, first, last) {
  var stop = last === undefined || last === null ? lines.length : last;
  var found = [];
  var index = first === undefined ? 0 : first;
  while (index < stop) {
    var line = lines[index];
    if (!pyStrip(line) || headIndentOf(line) !== base || headIsDashLine(line)) {
      index += 1;
      continue;
    }
    var split = headKeyOf(line);
    if (split === null) {
      index += 1;
      continue;
    }
    var end = headSpanOf(lines, index, stop, base, split.inline);
    found.push({ key: split.key, inline: split.inline, start: index, end: end });
    index = end;
  }
  return found;
}

/* How far a field reaches: its key line plus what belongs under it.
 *
 * A blank line only joins the field when something below it does. That way
 * the separator in front of the next field stays outside the span, and a
 * write does not swallow it.
 */
function headSpanOf(lines, start, last, base, inline) {
  var dashes = false;
  if (inline === '') {
    var probe = start + 1;
    while (probe < last && !pyStrip(lines[probe])) {
      probe += 1;
    }
    if (probe < last && headIndentOf(lines[probe]) === base && headIsDashLine(lines[probe])) {
      dashes = true;
    }
  }

  var end = start + 1;
  var index = start + 1;
  while (index < last) {
    var line = lines[index];
    if (!pyStrip(line)) {
      index += 1;
      continue;
    }
    if (headIndentOf(line) > base) {
      index += 1;
      end = index;
      continue;
    }
    if (dashes && headIndentOf(line) === base && headIsDashLine(line)) {
      index += 1;
      end = index;
      continue;
    }
    break;
  }
  return end;
}

/* The line ranges of the entries of a block list. */
function headItemSpans(lines, base) {
  var spans = [];
  var start = null;
  for (var index = 0; index < lines.length; index += 1) {
    var line = lines[index];
    if (pyStrip(line) && headIndentOf(line) === base && headIsDashLine(line)) {
      if (start !== null) {
        spans.push({ start: start, end: index });
      }
      start = index;
    }
  }
  if (start !== null) {
    spans.push({ start: start, end: lines.length });
  }
  return spans;
}

/* What a run of lines under a key is: a list, a mapping, or one value. */
function headStructure(lines) {
  var content = [];
  for (var index = 0; index < lines.length; index += 1) {
    if (pyStrip(lines[index])) {
      content.push(lines[index]);
    }
  }
  if (!content.length) {
    return { kind: 'empty', spans: [] };
  }
  var base = headIndentOf(content[0]);
  for (var at = 1; at < content.length; at += 1) {
    base = Math.min(base, headIndentOf(content[at]));
  }
  var first = content[0];
  if (headIsDashLine(first)) {
    return { kind: 'list', spans: headItemSpans(lines, base) };
  }
  var head = lstripSpacesAndTabs(first).charAt(0);
  if (head === '[' || head === '{') {
    // A flow collection is one value, even though a colon stands inside it.
    return { kind: 'scalar', spans: [] };
  }
  if (headKeyOf(first) !== null) {
    return { kind: 'map', spans: headWalk(lines, base, 0, null) };
  }
  return { kind: 'scalar', spans: [] };
}

/* Values ------------------------------------------------------------------- */

/* The value of a field, from what stands beside the key and below it. */
function headValue(inline, lines) {
  if (HEAD_BLOCK_SCALAR.test(inline)) {
    return headBlockScalar(inline, lines);
  }
  if (inline === '') {
    return headContentValue(lines);
  }
  var first = inline.charAt(0);
  if (first === '[' || first === '{' || first === '"' || first === "'") {
    return headScalarValue(foldedText([inline].concat(lines)));
  }
  for (var index = 0; index < lines.length; index += 1) {
    if (pyStrip(lines[index])) {
      return headPlainValue(foldedText([inline].concat(lines)));
    }
  }
  return headScalarValue(inline);
}

/* The value that stands under a key rather than beside it. */
function headContentValue(lines) {
  var shape = headStructure(lines);
  if (shape.kind === 'empty') {
    return null;
  }
  if (shape.kind === 'list') {
    var items = [];
    for (var index = 0; index < shape.spans.length; index += 1) {
      var span = shape.spans[index];
      items.push(headItemValue(lines.slice(span.start, span.end)));
    }
    return items;
  }
  if (shape.kind === 'map') {
    var pairs = Object.create(null);
    for (var at = 0; at < shape.spans.length; at += 1) {
      var entry = shape.spans[at];
      pairs[entry.key] = headValue(entry.inline, lines.slice(entry.start + 1, entry.end));
    }
    return pairs;
  }
  return headScalarValue(foldedText(lines));
}

/* One entry of a block list, read with its dash turned into a space. */
function headItemValue(lines) {
  var first = lines[0];
  var at = first.indexOf('-');
  return headContentValue(
    [first.slice(0, at) + ' ' + first.slice(at + 1)].concat(lines.slice(1))
  );
}

/* A value wrapped over several lines, read as the one value it is. */
function foldedText(lines) {
  var kept = [];
  for (var index = 0; index < lines.length; index += 1) {
    var line = pyStrip(lines[index]);
    if (line) {
      kept.push(line);
    }
  }
  return kept.join(' ');
}

/* A literal or folded block, without a trailing newline.
 *
 * Dropping the trailing newline keeps the value comparable; a head that needs
 * the exact ending of a paragraph is asking the head to carry a body.
 */
function headBlockScalar(inline, lines) {
  var content = [];
  for (var index = 0; index < lines.length; index += 1) {
    if (pyStrip(lines[index])) {
      content.push(lines[index]);
    }
  }
  if (!content.length) {
    return '';
  }
  var indent = headIndentOf(content[0]);
  for (var at = 1; at < content.length; at += 1) {
    indent = Math.min(indent, headIndentOf(content[at]));
  }
  var kept = [];
  for (var line = 0; line < lines.length; line += 1) {
    kept.push(pyStrip(lines[line]) ? lines[line].slice(indent) : '');
  }
  while (kept.length && !pyStrip(kept[kept.length - 1])) {
    kept.pop();
  }
  if (inline.charAt(0) === '>') {
    return foldedText(kept);
  }
  return kept.join('\n');
}

/* One value on one logical line: a flow collection, quoted, or plain. */
function headScalarValue(text) {
  var value = pyStrip(text);
  if (!value) {
    return null;
  }
  var first = value.charAt(0);
  if (first === '[' || first === '{') {
    return headFlowValue(value, 0).value;
  }
  if (first === '"' || first === "'") {
    return headUnquote(value);
  }
  return headPlainValue(value);
}

/* An unquoted value. It ends where a comment begins. */
function headPlainValue(text) {
  var value = text;
  var markers = [' #', '\t#'];
  for (var index = 0; index < markers.length; index += 1) {
    var cut = value.indexOf(markers[index]);
    if (cut >= 0) {
      value = value.slice(0, cut);
    }
  }
  value = pyStrip(value);
  if (HEAD_NULLS.indexOf(value) >= 0) {
    return null;
  }
  return value;
}

/* Where the string opened at start closes, or null. */
function headClosingQuote(text, start) {
  var quote = text.charAt(start);
  var index = start + 1;
  while (index < text.length) {
    var char = text.charAt(index);
    if (quote === '"' && char === '\\') {
      index += 2;
      continue;
    }
    if (char === quote) {
      if (quote === "'" && text.slice(index + 1, index + 2) === "'") {
        index += 2;
        continue;
      }
      return index;
    }
    index += 1;
  }
  return null;
}

function headUnquote(text) {
  var closing = headClosingQuote(text, 0);
  if (closing === null) {
    return text;
  }
  var inner = text.slice(1, closing);
  if (text.charAt(0) === "'") {
    return inner.split("''").join("'");
  }
  return headUnescaped(inner);
}

function headUnescaped(text) {
  var out = [];
  var index = 0;
  while (index < text.length) {
    var char = text.charAt(index);
    if (char !== '\\' || index + 1 >= text.length) {
      out.push(char);
      index += 1;
      continue;
    }
    var marker = text.charAt(index + 1);
    if (marker === 'u' && text.length >= index + 6) {
      var digits = text.slice(index + 2, index + 6);
      if (/^[0-9A-Fa-f]{4}$/.test(digits)) {
        out.push(String.fromCharCode(parseInt(digits, 16)));
        index += 6;
        continue;
      }
    }
    out.push(
      Object.prototype.hasOwnProperty.call(HEAD_UNESCAPE, marker)
        ? HEAD_UNESCAPE[marker]
        : marker
    );
    index += 2;
  }
  return out.join('');
}

/* A flow collection or a flow scalar, from index on. */
function headFlowValue(text, index) {
  var at = index;
  while (at < text.length && (text.charAt(at) === ' ' || text.charAt(at) === '\t')) {
    at += 1;
  }
  if (at >= text.length) {
    return { value: null, index: at };
  }
  if (text.charAt(at) === '[') {
    return headFlowList(text, at);
  }
  if (text.charAt(at) === '{') {
    return headFlowMap(text, at);
  }
  return headFlowScalar(text, at, ',]}');
}

function headFlowList(text, index) {
  var out = [];
  var at = index + 1;
  while (at < text.length) {
    while (at < text.length && ' \t,'.indexOf(text.charAt(at)) >= 0) {
      at += 1;
    }
    if (at < text.length && text.charAt(at) === ']') {
      return { value: out, index: at + 1 };
    }
    if (at >= text.length) {
      break;
    }
    var read = headFlowValue(text, at);
    if (read.index === at) {
      // A bracket that does not belong here. Stop rather than spin.
      break;
    }
    at = read.index;
    out.push(read.value);
  }
  return { value: out, index: at };
}

function headFlowMap(text, index) {
  var out = Object.create(null);
  var at = index + 1;
  while (at < text.length) {
    while (at < text.length && ' \t,'.indexOf(text.charAt(at)) >= 0) {
      at += 1;
    }
    if (at < text.length && text.charAt(at) === '}') {
      return { value: out, index: at + 1 };
    }
    if (at >= text.length) {
      break;
    }
    var read = headFlowScalar(text, at, ':,}');
    if (read.index === at) {
      break;
    }
    at = read.index;
    while (at < text.length && (text.charAt(at) === ' ' || text.charAt(at) === '\t')) {
      at += 1;
    }
    var value = null;
    if (at < text.length && text.charAt(at) === ':') {
      var pair = headFlowValue(text, at + 1);
      value = pair.value;
      at = pair.index;
    }
    // A name that is not text is written the way the run writes it.
    var name = typeof read.value === 'string'
      ? read.value
      : (read.value === null ? 'None' : String(read.value));
    out[name] = value;
  }
  return { value: out, index: at };
}

/* One value inside a flow collection, quoted or plain. */
function headFlowScalar(text, index, stop) {
  var first = text.charAt(index);
  if (first === '"' || first === "'") {
    var closing = headClosingQuote(text, index);
    if (closing === null) {
      return { value: headUnquote(text.slice(index)), index: text.length };
    }
    return { value: headUnquote(text.slice(index, closing + 1)), index: closing + 1 };
  }
  var start = index;
  var at = index;
  while (at < text.length && stop.indexOf(text.charAt(at)) < 0) {
    at += 1;
  }
  return { value: headPlainValue(text.slice(start, at)), index: at };
}

/* Writing ------------------------------------------------------------------ */

/* The lines of a head a write may work on, or a finding that there is none. */
function headForWriting(text) {
  var state = headLines(text);
  if (state === null) {
    throw new MissingHead('the page carries no head, and a head is never created here');
  }
  return state;
}

/* The one field of that name, or nothing. A name standing twice is refused. */
function headSingleField(bare, close, key) {
  var walked = headWalk(bare, 0, 1, close);
  var found = [];
  for (var index = 0; index < walked.length; index += 1) {
    if (walked[index].key === key) {
      found.push(walked[index]);
    }
  }
  if (found.length > 1) {
    var lines = [];
    for (var at = 0; at < found.length; at += 1) {
      lines.push(found[at].start + 1);
    }
    throw new AmbiguousField(new HeadRepeated(key, lines).toString());
  }
  return found.length ? found[0] : null;
}

/* Refuse a new name with the line the field would have taken. */
function headRequireSafeName(key, line) {
  if (!isSafeHeadName(key)) {
    throw new UnsafeName(
      JSON.stringify(key) + ' is no name this writer adds, line ' + line
    );
  }
}

/* The head carries text, lists and mappings. Anything else is refused.
 *
 * A number or a date object would come back as text on the next read, and the
 * writer would have to decide its form on the caller's behalf.
 */
function headCheckValue(value) {
  if (value === null || value === undefined || typeof value === 'string') {
    return;
  }
  if (Array.isArray(value)) {
    for (var index = 0; index < value.length; index += 1) {
      headCheckValue(value[index]);
    }
    return;
  }
  if (typeof value === 'object') {
    var names = Object.keys(value);
    for (var at = 0; at < names.length; at += 1) {
      headCheckValue(value[names[at]]);
    }
    return;
  }
  throw new TypeError('a head carries text, lists and mappings, not ' + typeof value);
}

/* How a field is written down today, so a rewrite keeps that shape. */
function HeadForm() {
  this.style = null;
  this.quote = null;
  this.indent = '  ';
  this.keyLine = null;
  this.keyText = null;
  this.items = [];
  this.pairs = new Map();
  this.itemStyle = 'flow';
  this.itemQuote = null;
}

/* Read the shape of the field that stands there now. */
function headFormOf(raw, bare, inline) {
  var form = new HeadForm();
  form.keyLine = raw[0];
  form.keyText = headKeyText(bare[0]);
  if (inline) {
    var first = inline.charAt(0);
    form.style = (first === '[' || first === '{') ? 'flow' : 'inline';
    if (first === '"' || first === "'") {
      form.quote = first;
    }
    return form;
  }

  var body = bare.slice(1);
  var shape = headStructure(body);
  if (shape.kind === 'list' && shape.spans.length) {
    form.style = 'block';
    var firstItem = body[shape.spans[0].start];
    form.indent = firstItem.slice(0, headIndentOf(firstItem));
    for (var index = 0; index < shape.spans.length; index += 1) {
      var span = shape.spans[index];
      form.items.push([
        headItemValue(body.slice(span.start, span.end)),
        raw.slice(1 + span.start, 1 + span.end).join('')
      ]);
    }
    var head = pyStrip(lstripSpacesAndTabs(firstItem).slice(1));
    if (head.charAt(0) === '{') {
      form.itemStyle = 'flow';
    } else if (head && headKeyOf(head) !== null) {
      form.itemStyle = 'block';
    }
    if (head.charAt(0) === '"' || head.charAt(0) === "'") {
      form.itemQuote = head.charAt(0);
    }
  } else if (shape.kind === 'map' && shape.spans.length) {
    form.style = 'block';
    var firstPair = body[shape.spans[0].start];
    form.indent = firstPair.slice(0, headIndentOf(firstPair));
    for (var at = 0; at < shape.spans.length; at += 1) {
      var entry = shape.spans[at];
      form.pairs.set(entry.key, [
        headValue(entry.inline, body.slice(entry.start + 1, entry.end)),
        raw.slice(1 + entry.start, 1 + entry.end).join('')
      ]);
    }
  } else if (shape.kind === 'scalar') {
    form.style = 'inline';
  }
  return form;
}

/* The lines that replace the span of one field. */
function headRenderField(key, value, form, ending) {
  var name = form.keyText !== null ? form.keyText : key;
  if (value === null || value === undefined) {
    return [name + ':' + ending];
  }
  if (Array.isArray(value) && value.length && form.style !== 'flow') {
    return headBlockList(name, value, form, ending);
  }
  if (
    !Array.isArray(value) && typeof value === 'object' &&
    Object.keys(value).length && form.style === 'block'
  ) {
    return headBlockMap(name, value, form, ending);
  }
  return [name + ': ' + writtenValue(value, form.quote, false) + ending];
}

/* A list under its key, reusing the line of every entry that stays.
 *
 * Adding one entry to related then changes exactly one line, which is what
 * ADR-11 asks of a write and what a per block comparison needs to see.
 */
function headBlockList(name, value, form, ending) {
  var lines = [form.keyLine !== null ? form.keyLine : name + ':' + ending];
  var pool = form.items.slice();
  for (var index = 0; index < value.length; index += 1) {
    var item = value[index];
    var kept = null;
    for (var at = 0; at < pool.length; at += 1) {
      if (sameValue(pool[at][0], item)) {
        kept = pool[at][1];
        pool.splice(at, 1);
        break;
      }
    }
    if (kept !== null) {
      lines.push(kept);
    } else {
      var fresh = headItemLines(item, form, ending);
      for (var line = 0; line < fresh.length; line += 1) {
        lines.push(fresh[line]);
      }
    }
  }
  return lines;
}

/* One entry of a block list, as the lines it takes. */
function headItemLines(item, form, ending) {
  var dash = form.indent + '- ';
  if (
    item !== null && !Array.isArray(item) && typeof item === 'object' &&
    Object.keys(item).length && form.itemStyle === 'block'
  ) {
    var names = Object.keys(item);
    var deeper = ' '.repeat(dash.length);
    var out = [dash + headPairText(names[0], item[names[0]], null) + ending];
    for (var index = 1; index < names.length; index += 1) {
      out.push(deeper + headPairText(names[index], item[names[index]], null) + ending);
    }
    return out;
  }
  return [dash + writtenValue(item, form.itemQuote, false) + ending];
}

/* A mapping under its key, reusing the lines of every pair that stays. */
function headBlockMap(name, value, form, ending) {
  var lines = [form.keyLine !== null ? form.keyLine : name + ':' + ending];
  var names = Object.keys(value);
  for (var index = 0; index < names.length; index += 1) {
    var old = form.pairs.get(names[index]);
    if (old !== undefined && sameValue(old[0], value[names[index]])) {
      lines.push(old[1]);
    } else {
      lines.push(form.indent + headPairText(names[index], value[names[index]], null) + ending);
    }
  }
  return lines;
}

function headPairText(name, value, quote) {
  if (value === null || value === undefined) {
    return name + ':';
  }
  return name + ': ' + writtenValue(value, quote, false);
}

/* One value on one line, quoted where a reader would otherwise trip. */
function writtenValue(value, quote, flow) {
  if (value === null || value === undefined) {
    return '~';
  }
  var index;
  if (Array.isArray(value)) {
    var items = [];
    for (index = 0; index < value.length; index += 1) {
      items.push(writtenValue(value[index], null, true));
    }
    return '[' + items.join(', ') + ']';
  }
  if (typeof value === 'object') {
    var names = Object.keys(value);
    var pairs = [];
    for (index = 0; index < names.length; index += 1) {
      pairs.push(names[index] + ': ' + writtenValue(value[names[index]], null, true));
    }
    return '{' + pairs.join(', ') + '}';
  }
  if (quote === "'" && !/[\n\r\t]/.test(value)) {
    return "'" + value.split("'").join("''") + "'";
  }
  if (quote !== null && quote !== undefined) {
    return quotedText(value);
  }
  if (headNeedsQuotes(value) || (flow && headNeedsFlowQuotes(value))) {
    return quotedText(value);
  }
  return value;
}

function quotedText(value) {
  var out = [];
  for (var index = 0; index < value.length; index += 1) {
    var char = value.charAt(index);
    out.push(
      Object.prototype.hasOwnProperty.call(HEAD_ESCAPE, char)
        ? HEAD_ESCAPE[char]
        : char
    );
  }
  return '"' + out.join('') + '"';
}

function headNeedsQuotes(value) {
  if (value === '' || value !== pyStrip(value)) {
    return true;
  }
  if (HEAD_LEADING.indexOf(value.charAt(0)) >= 0) {
    return true;
  }
  if (value.indexOf(': ') >= 0 || value.slice(-1) === ':' || value.indexOf(' #') >= 0) {
    return true;
  }
  if (/[\n\r\t]/.test(value)) {
    return true;
  }
  return HEAD_NULLS.indexOf(value) >= 0;
}

function headNeedsFlowQuotes(value) {
  return /[,[\]{}:]/.test(value);
}

/* The bench entry. The browser never reaches this line: from file:// the page
 * loads this file as a classic script, where module is not defined.
 */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    Block: Block,
    splitBlocks: splitBlocks,
    joinBlocks: joinBlocks,
    mergeBlocks: mergeBlocks,
    parseHead: parseHead,
    headField: headField,
    headEntries: headEntries,
    setHeadField: setHeadField,
    removeHeadField: removeHeadField,
    isSafeHeadName: isSafeHeadName,
    HeadError: HeadError,
    MissingHead: MissingHead,
    AmbiguousField: AmbiguousField,
    UnsafeName: UnsafeName
  };
}
