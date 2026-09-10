// Generated from app/core.js; shared line comparison.
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


export {matchingBlocks};
