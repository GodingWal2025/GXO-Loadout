import { useLanguage, type Lang } from '../i18n/LanguageContext';

/**
 * EN | ES segmented control. Lives in the topbar next to the site name.
 *
 * Deliberately always shows BOTH options rather than a single "switch to…"
 * button: on the dock the current language needs to be readable at a glance,
 * and a two-state control is one tap either direction with gloves on.
 */
export function LanguageToggle() {
  const { lang, setLang } = useLanguage();

  const options: { value: Lang; label: string; aria: string }[] = [
    { value: 'en', label: 'EN', aria: 'Switch to English' },
    { value: 'es', label: 'ES', aria: 'Cambiar a español' },
  ];

  return (
    <div className="lang-toggle" role="group" aria-label="Language / Idioma">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          className={`lang-toggle__btn ${lang === opt.value ? 'lang-toggle__btn--active' : ''}`}
          aria-label={opt.aria}
          aria-pressed={lang === opt.value}
          onClick={() => setLang(opt.value)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
