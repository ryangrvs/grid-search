import { describe, expect, it } from 'vitest';
import { turnIndicatorMarkup } from '../src/turn-indicator';

describe('turn indicator', () => {
  it('renders an accessible status and a decorative 5×5 grid', () => {
    const markup = turnIndicatorMarkup("Agent's turn");

    expect(markup).toContain('role="status"');
    expect(markup).toContain('aria-live="polite"');
    expect(markup).toContain('aria-atomic="true"');
    expect(markup).toContain('aria-hidden="true"');
    expect(markup.match(/class="turn-indicator__cell"/g)).toHaveLength(25);
    expect(markup).toContain('Agent&#39;s turn');
  });

  it('escapes labels before placing them into HTML', () => {
    const markup = turnIndicatorMarkup('<script>alert("x")</script> & "quoted"');

    expect(markup).toContain('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &quot;quoted&quot;');
    expect(markup).not.toContain('<script>');
  });

  it('uses the 5×5 chevron wave delay shape from the reference loading state', () => {
    const markup = turnIndicatorMarkup('Your turn');
    const delays = [...markup.matchAll(/--turn-indicator-delay:(\d+)ms/g)].map((match) => Number(match[1]));

    expect(delays).toEqual([
      180, 270, 360, 450, 540,
      90, 180, 270, 360, 450,
      0, 90, 180, 270, 360,
      90, 180, 270, 360, 450,
      180, 270, 360, 450, 540,
    ]);
  });
});
