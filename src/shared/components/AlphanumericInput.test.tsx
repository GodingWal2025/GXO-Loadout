import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AlphanumericInput } from './AlphanumericInput';

describe('AlphanumericInput', () => {
  it('keeps the letter keyboard and renders an inline 0-9 shortcut row', () => {
    const markup = renderToStaticMarkup(
      <AlphanumericInput value="P60SM" onValueChange={() => undefined} aria-label="Batch code" />
    );

    expect(markup).toContain('inputMode="text"');
    expect(markup).toContain('autoCapitalize="characters"');
    expect(markup.match(/aria-label="Insert \d"/g)).toHaveLength(10);
    expect(markup).toContain('>0</button>');
    expect(markup).toContain('>9</button>');
  });
});
