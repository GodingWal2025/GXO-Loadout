import { useT } from '../i18n/LanguageContext';

interface Props {
  editing: boolean;
  onChange: (editing: boolean) => void;
}

/**
 * Small corner control shown on completed inspections. View mode is the
 * default; switching to Edit re-enables every field on the screen.
 */
export function ViewEditToggle({ editing, onChange }: Props) {
  const t = useT();

  return (
    <div
      className="mode-toggle"
      role="group"
      aria-label={t('viewEdit.groupAria', 'View or edit this inspection')}
    >
      <button
        type="button"
        className={!editing ? 'active' : ''}
        aria-pressed={!editing}
        onClick={() => onChange(false)}
      >
        {t('viewEdit.view', '👁 View')}
      </button>
      <button
        type="button"
        className={editing ? 'active' : ''}
        aria-pressed={editing}
        onClick={() => onChange(true)}
      >
        {t('viewEdit.edit', '✎ Edit')}
      </button>
    </div>
  );
}
