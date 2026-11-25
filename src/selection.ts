export interface TextPosition {
  line: number;
  ch: number;
}

export interface TextRange {
  from: number;
  to: number;
}

export interface SelectionRules {
  whitespace: boolean;
  punctuation: boolean;
  line: boolean;
  list: boolean;
  code: boolean;
  latex: boolean;
  heading: boolean;
}

export interface SelectionState {
  anchor: number;
  head: number;
}

const DEFAULT_RULES: SelectionRules = {
  whitespace: true,
  punctuation: true,
  line: true,
  list: true,
  code: true,
  latex: true,
  heading: true
};

const PUNCTUATION = /[\p{P}\p{S}]/u;
const WHITESPACE = /\s/u;
const WORD = /[\p{L}\p{M}\p{N}_]/u;
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;
const LIST_MARKER = /^(\s*)(?:(?:[-+*]|\d+[.)])\s+)/u;
const FENCE_OPEN_MARKER = /^\s{0,3}(`{3,}|~{3,})(.*)$/u;
const FENCE_CLOSE_MARKER = /^\s{0,3}(`{3,}|~{3,})\s*$/u;
const FRONTMATTER_OPEN = /^---\s*$/u;
const FRONTMATTER_CLOSE = /^(?:---|\.\.\.)\s*$/u;
const LATEX_BLOCK_START = /^\s*\\(?:begin\{([^}]+)\}|\[)/u;
const LATEX_BLOCK_END = /^\s*\\(?:end\{([^}]+)\}|\])/u;

interface WordSegment {
  segment: string;
  index: number;
  isWordLike?: boolean;
}

interface WordSegmenterLike {
  segment(input: string): Iterable<WordSegment>;
}

const wordSegmenter: WordSegmenterLike | null = (() => {
  const intlWithSegmenter = Intl as unknown as {
    Segmenter?: new (
      locales?: string | string[],
      options?: { granularity?: "grapheme" | "word" | "sentence" }
    ) => WordSegmenterLike;
  };
  return typeof intlWithSegmenter.Segmenter === "function"
    ? new intlWithSegmenter.Segmenter(undefined, { granularity: "word" })
    : null;
})();

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function isPunctuationOrSymbol(character: string): boolean {
  return PUNCTUATION.test(character);
}

function isWhitespace(character: string): boolean {
  return WHITESPACE.test(character);
}

function isInlineWhitespace(character: string): boolean {
  return character === " " || character === "\t";
}

function isWord(character: string): boolean {
  return WORD.test(character);
}

function isAllowedBoundaryCharacter(character: string, rules: SelectionRules): boolean {
  if (isPunctuationOrSymbol(character)) return rules.punctuation;
  if (isInlineWhitespace(character)) return rules.whitespace;
  return false;
}

function lineStart(text: string, offset: number): number {
  if (offset <= 0) return 0;
  const start = text.lastIndexOf("\n", offset - 1);
  return start === -1 ? 0 : start + 1;
}

function lineEnd(text: string, offset: number): number {
  const end = text.indexOf("\n", offset);
  return end === -1 ? text.length : end;
}

function lineNumberAt(text: string, offset: number): number {
  let line = 0;
  for (let index = 0; index < offset; index += 1) {
    if (text[index] === "\n") line += 1;
  }
  return line;
}

interface LineInfo {
  start: number;
  end: number;
  text: string;
}

function getLines(text: string): LineInfo[] {
  const lines: LineInfo[] = [];
  let start = 0;

  while (start <= text.length) {
    const end = text.indexOf("\n", start);
    const actualEnd = end === -1 ? text.length : end;
    lines.push({ start, end: actualEnd, text: text.slice(start, actualEnd) });
    if (end === -1) break;
    start = end + 1;
  }

  return lines;
}

function trimOuterWhitespace(text: string, range: TextRange): TextRange {
  let from = range.from;
  let to = range.to;
  while (from < to && isWhitespace(text[from] ?? "")) from += 1;
  while (to > from && isWhitespace(text[to - 1] ?? "")) to -= 1;
  return { from, to };
}

interface FenceContext {
  range: TextRange;
  contentRange: TextRange | null;
  startLine: number;
  endLine: number;
}

interface FrontmatterContext {
  range: TextRange;
  bodyRange: TextRange | null;
  endLine: number;
}

