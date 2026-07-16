import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { renderMessageBody } from './renderMessage';

function doc(content: unknown[]): unknown {
  return { type: 'doc', content };
}
function para(content: unknown[]): unknown {
  return { type: 'paragraph', content };
}

describe('renderMessageBody (docs/modules/13 §5)', () => {
  it('renders plain paragraph text', () => {
    const { container } = render(
      <>{renderMessageBody(doc([para([{ type: 'text', text: 'hello' }])]))}</>,
    );
    expect(container.textContent).toContain('hello');
  });

  it('applies the bold mark as <strong>', () => {
    const { container } = render(
      <>
        {renderMessageBody(doc([para([{ type: 'text', text: 'x', marks: [{ type: 'bold' }] }])]))}
      </>,
    );
    expect(container.querySelector('strong')).not.toBeNull();
  });

  it('renders a safe https link as an anchor with a real href', () => {
    const { container } = render(
      <>
        {renderMessageBody(
          doc([
            para([
              {
                type: 'text',
                text: 'go',
                marks: [{ type: 'link', attrs: { href: 'https://a.tj' } }],
              },
            ]),
          ]),
        )}
      </>,
    );
    const a = container.querySelector('a');
    expect(a?.getAttribute('href')).toBe('https://a.tj');
  });

  it('never renders a javascript: link as an anchor (XSS guard)', () => {
    const { container } = render(
      <>
        {renderMessageBody(
          doc([
            para([
              {
                type: 'text',
                text: 'evil',

                marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }],
              },
            ]),
          ]),
        )}
      </>,
    );
    expect(container.querySelector('a')).toBeNull();
    expect(container.textContent).toContain('evil');
  });

  it('renders a mention as @label', () => {
    const { container } = render(
      <>
        {renderMessageBody(doc([para([{ type: 'mention', attrs: { id: 'u1', label: 'Иван' } }])]))}
      </>,
    );
    expect(container.textContent).toContain('@Иван');
  });

  it('returns null for an empty body', () => {
    expect(renderMessageBody(null)).toBeNull();
  });
});
