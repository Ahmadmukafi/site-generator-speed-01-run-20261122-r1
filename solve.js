// solve.js — a faster drop-in for makefun-site 1.0.0.
// Written from the vendor README spec alone (build order, front matter, template
// dialect, Markdown subset, slug rule, report). No part of the reference code
// was read or copied. Deterministic: no clock, environment or randomness.

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];

const ESC_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
function esc(s) {
  if (s.indexOf('&') < 0 && s.indexOf('<') < 0 && s.indexOf('>') < 0 &&
      s.indexOf('"') < 0 && s.indexOf("'") < 0) return s;
  let o = '', st = 0;
  for (let i = 0; i < s.length; i++) {
    const r = ESC_MAP[s[i]];
    if (r !== undefined) { o += s.slice(st, i) + r; st = i + 1; }
  }
  return o + s.slice(st);
}

const MARK_RE = /\p{M}/gu;
const NONALNUM_RE = /[^a-z0-9]+/g;
// Per-case memo: slugOf/dateLong are called for the same tag/date strings
// over and over (every card render). run() clears both maps, so nothing
// carries from one case to the next.
const SLUG_CACHE = new Map();
const DATE_CACHE = new Map();
function slugOf(text) {
  let s = SLUG_CACHE.get(text);
  if (s !== undefined) return s;
  s = slugOfRaw(text);
  SLUG_CACHE.set(text, s);
  return s;
}
function slugOfRaw(text) {
  let s = text.normalize('NFKD').replace(MARK_RE, '').toLowerCase();
  s = s.replace(NONALNUM_RE, '-');
  let a = 0, b = s.length;
  while (a < b && s.charCodeAt(a) === 45) a++;
  while (b > a && s.charCodeAt(b - 1) === 45) b--;
  s = s.slice(a, b);
  if (s.length > 64) { s = s.slice(0, 64); if (s.charCodeAt(63) === 45) s = s.slice(0, 63); }
  return s === '' ? 'untitled' : s;
}

function dateLong(d) {
  let s = DATE_CACHE.get(d);
  if (s !== undefined) return s;
  s = (+d.slice(8, 10)) + ' ' + MONTHS[+d.slice(5, 7) - 1] + ' ' + d.slice(0, 4);
  DATE_CACHE.set(d, s);
  return s;
}

// ---------------------------------------------------------------- front matter
const FM_KEYS = new Set(['title', 'summary', 'date', 'tags', 'draft', 'layout', 'slug']);
const QUOTED_RE = /^"((?:\\["\\]|[^"\\])*)"$/;
const UNESC_RE = /\\(["\\])/g;

function validDate(v) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const y = +v.slice(0, 4), m = +v.slice(5, 7), d = +v.slice(8, 10);
  if (y < 1970 || y > 2099 || m < 1 || m > 12 || d < 1) return false;
  const leap = (y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0));
  const dim = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
  return d <= dim;
}

function valueError(key, value, fm) {
  if (key === 'title' || key === 'summary') {
    if (value[0] === '"') {
      const m = QUOTED_RE.exec(value);
      if (!m) return `key "${key}": a quoted string is not closed`;
      fm[key] = m[1].replace(UNESC_RE, '$1');
      return null;
    }
    if (value[0] === '[') return `key "${key}": a bare string opens on [`;
    fm[key] = value;
    return null;
  }
  if (key === 'date') {
    if (!validDate(value)) return 'key "date": not a date from 1970-01-01 to 2099-12-31 (YYYY-MM-DD)';
    fm.date = value;
    return null;
  }
  if (key === 'tags') {
    if (value[0] !== '[' || value[value.length - 1] !== ']') return 'key "tags": not a list [a, b]';
    const inner = value.slice(1, -1);
    if (inner === '') { fm.tags = []; return null; }
    const parts = inner.split(',');
    const tags = [];
    for (let i = 0; i < parts.length; i++) {
      const t = parts[i].trim();
      if (t === '' || t.indexOf('"') >= 0 || t.indexOf('[') >= 0 || t.indexOf(']') >= 0)
        return 'key "tags": an empty tag, or one holding " [ or ]';
      tags.push(t);
    }
    fm.tags = tags;
    return null;
  }
  if (key === 'draft') {
    if (value === 'true') { fm.draft = true; return null; }
    if (value === 'false') { fm.draft = false; return null; }
    return 'key "draft": true or false';
  }
  if (key === 'layout') {
    if (!/^[a-z0-9-]+$/.test(value)) return 'key "layout": not a template name';
    fm.layout = value;
    return null;
  }
  // slug
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(value) || value.length > 64) return 'key "slug": not a slug';
  fm.slug = value;
  return null;
}