interface DocumentContext {
  text: string;
  lines: LineInfo[];
  fences: FenceContext[];
  frontmatter: FrontmatterContext | null;
}

function parseFrontmatter(lines: LineInfo[], textLength: number): FrontmatterContext | null {
  if (lines.length < 2 || !FRONTMATTER_OPEN.test(lines[0].text)) return null;
  for (let index = 1; index < lines.length; index += 1) {
    if (FRONTMATTER_CLOSE.test(lines[index].text)) {
      const range = { from: 0, to: lines[index].end };
      const bodyRange =
        index + 1 < lines.length
          ? { from: lines[index + 1].start, to: textLength }
          : null;
      return { range, bodyRange, endLine: index };
    }
  }
  return null;
}

function parseFenceContexts(lines: LineInfo[], textLength: number): FenceContext[] {
  const contexts: FenceContext[] = [];
  let openStart: number | null = null;
  let openLine = -1;
  let fenceCharacter = "";
  let fenceLength = 0;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (openStart === null) {
      const openMatch = line.text.match(FENCE_OPEN_MARKER);
      if (!openMatch) continue;
      const marker = openMatch[1];
      const infoString = openMatch[2] ?? "";
      if (marker[0] === "`" && infoString.includes("`")) continue;
      openStart = line.start;
      openLine = index;
      fenceCharacter = marker[0];
      fenceLength = marker.length;
      continue;
    }

    const closeMatch = line.text.match(FENCE_CLOSE_MARKER);
    if (!closeMatch) continue;
    const marker = closeMatch[1];
    if (marker[0] === fenceCharacter && marker.length >= fenceLength) {
      const contentRange =
        openLine + 1 <= index - 1
          ? { from: lines[openLine + 1].start, to: lines[index - 1].end }
          : null;
      contexts.push({
        range: { from: openStart, to: line.end },
        contentRange,
        startLine: openLine,
        endLine: index
      });
      openStart = null;
      openLine = -1;
      fenceCharacter = "";
      fenceLength = 0;
    }
  }

  if (openStart !== null) {
    const contentRange =
      openLine + 1 < lines.length
        ? { from: lines[openLine + 1].start, to: textLength }
        : null;
    contexts.push({
      range: { from: openStart, to: textLength },
      contentRange,
      startLine: openLine,
      endLine: Math.max(openLine, lines.length - 1)
    });
  }
  return contexts;
}

function createDocumentContext(text: string): DocumentContext {
  const lines = getLines(text);
  const fences = parseFenceContexts(lines, text.length);
  const frontmatter = parseFrontmatter(lines, text.length);
  return { text, lines, fences, frontmatter };
}

function isLineInsideFrontmatter(frontmatter: FrontmatterContext | null, lineIndex: number): boolean {
  return frontmatter !== null && lineIndex <= frontmatter.endLine;
}

function isLineInsideFence(fences: FenceContext[], lineIndex: number): boolean {
  return fences.some((fence) => lineIndex >= fence.startLine && lineIndex <= fence.endLine);
}

function rangeOverlapsFence(fences: FenceContext[], range: TextRange): boolean {
  return fences.some((fence) => range.from < fence.range.to && range.to > fence.range.from);
}

function parseLatexRanges(context: DocumentContext): TextRange[] {
  const { text, lines, fences } = context;
  const ranges: TextRange[] = [];
  const stack: Array<{ start: number; environment: string | null }> = [];

  for (let index = 0; index < lines.length; index += 1) {
    if (isLineInsideFence(fences, index)) continue;
    const line = lines[index];
    const startMatch = line.text.match(LATEX_BLOCK_START);
    if (startMatch) {
      stack.push({ start: line.start, environment: startMatch[1] ?? null });
      continue;
    }

    const endMatch = line.text.match(LATEX_BLOCK_END);
    if (endMatch && stack.length > 0) {
      const opening = stack.pop();
      if (opening && (!opening.environment || !endMatch[1] || opening.environment === endMatch[1])) {
        ranges.push({ from: opening.start, to: line.end });
      }
    }
  }

  while (stack.length > 0) {
    const opening = stack.pop();
    if (opening) ranges.push({ from: opening.start, to: text.length });
  }

  const inlinePattern =
    /\$\$[\s\S]*?\$\$|\\\([\s\S]*?\\\)|\\\[[\s\S]*?\\\]|(?<![\\$])\$(?!\$|\s)(?:[^$\n\\]|\\.)*?(?<!\s|\\)\$(?!\$|\d)/gu;
  for (const match of text.matchAll(inlinePattern)) {
    const from = match.index ?? 0;
    const candidate = { from, to: from + match[0].length };
    if (rangeOverlapsFence(fences, candidate)) continue;
    ranges.push(candidate);
  }

  return ranges.sort(
    (left, right) => left.to - left.from - (right.to - right.from) || right.from - left.from
  );
}

