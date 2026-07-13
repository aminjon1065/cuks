import { describe, expect, it } from 'vitest';
import {
  generateTempPassword,
  shortNameFromFullName,
  transliterate,
  usernameBase,
} from './user-identity';

describe('user-identity', () => {
  it('transliterates Russian to a clean latin slug', () => {
    expect(transliterate('Щукин')).toBe('shchukin');
    expect(transliterate('Пётр')).toBe('petr');
  });

  it('builds "И.О. Фамилия" short names', () => {
    expect(shortNameFromFullName('Иванов Пётр Сергеевич')).toBe('П.С. Иванов');
    expect(shortNameFromFullName('Иванов')).toBe('Иванов');
  });

  it('builds a username stem from surname + first initial', () => {
    expect(usernameBase('Иванов Пётр Сергеевич')).toBe('ivanov.p');
    expect(usernameBase('Каримова Дилноза')).toBe('karimova.d');
  });

  it('generates a non-empty temp password each time', () => {
    const a = generateTempPassword();
    const b = generateTempPassword();
    expect(a.length).toBeGreaterThanOrEqual(12);
    expect(a).not.toBe(b);
  });
});
