import { describe, expect, it } from 'vitest';
import { parseSnippet, SNIPPET_END, SNIPPET_START } from './docflow';

const hl = (s: string): string => `${SNIPPET_START}${s}${SNIPPET_END}`;

/**
 * The snippet is segments rather than markup for one reason: `ts_headline` wraps the matched
 * words but does not escape the text around them. Returning HTML would mean a document could
 * put a `<script>` in its own subject and have the search render it.
 */
describe('parseSnippet', () => {
  it('splits a highlighted fragment into text and matches', () => {
    expect(parseSnippet(`О мерах по ${hl('наводнению')} в районе`)).toEqual([
      { text: 'О мерах по ', hit: false },
      { text: 'наводнению', hit: true },
      { text: ' в районе', hit: false },
    ]);
  });

  it('handles several matches and a highlight at the very start', () => {
    expect(parseSnippet(`${hl('А')} и ${hl('Б')}`)).toEqual([
      { text: 'А', hit: true },
      { text: ' и ', hit: false },
      { text: 'Б', hit: true },
    ]);
  });

  it('keeps HTML as text — it is never markup', () => {
    const parts = parseSnippet(`<script>alert(1)</script> ${hl('приказ')}`);
    expect(parts?.[0]).toEqual({ text: '<script>alert(1)</script> ', hit: false });
    expect(parts?.[1]).toEqual({ text: 'приказ', hit: true });
  });

  it('drops a half-open highlight instead of guessing where it ended', () => {
    // A fragment cut mid-highlight by MaxWords: keep the text, lose the marker.
    expect(parseSnippet(`конец ${SNIPPET_START}обрыв`)).toEqual([
      { text: 'конец обрыв', hit: false },
    ]);
  });

  it('is null when there is nothing to show', () => {
    expect(parseSnippet(null)).toBeNull();
    expect(parseSnippet('')).toBeNull();
  });

  it('returns plain text as one unhighlighted run', () => {
    expect(parseSnippet('без совпадений')).toEqual([{ text: 'без совпадений', hit: false }]);
  });
});
