import { Editor, MarkdownView, Notice, Plugin } from "obsidian";
import {
  expandSelection,
  getDefaultSelectionRules,
  getSelectionRange,
  offsetToPosition,
  positionToOffset,
  shrinkSelection,
  type SelectionRules,
  type SelectionState
} from "./selection";
import { QuickExpandSelectionSettingTab } from "./settings";

interface QuickExpandSelectionSettings {
  rules: SelectionRules;
}

const DEFAULT_SETTINGS: QuickExpandSelectionSettings = {
  rules: getDefaultSelectionRules()
};

interface EditorHistory {
  text: string;
  selections: SelectionState[];
}

export default class QuickExpandSelectionPlugin extends Plugin {
  override settings: QuickExpandSelectionSettings = DEFAULT_SETTINGS;
  private readonly historyByEditor = new WeakMap<Editor, EditorHistory>();

  override async onload(): Promise<void> {
    await this.loadSettings();
    this.addSettingTab(new QuickExpandSelectionSettingTab(this.app, this));

    this.addCommand({
      id: "expand-selection",
      name: "扩选文本",
      repeatable: true,
      editorCallback: (editor) => this.expand(editor)
    });
    this.addCommand({
      id: "shrink-selection",
      name: "缩选文本",
      repeatable: true,
      editorCallback: (editor) => this.shrink(editor)
    });
  }

  override onunload(): void {
    // WeakMap history is released with its editor instances.
  }

  async loadSettings(): Promise<void> {
    const saved = (await this.loadData()) as Partial<QuickExpandSelectionSettings> | null;
    this.settings = {
      ...DEFAULT_SETTINGS,
      ...saved,
      rules: {
        ...DEFAULT_SETTINGS.rules,
        ...(saved?.rules ?? {})
      }
    };
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  clearSelectionHistory(): void {
    const editor = this.getActiveEditor();
    if (editor) this.historyByEditor.delete(editor);
    new Notice("已重置扩选历史");
  }

  private getActiveEditor(): Editor | null {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    return view?.editor ?? null;
  }

  private getText(editor: Editor): string {
    return editor.getValue();
  }

  private getSelectionState(editor: Editor, text: string): SelectionState {
    return {
      anchor: positionToOffset(text, editor.getCursor("anchor")),
      head: positionToOffset(text, editor.getCursor("head"))
    };
  }

  private setSelection(editor: Editor, text: string, selection: SelectionState): void {
    editor.setSelection(offsetToPosition(text, selection.anchor), offsetToPosition(text, selection.head));
  }

  private ensureHistory(editor: Editor, text: string, current: SelectionState): EditorHistory {
    const existing = this.historyByEditor.get(editor);
    const range = getSelectionRange(current);
    const existingCurrent = existing?.selections.at(-1);
    if (!existing || existing.text !== text || !existingCurrent || getSelectionRange(existingCurrent).from !== range.from || getSelectionRange(existingCurrent).to !== range.to) {
      const history: EditorHistory = { text, selections: [current] };
      this.historyByEditor.set(editor, history);
      return history;
    }
    return existing;
  }

  private expand(editor: Editor): void {
    const text = this.getText(editor);
    const current = this.getSelectionState(editor, text);
    const history = this.ensureHistory(editor, text, current);
    const nextRange = expandSelection(text, current, this.settings.rules);
    const next: SelectionState = current.anchor <= current.head
      ? { anchor: nextRange.from, head: nextRange.to }
      : { anchor: nextRange.to, head: nextRange.from };
    const previous = history.selections.at(-1);
    if (!previous || previous.anchor !== next.anchor || previous.head !== next.head) {
      history.selections.push(next);
    }
    this.setSelection(editor, text, next);
  }

  private shrink(editor: Editor): void {
    const text = this.getText(editor);
    const current = this.getSelectionState(editor, text);
    const history = this.ensureHistory(editor, text, current);
    const next = shrinkSelection(history.selections.slice(0, -1), current);
    if (history.selections.length > 1) history.selections.pop();
    this.setSelection(editor, text, next);
  }
}
