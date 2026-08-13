# Quick Expand Selection

Quick Expand Selection adds two Obsidian editor commands:

- `扩选文本`
- `缩选文本`

The commands have no default hotkeys so they do not conflict with existing Obsidian or user-defined shortcuts. Assign them in **Settings -> Hotkeys**. The default expansion model is Markdown-aware and progresses through word/token boundaries, punctuation and whitespace, lines and paragraphs, Markdown structures, and the full document. Code fences, LaTeX, list nesting, and heading sections are handled as separate structural scopes.

Every expansion rule can be enabled or disabled in the plugin settings. Shrinking follows the expansion history for the current editor and falls back to a collapsed cursor when no history remains.

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
