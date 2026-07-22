// Language selection (English / Spanish).
//
// Usage in a component:
//
//   const t = useT();
//   <h1>{t('bol.title', 'Capture BOL')}</h1>
//
// The English copy lives inline at the call site as the second argument, so a
// key with no Spanish entry still renders correct English rather than a raw
// key. Spanish lives in ./es.ts. `npm test` fails if any t() key is missing
// from the Spanish dictionary, which is what keeps coverage honest.

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { es } from './es';

export type Lang = 'en' | 'es';

const LANG_KEY = 'inspection.device.lang';

export function getStoredLang(): Lang {
  try {
    const raw = localStorage.getItem(LANG_KEY);
    if (raw === 'en' || raw === 'es') return raw;
    // No explicit choice yet — follow the device language, since a Spanish-first
    // handset on the dock should open in Spanish without anyone tapping.
    if (typeof navigator !== 'undefined' && navigator.language?.toLowerCase().startsWith('es')) {
      return 'es';
    }
  } catch {
    // localStorage unavailable (private mode) — fall through to English.
  }
  return 'en';
}

function storeLang(lang: Lang): void {
  try {
    localStorage.setItem(LANG_KEY, lang);
  } catch {
    // Non-fatal: the choice just won't survive a reload.
  }
}

/** Interpolates {name} placeholders. */
function fill(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, key) =>
    key in vars ? String(vars[key]) : match
  );
}

export type TranslateFn = (
  key: string,
  english: string,
  vars?: Record<string, string | number>
) => string;

interface LanguageContextValue {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: TranslateFn;
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>(getStoredLang);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    storeLang(next);
  }, []);

  const t = useCallback<TranslateFn>(
    (key, english, vars) => {
      if (lang === 'en') return fill(english, vars);
      const translated = es[key];
      return fill(translated ?? english, vars);
    },
    [lang]
  );

  const value = useMemo(() => ({ lang, setLang, t }), [lang, setLang, t]);

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage(): LanguageContextValue {
  const ctx = useContext(LanguageContext);
  if (!ctx) {
    throw new Error('useLanguage must be used inside <LanguageProvider>');
  }
  return ctx;
}

/** Shorthand for the common case of only needing the translate function. */
export function useT(): TranslateFn {
  return useLanguage().t;
}
