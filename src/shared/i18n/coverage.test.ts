// Guards the promise that the language toggle covers the whole app.
//
// Scans every component for t('key', 'English') calls and asserts each key has
// a Spanish entry. A new untranslated string fails the build rather than
// silently rendering English to a Spanish-speaking inspector.

import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { es } from './es';

const SRC = fileURLToPath(new URL('../..', import.meta.url));

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === 'node_modules' || entry === '.claude') continue;
      walk(full, out);
    } else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

/** Matches t('key', 'English…') including the multi-line and template forms. */
const T_CALL = /\bt\(\s*(['"])([^'"]+)\1\s*,/g;

/** Drops comments so documentation examples aren't mistaken for real usages. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

interface Usage {
  key: string;
  file: string;
}

function collectUsages(): Usage[] {
  const usages: Usage[] = [];
  for (const file of walk(SRC)) {
    const source = stripComments(readFileSync(file, 'utf8'));
    for (const match of source.matchAll(T_CALL)) {
      usages.push({ key: match[2], file: relative(SRC, file) });
    }
  }
  return usages;
}

describe('spanish translation coverage', () => {
  const usages = collectUsages();

  it('finds t() usages to check', () => {
    // Sanity check on the scanner itself — if this drops to zero the regex
    // broke and the rest of the suite would pass vacuously.
    expect(usages.length).toBeGreaterThan(50);
  });

  it('has a Spanish entry for every key used in the app', () => {
    const missing = usages
      .filter((u) => !(u.key in es))
      .map((u) => `${u.key}  (${u.file})`);

    expect(missing.sort()).toEqual([]);
  });

  it('has no unused Spanish entries', () => {
    const used = new Set(usages.map((u) => u.key));
    const orphaned = Object.keys(es).filter((k) => !used.has(k));

    expect(orphaned.sort()).toEqual([]);
  });

  it('keeps {placeholders} identical between English and Spanish', () => {
    // A dropped {count} would render a literal brace on the dock.
    const placeholders = (s: string) => (s.match(/\{(\w+)\}/g) ?? []).sort().join(',');
    const mismatched: string[] = [];

    for (const file of walk(SRC)) {
      const source = stripComments(readFileSync(file, 'utf8'));
      // Re-match with the English argument captured this time.
      for (const m of source.matchAll(/\bt\(\s*(['"])([^'"]+)\1\s*,\s*(['"])([^'"]*)\3/g)) {
        const [, , key, , english] = m;
        const spanish = es[key];
        if (spanish && placeholders(english) !== placeholders(spanish)) {
          mismatched.push(`${key}: en="${english}" es="${spanish}"`);
        }
      }
    }

    expect(mismatched.sort()).toEqual([]);
  });
});
