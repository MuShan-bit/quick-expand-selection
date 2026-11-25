import {
  expandSelection,
  getDocumentBodyRange,
  getSelectionRange,
  type SelectionRules,
  type SelectionState
} from "./selection";

export interface EditorSelectionAdapter {
  getText(): string;
  getSelections(): SelectionState[];
  setSelections(selections: SelectionState[]): void;
}

export interface EditorHistory {
  text: string;
  snapshots: SelectionState[][];
}

function snapshotsEqual(left: SelectionState[], right: SelectionState[]): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    const leftRange = getSelectionRange(left[index]);
    const rightRange = getSelectionRange(right[index]);
    if (leftRange.from !== rightRange.from || leftRange.to !== rightRange.to) {
      return false;
    }
  }
  return true;
}

function isClampedFullDocumentMatch(
  text: string,
  expected: SelectionState[],
  actual: SelectionState[]
): boolean {
  if (expected.length !== 1 || actual.length !== 1) return false;
  const expectedRange = getSelectionRange(expected[0]);
  const actualRange = getSelectionRange(actual[0]);
  const bodyRange = getDocumentBodyRange(text);

  const expectedIsFullDoc = expectedRange.from === 0 && expectedRange.to === text.length;
  const expectedIsFullBody =
    bodyRange !== null &&
    expectedRange.from === bodyRange.from &&
    expectedRange.to === bodyRange.to;

  if (!expectedIsFullDoc && !expectedIsFullBody) return false;

  const actualReachesEnd = actualRange.to >= Math.max(0, text.length - 1);
  const actualStartsAtDocOrBody =
    actualRange.from === 0 || (bodyRange !== null && actualRange.from === bodyRange.from);
  return actualReachesEnd && actualStartsAtDocOrBody && actualRange.from < actualRange.to;
}

function collapseSelections(selections: SelectionState[]): SelectionState[] {
  return selections.map((selection) => ({
    anchor: selection.head,
    head: selection.head
  }));
}

export function ensureEditorHistory(
  existing: EditorHistory | undefined,
  text: string,
  current: SelectionState[]
): EditorHistory {
  const existingTop = existing?.snapshots.at(-1);
  if (
    !existing ||
    existing.text !== text ||
    !existingTop ||
    (!snapshotsEqual(existingTop, current) &&
      !isClampedFullDocumentMatch(text, existingTop, current))
  ) {
    return { text, snapshots: [current] };
  }
  return existing;
}

export function expandWithHistory(
  existing: EditorHistory | undefined,
  adapter: EditorSelectionAdapter,
  rules: SelectionRules
): EditorHistory {
  const text = adapter.getText();
  const current = adapter.getSelections();
  if (current.length === 0) {
    return existing ?? { text, snapshots: [] };
  }

  const history = ensureEditorHistory(existing, text, current);
  const next = current.map((selection) => {
    const nextRange = expandSelection(text, selection, rules);
    return selection.anchor <= selection.head
      ? { anchor: nextRange.from, head: nextRange.to }
      : { anchor: nextRange.to, head: nextRange.from };
  });

  adapter.setSelections(next);

  // Read back the actual selection applied by the editor (handles Live Preview / Properties
  // clamping and automatic merging of overlapping multi-cursor selections).
  const applied = adapter.getSelections();
  const recorded = applied.length > 0 ? applied : next;
  const previous = history.snapshots.at(-1);
  if (!previous || !snapshotsEqual(previous, recorded)) {
    history.snapshots.push(recorded);
  }
  return history;
}

export function shrinkWithHistory(
  existing: EditorHistory | undefined,
  adapter: EditorSelectionAdapter
): EditorHistory {
  const text = adapter.getText();
  const current = adapter.getSelections();
  if (current.length === 0) {
    return existing ?? { text, snapshots: [] };
  }

  const history = ensureEditorHistory(existing, text, current);
  if (history.snapshots.length <= 1) {
    const collapsed = collapseSelections(current);
    adapter.setSelections(collapsed);
    const applied = adapter.getSelections();
    return { text, snapshots: [applied.length > 0 ? applied : collapsed] };
  }

  // Pop current snapshot and find the most recent distinct prior snapshot
  history.snapshots.pop();
  let target: SelectionState[] | null = null;
  while (history.snapshots.length > 0) {
    const candidate = history.snapshots[history.snapshots.length - 1];
    if (!snapshotsEqual(candidate, current)) {
      target = candidate;
      break;
    }
    history.snapshots.pop();
  }

  if (!target) {
    const collapsed = collapseSelections(current);
    adapter.setSelections(collapsed);
    const applied = adapter.getSelections();
    return { text, snapshots: [applied.length > 0 ? applied : collapsed] };
  }

  adapter.setSelections(target);
  const applied = adapter.getSelections();
  if (applied.length > 0 && history.snapshots.length > 0) {
    history.snapshots[history.snapshots.length - 1] = applied;
  }
  return history;
}