function findContainingLatexRanges(context: DocumentContext, range: TextRange): TextRange[] {
  return parseLatexRanges(context).filter((candidate) => rangeContains(candidate, range));
}

function findContainingFenceContext(context: DocumentContext, range: TextRange): FenceContext | null {
  return context.fences.find((fence) => rangeContains(fence.range, range)) ?? null;
}

function getListInfo(lineText: string): { indent: number; markerStart: number; contentStart: number } | null {
  const match = lineText.match(LIST_MARKER);
  if (!match) return null;
  return {
    indent: match[1].length,
    markerStart: match[1].length,
    contentStart: match[0].length
  };
}

function isBlankLine(text: string): boolean {
  return /^\s*$/u.test(text);
}

function listBlockForLine(lines: ReturnType<typeof getLines>, index: number, indent: number): TextRange | null {
  const current = getListInfo(lines[index]?.text ?? "");
  if (!current || current.indent !== indent) return null;

  let first = index;
  let last = index;
  while (first > 0) {
    const previous = getListInfo(lines[first - 1].text);
    if (!previous || previous.indent < indent || isBlankLine(lines[first - 1].text)) break;
    first -= 1;
  }
  while (last + 1 < lines.length) {
    const nextText = lines[last + 1].text;
    const next = getListInfo(nextText);
    if (isBlankLine(nextText) || !next || next.indent < indent) break;
    last += 1;
  }

  return { from: lines[first].start, to: lines[last].end };
}

