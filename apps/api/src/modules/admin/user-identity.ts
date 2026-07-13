import { randomBytes } from 'node:crypto';

/** Russian → Latin transliteration for generating usernames (docs/16 §1). */
const TRANSLIT: Record<string, string> = {
  а: 'a',
  б: 'b',
  в: 'v',
  г: 'g',
  д: 'd',
  е: 'e',
  ё: 'e',
  ж: 'zh',
  з: 'z',
  и: 'i',
  й: 'i',
  к: 'k',
  л: 'l',
  м: 'm',
  н: 'n',
  о: 'o',
  п: 'p',
  р: 'r',
  с: 's',
  т: 't',
  у: 'u',
  ф: 'f',
  х: 'kh',
  ц: 'ts',
  ч: 'ch',
  ш: 'sh',
  щ: 'shch',
  ъ: '',
  ы: 'y',
  ь: '',
  э: 'e',
  ю: 'yu',
  я: 'ya',
};

export function transliterate(input: string): string {
  return input
    .toLowerCase()
    .split('')
    .map((ch) => TRANSLIT[ch] ?? ch)
    .join('')
    .replace(/[^a-z0-9]+/g, '');
}

/** "Иванов Пётр Сергеевич" → "П.С. Иванов" (И.О. Фамилия, docs/07). */
export function shortNameFromFullName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return fullName.trim();
  const [surname, ...rest] = parts;
  const initials = rest.map((p) => `${p[0]?.toUpperCase() ?? ''}.`).join('');
  return initials ? `${initials} ${surname}` : (surname ?? fullName.trim());
}

/** Username stem from a full name: `<surname>.<first-initial>` transliterated. */
export function usernameBase(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  const surname = transliterate(parts[0] ?? '');
  const firstInitial = parts[1] ? transliterate(parts[1]).slice(0, 1) : '';
  const base = firstInitial ? `${surname}.${firstInitial}` : surname;
  return base || 'user';
}

/** Strong, one-time temporary password (docs/16 §1 — shown once on create/reset). */
export function generateTempPassword(): string {
  return randomBytes(12).toString('base64url');
}
