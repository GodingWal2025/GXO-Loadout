import { useRef } from 'react';

interface Props {
  value: string;
  onValueChange: (value: string) => void;
  className?: string;
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  'aria-label'?: string;
}

const DIGITS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'];

/** Batch-code input with a mobile number row above the letter keyboard. */
export function AlphanumericInput({
  value,
  onValueChange,
  className,
  placeholder,
  disabled,
  required,
  'aria-label': ariaLabel,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);

  const insertDigit = (digit: string) => {
    const input = inputRef.current;
    const start = input?.selectionStart ?? value.length;
    const end = input?.selectionEnd ?? start;
    onValueChange(`${value.slice(0, start)}${digit}${value.slice(end)}`.toUpperCase());
    requestAnimationFrame(() => {
      input?.focus();
      input?.setSelectionRange(start + 1, start + 1);
    });
  };

  return (
    <div className="alphanumeric-input">
      <input
        ref={inputRef}
        type="text"
        inputMode="text"
        value={value}
        onChange={(event) => onValueChange(event.target.value.toUpperCase())}
        className={className}
        placeholder={placeholder}
        disabled={disabled}
        required={required}
        aria-label={ariaLabel}
        autoCapitalize="characters"
        autoCorrect="off"
        spellCheck={false}
        style={{ textTransform: 'uppercase' }}
      />
      <div className="alphanumeric-input__digits" aria-label="Number shortcuts">
        {DIGITS.map((digit) => (
          <button
            key={digit}
            type="button"
            className="alphanumeric-input__digit mono"
            aria-label={`Insert ${digit}`}
            disabled={disabled}
            onPointerDown={(event) => event.preventDefault()}
            onClick={() => insertDigit(digit)}
          >
            {digit}
          </button>
        ))}
      </div>
    </div>
  );
}
