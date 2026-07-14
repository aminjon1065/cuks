/**
 * Layer slug (docs/modules/10 §3). Layers are addressed by slug in the tile/WMS
 * surface and an imported layer's slug becomes a physical table name, so it has to
 * be ASCII — Russian and the six Tajik-specific letters are transliterated rather
 * than dropped (docs/04 §i18n: both languages are first class, identifiers are
 * English).
 */
const CYRILLIC: Record<string, string> = {
  а: 'a',
  б: 'b',
  в: 'v',
  г: 'g',
  ғ: 'gh',
  д: 'd',
  е: 'e',
  ё: 'e',
  ж: 'zh',
  з: 'z',
  и: 'i',
  ӣ: 'i',
  й: 'i',
  к: 'k',
  қ: 'q',
  л: 'l',
  м: 'm',
  н: 'n',
  о: 'o',
  п: 'p',
  р: 'r',
  с: 's',
  т: 't',
  у: 'u',
  ӯ: 'u',
  ф: 'f',
  х: 'h',
  ҳ: 'h',
  ц: 'c',
  ч: 'ch',
  ҷ: 'ch',
  ш: 'sh',
  щ: 'sch',
  ъ: '',
  ы: 'y',
  ь: '',
  э: 'e',
  ю: 'yu',
  я: 'ya',
};

export function slugify(title: string): string {
  const latin = [...title.toLowerCase()].map((ch) => CYRILLIC[ch] ?? ch).join('');
  const slug = latin
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return slug || 'layer';
}
