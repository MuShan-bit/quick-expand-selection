import { App, PluginSettingTab, Setting, type SettingDefinitionItem } from "obsidian";
import type QuickExpandSelectionPlugin from "./main";
import type { SelectionRules } from "./selection";

export const RULE_DESCRIPTIONS: Record<keyof SelectionRules, { name: string; description: string }> = {
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

export class QuickExpandSelectionSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly plugin: QuickExpandSelectionPlugin) {
    super(app, plugin);
  }

  override getSettingDefinitions(): SettingDefinitionItem[] {
    return [
      {
        type: "group",
        heading: "Quick Expand Selection",
        items: [
          {
            name: "说明",
            desc: "扩选和缩选命令会出现在 Obsidian 的快捷键设置中。下面的规则会影响扩选顺序。"
          },
          ...(Object.keys(RULE_DESCRIPTIONS) as Array<keyof SelectionRules>).map((key) => {
            const description = RULE_DESCRIPTIONS[key];
            return {
              name: description.name,
              desc: description.description,
              aliases: ["扩选规则", "选择范围"],
              control: {
                type: "toggle" as const,
                key: `rules.${key}`,
                defaultValue: false
              }
            };
          }),
          {
            name: "重置扩选历史",
            desc: "清除当前编辑器中的扩选层级记录。",
            action: () => this.plugin.clearSelectionHistory()
          }
        ]
      }
    ];
  }

  override getControlValue(key: string): unknown {
    const rule = this.getRuleKey(key);
    return rule ? this.plugin.settings.rules[rule] : undefined;
  }

  override async setControlValue(key: string, value: unknown): Promise<void> {
    const rule = this.getRuleKey(key);
    if (!rule || typeof value !== "boolean") return;
    this.plugin.settings.rules[rule] = value;
    await this.plugin.saveSettings();
  }

  override display(): void {
    const { containerEl } = this;
    containerEl.empty();
    new Setting(containerEl)
      .setName("Quick Expand Selection")
      .setHeading();
    containerEl.createEl("p", {
      text: "扩选和缩选命令会出现在 Obsidian 的快捷键设置中。下面的规则会影响扩选顺序。",
      cls: "setting-item-description"
    });

    new Setting(containerEl)
      .setName("扩选规则")
      .setHeading();

    (Object.keys(RULE_DESCRIPTIONS) as Array<keyof SelectionRules>).forEach((key) => {
      const description = RULE_DESCRIPTIONS[key];
      new Setting(containerEl)
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

    new Setting(containerEl)
      .setName("重置扩选历史")
      .setDesc("清除当前编辑器中的扩选层级记录。")
      .addButton((button) => {
        button.setButtonText("重置").onClick(() => {
          this.plugin.clearSelectionHistory();
        });
      });
  }

  private getRuleKey(key: string): keyof SelectionRules | null {
    const prefix = "rules.";
    if (!key.startsWith(prefix)) return null;

    const rule = key.slice(prefix.length) as keyof SelectionRules;
    return Object.prototype.hasOwnProperty.call(RULE_DESCRIPTIONS, rule) ? rule : null;
  }
}
