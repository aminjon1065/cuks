import { describe, expect, it } from 'vitest';
import type { DocumentContent } from './content';
import {
  collectTemplateVariables,
  isTemplateVariable,
  renderTemplateContent,
  renderTemplateText,
} from './template-variables';

const ctx = {
  'document.subject': 'О паводке',
  'author.shortName': 'Иванов И.',
  'correspondent.name': null,
};

describe('renderTemplateText', () => {
  it('substitutes an allow-listed variable, tolerating whitespace', () => {
    expect(renderTemplateText('Тема: {{document.subject}}', ctx)).toBe('Тема: О паводке');
    expect(renderTemplateText('Тема: {{ document.subject }}', ctx)).toBe('Тема: О паводке');
  });

  it('renders a known but unset variable as empty — «no correspondent» is a real state', () => {
    expect(renderTemplateText('От: {{correspondent.name}}.', ctx)).toBe('От: .');
  });

  it('leaves an unknown placeholder verbatim so the author sees their typo', () => {
    expect(renderTemplateText('{{document.subjekt}}', ctx)).toBe('{{document.subjekt}}');
    expect(renderTemplateText('{{whatever.thing}}', ctx)).toBe('{{whatever.thing}}');
  });

  it('resolves nothing outside the allow-list, however it is spelled', () => {
    // The point of an explicit list: no traversal into whatever object the context came
    // from, no prototype access, no constructor reach-through.
    for (const name of [
      'user.passwordHash',
      'author.totpSecret',
      'document.__proto__',
      'constructor.constructor',
      'org.quotaBytes',
    ]) {
      expect(isTemplateVariable(name), name).toBe(false);
      expect(renderTemplateText(`{{${name}}}`, ctx)).toBe(`{{${name}}}`);
    }
  });

  it('does not evaluate anything — a placeholder is a lookup, not an expression', () => {
    expect(renderTemplateText('{{1+1}}', ctx)).toBe('{{1+1}}');
    expect(renderTemplateText('{{alert(1)}}', ctx)).toBe('{{alert(1)}}');
  });
});

describe('collectTemplateVariables', () => {
  it('reports the known and the unresolvable placeholders separately', () => {
    const content = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: '{{document.subject}}' }] },
        { type: 'paragraph', content: [{ type: 'text', text: '{{author.shortName}} {{nope.x}}' }] },
      ],
    };
    expect(collectTemplateVariables(content)).toEqual({
      known: ['document.subject', 'author.shortName'],
      unknown: ['nope.x'],
    });
  });

  it('deduplicates repeated placeholders', () => {
    const content = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: '{{org.name}} {{org.name}}' }] },
      ],
    };
    expect(collectTemplateVariables(content).known).toEqual(['org.name']);
  });
});

describe('renderTemplateContent', () => {
  const content: DocumentContent = {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'Тема: {{document.subject}}' },
          {
            type: 'text',
            text: 'ссылка',
            marks: [{ type: 'link', attrs: { href: 'https://cuks.local/{{document.subject}}' } }],
          },
        ],
      },
    ],
  };

  it('substitutes text leaves only', () => {
    const rendered = renderTemplateContent(content, ctx);
    const [first, second] = rendered.content![0]!.content!;
    expect(first!.text).toBe('Тема: О паводке');
    // A placeholder inside an href is NEVER resolved: a template must not be usable to
    // assemble a URL out of values at render time.
    expect(second!.marks![0]!.attrs!.href).toBe('https://cuks.local/{{document.subject}}');
  });

  it('leaves the structure untouched', () => {
    const rendered = renderTemplateContent(content, ctx);
    expect(rendered.type).toBe('doc');
    expect(rendered.content).toHaveLength(1);
    expect(rendered.content![0]!.type).toBe('paragraph');
  });
});
