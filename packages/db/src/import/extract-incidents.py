#!/usr/bin/env python3
"""
D3 extractor (docs/plan/DATA-INTEGRATION.md §D3) — read the historical КЧС
Excel registries and emit a clean, deduplicated CSV that load-incidents.ts stages.

The source workbooks live OUTSIDE the repo (they are raw КЧС data). Point SRC at
the "Disaster+" folder. Output → ../data/d3-incidents/stg-incidents.csv.

  SRC="/path/to/Data For CUKS/Всякая статистика/Disaster+" python3 extract-incidents.py

Deps: openpyxl, xlrd  (pip install openpyxl xlrd). Deterministic: no network, no DB.
The standalone "Disaster 2018 .xlsx" is intentionally excluded — it duplicates the
2018 sheet of "Disaster 2017- 2018.xlsx".
"""
import os, re, csv, collections, warnings
warnings.filterwarnings("ignore")
import openpyxl, xlrd

SRC = os.environ.get("SRC", os.path.expanduser(
    "~/Desktop/Data For CUKS/Всякая статистика/Disaster+"))
OUT = os.path.join(os.path.dirname(__file__), "..", "data", "d3-incidents", "stg-incidents.csv")
FILES = ["Disaster 1992-2016.xls", "Disaster 2017- 2018.xlsx", "Disaster 2019 .xlsx",
         "Disaster 2020.xls.xlsx"]

RX = {'type': r'DISASTER|ОФАТХО', 'prov': r'PROVINCE|ВИЛОЯТ', 'dist': r'DISTRICT|НОХИЯ|НОҲИЯ',
      'jam': r'ЧАМОАТ|ҶАМОАТ|JAMOAT', 'year': r'YEAR|СОЛ', 'mon': r'Month|МОХ|МОҲ|мох',
      'day': r'Days|САНА', 'desc': r'НАМУДИ ХОДИСА|TYPE OF DAMAGE|ХОЛАТ',
      'dead': r'^фавтида|погиб', 'injured': r'Чарохат|ярохат|ранен',
      'rescued': r'начотёфта|Начотёфта', 'affected': r'POPULATION AFF|ахол', 'damage': r'DAMAGE SUM'}


def sheets(path):
    if path.lower().endswith('.xlsx'):
        wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
        for ws in wb.worksheets:
            yield ws.title, [list(r) for r in ws.iter_rows(values_only=True)]
        wb.close()
    else:
        wb = xlrd.open_workbook(path)
        for ws in wb.sheets():
            yield ws.name, [[ws.cell_value(ri, ci) for ci in range(ws.ncols)] for ri in range(ws.nrows)]


def norm(v):
    return re.sub(r'\s+', ' ', str(v)).strip() if v not in (None, '') else ''


def to_int(v):
    s = norm(v)
    m = re.match(r'^\s*(\d+)', s.replace('.0', '')) if s else None
    return m.group(1) if m else ''


def to_num(v):
    s = norm(v).replace(' ', '').replace(',', '.')
    return s if re.match(r'^\d+(\.\d+)?$', s) else ''


def yr(v):
    try:
        n = int(float(norm(v)))
        return n if 1980 < n < 2030 else ''
    except Exception:
        return ''


def mn(v):
    try:
        n = int(float(norm(v)))
        return n if 1 <= n <= 12 else ''
    except Exception:
        return ''


def dy(v):
    m = re.match(r'^\s*(\d{1,2})', norm(v))  # first day of a "25-26" range
    if m:
        n = int(m.group(1))
        return n if 1 <= n <= 31 else ''
    return ''


def main():
    out, seen, dups = [], set(), 0
    for fname in FILES:
        path = os.path.join(SRC, fname)
        for sh, rows in sheets(path):
            hr = next((ri for ri, row in enumerate(rows[:5])
                       if any(re.search(RX['type'], norm(c), re.I) for c in row)), None)
            if hr is None:
                continue
            H = [norm(c) for c in rows[hr]]
            col = {k: next((i for i, h in enumerate(H) if re.search(rx, h, re.I)), None)
                   for k, rx in RX.items()}

            def g(row, k):
                i = col[k]
                return norm(row[i]) if i is not None and i < len(row) else ''

            def gi(row, k, conv):
                i = col[k]
                return conv(row[i]) if i is not None and i < len(row) else ''

            for ri, row in enumerate(rows[hr + 1:], start=hr + 2):
                tt = g(row, 'type')
                y = gi(row, 'year', yr)
                if not tt and not y:
                    continue
                dist, desc = g(row, 'dist'), g(row, 'desc')
                key = (y, gi(row, 'mon', mn), gi(row, 'day', dy),
                       dist.lower(), tt.lower(), desc[:40].lower())
                if key in seen:
                    dups += 1
                    continue
                seen.add(key)
                damage_hdr = H[col['desc']] if col['desc'] is not None else ''
                out.append({
                    'source_file': fname, 'source_sheet': sh, 'source_row': ri,
                    'year': y, 'month': gi(row, 'mon', mn), 'day': gi(row, 'day', dy),
                    'type_token': tt, 'prov_token': g(row, 'prov'), 'dist_token': dist,
                    'jam_token': g(row, 'jam'),
                    'dead': gi(row, 'dead', to_int), 'injured': gi(row, 'injured', to_int),
                    'rescued': gi(row, 'rescued', to_int), 'affected_text': g(row, 'affected'),
                    'damage_sum': gi(row, 'damage', to_num),
                    'damage_text': desc if 'DAMAGE' in damage_hdr else '',
                    'description': desc,
                })

    cols = ['source_file', 'source_sheet', 'source_row', 'year', 'month', 'day', 'type_token',
            'prov_token', 'dist_token', 'jam_token', 'dead', 'injured', 'rescued',
            'affected_text', 'damage_sum', 'damage_text', 'description']
    with open(OUT, 'w', newline='', encoding='utf-8') as fh:
        w = csv.DictWriter(fh, fieldnames=cols)
        w.writeheader()
        w.writerows(out)
    by_file = dict(collections.Counter(r['source_file'] for r in out))
    print(f"extracted {len(out)} incidents ({dups} intra-dup removed) -> {OUT}")
    print("per source_file:", by_file)


if __name__ == "__main__":
    main()
