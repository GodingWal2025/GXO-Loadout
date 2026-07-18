interface Props {
  editing: boolean;
  onChange: (editing: boolean) => void;
}

/**
 * Small corner control shown on completed inspections. View mode is the
 * default; switching to Edit re-enables every field on the screen.
 */
export function ViewEditToggle({ editing, onChange }: Props) {
  return (
    <div className="mode-toggle" role="group" aria-label="View or edit this inspection">
      <button
        type="button"
        className={!editing ? 'active' : ''}
        aria-pressed={!editing}
        onClick={() => onChange(false)}
      >
        👁 View
      </button>
      <button
        type="button"
        className={editing ? 'active' : ''}
        aria-pressed={editing}
        onClick={() => onChange(true)}
      >
        ✎ Edit
      </button>
    </div>
  );
}
