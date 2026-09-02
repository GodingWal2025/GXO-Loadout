interface Props {
  value: string;
  onValueChange: (value: string) => void;
  className?: string;
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  /** Keep identifier-style values consistently capitalized. */
  uppercase?: boolean;
  'aria-label'?: string;
}

/** Code/identifier input with consistent capitalization and keyboard behavior. */
export function AlphanumericInput({
  value,
  onValueChange,
  className,
  placeholder,
  disabled,
  required,
  uppercase = true,
  'aria-label': ariaLabel,
}: Props) {
  const normalize = (nextValue: string) => uppercase ? nextValue.toUpperCase() : nextValue;

  return (
    <div className="alphanumeric-input">
      <input
        type="text"
        inputMode="text"
        value={value}
        onChange={(event) => onValueChange(normalize(event.target.value))}
        className={className}
        placeholder={placeholder}
        disabled={disabled}
        required={required}
        aria-label={ariaLabel}
        autoCapitalize={uppercase ? 'characters' : 'none'}
        autoCorrect="off"
        spellCheck={false}
        style={uppercase ? { textTransform: 'uppercase' } : undefined}
      />
    </div>
  );
}
