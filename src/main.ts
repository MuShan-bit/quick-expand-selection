import { Editor, Notice, Plugin } from "obsidian";
import {
  getDefaultSelectionRules,
  offsetToPosition,
  positionToOffset,
  type SelectionRules,
  type SelectionState
} from "./selection";
import {
  expandWithHistory,
  shrinkWithHistory,
  type EditorHistory,
  type EditorSelectionAdapter
} from "./history";
import { QuickExpandSelectionSettingTab } from "./settings";
import { getLocaleStrings } from "./i18n";

interface QuickExpandSelectionSettings {
  rules: SelectionRules;
}

const DEFAULT_SETTINGS: QuickExpandSelectionSettings = {
  rules: getDefaultSelectionRules()
};

export default class QuickExpandSelectionPlugin extends Plugin {
  override settings: QuickExpandSelectionSettings = {
    rules: getDefaultSelectionRules()
  };
  private historyByEditor = new WeakMap<Editor, EditorHistory>();

  override async onload(): Promise<void> {
    await this.loadSettings();
    this.addSettingTab(new QuickExpandSelectionSettingTab(this.app, this));
    const strings = getLocaleStrings();

    this.addCommand({
      id: "expand-selection",
      name: strings.commands.expandSelection,
      repeatable: true,
      editorCallback: (editor) => this.expand(editor)
    });
    this.addCommand({
      id: "shrink-selection",
      name: strings.commands.shrinkSelection,
      repeatable: true,
      editorCallback: (editor) => this.shrink(editor)
    });
  }

  override onunload(): void {
    // WeakMap history is released with its editor instances.
  }

  override async onExternalSettingsChange(): Promise<void> {
    await this.loadSettings();
  }

  async loadSettings(): Promise<void> {
    const saved = (await this.loadData()) as Partial<QuickExpandSelectionSettings> | null;
    this.settings = {
      ...DEFAULT_SETTINGS,
      ...saved,
      rules: {
        ...getDefaultSelectionRules(),
        ...(saved?.rules ?? {})
      }
    };
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  clearSelectionHistory(): void {
    this.historyByEditor = new WeakMap<Editor, EditorHistory>();
    new Notice(getLocaleStrings().notices.expansionHistoryReset);
  }

  private createAdapter(editor: Editor): EditorSelectionAdapter {
    const posToOffset = (text: string, pos: { line: number; ch: number }): number =>
      typeof editor.posToOffset === "function"
        ? editor.posToOffset(pos)
        : positionToOffset(text, pos);

    const offsetToPos = (text: string, offset: number): { line: number; ch: number } =>
      typeof editor.offsetToPos === "function"
        ? editor.offsetToPos(offset)
        : offsetToPosition(text, offset);

    return {
      getText: () => editor.getValue(),
      getSelections: () => {
        const text = editor.getValue();
        const raw = typeof editor.listSelections === "function" ? editor.listSelections() : [];
        if (raw.length > 0) {
          return raw.map((selection) => ({
            anchor: posToOffset(text, selection.anchor),
            head: posToOffset(text, selection.head)
          }));
        }
        return [
          {
            anchor: posToOffset(text, editor.getCursor("anchor")),
            head: posToOffset(text, editor.getCursor("head"))
          }
        ];
      },
      setSelections: (selections: SelectionState[]) => {
        if (selections.length === 0) return;
        const text = editor.getValue();
        if (selections.length === 1 || typeof editor.setSelections !== "function") {
          const primary = selections[0];
          editor.setSelection(
            offsetToPos(text, primary.anchor),
            offsetToPos(text, primary.head)
          );
          return;
        }
        editor.setSelections(
          selections.map((selection) => ({
            anchor: offsetToPos(text, selection.anchor),
            head: offsetToPos(text, selection.head)
          }))
        );
      }
    };
  }

  private expand(editor: Editor): void {
    const adapter = this.createAdapter(editor);
    const updated = expandWithHistory(
      this.historyByEditor.get(editor),
      adapter,
      this.settings.rules
    );
    this.historyByEditor.set(editor, updated);
  }

  private shrink(editor: Editor): void {
    const adapter = this.createAdapter(editor);
    const updated = shrinkWithHistory(this.historyByEditor.get(editor), adapter);
    this.historyByEditor.set(editor, updated);
  }
}