function parseFrontMatter(content) {
  const lines = content.split('\n');
  if (lines[0] !== '---') return { error: 'no front matter' };
  const fm = {};
  const seen = new Set();
  const n = lines.length;
  let j = 1, closed = false;
  for (; j < n; j++) {
    const raw = lines[j];
    if (raw === '---') { closed = true; j++; break; }
    const line = raw.replace(/[ \t]+$/, '');
    if (line === '' || line[0] === '#') continue;
    const m = /^([a-z_]+):(.*)$/.exec(line);
    if (!m) return { error: `line ${j + 1} is not "key: value"` };
    const key = m[1], rest = m[2];
    if (!FM_KEYS.has(key)) return { error: `unknown key "${key}"` };
    if (seen.has(key)) return { error: `key "${key}" is given twice` };
    seen.add(key);
    if (rest === '') return { error: `key "${key}" has no value` };
    if (rest[0] !== ' ') return { error: `line ${j + 1} is not "key: value"` };
    const err = valueError(key, rest.slice(1), fm);
    if (err) return { error: err };
  }
  if (!closed) return { error: 'the front matter is not closed' };
  if (!fm.title) return { error: 'no title' };
  // The body is everything after the closing '---' line. The first
  // '\n---\n' after the opening line IS that line (front-matter values are
  // single-line, so no earlier '---' line can hide inside one); slice it
  // instead of re-joining the split lines.
  let body;
  const ci = content.indexOf('\n---\n', 3);
  if (ci >= 0) body = content.slice(ci + 5);
  else if (content.endsWith('\n---')) body = '';
  else body = lines.slice(j).join('\n');
  return { fm, body };
}

