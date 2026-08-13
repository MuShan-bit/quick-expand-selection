'use strict';

var obsidian = require('obsidian');

const DEFAULT_RULES = {
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
const LIST_MARKER = /^(\s*)(?:(?:[-+*]|\d+[.)])\s+)/u;
const FENCE_MARKER = /^\s{0,3}(`{3,}|~{3,})/u;
const LATEX_BLOCK_START = /^\s*\\(?:begin\{([^}]+)\}|\[)/u;
const LATEX_BLOCK_END = /^\s*\\(?:end\{([^}]+)\}|\])/u;
function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
}
function isPunctuationOrSymbol(character) {
    return PUNCTUATION.test(character);
}
function isWhitespace(character) {
    return WHITESPACE.test(character);
}
function isInlineWhitespace(character) {
    return character === " " || character === "\t";
}
function isWord(character) {
    return WORD.test(character);
}
function isAllowedBoundaryCharacter(character, rules) {
    if (isPunctuationOrSymbol(character))
        return rules.punctuation;
    if (isInlineWhitespace(character))
        return rules.whitespace;
    return false;
}
function lineStart(text, offset) {
    const start = text.lastIndexOf("\n", Math.max(0, offset - 1));
    return start === -1 ? 0 : start + 1;
}
function lineEnd(text, offset) {
    const end = text.indexOf("\n", offset);
    return end === -1 ? text.length : end;
}
function lineNumberAt(text, offset) {
    let line = 0;
    for (let index = 0; index < offset; index += 1) {
        if (text[index] === "\n")
            line += 1;
    }
    return line;
}
function getLines(text) {
    const lines = [];
    let start = 0;
    while (start <= text.length) {
        const end = text.indexOf("\n", start);
        const actualEnd = end === -1 ? text.length : end;
        lines.push({ start, end: actualEnd, text: text.slice(start, actualEnd) });
        if (end === -1)
            break;
        start = end + 1;
    }
    return lines;
}
function trimOuterWhitespace(text, range) {
    let from = range.from;
    let to = range.to;
    while (from < to && isWhitespace(text[from] ?? ""))
        from += 1;
    while (to > from && isWhitespace(text[to - 1] ?? ""))
        to -= 1;
    return { from, to };
}
function parseFenceContexts(text) {
    const contexts = [];
    let openStart = null;
    let fenceCharacter = "";
    let fenceLength = 0;
    for (const line of getLines(text)) {
        const match = line.text.match(FENCE_MARKER);
        if (!match)
            continue;
        const marker = match[1];
        if (openStart === null) {
            openStart = line.start;
            fenceCharacter = marker[0];
            fenceLength = marker.length;
            continue;
        }
        if (marker[0] === fenceCharacter && marker.length >= fenceLength) {
            contexts.push({
                range: { from: openStart, to: line.end }
            });
            openStart = null;
            fenceCharacter = "";
            fenceLength = 0;
        }
    }
    if (openStart !== null) {
        contexts.push({
            range: { from: openStart, to: text.length }
        });
    }
    return contexts;
}
function parseLatexRanges(text) {
    const ranges = [];
    const lines = getLines(text);
    const stack = [];
    for (const line of lines) {
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
        if (opening)
            ranges.push({ from: opening.start, to: text.length });
    }
    const inlinePattern = /\$\$[\s\S]*?\$\$|\\\([\s\S]*?\\\)|\\\[[\s\S]*?\\\]|(?<!\$)\$(?!\$)[^\n$]+(?<!\$)\$(?!\$)/gu;
    for (const match of text.matchAll(inlinePattern)) {
        const from = match.index ?? 0;
        ranges.push({ from, to: from + match[0].length });
    }
    return ranges.sort((left, right) => left.from - right.from || left.to - right.to);
}
function findContainingLatexRange(text, range) {
    return parseLatexRanges(text).find((candidate) => rangeContains(candidate, range)) ?? null;
}
function findContainingFenceContext(text, range) {
    return parseFenceContexts(text).find((context) => rangeContains(context.range, range)) ?? null;
}
function getListInfo(lineText) {
    const match = lineText.match(LIST_MARKER);
    if (!match)
        return null;
    return {
        indent: match[1].length,
        markerStart: match[1].length,
        contentStart: match[0].length
    };
}
function isBlankLine(text) {
    return /^\s*$/u.test(text);
}
function listBlockForLine(lines, index, indent) {
    const current = getListInfo(lines[index]?.text ?? "");
    if (!current || current.indent !== indent)
        return null;
    let first = index;
    let last = index;
    while (first > 0) {
        const previous = getListInfo(lines[first - 1].text);
        if (!previous || previous.indent < indent || isBlankLine(lines[first - 1].text))
            break;
        first -= 1;
    }
    while (last + 1 < lines.length) {
        const nextText = lines[last + 1].text;
        const next = getListInfo(nextText);
        if (isBlankLine(nextText) || !next || next.indent < indent)
            break;
        last += 1;
    }
    return { from: lines[first].start, to: lines[last].end };
}
function headingLevel(lineText) {
    const match = lineText.match(/^\s{0,3}(#{1,6})(?:\s+|$)/u);
    return match ? match[1].length : null;
}
function headingSectionForLine(lines, index) {
    const level = headingLevel(lines[index]?.text ?? "");
    if (level === null)
        return null;
    let nextHeading = index + 1;
    while (nextHeading < lines.length) {
        const nextLevel = headingLevel(lines[nextHeading].text);
        if (nextLevel !== null && nextLevel <= level)
            break;
        nextHeading += 1;
    }
    const last = nextHeading < lines.length ? nextHeading - 1 : lines.length - 1;
    return { from: lines[index].start, to: lines[last].end };
}
function headingHierarchyRanges(lines, index) {
    let headingIndex = index;
    let level = headingLevel(lines[headingIndex]?.text ?? "");
    if (level === null) {
        for (let lineIndex = index - 1; lineIndex >= 0; lineIndex -= 1) {
            const candidateLevel = headingLevel(lines[lineIndex].text);
            if (candidateLevel !== null) {
                headingIndex = lineIndex;
                level = candidateLevel;
                break;
            }
        }
    }
    if (level === null)
        return [];
    const ranges = [];
    const currentSection = headingSectionForLine(lines, headingIndex);
    if (currentSection)
        ranges.push(currentSection);
    let childIndex = headingIndex;
    let childLevel = level;
    while (childIndex > 0) {
        let parentIndex = childIndex - 1;
        let parentLevel = null;
        while (parentIndex >= 0) {
            const candidateLevel = headingLevel(lines[parentIndex].text);
            if (candidateLevel !== null && candidateLevel < childLevel) {
                parentLevel = candidateLevel;
                break;
            }
            parentIndex -= 1;
        }
        if (parentIndex < 0 || parentLevel === null)
            break;
        const parentSection = headingSectionForLine(lines, parentIndex);
        if (parentSection)
            ranges.push(parentSection);
        childIndex = parentIndex;
        childLevel = parentLevel;
    }
    return ranges;
}
function expandWord(text, offset) {
    if (offset >= text.length)
        offset = text.length - 1;
    if (offset < 0)
        return null;
    if (!isWord(text[offset]) && offset > 0 && isWord(text[offset - 1]))
        offset -= 1;
    let from = offset;
    let to = offset;
    const current = text[offset];
    if (!current)
        return null;
    if (isWord(current)) {
        while (from > 0 && isWord(text[from - 1]))
            from -= 1;
        while (to < text.length && isWord(text[to]))
            to += 1;
        return { from, to };
    }
    return { from, to: offset + 1 };
}
function expandBoundaryRun(text, range, rules) {
    const candidate = normalizeRange(range, text.length);
    if (candidate.from >= candidate.to)
        return null;
    for (let index = candidate.from; index < candidate.to; index += 1) {
        if (!isAllowedBoundaryCharacter(text[index], rules))
            return null;
    }
    let from = candidate.from;
    let to = candidate.to;
    while (from > 0 && isAllowedBoundaryCharacter(text[from - 1], rules))
        from -= 1;
    while (to < text.length && isAllowedBoundaryCharacter(text[to], rules))
        to += 1;
    return from === candidate.from && to === candidate.to ? null : { from, to };
}
function expandAdjacentBoundaries(text, range, rules) {
    const candidate = normalizeRange(range, text.length);
    if (candidate.from >= candidate.to)
        return null;
    let from = candidate.from;
    let to = candidate.to;
    while (from > 0 && isAllowedBoundaryCharacter(text[from - 1], rules))
        from -= 1;
    while (to < text.length && isAllowedBoundaryCharacter(text[to], rules))
        to += 1;
    return from === candidate.from && to === candidate.to ? null : { from, to };
}
function expandToken(text, range, rules) {
    const candidate = trimOuterWhitespace(text, range);
    if (candidate.from >= candidate.to)
        return null;
    let from = candidate.from;
    let to = candidate.to;
    while (from > 0 && !isWhitespace(text[from - 1]) && (rules.punctuation || !isPunctuationOrSymbol(text[from - 1])))
        from -= 1;
    while (to < text.length && !isWhitespace(text[to]) && (rules.punctuation || !isPunctuationOrSymbol(text[to])))
        to += 1;
    return { from, to };
}
function expandParagraph(text, range) {
    const startLine = lineNumberAt(text, range.from);
    const endOffset = Math.max(range.from, range.to - 1);
    const endLine = lineNumberAt(text, endOffset);
    const lines = getLines(text);
    let first = startLine;
    let last = endLine;
    while (first > 0 && !isBlankLine(lines[first - 1].text))
        first -= 1;
    while (last + 1 < lines.length && !isBlankLine(lines[last + 1].text))
        last += 1;
    return { from: lines[first].start, to: lines[last].end };
}
function expandDocument(text) {
    return { from: 0, to: text.length };
}
function rangeContains(outer, inner) {
    return outer.from <= inner.from && outer.to >= inner.to;
}
function getListExpansionRanges(text, range) {
    const lines = getLines(text);
    const lineIndex = lineNumberAt(text, clamp(range.from, 0, text.length));
    const currentLine = lines[lineIndex];
    const current = getListInfo(currentLine?.text ?? "");
    if (!current || !currentLine)
        return [];
    const ranges = [];
    const itemStart = currentLine.start + current.indent;
    ranges.push({ from: itemStart, to: currentLine.end });
    let indent = current.indent;
    let itemIndex = lineIndex;
    while (true) {
        const block = listBlockForLine(lines, itemIndex, indent);
        if (block)
            ranges.push(block);
        let parentIndex = itemIndex - 1;
        let parentIndent = null;
        while (parentIndex >= 0) {
            const parent = getListInfo(lines[parentIndex].text);
            if (parent && parent.indent < indent) {
                parentIndent = parent.indent;
                break;
            }
            if (isBlankLine(lines[parentIndex].text))
                break;
            parentIndex -= 1;
        }
        if (parentIndex < 0 || parentIndent === null)
            break;
        itemIndex = parentIndex;
        indent = parentIndent;
    }
    return ranges;
}
function getCodeLineRange(text, range) {
    const start = lineStart(text, range.from);
    const end = lineEnd(text, Math.max(range.from, range.to));
    return { from: start, to: end };
}
function addSurroundingPairRanges(text, range, includeMarkdownDelimiters = true) {
    const ranges = [];
    const stack = [];
    const closingToOpening = { ")": "(", "]": "[", "}": "{" };
    for (let index = 0; index < text.length; index += 1) {
        if (text[index - 1] === "\\")
            continue;
        const character = text[index];
        if (character === "(" || character === "[" || character === "{") {
            stack.push({ opening: character, index });
            continue;
        }
        const opening = closingToOpening[character];
        if (!opening)
            continue;
        for (let stackIndex = stack.length - 1; stackIndex >= 0; stackIndex -= 1) {
            if (stack[stackIndex].opening !== opening)
                continue;
            const pair = { from: stack[stackIndex].index, to: index + 1 };
            if (rangeContains(pair, range))
                ranges.push(pair);
            stack.splice(stackIndex, 1);
            break;
        }
    }
    if (!includeMarkdownDelimiters)
        return ranges;
    for (const delimiter of ["`", "*", "_", "~"]) {
        let opening = -1;
        for (let index = 0; index < text.length; index += 1) {
            if (text[index] !== delimiter || text[index - 1] === "\\")
                continue;
            if (opening === -1) {
                opening = index;
            }
            else {
                const pair = { from: opening, to: index + 1 };
                if (rangeContains(pair, range))
                    ranges.push(pair);
                opening = -1;
            }
        }
    }
    return ranges;
}
function addQuotedRanges(text, range) {
    const ranges = [];
    for (const quote of ["\"", "'"]) {
        let opening = -1;
        for (let index = 0; index < text.length; index += 1) {
            if (text[index] !== quote || text[index - 1] === "\\")
                continue;
            if (opening === -1) {
                opening = index;
                continue;
            }
            const candidate = { from: opening, to: index + 1 };
            if (rangeContains(candidate, range))
                ranges.push(candidate);
            opening = -1;
        }
    }
    return ranges;
}
function addCodePairRanges(text, range) {
    return [...addSurroundingPairRanges(text, range, false), ...addQuotedRanges(text, range)];
}
function normalizeRange(range, textLength) {
    return {
        from: clamp(Math.min(range.from, range.to), 0, textLength),
        to: clamp(Math.max(range.from, range.to), 0, textLength)
    };
}
function getSelectionRange(selection) {
    return {
        from: Math.min(selection.anchor, selection.head),
        to: Math.max(selection.anchor, selection.head)
    };
}
function expandSelection(text, selection, inputRules = DEFAULT_RULES) {
    const rules = { ...DEFAULT_RULES, ...inputRules };
    const current = normalizeRange(getSelectionRange(selection), text.length);
    const candidates = [];
    const cursor = current.from;
    const fenceContext = rules.code ? findContainingFenceContext(text, current) : null;
    const latexRange = rules.latex ? findContainingLatexRange(text, current) : null;
    const lines = getLines(text);
    const lineIndex = lineNumberAt(text, clamp(current.from, 0, text.length));
    const currentLine = lines[lineIndex];
    const listScope = rules.list && !!getListInfo(currentLine?.text ?? "");
    const headingScope = rules.heading && (headingLevel(currentLine?.text ?? "") !== null || headingHierarchyRanges(lines, lineIndex).length > 0);
    if (current.from === current.to)
        candidates.push(expandWord(text, cursor));
    if (fenceContext) {
        candidates.push(...addCodePairRanges(text, current));
        candidates.push(getCodeLineRange(text, current));
        candidates.push(fenceContext.range);
    }
    else if (latexRange) {
        candidates.push(...addSurroundingPairRanges(text, current, false));
        candidates.push(latexRange);
        if (rules.line)
            candidates.push(getCodeLineRange(text, current));
    }
    else if (listScope) {
        candidates.push(...getListExpansionRanges(text, current));
    }
    else if (headingScope) {
        if (headingLevel(currentLine?.text ?? "") !== null) {
            candidates.push({ from: currentLine.start, to: currentLine.end });
        }
        candidates.push(...headingHierarchyRanges(lines, lineIndex));
    }
    else {
        if (current.from !== current.to) {
            candidates.push(expandAdjacentBoundaries(text, current, rules));
            candidates.push(expandBoundaryRun(text, current, rules));
            candidates.push(addSurroundingPairRanges(text, current)[0] ?? null);
            candidates.push(expandToken(text, current, rules));
        }
    }
    if (!fenceContext && !latexRange && !listScope && !headingScope) {
        if (rules.line) {
            candidates.push(getCodeLineRange(text, current));
            candidates.push(expandParagraph(text, current));
        }
    }
    candidates.push(expandDocument(text));
    const seen = new Set();
    for (const candidate of candidates) {
        if (!candidate)
            continue;
        const normalized = normalizeRange(candidate, text.length);
        const key = `${normalized.from}:${normalized.to}`;
        if (seen.has(key))
            continue;
        seen.add(key);
        if (rangeContains(normalized, current) && (normalized.from !== current.from || normalized.to !== current.to)) {
            return normalized;
        }
    }
    return current;
}
function shrinkSelection(history, current) {
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
function positionToOffset(text, position) {
    const lines = getLines(text);
    const line = clamp(position.line, 0, Math.max(0, lines.length - 1));
    const target = lines[line];
    return target.start + clamp(position.ch, 0, target.end - target.start);
}
function offsetToPosition(text, offset) {
    const safeOffset = clamp(offset, 0, text.length);
    const lines = getLines(text);
    const line = lineNumberAt(text, safeOffset);
    return { line, ch: safeOffset - lines[line].start };
}
function getDefaultSelectionRules() {
    return { ...DEFAULT_RULES };
}

const RULE_DESCRIPTIONS = {
    whitespace: {
        name: "空白字符",
        description: "将连续空格、换行和制表符作为扩选边界。"
    },
    punctuation: {
        name: "标点和符号",
        description: "将 Markdown 标记、标点和符号作为扩选边界。"
    },
    line: {
        name: "段落和整行",
        description: "扩选到当前行，再扩选到连续的段落。"
    },
    list: {
        name: "列表层级",
        description: "在列表中依次扩选列表项内容、当前列表块。"
    },
    code: {
        name: "代码段",
        description: "在 fenced code block 内按 IDE 风格扩选，并支持整个代码段。"
    },
    latex: {
        name: "LaTeX",
        description: "识别行级数学环境、\\(...\\)、\\[...\\] 和 $...$。"
    },
    heading: {
        name: "标题层级",
        description: "在标题中扩选当前标题，再扩选到该标题的内容区域。"
    }
};
class QuickExpandSelectionSettingTab extends obsidian.PluginSettingTab {
    constructor(app, plugin) {
        super(app, plugin);
        this.plugin = plugin;
    }
    display() {
        const { containerEl } = this;
        containerEl.empty();
        containerEl.createEl("h2", { text: "Quick Expand Selection" });
        containerEl.createEl("p", {
            text: "扩选和缩选命令会出现在 Obsidian 的快捷键设置中。下面的规则会影响扩选顺序。",
            cls: "setting-item-description"
        });
        new obsidian.Setting(containerEl)
            .setName("扩选规则")
            .setHeading();
        Object.keys(RULE_DESCRIPTIONS).forEach((key) => {
            const description = RULE_DESCRIPTIONS[key];
            new obsidian.Setting(containerEl)
                .setName(description.name)
                .setDesc(description.description)
                .addToggle((toggle) => {
                toggle
                    .setValue(this.plugin.settings.rules[key])
                    .onChange(async (value) => {
                    this.plugin.settings.rules[key] = value;
                    await this.plugin.saveSettings();
                });
            });
        });
        new obsidian.Setting(containerEl)
            .setName("重置扩选历史")
            .setDesc("清除当前编辑器中的扩选层级记录。")
            .addButton((button) => {
            button.setButtonText("重置").onClick(() => {
                this.plugin.clearSelectionHistory();
            });
        });
    }
}

const DEFAULT_SETTINGS = {
    rules: getDefaultSelectionRules()
};
class QuickExpandSelectionPlugin extends obsidian.Plugin {
    constructor() {
        super(...arguments);
        this.settings = DEFAULT_SETTINGS;
        this.historyByEditor = new WeakMap();
    }
    async onload() {
        await this.loadSettings();
        this.addSettingTab(new QuickExpandSelectionSettingTab(this.app, this));
        this.addCommand({
            id: "expand-selection",
            name: "扩选文本",
            hotkeys: [{ modifiers: ["Alt"], key: "ArrowUp" }],
            repeatable: true,
            editorCallback: (editor) => this.expand(editor)
        });
        this.addCommand({
            id: "shrink-selection",
            name: "缩选文本",
            hotkeys: [{ modifiers: ["Alt"], key: "ArrowDown" }],
            repeatable: true,
            editorCallback: (editor) => this.shrink(editor)
        });
    }
    onunload() {
        // WeakMap history is released with its editor instances.
    }
    async loadSettings() {
        const saved = (await this.loadData());
        this.settings = {
            ...DEFAULT_SETTINGS,
            ...saved,
            rules: {
                ...DEFAULT_SETTINGS.rules,
                ...(saved?.rules ?? {})
            }
        };
    }
    async saveSettings() {
        await this.saveData(this.settings);
    }
    clearSelectionHistory() {
        const editor = this.getActiveEditor();
        if (editor)
            this.historyByEditor.delete(editor);
        new obsidian.Notice("已重置扩选历史");
    }
    getActiveEditor() {
        const view = this.app.workspace.getActiveViewOfType(obsidian.MarkdownView);
        return view?.editor ?? null;
    }
    getText(editor) {
        return editor.getValue();
    }
    getSelectionState(editor, text) {
        return {
            anchor: positionToOffset(text, editor.getCursor("anchor")),
            head: positionToOffset(text, editor.getCursor("head"))
        };
    }
    setSelection(editor, text, selection) {
        editor.setSelection(offsetToPosition(text, selection.anchor), offsetToPosition(text, selection.head));
    }
    ensureHistory(editor, text, current) {
        const existing = this.historyByEditor.get(editor);
        const range = getSelectionRange(current);
        const existingCurrent = existing?.selections.at(-1);
        if (!existing || existing.text !== text || !existingCurrent || getSelectionRange(existingCurrent).from !== range.from || getSelectionRange(existingCurrent).to !== range.to) {
            const history = { text, selections: [current] };
            this.historyByEditor.set(editor, history);
            return history;
        }
        return existing;
    }
    expand(editor) {
        const text = this.getText(editor);
        const current = this.getSelectionState(editor, text);
        const history = this.ensureHistory(editor, text, current);
        const nextRange = expandSelection(text, current, this.settings.rules);
        const next = current.anchor <= current.head
            ? { anchor: nextRange.from, head: nextRange.to }
            : { anchor: nextRange.to, head: nextRange.from };
        const previous = history.selections.at(-1);
        if (!previous || previous.anchor !== next.anchor || previous.head !== next.head) {
            history.selections.push(next);
        }
        this.setSelection(editor, text, next);
    }
    shrink(editor) {
        const text = this.getText(editor);
        const current = this.getSelectionState(editor, text);
        const history = this.ensureHistory(editor, text, current);
        const next = shrinkSelection(history.selections.slice(0, -1), current);
        if (history.selections.length > 1)
            history.selections.pop();
        this.setSelection(editor, text, next);
    }
}

module.exports = QuickExpandSelectionPlugin;
