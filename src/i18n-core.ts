export interface LocaleStrings {
  commands: {
    expandSelection: string;
    shrinkSelection: string;
  };
  rules: Record<"whitespace" | "punctuation" | "line" | "list" | "code" | "latex" | "heading", { name: string; description: string }>;
  settings: {
    heading: string;
    descriptionName: string;
    description: string;
    aliases: string[];
    resetHistory: string;
    resetHistoryDescription: string;
    resetButton: string;
  };
  notices: {
    expansionHistoryReset: string;
  };
}

const en: LocaleStrings = {
  commands: {
    expandSelection: "Expand selection",
    shrinkSelection: "Shrink selection"
  },
  rules: {
    whitespace: { name: "Whitespace", description: "Treat consecutive spaces, line breaks, and tabs as expansion boundaries." },
    punctuation: { name: "Punctuation and symbols", description: "Treat Markdown markers, punctuation, and symbols as expansion boundaries." },
    line: { name: "Paragraphs and lines", description: "Expand to the current line, then to consecutive paragraphs." },
    list: { name: "List hierarchy", description: "Within a list, expand through list-item content and then the current list block." },
    code: { name: "Code blocks", description: "Use IDE-style expansion inside fenced code blocks, including the whole code block." },
    latex: { name: "LaTeX", description: "Recognize inline math, \\(...\\), \\[...\\], and $...$." },
    heading: { name: "Heading hierarchy", description: "Expand the current heading, then the content under that heading." }
  },
  settings: {
    heading: "Expansion rules",
    descriptionName: "About",
    description: "Expand and shrink selection commands appear in Obsidian's Hotkeys settings. The rules below affect their expansion order.",
    aliases: ["Expansion rules", "Selection range"],
    resetHistory: "Reset expansion history",
    resetHistoryDescription: "Clear the expansion history for the current editor.",
    resetButton: "Reset"
  },
  notices: {
    expansionHistoryReset: "Expansion history reset."
  }
};

const zhCn: LocaleStrings = {
  commands: {
    expandSelection: "扩选文本",
    shrinkSelection: "缩选文本"
  },
  rules: {
    whitespace: { name: "空白字符", description: "将连续空格、换行和制表符作为扩选边界。" },
    punctuation: { name: "标点和符号", description: "将 Markdown 标记、标点和符号作为扩选边界。" },
    line: { name: "段落和整行", description: "扩选到当前行，再扩选到连续的段落。" },
    list: { name: "列表层级", description: "在列表中依次扩选列表项内容、当前列表块。" },
    code: { name: "代码段", description: "在 fenced code block 内按 IDE 风格扩选，并支持整个代码段。" },
    latex: { name: "LaTeX", description: "识别行级数学环境、\\(...\\)、\\[...\\] 和 $...$。" },
    heading: { name: "标题层级", description: "在标题中扩选当前标题，再扩选到该标题的内容区域。" }
  },
  settings: {
    heading: "扩选规则",
    descriptionName: "说明",
    description: "扩选和缩选命令会出现在 Obsidian 的快捷键设置中。下面的规则会影响扩选顺序。",
    aliases: ["扩选规则", "选择范围"],
    resetHistory: "重置扩选历史",
    resetHistoryDescription: "清除当前编辑器中的扩选层级记录。",
    resetButton: "重置"
  },
  notices: {
    expansionHistoryReset: "已重置扩选历史"
  }
};

export function getLocaleStringsForLanguage(rawLanguage: string): LocaleStrings {
  const language = rawLanguage.toLowerCase().replace(/_/g, "-");
  return language === "zh" ? zhCn : en;
}