// --------------------------------------------------------------------- inline
const ESCAPABLE = new Set(['\\', '`', '*', '_', '[', ']', '(', ')', '#', '+', '-', '.', '!', '>']);
const INLINE_SPECIAL = /[\\`*\[]/g;
const SCHEME_RE = /^[A-Za-z][A-Za-z0-9+.-]*:/;

function isEscaped(s, j) {
  let k = j - 1, c = 0;
  while (k >= 0 && s.charCodeAt(k) === 92) { c++; k--; }
  return (c & 1) === 1;
}

function findStrongClose(s, i) {
  let j = s.indexOf('**', i + 2);
  while (j >= 0) {
    if (j - (i + 2) >= 1 && !isEscaped(s, j)) return j;
    j = s.indexOf('**', j + 1);
  }
  return -1;
}

function findEmClose(s, i) {
  // The next single `*` (one not beside another `*`) not escaped, with at
  // least one character between. Stars come in runs: in `***quick***` the
  // closing run of three is `**` plus the single `*` that closes the
  // emphasis, so the closer is the LAST star of an odd-length run of
  // unescaped stars; an even run holds no single star at all. An escaped
  // `*` is neither a closer nor part of a run.
  const n = s.length;
  let j = i + 2;
  while (j < n) {
    const c = s.charCodeAt(j);
    if (c === 92) { j += 2; continue; } // skip an escape pair
    if (c !== 42) { j++; continue; }
    if (isEscaped(s, j)) { j++; continue; }
    let k = j + 1;
    while (k < n && s.charCodeAt(k) === 42) k++;
    if ((k - j) % 2 === 1) return k - 1;
    j = k;
  }
  return -1;
}

function resolveHref(target, ctx) {
  if (SCHEME_RE.test(target) || target[0] === '/' || target[0] === '#') return target;
  let path = target, frag = null;
  const h = target.indexOf('#');
  if (h >= 0) { path = target.slice(0, h); frag = target.slice(h + 1); }
  const parts = ctx.dir === '' ? [] : ctx.dir.split('/');
  const segs = path.split('/');
  for (let i = 0; i < segs.length; i++) {
    const seg = segs[i];
    if (seg === '' || seg === '.') continue;
    if (seg === '..') { if (parts.length) parts.pop(); continue; }
    parts.push(seg);
  }
  const resolved = parts.join('/');
  const url = ctx.pages.get(resolved);
  if (url !== undefined) return frag === null ? url : url + '#' + frag;
  if (ctx.statics.has(resolved)) return ctx.base + '/' + resolved + (frag === null ? '' : '#' + frag);
  ctx.broken.add('broken-link ' + ctx.source + ' -> ' + target);
  return target;
}

function parseLink(s, i, ctx) {
  const n = s.length;
  let j = i + 1;
  while (j < n) {
    if (s.charCodeAt(j) === 92) { j += 2; continue; }
    if (s.charCodeAt(j) === 93) break;
    j++;
  }
  if (j >= n || s.charCodeAt(j) !== 93) return null;
  if (s.charCodeAt(j + 1) !== 40) return null;
  const k = s.indexOf(')', j + 2);
  if (k < 0) return null;
  const target = s.slice(j + 2, k);
  if (target === '' || /\s/.test(target)) return null;
  const text = inlineInner(s, i + 1, j, ctx);
  return { html: '<a href="' + esc(resolveHref(target, ctx)) + '">' + text + '</a>', end: k + 1 };
}

// Inline content of an emphasis span: most spans are a single plain word,
// so skip the recursive inline() call when the span holds no special char.
function inlineInner(s, a, b, ctx) {
  for (let k = a; k < b; k++) {
    const c = s.charCodeAt(k);
    if (c === 92 || c === 96 || c === 42 || c === 91) return inline(s.slice(a, b), ctx);
  }
  return esc(s.slice(a, b));
}

function inline(s, ctx) {
  const out = [];
  const n = s.length;
  let i = 0;
  while (i < n) {
    INLINE_SPECIAL.lastIndex = i;
    const m = INLINE_SPECIAL.exec(s);
    const next = m ? m.index : n;
    if (next > i) out.push(esc(s.slice(i, next)));
    if (!m) break;
    i = next;
    const ch = s[i];
    if (ch === '\\') {
      const nx = s[i + 1];
      if (nx !== undefined && ESCAPABLE.has(nx)) { out.push(esc(nx)); i += 2; }
      else { out.push('\\'); i += 1; }
    } else if (ch === '`') {
      const j = s.indexOf('`', i + 1);
      if (j > i + 1) { out.push('<code>' + esc(s.slice(i + 1, j)) + '</code>'); i = j + 1; }
      else { out.push('`'); i += 1; }
    } else if (ch === '*') {
      if (s[i + 1] === '*') {
        // Strong opens, but not when the text after it opens on `**` too:
        // ****in** renders **<strong>in</strong>, while ***bundle*** renders
        // <strong>*bundle</strong>* — the content must not start on `**`.
        if (s[i + 2] === '*' && s[i + 3] === '*') { out.push('**'); i += 2; continue; }
        const j = findStrongClose(s, i);
        if (j >= 0) { out.push('<strong>' + inlineInner(s, i + 2, j, ctx) + '</strong>'); i = j + 2; }
        else { out.push('**'); i += 2; }
      } else {
        const j = findEmClose(s, i);
        if (j >= 0) { out.push('<em>' + inlineInner(s, i + 1, j, ctx) + '</em>'); i = j + 1; }
        else { out.push('*'); i += 1; }
      }
    } else { // '['
      const r = parseLink(s, i, ctx);
      if (r) { out.push(r.html); i = r.end; }
      else { out.push('['); i += 1; }
    }
  }
  return out.join('');
}

