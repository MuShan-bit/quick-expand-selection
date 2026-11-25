# Quick Expand Selection

![Quick Expand Selection demo](assets/demo.gif)

Quick Expand Selection adds two localized Obsidian editor commands:

- `Expand selection`
- `Shrink selection`

The command names and settings follow Obsidian's interface language. English is used as the fallback, with Simplified Chinese currently supported. The commands have no default hotkeys so they do not conflict with existing Obsidian or user-defined shortcuts. Assign them in **Settings -> Hotkeys**. The default expansion model is Markdown-aware and progresses cleanly through word/CJK boundaries, inner and outer pairs/delimiters, punctuation and whitespace, lines and paragraphs, lists, fenced code blocks, LaTeX math, heading sections, body/frontmatter, and the full document, with full multi-cursor support.

Every expansion rule can be enabled or disabled in the plugin settings. Shrinking follows the expansion history for the current editor (including stepping back cleanly from full-document selections) and falls back to a collapsed cursor when no history remains.

## Development

```bash
npm install
npm test
npm run build
```

Copy `main.js` and `manifest.json` into:

```text
<vault>/.obsidian/plugins/quick-expand-selection/
```
