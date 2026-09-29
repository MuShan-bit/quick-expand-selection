import { getLanguage } from "obsidian";
import { getLocaleStringsForLanguage, type LocaleStrings } from "./i18n-core";

export type { LocaleStrings } from "./i18n-core";

export function getLocaleStrings(): LocaleStrings {
  const language = typeof getLanguage === "function" ? getLanguage() : "en";
  return getLocaleStringsForLanguage(language);
}