// ------------------------------------------------------------------ markdown
const FENCE_START_RE = /^```([A-Za-z0-9_+\-]*)[ \t]*$/;
const FENCE_CLOSE_RE = /^```[ \t]*$/;
const HEADING_RE = /^(#{1,6})[ \t]+(.*)$/;
const HR_RE = /^(---|\*\*\*)[ \t]*$/;

function isBlank(line) {
  for (let i = 0; i < line.length; i++) {
    const c = line.charCodeAt(i);
    if (c !== 32 && c !== 9) return false;
  }
  return true;
}

function trimLine(line) {
  let a = 0, b = line.length;
  while (a < b && (line.charCodeAt(a) === 32 || line.charCodeAt(a) === 9)) a++;
  while (b > a && (line.charCodeAt(b - 1) === 32 || line.charCodeAt(b - 1) === 9)) b--;
  return line.slice(a, b);
}

function headingOf(line) {
  if (line.charCodeAt(0) !== 35) return null;
  const m = HEADING_RE.exec(line);
  if (!m) return null;
  const text = m[2].replace(/[ \t]+$/, '');
  if (text === '') return null;
  return { level: m[1].length, text };
}

function fenceStart(line) {
  if (!line.startsWith('```')) return null;
  const m = FENCE_START_RE.exec(line);
  return m ? m[1] : null;
}

function isHR(line) {
  if (!line.startsWith('---') && !line.startsWith('***')) return false;
  return HR_RE.test(line);
}

function listStart(l) {
  const c0 = l.charCodeAt(0);
  if (c0 === 45 || c0 === 42) { // '-' or '*'
    if (l.charCodeAt(1) === 32) return { ordered: false, text: trimLine(l.slice(2)) };
    return null;
  }
  if (c0 >= 48 && c0 <= 57) {
    const m = /^(\d+)\. /.exec(l);
    if (m) return { ordered: true, num: +m[1], text: trimLine(l.slice(m[0].length)) };
  }
  return null;
}

function renderBody(body, ctx) {
  const lines = body.split('\n');
  const n = lines.length;
  const out = [];
  const toc = [];
  const ids = new Map();
  let excerpt = '';
  let hasExcerpt = false;
  let i = 0;
  while (i < n) {
    const line = lines[i];
    if (isBlank(line)) { i++; continue; }
    const lang = fenceStart(line);
    if (lang !== null) {
      const buf = [];
      i++;
      while (i < n && !FENCE_CLOSE_RE.test(lines[i])) { buf.push(esc(lines[i])); i++; }
      if (i < n) i++;
      out.push('<pre><code' + (lang ? ' class="language-' + lang + '"' : '') + '>' +
        (buf.length ? buf.join('\n') + '\n' : '') + '</code></pre>\n');
      continue;
    }
    const hm = headingOf(line);
    if (hm) {
      let id = slugOf(hm.text);
      const c = (ids.get(id) || 0) + 1;
      ids.set(id, c);
      if (c > 1) id = id + '-' + c;
      const html = inline(hm.text, ctx);
      if (hm.level === 2 || hm.level === 3) toc.push({ level: hm.level, id, html });
      out.push('<h' + hm.level + ' id="' + id + '">' + html + '</h' + hm.level + '>\n');
      i++;
      continue;
    }
    if (isHR(line)) { out.push('<hr>\n'); i++; continue; }
    if (line.charCodeAt(0) === 62) { // '>'
      const parts = [];
      while (i < n && lines[i].charCodeAt(0) === 62) {
        let t = lines[i].slice(1);
        if (t.charCodeAt(0) === 32) t = t.slice(1);
        t = trimLine(t);
        if (t !== '') parts.push(t);
        i++;
      }
      if (parts.length === 0) out.push('<blockquote>\n</blockquote>\n');
      else out.push('<blockquote>\n<p>' + inline(parts.join('\n'), ctx) + '</p>\n</blockquote>\n');
      continue;
    }
    const lm = listStart(line);
    if (lm) {
      const ordered = lm.ordered;
      const startNum = lm.num;
      const items = [lm.text];
      i++;
      while (i < n) {
        const l = lines[i];
        const m2 = listStart(l);
        if (m2 && m2.ordered === ordered) { items.push(m2.text); i++; continue; }
        if (l.length >= 2 && l.charCodeAt(0) === 32 && l.charCodeAt(1) === 32 && trimLine(l) !== '') {
          items[items.length - 1] += '\n' + trimLine(l);
          i++;
          continue;
        }
        break;
      }
      out.push(ordered ? (startNum !== 1 ? '<ol start="' + startNum + '">' : '<ol>') : '<ul>');
      out.push('\n');
      for (let k = 0; k < items.length; k++) out.push('<li>' + inline(items[k], ctx) + '</li>\n');
      out.push(ordered ? '</ol>\n' : '</ul>\n');
      continue;
    }
    // paragraph: lines up to a blank line, a fence, a heading or a thematic break
    const parts = [trimLine(line)];
    i++;
    while (i < n) {
      const l = lines[i];
      if (isBlank(l)) break;
      if (fenceStart(l) !== null) break;
      if (headingOf(l)) break;
      if (isHR(l)) break;
      parts.push(trimLine(l));
      i++;
    }
    const inner = inline(parts.join('\n'), ctx);
    if (!hasExcerpt) { excerpt = inner; hasExcerpt = true; }
    out.push('<p>' + inner + '</p>\n');
  }
  return { html: out.join(''), excerpt, toc };
}

// ----------------------------------------------------------------- templates
function isPath(p) {
  return /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$/.test(p);
}

function tokenize(src) {
  const toks = [];
  let i = 0;
  const n = src.length;
  while (i < n) {
    const j1 = src.indexOf('{{{', i), j2 = src.indexOf('{{', i), j3 = src.indexOf('{%', i);
    let j = -1, kind = '';
    if (j1 >= 0 && (j < 0 || j1 < j)) { j = j1; kind = 'raw'; }
    if (j2 >= 0 && (j < 0 || j2 < j || (j2 === j && kind !== 'raw'))) { if (j2 < j || j < 0) { j = j2; kind = 'var'; } else if (j2 === j && kind !== 'raw') { j = j2; kind = 'var'; } }
    if (j3 >= 0 && (j < 0 || j3 < j)) { j = j3; kind = 'tag'; }
    if (j < 0) { toks.push({ t: 'text', s: src.slice(i) }); break; }
    if (j > i) toks.push({ t: 'text', s: src.slice(i, j) });
    if (kind === 'raw') {
      const e = src.indexOf('}}}', j + 3);
      if (e < 0) return { error: 'unclosed {{{' };
      toks.push({ t: 'raw', path: src.slice(j + 3, e).trim(), start: j, end: e + 3 });
      i = e + 3;
    } else if (kind === 'var') {
      const e = src.indexOf('}}', j + 2);
      if (e < 0) return { error: 'unclosed {{' };
      toks.push({ t: 'var', path: src.slice(j + 2, e).trim(), start: j, end: e + 2 });
      i = e + 2;
    } else {
      const e = src.indexOf('%}', j + 2);
      if (e < 0) return { error: 'unclosed {%' };
      toks.push({ t: 'tag', raw: src.slice(j + 2, e).trim(), start: j, end: e + 2 });
      i = e + 2;
    }
  }
  return { toks };
}

function stripStandalone(src, toks) {
  // A {% %} tag alone on its line (only spaces/tabs beside it) takes the whole
  // line with it, its \n included. The tag itself still runs; only the
  // whitespace before it on its line and the whitespace plus \n after it go.
  // Ranges are computed on the raw source, then removed right to left.
  const remove = [];
  for (const tk of toks) {
    if (tk.t !== 'tag') continue;
    const ls = src.lastIndexOf('\n', tk.start - 1) + 1;
    const le = src.indexOf('\n', tk.end);
    const before = src.slice(ls, tk.start);
    const after = src.slice(tk.end, le < 0 ? src.length : le);
    if (/^[ \t]*$/.test(before) && /^[ \t]*$/.test(after)) {
      if (tk.start > ls) remove.push([ls, tk.start]);
      remove.push([tk.end, le < 0 ? src.length : le + 1]);
    }
  }
  if (!remove.length) return src;
  remove.sort((a, b) => b[0] - a[0]);
  let out = src;
  for (let k = 0; k < remove.length; k++) out = out.slice(0, remove[k][0]) + out.slice(remove[k][1]);
  return out;
}

function buildAST(toks) {
  const root = { t: 'root', kids: [] };
  const stack = [{ node: root, arr: root.kids }];
  for (let ti = 0; ti < toks.length; ti++) {
    const tk = toks[ti];
    const top = stack[stack.length - 1];
    if (tk.t === 'text') { if (tk.s !== '') top.arr.push({ t: 'text', s: tk.s }); continue; }
    if (tk.t === 'var' || tk.t === 'raw') {
      if (!isPath(tk.path)) return { error: 'not a path' };
      top.arr.push({ t: tk.t, path: tk.path.split('.') });
      continue;
    }
    const raw = tk.raw;
    let m;
    if ((m = /^for\s+([A-Za-z_][A-Za-z0-9_]*)\s+in\s+(.+)$/.exec(raw))) {
      if (!isPath(m[2])) return { error: 'not a path' };
      const node = { t: 'for', v: m[1], path: m[2].split('.'), kids: [] };
      top.arr.push(node);
      stack.push({ node, arr: node.kids });
    } else if (raw === 'endfor') {
      if (top.node.t !== 'for') return { error: 'endfor without for' };
      stack.pop();
    } else if ((m = /^if\s+(not\s+)?(.+)$/.exec(raw))) {
      if (!isPath(m[2])) return { error: 'not a path' };
      const node = { t: 'if', neg: !!m[1], path: m[2].split('.'), kids: [], els: null };
      top.arr.push(node);
      stack.push({ node, arr: node.kids });
    } else if (raw === 'else') {
      if (top.node.t !== 'if' || top.node.els !== null) return { error: 'else without if' };
      top.node.els = [];
      top.arr = top.node.els;
    } else if (raw === 'endif') {
      if (top.node.t !== 'if') return { error: 'endif without if' };
      stack.pop();
    } else if ((m = /^include\s+"([A-Za-z0-9_-]+)"$/.exec(raw))) {
      top.arr.push({ t: 'include', name: m[1] });
    } else {
      return { error: 'unknown tag' };
    }
  }
  if (stack.length > 1) {
    const open = stack[stack.length - 1].node;
    return { error: open.t === 'for' ? 'for is not closed' : 'if is not closed' };
  }
  return { root };
}

function genKids(kids, out, ctr) {
  for (let i = 0; i < kids.length; i++) genNode(kids[i], out, ctr);
}

function genNode(node, out, ctr) {
  if (node.t === 'text') { out.push('O.push(' + JSON.stringify(node.s) + ');'); return; }
  if (node.t === 'var') { out.push('O.push(esc(val(get(S,F,' + JSON.stringify(node.path) + '))));'); return; }
  if (node.t === 'raw') { out.push('O.push(val(get(S,F,' + JSON.stringify(node.path) + ')));'); return; }
  if (node.t === 'if') {
    out.push('if(' + (node.neg ? '!' : '') + 'truthy(get(S,F,' + JSON.stringify(node.path) + '))){');
    genKids(node.kids, out, ctr);
    if (node.els) { out.push('}else{'); genKids(node.els, out, ctr); }
    out.push('}');
    return;
  }
  if (node.t === 'for') {
    const k = ctr.n++;
    out.push('var _a' + k + '=get(S,F,' + JSON.stringify(node.path) + ');');
    out.push('if(Array.isArray(_a' + k + ')){');
    out.push('var _l' + k + '={index:0,first:false,last:false,length:_a' + k + '.length};');
    out.push('var _f' + k + '={v:' + JSON.stringify(node.v) + ',x:null,loop:_l' + k + '};');
    out.push('F.push(_f' + k + ');');
    out.push('for(var _i' + k + '=0;_i' + k + '<_a' + k + '.length;_i' + k + '++){');
    out.push('_l' + k + '.index=_i' + k + '+1;_l' + k + '.first=_i' + k + '===0;_l' + k + '.last=_i' + k + '===_a' + k + '.length-1;_f' + k + '.x=_a' + k + '[_i' + k + '];');
    genKids(node.kids, out, ctr);
    out.push('}F.pop();}');
    return;
  }
  // include
  out.push('inc(' + JSON.stringify(node.name) + ',S,F,O,D);');
}

function compileTemplate(src) {
  const tk1 = tokenize(src);
  if (tk1.error) return { error: tk1.error };
  const cleaned = stripStandalone(src, tk1.toks);
  const tk2 = tokenize(cleaned);
  if (tk2.error) return { error: tk2.error };
  const ast = buildAST(tk2.toks);
  if (ast.error) return { error: ast.error };
  const parts = ['"use strict";'];
  genKids(ast.root.kids, parts, { n: 0 });
  const fn = new Function('S', 'F', 'O', 'D', 'get', 'val', 'esc', 'truthy', 'inc', parts.join(''));
  return { fn };
}

// Template runtime helpers (passed into compiled functions).
function get(S, F, parts) {
  const name = parts[0];
  let v;
  let found = false;
  for (let i = F.length - 1; i >= 0; i--) {
    const fr = F[i];
    if (name === 'loop') { v = fr.loop; found = true; break; }
    if (fr.v === name) { v = fr.x; found = true; break; }
  }
  if (!found) {
    v = S[name];
    if (v === undefined) return undefined;
  }
  for (let j = 1; j < parts.length; j++) {
    if (v === null || v === undefined) return undefined;
    if (!Object.prototype.hasOwnProperty.call(v, parts[j])) return undefined;
    v = v[parts[j]];
  }
  return v;
}

function val(v) {
  if (v === null || v === undefined) return '';
  const t = typeof v;
  if (t === 'string') return v;
  if (t === 'number' || t === 'boolean') return String(v);
  if (Array.isArray(v)) {
    let s = '';
    for (let i = 0; i < v.length; i++) { if (i) s += ', '; s += val(v[i]); }
    return s;
  }
  return '';
}

function truthy(v) {
  return !(v === undefined || v === null || v === false || v === '' || v === 0 ||
    (Array.isArray(v) && v.length === 0));
}

function dirOf(p) {
  const i = p.lastIndexOf('/');
  return i < 0 ? '' : p.slice(0, i);
}

// Word count without allocating the match array: maximal runs of \S.
function countWords(s) {
  let n = 0, inWord = false;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    const ws = c === 32 || c === 9 || c === 10 || c === 11 || c === 12 || c === 13 ||
      c === 160 || c === 5760 || (c >= 8192 && c <= 8202) || c === 8232 || c === 8233 ||
      c === 8239 || c === 8287 || c === 12288 || c === 65279;
    if (ws) inWord = false;
    else if (!inWord) { inWord = true; n++; }
  }
  return n;
}

