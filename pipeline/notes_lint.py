#!/usr/bin/env python3
"""檢查 data/notes.json 是否符合 docs/CLAUDE_DAILY.md 的寫作規則（2026-11-09 建立，參考破曉 Daybreak 的同名腳本）。
用法（在倉庫根目錄）：python3 pipeline/notes_lint.py   # 有問題會列出並以非零結束
檢查：必要欄位、頭條與摘要長度、「說重點」（每點最多 2 個數字、不寫「看錯／照舊走／找不到誰／看了一圈」）、不暗示持有（鐵則 4）。"""
import json, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HEAD_MAX, SUM_MAX = 60, 180
VAGUE = re.compile(r'看錯|照舊走|照舊在走|不一定照舊|找不到誰|找不到有誰|看了一圈|我找不到|我沒找到')
OWN = re.compile(r'持倉|我的部位|扣款|(?<!基金的)(?<!持股包括)持有(?!者)')
# 數字：去掉代號括號（2330）（NVDA）（LU0997587083）、日期 11/06、2026-11-06、年份、序號後再數
CODE = re.compile(r'（[0-9A-Z.]{2,14}）|\([0-9A-Z.]{2,14}\)')
DATE = re.compile(r'\d{4}-\d{2}-\d{2}|\d{1,2}/\d{1,2}|\d{4} ?年|\d{1,2} 月 ?\d{1,2} 日|\d{1,2}:\d{2}')
NUM = re.compile(r'[+\-−]?\d[\d,]*(?:\.\d+)?')
NAME = re.compile(r'\d+ ?日(?:均)?線|S&P ?500|那斯達克 ?100|台灣 ?50|0050|006208|0056|00878|00919|00929|00713|00679B|七巨頭|前十大')   # 名稱裡的數字不算數據
POINT_MAX = 2
REQ = ('date', 'slot', 'edition', 'written_utc', 'stance', 'headline', 'summary', 'modules', 'news', 'actions', 'changes')


def nums(s): return len(NUM.findall(NAME.sub('', DATE.sub('', CODE.sub('', s)))))


def walk(o, path=''):
    if isinstance(o, dict):
        for k, v in o.items(): yield from walk(v, f'{path}.{k}' if path else k)
    elif isinstance(o, list):
        for i, v in enumerate(o): yield from walk(v, f'{path}[{i}]')
    elif isinstance(o, str): yield path, o


KEEP = ('date', 'slot', 'edition', 'written_utc', 'tone', 'kind', 'dir', 'sym', 'value', 'weight', 'impact', 'module', 'url', 'time')
OWN_EN = re.compile(r'\b(my|our) (position|holding|portfolio)s?\b|\bwe (own|hold)\b', re.I)


def shape(a, b, path, out):
    """英文版和中文版的結構要一致：同樣的鍵、同樣長度的陣列、不翻的欄位原樣"""
    if isinstance(a, dict):
        if not isinstance(b, dict): out.append(f'en {path}：型別不同'); return
        for k in set(a) | set(b):
            if k not in b: out.append(f'en {path}.{k}：英文版缺這個欄位')
            elif k not in a: out.append(f'en {path}.{k}：中文版沒有這個欄位')
            elif k in KEEP and a[k] != b[k] and not isinstance(a[k], (dict, list)): out.append(f'en {path}.{k}：要和中文版一樣（{a[k]!r}）')
            else: shape(a[k], b[k], f'{path}.{k}' if path else k, out)
    elif isinstance(a, list):
        if not isinstance(b, list) or len(a) != len(b): out.append(f'en {path}：陣列長度要和中文版一樣'); return
        for i, (x, y) in enumerate(zip(a, b)): shape(x, y, f'{path}[{i}]', out)


def lint_en(n):
    """2026-11-15：英文版 data/notes.en.json（網站英文版讀這份）。沒有就提醒；日期不同代表忘了更新"""
    p = os.path.join(ROOT, 'data', 'notes.en.json')
    if not os.path.exists(p): return ['缺 data/notes.en.json（英文版判讀）']
    e = json.load(open(p)); out = []
    if (e.get('date'), e.get('slot')) != (n.get('date'), n.get('slot')): return [f'notes.en.json 是 {e.get("date")} {e.get("slot")}，中文版是 {n.get("date")} {n.get("slot")}：英文版要跟著更新']
    shape(n, e, '', out)
    if len(e.get('headline', '')) > 110: out.append(f'en headline {len(e["headline"])} 字元，上限 110（英文比中文長，頭條會佔滿一整個畫面）')
    for path, s in walk(e):
        if path.endswith(('.url', '.source')): continue
        if re.search(r'[\u4e00-\u9fff]', s): out.append(f'en {path}：還有中文')
        if OWN_EN.search(s): out.append(f'en {path}：不得暗示持有（「{OWN_EN.search(s).group(0)}」）')
    return out


def main():
    n = json.load(open(os.path.join(ROOT, 'data', 'notes.json')))
    bad = [f'缺欄位 {k}' for k in REQ if k not in n]
    if len(n.get('headline', '')) > HEAD_MAX: bad.append(f'頭條 {len(n["headline"])} 字，上限 {HEAD_MAX}')
    if len(n.get('summary', '')) > SUM_MAX: bad.append(f'摘要 {len(n["summary"])} 字，上限 {SUM_MAX}')
    for path, s in walk(n):
        if path.endswith(('.url', '.source', '.time', '.cat', '.date', '.written_utc', '.sym', '.slot')) or path in ('date', 'written_utc', 'slot'): continue
        if VAGUE.search(s): bad.append(f'{path}：寫成市場的事實，不寫「{VAGUE.search(s).group(0)}」')
        if OWN.search(s): bad.append(f'{path}：不得暗示持有（「{OWN.search(s).group(0)}」）')
        if re.search(r'\.points\[\d+\]$|\.flips\[\d+\]$|changes\[\d+\]\.say$', path) and nums(s) > POINT_MAX:
            bad.append(f'{path}：{nums(s)} 個數字，每點最多 {POINT_MAX} 個——留下撐結論的那一兩個')
    for path, s in walk({'headline': n.get('headline', ''), 'summary': n.get('summary', '')}):
        first = re.split(r'[。；]', s)[0]
        if nums(first) > POINT_MAX: bad.append(f'{path} 第一句 {nums(first)} 個數字，最多 {POINT_MAX} 個——先講判斷')
    for k, m in (n.get('modules') or {}).items():
        first = re.split(r'[。；]', m.get('lead', ''))[0]
        if nums(first) > POINT_MAX: bad.append(f'modules.{k}.lead 第一句 {nums(first)} 個數字，最多 {POINT_MAX} 個——lead 是結論不是數字清單')
    for k, f in (n.get('focus_items') or {}).items():
        first = re.split(r'[。；]', f.get('view', ''))[0]
        if nums(first) > POINT_MAX: bad.append(f'focus_items.{k}.view 第一句 {nums(first)} 個數字，最多 {POINT_MAX} 個')
    bad += lint_en(n)
    if bad:
        print(f'notes_lint：{len(bad)} 個問題'); [print(' -', b) for b in bad]; sys.exit(1)
    print('notes_lint：通過')


if __name__ == '__main__': main()
