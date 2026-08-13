import assert from "node:assert/strict";
import test from "node:test";
import {
  expandSelection,
  getSelectionRange,
  offsetToPosition,
  positionToOffset,
  shrinkSelection,
  type SelectionRules,
  type SelectionState
} from "../src/selection";
import type { TextRange } from "../src/selection";

const allRules: SelectionRules = {
  whitespace: true,
  punctuation: true,
  line: true,
  list: true,
  code: true,
  latex: true,
  heading: true
};

function selected(text: string, selection: SelectionState | TextRange): string {
  const range = "anchor" in selection ? getSelectionRange(selection) : selection;
  return text.slice(range.from, range.to);
}

function at(text: string, fragment: string, occurrence = 0): SelectionState {
  let from = -1;
  let searchFrom = 0;
  for (let index = 0; index <= occurrence; index += 1) {
    from = text.indexOf(fragment, searchFrom);
    searchFrom = from + fragment.length;
  }
  assert.notEqual(from, -1, `fragment not found: ${fragment}`);
  return { anchor: from, head: from + fragment.length };
}

test("expands regular Markdown text from word to punctuation, token, line, paragraph, document", () => {
  const text = "写作很重要。下一句。\n\n另一段。";
  let current = at(text, "很重要");
  const selections: string[] = [];
  for (let index = 0; index < 5; index += 1) {
    selections.push(selected(text, current));
    const next = expandSelection(text, current, allRules);
    if (next.from === current.anchor && next.to === current.head) break;
    current = { anchor: next.from, head: next.to };
  }
  assert.deepEqual(selections.slice(0, 3), ["很重要", "很重要。", "写作很重要。下一句。"]);
});

test("expands code content before the whole fenced code block", () => {
  const text = "```ts\nconst value = fn(arg);\n```";
  const word = at(text, "value");
  const line = expandSelection(text, word, allRules);
  const fence = expandSelection(text, { anchor: line.from, head: line.to }, allRules);
  assert.equal(selected(text, line), "const value = fn(arg);");
  assert.equal(selected(text, fence), text);
});

test("uses IDE-like delimiter levels inside code", () => {
  const text = "```js\nconst value = fn(arg);\n```";
  const argument = at(text, "arg");
  const pair = expandSelection(text, argument, allRules);
  const line = expandSelection(text, { anchor: pair.from, head: pair.to }, allRules);
  assert.equal(selected(text, pair), "(arg)");
  assert.equal(selected(text, line), "const value = fn(arg);");
});

test("expands list items and nested list blocks", () => {
  const text = "- first\n  - nested\n  - second\n- last";
  const nested = at(text, "nested");
  const item = expandSelection(text, nested, allRules);
  const block = expandSelection(text, { anchor: item.from, head: item.to }, allRules);
  const parent = expandSelection(text, { anchor: block.from, head: block.to }, allRules);
  assert.equal(selected(text, item), "- nested");
  assert.equal(selected(text, block), "  - nested\n  - second");
  assert.equal(selected(text, parent), text);
});

test("expands heading to its section", () => {
  const text = "# Title\nintro\n## Child\nchild text\n# Next";
  const heading = at(text, "Title");
  const line = expandSelection(text, heading, allRules);
  const section = expandSelection(text, { anchor: line.from, head: line.to }, allRules);
  assert.equal(selected(text, line), "# Title");
  assert.equal(selected(text, section), "# Title\nintro\n## Child\nchild text");
});

test("expands inline and block LaTeX", () => {
  const inline = "公式 $a + b$ 很有用";
  const inlineContent = at(inline, "a + b");
  const inlineMath = expandSelection(inline, inlineContent, allRules);
  assert.equal(selected(inline, inlineMath), "$a + b$");

  const block = "\\[\nx^2 + y^2\n\\]";
  const blockContent = at(block, "x^2 + y^2");
  const blockMath = expandSelection(block, blockContent, allRules);
  assert.equal(selected(block, blockMath), block);

  const nested = "$$\\frac{a}{b}$$";
  const numerator = at(nested, "a", 1);
  const fraction = expandSelection(nested, numerator, allRules);
  assert.equal(selected(nested, fraction), "{a}");
});

test("disabled rules are respected", () => {
  const text = "# Title\ncontent";
  const heading = at(text, "Title");
  const rules: SelectionRules = { ...allRules, heading: false, line: false };
  const next = expandSelection(text, heading, rules);
  assert.equal(selected(text, next), "# Title");
});

test("whitespace and punctuation toggles change their boundaries", () => {
  const punctuationText = "中文。下一句";
  const punctuation = at(punctuationText, "中文");
  const withoutPunctuation = expandSelection(punctuationText, punctuation, { ...allRules, punctuation: false });
  assert.equal(selected(punctuationText, withoutPunctuation), "中文。下一句");

  const whitespaceText = "one two";
  const word = at(whitespaceText, "one");
  const withWhitespace = expandSelection(whitespaceText, word, allRules);
  const withoutWhitespace = expandSelection(whitespaceText, word, { ...allRules, whitespace: false });
  assert.equal(selected(whitespaceText, withWhitespace), "one ");
  assert.equal(selected(whitespaceText, withoutWhitespace), "one two");
});

test("shrink returns the prior selection and then collapses the cursor", () => {
  const history: SelectionState[] = [
    { anchor: 4, head: 8 },
    { anchor: 0, head: 12 },
    { anchor: 0, head: 20 }
  ];
  assert.deepEqual(shrinkSelection(history.slice(0, -1), history[2]), history[1]);
  assert.deepEqual(shrinkSelection([], history[0]), { anchor: 8, head: 8 });
});

test("converts between line/ch positions and offsets", () => {
  const text = "ab\n中文";
  assert.equal(positionToOffset(text, { line: 1, ch: 1 }), 4);
  assert.deepEqual(offsetToPosition(text, 4), { line: 1, ch: 1 });
});