// ---------------------------------------------------------------------- build
export function run(input) {
  SLUG_CACHE.clear();
  DATE_CACHE.clear();
  const site = input.site || {};
  const base = (site.base_url || '').replace(/\/+$/, '');
  const siteScope = { title: site.title || '', base_url: base };
  const report = new Set();

  const files = (input.files || []).slice().sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

  const compiled = {};
  const tNames = Object.keys(input.templates || {}).sort();
  for (let i = 0; i < tNames.length; i++) {
    const c = compileTemplate(input.templates[tNames[i]]);
    if (c.error) report.add('template "' + tNames[i] + '": ' + c.error);
    else compiled[tNames[i]] = c.fn;
  }
  const inc = (name, S, F, O, D) => {
    if (D >= 8) return;
    const fn = compiled[name];
    if (fn) fn(S, F, O, D + 1, get, val, esc, truthy, inc);
  };
  const render = (fn, S) => {
    const O = [];
    fn(S, [], O, 0, get, val, esc, truthy, inc);
    return O.join('');
  };

  const pages = [];
  const statics = [];
  const slugTaken = new Map();
  slugTaken.set('', new Set(['posts', 'tags', 'page']));
  for (let fi = 0; fi < files.length; fi++) {
    const f = files[fi];
    if (!f.path.endsWith('.md')) { statics.push(f); continue; }
    // Most files have no carriage returns: skip both regex passes then.
    const content = f.content.indexOf('\r') < 0 ? f.content
      : f.content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const parsed = parseFrontMatter(content);
    if (parsed.error) { report.add('refused ' + f.path + ': ' + parsed.error); continue; }
    const fm = parsed.fm;
    const isPost = f.path.startsWith('posts/');
    const dir = isPost ? 'posts' : dirOf(f.path);
    if (!isPost && (f.path.startsWith('tags/') || f.path.startsWith('page/'))) {
      report.add('refused ' + f.path + ': ' +
        (f.path.startsWith('tags/') ? 'tags/ is the generator\'s own' : 'page/ is the generator\'s own'));
      continue;
    }
    if (isPost && !fm.date) { report.add('refused ' + f.path + ': a post needs a date'); continue; }
    const layout = fm.layout || (isPost ? 'post' : 'page');
    if (!compiled[layout]) { report.add('refused ' + f.path + ': layout "' + layout + '" is no template that parses'); continue; }
    if (fm.draft === true) { report.add('draft ' + f.path); continue; }
    let slug = fm.slug || slugOf(fm.title);
    let taken = slugTaken.get(dir);
    if (!taken) { taken = new Set(); slugTaken.set(dir, taken); }
    let cand = slug, k = 2;
    while (taken.has(cand)) { cand = slug + '-' + k; k++; }
    taken.add(cand);
    slug = cand;
    const outPath = (dir ? dir + '/' : '') + slug + '/index.html';
    const url = base + '/' + (dir ? dir + '/' : '') + slug + '/';
    pages.push({ path: f.path, dir, isPost, fm, body: parsed.body, layout, slug, outPath, url });
  }

  const pageBySource = new Map();
  const staticSet = new Set();
  for (const p of pages) pageBySource.set(p.path, p.url);
  for (const f of statics) staticSet.add(f.path);
  const broken = new Set();

  for (const p of pages) {
    const ctx = { dir: dirOf(p.path), pages: pageBySource, statics: staticSet, base, broken, source: p.path };
    const r = renderBody(p.body, ctx);
    p.content = r.html;
    p.excerpt = r.excerpt;
    p.toc = r.toc;
    const wm = countWords(p.body);
    p.reading = Math.max(1, Math.ceil(wm / 200));
  }

  const posts = pages.filter((p) => p.isPost).sort((a, b) => {
    if (a.fm.date !== b.fm.date) return a.fm.date < b.fm.date ? 1 : -1;
    return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
  });
  for (let i = 0; i < posts.length; i++) {
    posts[i].newer = i > 0 ? posts[i - 1] : null;
    posts[i].older = i < posts.length - 1 ? posts[i + 1] : null;
  }

  const tagMap = new Map();
  for (const post of posts) {
    const seen = new Set();
    const tags = post.fm.tags || [];
    for (let i = 0; i < tags.length; i++) {
      const slug = slugOf(tags[i]);
      if (seen.has(slug)) continue;
      seen.add(slug);
      let t = tagMap.get(slug);
      if (!t) {
        t = { name: tags[i], slug, url: base + '/tags/' + slug + '/', count: 0, posts: [] };
        tagMap.set(slug, t);
      }
      t.posts.push(post);
      t.count++;
    }
  }
  const tags = [...tagMap.values()].sort((a, b) =>
    (b.count - a.count) || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));

  function cardOf(p) {
    const tagList = [];
    const seen = new Set();
    const ft = p.fm.tags || [];
    for (let i = 0; i < ft.length; i++) {
      const slug = slugOf(ft[i]);
      if (seen.has(slug)) continue;
      seen.add(slug);
      const t = tagMap.get(slug);
      // A page's tags link to the tag of the same slug: the tag's own name
      // (the first spelling met walking the posts), or the page's own
      // spelling where no post has that tag.
      tagList.push({ name: t ? t.name : ft[i], slug, url: t ? t.url : '' });
    }
    return {
      title: p.fm.title, url: p.url,
      date: p.fm.date || '', date_long: p.fm.date ? dateLong(p.fm.date) : '',
      summary: p.fm.summary || '', excerpt: p.excerpt, reading_minutes: p.reading,
      tags: tagList,
    };
  }
  function neighbour(n) {
    if (!n) return null;
    return { title: n.fm.title, url: n.url, date: n.fm.date || '', date_long: n.fm.date ? dateLong(n.fm.date) : '' };
  }
  for (const p of pages) {
    const card = cardOf(p);
    p.card = card;
    p.pageScope = {
      title: card.title, url: card.url, date: card.date, date_long: card.date_long,
      summary: card.summary, excerpt: card.excerpt, reading_minutes: card.reading_minutes,
      tags: card.tags, slug: p.slug, content: p.content, toc: p.toc,
      newer: p.isPost ? neighbour(p.newer) : null,
      older: p.isPost ? neighbour(p.older) : null,
      is_post: p.isPost,
    };
  }

  const tagsScope = tags.map((t) => ({ name: t.name, slug: t.slug, url: t.url, count: t.count }));
  const recentN = typeof site.recent === 'number' ? site.recent : 0;
  const recentScope = posts.slice(0, recentN).map((p) => p.card);

  const out = {};
  for (const p of pages) {
    out[p.outPath] = render(compiled[p.layout],
      { site: siteScope, tags: tagsScope, recent: recentScope, page: p.pageScope });
  }

  const perPage = site.per_page >= 1 ? site.per_page : 1;
  const total = Math.max(1, Math.ceil(posts.length / perPage));
  if (compiled.index) {
    for (let i = 1; i <= total; i++) {
      const slice = posts.slice((i - 1) * perPage, i * perPage);
      const url = i === 1 ? base + '/' : base + '/page/' + i + '/';
      const pager = {
        number: i, total, url,
        newer_url: i > 1 ? (i - 1 === 1 ? base + '/' : base + '/page/' + (i - 1) + '/') : '',
        older_url: i < total ? base + '/page/' + (i + 1) + '/' : '',
      };
      out[i === 1 ? 'index.html' : 'page/' + i + '/index.html'] = render(compiled.index,
        { site: siteScope, tags: tagsScope, recent: recentScope, posts: slice.map((p) => p.card), pager });
    }
  }
  if (compiled.tag) {
    for (const t of tags) {
      out['tags/' + t.slug + '/index.html'] = render(compiled.tag, {
        site: siteScope, tags: tagsScope, recent: recentScope,
        tag: { name: t.name, slug: t.slug, url: t.url, count: t.count, posts: t.posts.map((p) => p.card) },
      });
    }
  }
  if (compiled.tags) {
    out['tags/index.html'] = render(compiled.tags,
      { site: siteScope, tags: tagsScope, recent: recentScope });
  }

  let staticCount = 0;
  for (const f of statics) {
    if (out[f.path] !== undefined) { report.add('shadowed ' + f.path + ': a built page has its path'); continue; }
    out[f.path] = f.content;
    staticCount++;
  }

  for (const line of broken) report.add(line);
  const lines = [...report].sort();
  lines.push('built ' + (pages.length - posts.length) + ' pages, ' + posts.length +
    ' posts, ' + tags.length + ' tags and ' + staticCount + ' static files');
  out['build-report.txt'] = lines.map((l) => l + '\n').join('');
  return out;
}
