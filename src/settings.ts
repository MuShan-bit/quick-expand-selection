import { App, PluginSettingTab, Setting, type SettingDefinitionItem } from "obsidian";
import type QuickExpandSelectionPlugin from "./main";
import type { SelectionRules } from "./selection";
import { getLocaleStrings } from "./i18n";

export class QuickExpandSelectionSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly plugin: QuickExpandSelectionPlugin) {
    super(app, plugin);
  }

  override getSettingDefinitions(): SettingDefinitionItem[] {
    const strings = getLocaleStrings();
    return [
      {
        type: "group",
        heading: strings.settings.heading,
        items: [
          {
            name: strings.settings.descriptionName,
            desc: strings.settings.description
          },
          ...(Object.keys(strings.rules) as Array<keyof SelectionRules>).map((key) => {
            const description = strings.rules[key];
            return {
              name: description.name,
              desc: description.description,
              aliases: strings.settings.aliases,
              control: {
                type: "toggle" as const,
                key: `rules.${key}`,
                defaultValue: false
              }
            };
          }),
          {
            name: strings.settings.resetHistory,
            desc: strings.settings.resetHistoryDescription,
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
    const strings = getLocaleStrings();
    const { containerEl } = this;
    containerEl.empty();
    new Setting(containerEl)
      .setName(strings.settings.heading)
      .setHeading();
    containerEl.createEl("p", {
      text: strings.settings.description,
      cls: "setting-item-description"
    });

    new Setting(containerEl)
      .setName(strings.settings.heading)
      .setHeading();

    (Object.keys(strings.rules) as Array<keyof SelectionRules>).forEach((key) => {
      const description = strings.rules[key];
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
      .setName(strings.settings.resetHistory)
      .setDesc(strings.settings.resetHistoryDescription)
      .addButton((button) => {
        button.setButtonText(strings.settings.resetButton).onClick(() => {
          this.plugin.clearSelectionHistory();
        });
      });
  }

  private getRuleKey(key: string): keyof SelectionRules | null {
    const prefix = "rules.";
    if (!key.startsWith(prefix)) return null;

    const rule = key.slice(prefix.length) as keyof SelectionRules;
    return Object.prototype.hasOwnProperty.call(getLocaleStrings().rules, rule) ? rule : null;
  }
}