function headingLevelAt(context: DocumentContext, index: number): number | null {
  if (index < 0 || index >= context.lines.length) return null;
  if (isLineInsideFence(context.fences, index)) return null;
  if (isLineInsideFrontmatter(context.frontmatter, index)) return null;
  const match = context.lines[index].text.match(/^\s{0,3}(#{1,6})(?:\s+|$)/u);
  return match ? match[1].length : null;
}

function headingSectionForLine(context: DocumentContext, index: number): TextRange | null {
  const level = headingLevelAt(context, index);
  if (level === null) return null;

  let nextHeading = index + 1;
  while (nextHeading < context.lines.length) {
    const nextLevel = headingLevelAt(context, nextHeading);
    if (nextLevel !== null && nextLevel <= level) break;
    nextHeading += 1;
  }
  const last = nextHeading < context.lines.length ? nextHeading - 1 : context.lines.length - 1;
  return { from: context.lines[index].start, to: context.lines[last].end };
}

function headingHierarchyRanges(context: DocumentContext, index: number): TextRange[] {
  let headingIndex = index;
  let level = headingLevelAt(context, headingIndex);

  if (level === null) {
    for (let lineIndex = index - 1; lineIndex >= 0; lineIndex -= 1) {
      const candidateLevel = headingLevelAt(context, lineIndex);
      if (candidateLevel !== null) {
        headingIndex = lineIndex;
        level = candidateLevel;
        break;
      }
    }
  }

  if (level === null) return [];
  const ranges: TextRange[] = [];
  const currentSection = headingSectionForLine(context, headingIndex);
  if (currentSection) ranges.push(currentSection);

  let childIndex = headingIndex;
  let childLevel = level;
  while (childIndex > 0) {
    let parentIndex = childIndex - 1;
    let parentLevel: number | null = null;
    while (parentIndex >= 0) {
      const candidateLevel = headingLevelAt(context, parentIndex);
      if (candidateLevel !== null && candidateLevel < childLevel) {
        parentLevel = candidateLevel;
        break;
      }
      parentIndex -= 1;
    }
    if (parentIndex < 0 || parentLevel === null) break;
    const parentSection = headingSectionForLine(context, parentIndex);
    if (parentSection) ranges.push(parentSection);
    childIndex = parentIndex;
    childLevel = parentLevel;
  }
  return ranges;
}

function expandWord(text: string, offset: number): TextRange | null {
  if (offset >= text.length) offset = text.length - 1;
  if (offset < 0) return null;

  if (!isWord(text[offset]) && offset > 0 && isWord(text[offset - 1])) offset -= 1;

  let from = offset;
  let to = offset;
  const current = text[offset];
  if (!current) return null;

  if (isWord(current)) {
    while (from > 0 && isWord(text[from - 1])) from -= 1;
    while (to < text.length && isWord(text[to])) to += 1;

    const run = text.slice(from, to);
    if (wordSegmenter && CJK.test(run)) {
      const relativeOffset = offset - from;
      for (const segment of wordSegmenter.segment(run)) {
        const segStart = segment.index;
        const segEnd = segStart + segment.segment.length;
        if (relativeOffset >= segStart && relativeOffset < segEnd) {
          if (segEnd - segStart < run.length) {
            return { from: from + segStart, to: from + segEnd };
          }
          break;
        }
      }
    }

    return { from, to };
  }

  return { from, to: offset + 1 };
}

function expandWordRun(text: string, range: TextRange): TextRange | null {
  const candidate = normalizeRange(range, text.length);
  if (candidate.from >= candidate.to) return null;
  for (let index = candidate.from; index < candidate.to; index += 1) {
    if (!isWord(text[index])) return null;
  }
  let from = candidate.from;
  let to = candidate.to;
  while (from > 0 && isWord(text[from - 1])) from -= 1;
  while (to < text.length && isWord(text[to])) to += 1;
  return from === candidate.from && to === candidate.to ? null : { from, to };
}

function expandBoundaryRun(text: string, range: TextRange, rules: SelectionRules): TextRange | null {
  const candidate = normalizeRange(range, text.length);
  if (candidate.from >= candidate.to) return null;

  for (let index = candidate.from; index < candidate.to; index += 1) {
    if (!isAllowedBoundaryCharacter(text[index], rules)) return null;
  }

  let from = candidate.from;
  let to = candidate.to;
  while (from > 0 && isAllowedBoundaryCharacter(text[from - 1], rules)) from -= 1;
  while (to < text.length && isAllowedBoundaryCharacter(text[to], rules)) to += 1;
  return from === candidate.from && to === candidate.to ? null : { from, to };
}

function expandAdjacentBoundaries(text: string, range: TextRange, rules: SelectionRules): TextRange | null {
  const candidate = normalizeRange(range, text.length);
  if (candidate.from >= candidate.to) return null;

  let from = candidate.from;
  let to = candidate.to;
  while (from > 0 && isAllowedBoundaryCharacter(text[from - 1], rules)) from -= 1;
  while (to < text.length && isAllowedBoundaryCharacter(text[to], rules)) to += 1;
  return from === candidate.from && to === candidate.to ? null : { from, to };
}

function expandToken(text: string, range: TextRange, rules: SelectionRules): TextRange | null {
  const candidate = trimOuterWhitespace(text, range);
  if (candidate.from >= candidate.to) return null;
  let from = candidate.from;
  let to = candidate.to;
  while (from > 0 && !isWhitespace(text[from - 1]) && (rules.punctuation || !isPunctuationOrSymbol(text[from - 1]))) from -= 1;
  while (to < text.length && !isWhitespace(text[to]) && (rules.punctuation || !isPunctuationOrSymbol(text[to]))) to += 1;
  return { from, to };
}

function isParagraphBoundaryLine(context: DocumentContext, lineIndex: number): boolean {
  if (lineIndex < 0 || lineIndex >= context.lines.length) return true;
  return (
    isBlankLine(context.lines[lineIndex].text) ||
    isLineInsideFence(context.fences, lineIndex) ||
    isLineInsideFrontmatter(context.frontmatter, lineIndex) ||
    headingLevelAt(context, lineIndex) !== null
  );
}

function expandParagraph(context: DocumentContext, range: TextRange): TextRange | null {
  const { text, lines } = context;
  const startLine = lineNumberAt(text, range.from);
  const endOffset = range.to > range.from ? range.to - 1 : range.from;
  const endLine = lineNumberAt(text, endOffset);
  let first = startLine;
  let last = endLine;

  while (first > 0 && !isParagraphBoundaryLine(context, first - 1)) first -= 1;
  while (last + 1 < lines.length && !isParagraphBoundaryLine(context, last + 1)) last += 1;
  return { from: lines[first].start, to: lines[last].end };
}

function expandDocument(text: string): TextRange {
  return { from: 0, to: text.length };
}

function rangeContains(outer: TextRange, inner: TextRange): boolean {
  return outer.from <= inner.from && outer.to >= inner.to;
}

function getListExpansionRanges(context: DocumentContext, range: TextRange): TextRange[] {
  const { text, lines } = context;
  const lineIndex = lineNumberAt(text, clamp(range.from, 0, text.length));
  const currentLine = lines[lineIndex];
  const current = getListInfo(currentLine?.text ?? "");
  if (!current || !currentLine) return [];

  const ranges: TextRange[] = [];
  const contentStart = currentLine.start + current.contentStart;
  if (contentStart < currentLine.end) {
    ranges.push({ from: contentStart, to: currentLine.end });
  }
  const itemStart = currentLine.start + current.indent;
  ranges.push({ from: itemStart, to: currentLine.end });

  let indent = current.indent;
  let itemIndex = lineIndex;
  while (true) {
    const block = listBlockForLine(lines, itemIndex, indent);
    if (block) ranges.push(block);

    let parentIndex = itemIndex - 1;
    let parentIndent: number | null = null;
    while (parentIndex >= 0) {
      const parent = getListInfo(lines[parentIndex].text);
      if (parent && parent.indent < indent) {
        parentIndent = parent.indent;
        break;
      }
      if (isBlankLine(lines[parentIndex].text)) break;
      parentIndex -= 1;
    }
    if (parentIndex < 0 || parentIndent === null) break;
    itemIndex = parentIndex;
    indent = parentIndent;
  }

  return ranges;
}

function getCodeLineRange(text: string, range: TextRange): TextRange | null {
  const start = lineStart(text, range.from);
  const endCursor = range.to > range.from && text[range.to - 1] === "\n" ? range.to - 1 : range.to;
  const end = lineEnd(text, Math.max(range.from, endCursor));
  return { from: start, to: end };
}

function isEscaped(text: string, index: number): boolean {
  let backslashes = 0;
  for (let cursor = index - 1; cursor >= 0 && text[cursor] === "\\"; cursor -= 1) {
    backslashes += 1;
  }
  return backslashes % 2 === 1;
}

function pushPairWithInner(
  ranges: TextRange[],
  openStart: number,
  openEnd: number,
  closeStart: number,
  closeEnd: number,
  target: TextRange
): void {
  if (openEnd < closeStart) {
    const inner = { from: openEnd, to: closeStart };
    if (rangeContains(inner, target)) ranges.push(inner);
  }
  const outer = { from: openStart, to: closeEnd };
  if (rangeContains(outer, target)) ranges.push(outer);
}

function sortRangesInnermostFirst(ranges: TextRange[]): TextRange[] {
  return ranges.sort(
    (left, right) => left.to - left.from - (right.to - right.from) || right.from - left.from
  );
}

const ASYMMETRIC_OPENERS = new Set(["(", "[", "{", "（", "【", "「", "『", "《", "“", "‘"]);
const ASYMMETRIC_CLOSING_TO_OPENING: Record<string, string> = {
  ")": "(",
  "]": "[",
  "}": "{",
  "）": "（",
  "】": "【",
  "」": "「",
  "』": "『",
  "》": "《",
  "”": "“",
  "’": "‘"
};

function addAsymmetricPairRanges(text: string, scope: TextRange, range: TextRange): TextRange[] {
  const ranges: TextRange[] = [];
  const stack: Array<{ opening: string; index: number }> = [];

  for (let index = scope.from; index < scope.to; index += 1) {
    if (isEscaped(text, index)) continue;
    const character = text[index];
    if (ASYMMETRIC_OPENERS.has(character)) {
      stack.push({ opening: character, index });
      continue;
    }
    const opening = ASYMMETRIC_CLOSING_TO_OPENING[character];
    if (!opening) continue;
    for (let stackIndex = stack.length - 1; stackIndex >= 0; stackIndex -= 1) {
      if (stack[stackIndex].opening !== opening) continue;
      const openIndex = stack[stackIndex].index;
      stack.splice(stackIndex, 1);

      // Skip the half-bracket pair inside Obsidian wikilinks like [[Note|Alias]]
      const isInnerOfWikilink =
        opening === "[" &&
        openIndex > scope.from &&
        index + 1 < scope.to &&
        text[openIndex - 1] === "[" &&
        text[index + 1] === "]";
      if (isInnerOfWikilink) {
        if (openIndex + 1 < index) {
          const inner = { from: openIndex + 1, to: index };
          if (rangeContains(inner, range)) ranges.push(inner);
        }
        break;
      }

      const isOuterOfWikilink =
        opening === "[" &&
        openIndex + 1 < index &&
        text[openIndex + 1] === "[" &&
        text[index - 1] === "]";
      if (isOuterOfWikilink) {
        pushPairWithInner(ranges, openIndex, openIndex + 2, index - 1, index + 1, range);
        break;
      }

      pushPairWithInner(ranges, openIndex, openIndex + 1, index, index + 1, range);
      break;
    }
  }

  return ranges;
}

function addInlineMarkdownDelimiterRanges(text: string, scope: TextRange, range: TextRange): TextRange[] {
  const ranges: TextRange[] = [];
  const scopeText = text.slice(scope.from, scope.to);
  const lines = getLines(scopeText);

  for (const line of lines) {
    const lineAbsStart = scope.from + line.start;
    const lineAbsEnd = scope.from + line.end;
    if (range.to < lineAbsStart || range.from > lineAbsEnd) continue;

    // Skip leading list marker so "* item" does not act as an italic delimiter
    const listInfo = getListInfo(line.text);
    const contentOffset = listInfo ? listInfo.contentStart : 0;
    const startIdx = lineAbsStart + contentOffset;

    // Inline code spans (`...`, ``...``)
    let index = startIdx;
    while (index < lineAbsEnd) {
      if (text[index] === "`" && !isEscaped(text, index)) {
        let ticks = 1;
        while (index + ticks < lineAbsEnd && text[index + ticks] === "`") ticks += 1;
        const marker = "`".repeat(ticks);
        let search = index + ticks;
        let close = -1;
        while (search <= lineAbsEnd - ticks) {
          if (text.startsWith(marker, search) && !isEscaped(text, search)) {
            const beforeOk = search === 0 || text[search - 1] !== "`";
            const afterOk = search + ticks >= lineAbsEnd || text[search + ticks] !== "`";
            if (beforeOk && afterOk) {
              close = search;
              break;
            }
          }
          search += 1;
        }
        if (close !== -1) {
          pushPairWithInner(ranges, index, index + ticks, close, close + ticks, range);
          index = close + ticks;
          continue;
        }
        index += ticks;
        continue;
      }
      index += 1;
    }

    // Emphasis / highlight / strikethrough delimiters (longest first)
    const delimiters = ["***", "___", "**", "__", "~~", "==", "*", "_", "~"];
    for (const delimiter of delimiters) {
      const len = delimiter.length;
      const ch = delimiter[0];
      let open = -1;
      for (let pos = startIdx; pos <= lineAbsEnd - len; pos += 1) {
        if (!text.startsWith(delimiter, pos) || isEscaped(text, pos)) continue;
        // Require exact run length so "**" is not also matched as two "*"
        if (pos > startIdx && text[pos - 1] === ch) continue;
        if (pos + len < lineAbsEnd && text[pos + len] === ch) continue;
        // Avoid matching intra-word underscores like foo_bar_baz
        if (
          ch === "_" &&
          pos > startIdx &&
          pos + len < lineAbsEnd &&
          isWord(text[pos - 1]) &&
          isWord(text[pos + len])
        ) {
          continue;
        }

        if (open === -1) {
          const nextChar = text[pos + len];
          if (nextChar && !isWhitespace(nextChar)) {
            open = pos;
            pos += len - 1;
          }
        } else {
          const prevChar = text[pos - 1];
          if (prevChar && !isWhitespace(prevChar)) {
            pushPairWithInner(ranges, open, open + len, pos, pos + len, range);
            open = -1;
            pos += len - 1;
          }
        }
      }
    }

    // Straight quotes on the same line, ignoring apostrophes like don't
    for (const quote of ["\"", "'"]) {
      let open = -1;
      for (let pos = startIdx; pos < lineAbsEnd; pos += 1) {
        if (text[pos] !== quote || isEscaped(text, pos)) continue;
        if (
          quote === "'" &&
          pos > startIdx &&
          pos + 1 < lineAbsEnd &&
          isWord(text[pos - 1]) &&
          isWord(text[pos + 1])
        ) {
          continue;
        }
        if (open === -1) {
          open = pos;
        } else {
          pushPairWithInner(ranges, open, open + 1, pos, pos + 1, range);
          open = -1;
        }
      }
    }
  }

  return ranges;
}

function addSurroundingPairRanges(
  text: string,
  range: TextRange,
  includeMarkdownDelimiters = true,
  scope: TextRange = { from: 0, to: text.length }
): TextRange[] {
  const ranges = addAsymmetricPairRanges(text, scope, range);
  if (includeMarkdownDelimiters) {
    ranges.push(...addInlineMarkdownDelimiterRanges(text, scope, range));
  }
  return sortRangesInnermostFirst(ranges);
}

function addCodePairRanges(
  text: string,
  range: TextRange,
  scope: TextRange = { from: 0, to: text.length }
): TextRange[] {
  const ranges: TextRange[] = [];
  const bracketStack: Array<{ opening: string; index: number }> = [];
  const codeClosingToOpening: Record<string, string> = { ")": "(", "]": "[", "}": "{" };
  let activeQuote: string | null = null;
  let quoteStart = -1;

  for (let index = scope.from; index < scope.to; index += 1) {
    const character = text[index];

    if (activeQuote !== null) {
      if (character === "\n" && activeQuote !== "`") {
        activeQuote = null;
        quoteStart = -1;
        continue;
      }
      if (character === activeQuote && !isEscaped(text, index)) {
        pushPairWithInner(ranges, quoteStart, quoteStart + 1, index, index + 1, range);
        activeQuote = null;
        quoteStart = -1;
      }
      continue;
    }

    if (isEscaped(text, index)) continue;

    if (character === "`" && text[index + 1] === "`" && text[index + 2] === "`") {
      while (index + 1 < scope.to && text[index + 1] === "`") index += 1;
      continue;
    }

    if (character === "\"" || character === "'" || character === "`") {
      activeQuote = character;
      quoteStart = index;
      continue;
    }

    if (character === "(" || character === "[" || character === "{") {
      bracketStack.push({ opening: character, index });
      continue;
    }

    const opening = codeClosingToOpening[character];
    if (!opening) continue;
    for (let stackIndex = bracketStack.length - 1; stackIndex >= 0; stackIndex -= 1) {
      if (bracketStack[stackIndex].opening !== opening) continue;
      const openIndex = bracketStack[stackIndex].index;
      pushPairWithInner(ranges, openIndex, openIndex + 1, index, index + 1, range);
      bracketStack.splice(stackIndex, 1);
      break;
    }
  }

  return sortRangesInnermostFirst(ranges);
}

function normalizeRange(range: TextRange, textLength: number): TextRange {
  return {
    from: clamp(Math.min(range.from, range.to), 0, textLength),
    to: clamp(Math.max(range.from, range.to), 0, textLength)
  };
}

export function getSelectionRange(selection: SelectionState): TextRange {
  return {
    from: Math.min(selection.anchor, selection.head),
    to: Math.max(selection.anchor, selection.head)
  };
}

export function expandSelection(
  text: string,
  selection: SelectionState,
  inputRules: Partial<SelectionRules> = DEFAULT_RULES
): TextRange {
  const rules = { ...DEFAULT_RULES, ...inputRules };
  const current = normalizeRange(getSelectionRange(selection), text.length);
  const context = createDocumentContext(text);
  const candidates: Array<TextRange | null> = [];
  const cursor = current.from;
  const fenceContext = rules.code ? findContainingFenceContext(context, current) : null;
  const latexRanges = rules.latex ? findContainingLatexRanges(context, current) : [];
  const lineIndex = lineNumberAt(text, clamp(current.from, 0, text.length));
  const currentLine = context.lines[lineIndex];
  const listInfo = rules.list && !fenceContext ? getListInfo(currentLine?.text ?? "") : null;
  const isOnHeadingLine = rules.heading && headingLevelAt(context, lineIndex) !== null;
  const headingRanges = rules.heading ? headingHierarchyRanges(context, lineIndex) : [];

  if (current.from === current.to) candidates.push(expandWord(text, cursor));

  if (fenceContext) {
    const codeScope = fenceContext.contentRange ?? fenceContext.range;
    const codePairs = addCodePairRanges(text, current, codeScope);
    const codeLine = getCodeLineRange(text, current);
    const inlinePairs = codeLine
      ? codePairs.filter((pair) => rangeContains(codeLine, pair))
      : codePairs;
    const multilinePairs = codeLine
      ? codePairs.filter((pair) => !rangeContains(codeLine, pair))
      : [];
    candidates.push(...inlinePairs);
    candidates.push(codeLine);
    candidates.push(...multilinePairs);
    if (fenceContext.contentRange) candidates.push(fenceContext.contentRange);
    candidates.push(fenceContext.range);
  } else if (latexRanges.length > 0) {
    const latexScope = latexRanges[latexRanges.length - 1];
    candidates.push(...addSurroundingPairRanges(text, current, false, latexScope));
    candidates.push(...latexRanges);
    if (listInfo) {
      candidates.push(...getListExpansionRanges(context, current));
    } else if (rules.line) {
      candidates.push(getCodeLineRange(text, current));
      candidates.push(expandParagraph(context, current));
    }
  } else if (listInfo && currentLine) {
    if (current.from !== current.to) {
      const itemContentScope = {
        from: currentLine.start + listInfo.contentStart,
        to: currentLine.end
      };
      if (rangeContains(itemContentScope, current)) {
        candidates.push(...addSurroundingPairRanges(text, current, true, itemContentScope));
        candidates.push(expandWordRun(text, current));
      }
    }
    candidates.push(...getListExpansionRanges(context, current));
  } else if (isOnHeadingLine && currentLine) {
    if (current.from !== current.to) {
      const headingLineScope = { from: currentLine.start, to: currentLine.end };
      candidates.push(...addSurroundingPairRanges(text, current, true, headingLineScope));
      candidates.push(expandWordRun(text, current));
    }
    candidates.push({ from: currentLine.start, to: currentLine.end });
  } else {
    if (current.from !== current.to) {
      const paragraphScope = expandParagraph(context, current) ?? { from: 0, to: text.length };
      candidates.push(...addSurroundingPairRanges(text, current, true, paragraphScope));
      candidates.push(expandAdjacentBoundaries(text, current, rules));
      candidates.push(expandBoundaryRun(text, current, rules));
      candidates.push(expandWordRun(text, current));
      candidates.push(expandToken(text, current, rules));
    }
    if (rules.line) {
      candidates.push(getCodeLineRange(text, current));
      candidates.push(expandParagraph(context, current));
    }
  }

  if (headingRanges.length > 0) {
    candidates.push(...headingRanges);
  }

  if (context.frontmatter) {
    if (rangeContains(context.frontmatter.range, current)) {
      candidates.push(context.frontmatter.range);
    } else if (context.frontmatter.bodyRange && rangeContains(context.frontmatter.bodyRange, current)) {
      candidates.push(context.frontmatter.bodyRange);
    }
  }

  candidates.push(expandDocument(text));

  const seen = new Set<string>();
  for (const candidate of candidates) {
    if (!candidate) continue;
    const normalized = normalizeRange(candidate, text.length);
    const key = `${normalized.from}:${normalized.to}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (rangeContains(normalized, current) && (normalized.from !== current.from || normalized.to !== current.to)) {
      return normalized;
    }
  }
  return current;
}

export function shrinkSelection(history: SelectionState[], current: SelectionState): SelectionState {
  const currentRange = getSelectionRange(current);
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const candidate = history[index];
    const candidateRange = getSelectionRange(candidate);
    if (candidateRange.from !== currentRange.from || candidateRange.to !== currentRange.to) {
      return candidate;
    }
  }
  return { anchor: current.head, head: current.head };
}

export function positionToOffset(text: string, position: TextPosition): number {
  const lines = getLines(text);
  const line = clamp(position.line, 0, Math.max(0, lines.length - 1));
  const target = lines[line];
  return target.start + clamp(position.ch, 0, target.end - target.start);
}

export function offsetToPosition(text: string, offset: number): TextPosition {
  const safeOffset = clamp(offset, 0, text.length);
  const lines = getLines(text);
  const line = lineNumberAt(text, safeOffset);
  return { line, ch: safeOffset - lines[line].start };
}

export function getDefaultSelectionRules(): SelectionRules {
  return { ...DEFAULT_RULES };
}

export function getDocumentBodyRange(text: string): TextRange | null {
  const lines = getLines(text);
  return parseFrontmatter(lines, text.length)?.bodyRange ?? null;
}
