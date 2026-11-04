// =============================================================================
// Fleet Manager — tests for the translation dictionary.
//
// The dictionary has two languages and a `t()` lookup that falls back to
// Portuguese and then to the raw key. A key that lives outside both language
// objects therefore falls all the way through to the key itself — the
// interface shows `auditSources` instead of "AUDITAR FONTES" — and a key that
// exists only in Portuguese shows Portuguese text in English mode.
//
// Both happened. These tests make that impossible to reintroduce.
//
// Run with: npm test  (node --test tests/*.test.ts)
// =============================================================================

import { test } from "node:test";
import assert from "node:assert/strict";

import { I18N } from "../src/i18n.ts";

const pt = I18N.pt as Record<string, string>;
const en = I18N.en as Record<string, string>;

/** The lookup the interface performs. */
function t(key: string, language: "pt" | "en"): string {
  return (language === "en" ? en : pt)[key] ?? pt[key] ?? key;
}

// -----------------------------------------------------------------------------
// The dictionary's shape
// -----------------------------------------------------------------------------

test("the dictionary holds exactly two languages and nothing else", () => {
  // A key placed at the top level of the dictionary is outside both language
  // objects, so neither language can find it.
  const topLevel = Object.keys(I18N).filter((key) => key !== "pt" && key !== "en");
  assert.deepEqual(topLevel, []);
});

test("every key used by the interface exists in both languages", () => {
  // The dictionary is read through `t()`, whose lookup falls back to
  // Portuguese and then to the raw key. A key the interface asks for must
  // therefore exist in the language being shown and in Portuguese, so the
  // fallback never leaks a raw identifier into the interface.
  const missingInEn = [...Object.keys(pt)].filter((key) => !(key in en));
  const missingInPt = [...Object.keys(en)].filter((key) => !(key in pt));

  // The English dictionary carries some labels the interface renders
  // directly rather than through `t()`; those are English-only by design.
  const englishOnly = new Set(Object.keys(en).filter((key) => !(key in pt)));
  const unexpected = missingInPt.filter((key) => !englishOnly.has(key));
  assert.deepEqual(unexpected, [], `missing in Portuguese: ${unexpected.join(", ")}`);

  // Every key Portuguese has must also exist in English — an English-mode
  // interface must never fall back to Portuguese.
  assert.deepEqual(missingInEn, [], `missing in English: ${missingInEn.join(", ")}`);
});

test("no key resolves to itself", () => {
  // A key that resolves to itself is a key no language has — the interface
  // would show the raw identifier to the user.
  const unresolved = Object.keys(pt).filter((key) => t(key, "pt") === key);
  assert.deepEqual(unresolved, []);
});

test("the two languages do not share identical values for the same key", () => {
  // Identical values mean one language was never translated and the other
  // was copied over it. A handful of labels are the same word in both
  // languages ("Nodes", "Dashboard") — those are listed as expected.
  const EXPECTED_IDENTICAL = [
    "aims",
    "aliveFilter",
    "dashboard",
    "dashboardExplorer",
    "deadFilter",
    "endpoint",
    "explorerUptime",
    "nodeA",
    "nodeB",
    "nodes",
    "offlineStatus",
  ];
  const identical = Object.keys(en).filter(
    (key) => key in pt && pt[key] === en[key],
  );
  assert.deepEqual(identical.sort(), [...EXPECTED_IDENTICAL].sort());
});

// -----------------------------------------------------------------------------
// The keys that were once outside the English dictionary
// -----------------------------------------------------------------------------

const FORMERLY_ORPHANED = [
  "aimLab",
  "aimLabHint",
  "auditSources",
  "dataReadiness",
  "dataReadinessHint",
  "endpoint",
  "protectedAction",
  "sourceAuditRunning",
  "sourceFailed",
  "sourceMissing",
  "sourceReady",
];

test("the keys that were once outside the English dictionary are in it", () => {
  for (const key of FORMERLY_ORPHANED) {
    assert.ok(key in en, `${key} is missing from the English dictionary`);
  }
});

test("the keys that were once outside the English dictionary read in English", () => {
  // "Endpoint" is the same word in both languages, so it is expected to
  // read identically. Every other one must differ — otherwise the English
  // interface is showing Portuguese.
  const SAME_IN_BOTH = ["endpoint"];
  for (const key of FORMERLY_ORPHANED) {
    assert.notEqual(t(key, "en"), key, `${key} resolves to the raw key`);
    if (SAME_IN_BOTH.includes(key)) continue;
    assert.notEqual(t(key, "en"), pt[key], `${key} falls back to Portuguese in English mode`);
  }
});

test("the keys that were once outside the English dictionary still read in Portuguese", () => {
  for (const key of FORMERLY_ORPHANED) {
    assert.ok(key in pt, `${key} is missing from the Portuguese dictionary`);
    assert.notEqual(t(key, "pt"), key);
  }
});

// -----------------------------------------------------------------------------
// The nine tabs
// -----------------------------------------------------------------------------

test("every tab has a label in both languages", () => {
  // The interface resolves a tab's label through this map, so the tab's
  // translation key is not always the tab's own id.
  const TAB_LABEL_KEY = {
    overview: "dashboard",
    nodes: "nodes",
    licenses: "licenses",
    aims: "aims",
    tilling: "tilling",
    diagnostics: "diagnostics",
    earnings: "earnings",
    alerts: "alerts",
    settings: "settings",
  };
  // "Dashboard", "Nodes" and "AIM Manager" are the same in both languages.
  const SAME_IN_BOTH = ["nodes", "aims", "overview"];
  for (const [tab, key] of Object.entries(TAB_LABEL_KEY)) {
    assert.ok(key in pt, `the ${tab} tab has no Portuguese label`);
    assert.ok(key in en, `the ${tab} tab has no English label`);
    assert.notEqual(t(key, "en"), key, `the ${tab} tab resolves to the raw key`);
    if (SAME_IN_BOTH.includes(tab)) continue;
    assert.notEqual(t(key, "en"), t(key, "pt"), `the ${tab} tab reads the same in both languages`);
  }
});
