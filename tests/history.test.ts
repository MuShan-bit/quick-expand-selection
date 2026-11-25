import assert from "node:assert/strict";
import test from "node:test";
import {
  expandWithHistory,
  shrinkWithHistory,
  type EditorHistory,
  type EditorSelectionAdapter
} from "../src/history";
import { getDefaultSelectionRules, getSelectionRange, type SelectionState } from "../src/selection";

const allRules = getDefaultSelectionRules();

function createMockEditor(
  text: string,
  initial: SelectionState[],
  options?: {
    clampSelection?: (selections: SelectionState[]) => SelectionState[];
  }
): EditorSelectionAdapter & { current: SelectionState[]; text: string } {
  const state = {
    text,
    current: initial,
    getText() {
      return state.text;
    },
    getSelections() {
      return state.current.map((selection) => ({ ...selection }));
    },
    setSelections(selections: SelectionState[]) {
      const next = options?.clampSelection ? options.clampSelection(selections) : selections;
      // Mimic CodeMirror merging identical/overlapping selections
      const merged: SelectionState[] = [];
      for (const item of next) {
        const range = getSelectionRange(item);
        const duplicate = merged.some((existing) => {
          const existingRange = getSelectionRange(existing);
          return existingRange.from === range.from && existingRange.to === range.to;
        });
        if (!duplicate) merged.push({ ...item });
      }
      state.current = merged;
    }
  };
  return state;
}

function selectedTexts(editor: { text: string; current: SelectionState[] }): string[] {
  return editor.current.map((selection) => {
    const range = getSelectionRange(selection);
    return editor.text.slice(range.from, range.to);
  });
}

test("shrinks step-by-step back from full-document selection to original cursor", () => {
  const text = "# Title\n\nhello (world)\n\n# Next";
  const cursor = text.indexOf("world");
  const editor = createMockEditor(text, [{ anchor: cursor, head: cursor }]);
  let history: EditorHistory | undefined;

  const forward: string[] = [];
  for (let index = 0; index < 10; index += 1) {
    history = expandWithHistory(history, editor, allRules);
    const value = selectedTexts(editor)[0];
    if (forward.at(-1) === value) break;
    forward.push(value);
  }
  assert.equal(forward.at(-1), text);

  // Pressing expand one extra time at full document must not corrupt history
  history = expandWithHistory(history, editor, allRules);
  assert.equal(selectedTexts(editor)[0], text);

  const backward: string[] = [];
  for (let index = 0; index < forward.length; index += 1) {
    history = shrinkWithHistory(history, editor);
    backward.push(selectedTexts(editor)[0]);
  }
  assert.deepEqual(backward, [...forward.slice(0, -1).reverse(), ""]);
});

test("preserves shrink history when editor clamps full-document selection past frontmatter", () => {
  const text = "---\ntitle: Demo\n---\n\nhello world";
  const bodyStart = text.indexOf("\nhello world");
  const cursor = text.indexOf("hello");
  const editor = createMockEditor(text, [{ anchor: cursor, head: cursor }], {
    clampSelection: (selections) =>
      selections.map((selection) => ({
        anchor: Math.max(bodyStart, selection.anchor),
        head: Math.max(bodyStart, selection.head)
      }))
  });

  let history: EditorHistory | undefined;
  history = expandWithHistory(history, editor, allRules); // hello
  history = expandWithHistory(history, editor, allRules); // "hello "
  history = expandWithHistory(history, editor, allRules); // "hello world"
  history = expandWithHistory(history, editor, allRules); // body "\nhello world"
  // Expanding again tries full doc 0..text.length, which editor clamps back to bodyStart..text.length
  history = expandWithHistory(history, editor, allRules);
  assert.equal(selectedTexts(editor)[0], "\nhello world");

  history = shrinkWithHistory(history, editor);
  assert.equal(selectedTexts(editor)[0], "hello world");
  history = shrinkWithHistory(history, editor);
  assert.equal(selectedTexts(editor)[0], "hello ");
  history = shrinkWithHistory(history, editor);
  assert.equal(selectedTexts(editor)[0], "hello");
});

test("preserves shrink history if editor asynchronously clamps full-doc selection after expand", () => {
  const text = "---\ntitle: Demo\n---\n\nhello world";
  const bodyStart = text.indexOf("\nhello world");
  const cursor = text.indexOf("hello");
  const editor = createMockEditor(text, [{ anchor: cursor, head: cursor }]);

  let history: EditorHistory | undefined;
  history = expandWithHistory(history, editor, allRules); // hello
  history = expandWithHistory(history, editor, allRules); // "hello "
  history = expandWithHistory(history, editor, allRules); // "hello world"
  history = expandWithHistory(history, editor, allRules); // body
  history = expandWithHistory(history, editor, allRules); // full doc 0..text.length
  assert.equal(selectedTexts(editor)[0], text);

  // Simulate async Live Preview clamping after render tick
  editor.current = [{ anchor: bodyStart, head: text.length }];

  history = shrinkWithHistory(history, editor);
  assert.equal(selectedTexts(editor)[0], "hello world");
});

test("supports multi-cursor expand, merge at full document, and full restore on shrink", () => {
  const text = "first apple line\n\nsecond banana line";
  const applePos = text.indexOf("apple");
  const bananaPos = text.indexOf("banana");
  const editor = createMockEditor(text, [
    { anchor: applePos, head: applePos },
    { anchor: bananaPos, head: bananaPos }
  ]);

  let history: EditorHistory | undefined;
  history = expandWithHistory(history, editor, allRules);
  assert.deepEqual(selectedTexts(editor), ["apple", "banana"]);

  history = expandWithHistory(history, editor, allRules);
  assert.deepEqual(selectedTexts(editor), [" apple ", " banana "]);

  history = expandWithHistory(history, editor, allRules);
  assert.deepEqual(selectedTexts(editor), ["first apple line", "second banana line"]);

  // Next step merges both cursors into a single full-document selection
  history = expandWithHistory(history, editor, allRules);
  assert.deepEqual(selectedTexts(editor), [text]);

  // Shrinking must restore BOTH cursors independently
  history = shrinkWithHistory(history, editor);
  assert.deepEqual(selectedTexts(editor), ["first apple line", "second banana line"]);

  history = shrinkWithHistory(history, editor);
  assert.deepEqual(selectedTexts(editor), [" apple ", " banana "]);

  history = shrinkWithHistory(history, editor);
  assert.deepEqual(selectedTexts(editor), ["apple", "banana"]);
});
