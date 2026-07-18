# D1 — административное деление: кросс-волки (crosswalks)

Артефакты фазы **D1** плана интеграции данных (`docs/plan/DATA-INTEGRATION.md`). Переводят «грязные»
свободно-текстовые названия мест из исторических реестров ЧС (1988–2020, русский/таджикский/советские
названия, опечатки, префиксы, заграница-миграция) в **канонические административные единицы** — фундамент
геокодинга всех инцидентов (стратегия: джамоат → район → регион).

## Как это построено
Токены извлечены детерминированно из всех Excel-реестров (`Data For CUKS/Всякая статистика/Disaster+`):
**71 область, 617 районов, 85 джамоатов**. Сопоставление с каноном выполнено многоагентным workflow с
**состязательной проверкой каждого батча** + критиком полноты (33 агента), затем детерминированно
доведено и провалидировано (0 невалидных канонов, 100% покрытие).

Канон районов = **58 латинских `shapeName`** из geoBoundaries ADM2 (пиннированный релиз в `seed-geo.sh`) —
это и есть join-ключ с `gis.admin_units` после загрузки границ.

## Файлы
| Файл | Строк | Назначение |
|---|---|---|
| `district-names.csv` | 58 | `latin, name_ru, name_tg, aliases(pipe)` — официальные RU/TG названия районов + историч. алиасы (Rumi=Колхозобод, Bokhtar=Курган-Тюбе, Jirgatol=Лахш, Ghonchi=Деваштич, Sarband=Левакант…). Загрузчик обновляет `gis.admin_units.name_ru/name_tg`. |
| `district-aliases.csv` | 622 | `raw_token, kind, canonical_latin, targets(pipe), note`. `kind`: `district`/`city`/`zone`/`multi`/`region`/`national`/`foreign`/`unknown`. Пример: `Гарм→Rasht`, `ш. Хоруғ→city TJ-GB`, `Минтақаи Рашт→zone TJ-RA`, `ш. Москва→foreign Russia`. |
| `region-aliases.csv` | 71 | `raw_token, kind, targets(pipe), note` — области/провинции: `РРП/НТҶ→TJ-RA`, `ВМКБ→TJ-GB`, `РТ/ЧТ→national`, `ФР/Россия→foreign`. |
| `jamoat-aliases.csv` | 85 | `raw_token, parent_latin, confidence, note` — джамоаты → родительский район (best-effort; геометрии джамоатов пока нет, см. ниже). |
| `_review-districts.csv` | 28 | `foreign`/`national`/`unknown` токены — для ручной сверки (осознанно НЕ мапятся на единицу РТ). |

`kind`-значения: `district`/`city` → `canonical_latin` = один из 58; `multi` → `targets` = список районов
(трансграничные события); `zone`/`region` → `targets` = ISO региона; `foreign`/`national`/`unknown` →
на единицу РТ не резолвятся (по дизайну).

## Порядок загрузки (когда БД поднята)
```bash
# 1) границы: регионы (5) + районы (58). Джамоаты (ADM3) опциональны — их у geoBoundaries нет.
DATABASE_URL=postgres://cuks:***@localhost:5432/cuks ./infra/scripts/seed-geo.sh
# 2) RU/TG названия районов + кросс-волк → stg.admin_alias (идемпотентно)
pnpm --filter @cuks/db load:crosswalk
```
Результат: `gis.admin_units` (region+district с русскими именами) и `stg.admin_alias`
(raw_token → `admin_unit_id` + `region_iso`), готовый для геокодинга в D3.

## Известное ограничение — джамоаты (ADM3)
Пиннированный релиз geoBoundaries gbOpen **не публикует ADM3 для Таджикистана** (URL 404). Поэтому:
- `seed-geo.sh` грузит **регионы + районы**; ADM3 сделан опциональным (скрипт не падает).
- Геокодинг привязывает к **центроиду района** (деградируя до региона), пока не подключён источник
  геометрии джамоатов (gbHumanitarian / OCHA COD-AB / GADM). `jamoat-aliases.csv` уже готов — при появлении
  ADM3 джамоаты подхватятся автоматически, а привязка станет точнее.
