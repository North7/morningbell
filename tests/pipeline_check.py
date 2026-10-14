#!/usr/bin/env python3
"""資料管線檢查（2026-10-14）：update.py、backfill.py 用到的每個 sources.S.xxx 都必須存在。
起因：10-14 改 Yahoo 抓取時誤刪了證交所的函式，本機只測美股（--skip-tw）沒發現，台股、美股、基金連續一天沒更新。"""
import os, re, sys
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'pipeline'))
import sources as S
bad = []
for f in ('update.py', 'backfill.py', 'build.py'):
    for name in sorted(set(re.findall(r'\bS\.([A-Za-z_]\w*)', open(os.path.join(ROOT, 'pipeline', f)).read()))):
        if not hasattr(S, name): bad.append(f'{f}: S.{name}')
print('\n'.join(bad) if bad else '資料管線函式齊全')
sys.exit(1 if bad else 0)
