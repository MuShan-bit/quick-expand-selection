import assert from "node:assert/strict";
import test from "node:test";
import { getLocaleStringsForLanguage } from "../src/i18n-core";

test("localizes Simplified Chinese only", () => {
  assert.equal(getLocaleStringsForLanguage("zh").commands.expandSelection, "扩选文本");
  assert.equal(getLocaleStringsForLanguage("zh-TW").commands.expandSelection, "Expand selection");
  assert.equal(getLocaleStringsForLanguage("en").commands.expandSelection, "Expand selection");
});

test("normalizes language codes before selecting a locale", () => {
  assert.equal(getLocaleStringsForLanguage("ZH").commands.shrinkSelection, "缩选文本");
  assert.equal(getLocaleStringsForLanguage("zh_TW").commands.shrinkSelection, "Shrink selection");
});
