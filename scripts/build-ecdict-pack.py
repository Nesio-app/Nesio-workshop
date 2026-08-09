#!/usr/bin/env python3
"""
从 ECDICT sqlite(stardict.db) 导出 Nesio 离线词库分片。

源: https://github.com/skywind3000/ECDICT (与欧路/Eudic 兼容的开源英汉库)
用法:
  python3 scripts/build-ecdict-pack.py /path/to/stardict.db
默认输出: public/data/dictionary/{a-z,_}.json.gz + zh.json.gz + meta.json
"""

from __future__ import annotations

import argparse
import collections
import gzip
import json
import re
import sqlite3
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT_DEFAULT = ROOT / "public" / "data" / "dictionary"

# 收词:小写英文词/带连字符/撇号;目标几十万级
WORD_RE = re.compile(r"^[a-z][a-z0-9'./-]{0,39}$")
# 专名/缩写也收一部分(首字母大写但全字母)
WORD_RE_CAP = re.compile(r"^[A-Za-z][A-Za-z0-9'./-]{0,39}$")
ZH_RE = re.compile(r"[\u4e00-\u9fff]{2,8}")


def score(frq, bnc, oxford, collins, tag, wl: str) -> int:
    """越小越优先。有语料/考试标注的词压在最前;其余按词长短补齐(保证字母分布)。"""
    ranks = [x for x in (frq, bnc) if isinstance(x, int) and x > 0]
    if ranks or oxford or collins or (tag and str(tag).strip()):
        best = min(ranks) if ranks else 50_000
        if oxford:
            best -= 8_000
        if collins:
            best -= 5_000
        if tag and str(tag).strip():
            best -= 3_000
        return max(0, best)
    # 无词频:短词优先,并掺一点首字母打散,避免 a/b/c 占满额度
    return 1_000_000 + len(wl) * 100 + (sum(ord(c) for c in wl[:4]) % 97)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("db", type=Path, help="ECDICT stardict.db path")
    ap.add_argument("--out", type=Path, default=OUT_DEFAULT)
    ap.add_argument("--cap", type=int, default=400_000, help="max entries")
    args = ap.parse_args()
    if not args.db.is_file():
        print("missing db", args.db, file=sys.stderr)
        return 1

    out: Path = args.out
    out.mkdir(parents=True, exist_ok=True)
    for p in out.iterdir():
        if p.is_file():
            p.unlink()

    conn = sqlite3.connect(str(args.db))
    cur = conn.cursor()
    cur.execute(
        """
        SELECT word, phonetic, translation, frq, bnc, oxford, collins, tag
        FROM stardict
        WHERE translation IS NOT NULL AND translation != ''
        """
    )

    rows: list[tuple[int, str, str, str, str]] = []
    seen: set[str] = set()
    t0 = time.time()
    scanned = 0
    for word, phonetic, translation, frq, bnc, oxford, collins, tag in cur:
        scanned += 1
        if not word:
            continue
        w = word.strip()
        wl = w.lower()
        if wl in seen:
            continue
        # 优先收小写词形;大写专名仅在有词频/标签时收
        if WORD_RE.match(wl):
            pass
        elif WORD_RE_CAP.match(w) and (
            (isinstance(frq, int) and 0 < frq <= 200_000)
            or (isinstance(bnc, int) and 0 < bnc <= 200_000)
            or oxford
            or collins
            or (tag and str(tag).strip())
        ):
            pass
        else:
            continue
        seen.add(wl)
        t = (translation or "").strip().replace("\r", "")
        if len(t) > 240:
            t = t[:237] + "…"
        p = (phonetic or "").strip()
        if len(p) > 40:
            p = p[:40]
        rows.append((score(frq, bnc, oxford, collins, tag, wl), wl, wl, p, t))
        if len(rows) % 200_000 == 0:
            print(f"kept {len(rows)} scanned {scanned} t={time.time()-t0:.1f}s", flush=True)

    print(f"total kept before cap {len(rows)} scanned {scanned} t={time.time()-t0:.1f}s", flush=True)
    rows.sort(key=lambda r: (r[0], r[1]))
    rows = rows[: args.cap]
    print(f"capped {len(rows)}", flush=True)

    shards: dict[str, list[list[str]]] = collections.defaultdict(list)
    zh_map: dict[str, list[str]] = collections.defaultdict(list)
    for _sc, wl, w, p, t in rows:
        key = wl[0] if wl[0].isalpha() else "_"
        shards[key].append([w, p, t])
        for m in ZH_RE.findall(t)[:3]:
            arr = zh_map[m]
            if wl not in arr and len(arr) < 6:
                arr.append(wl)

    meta = {
        "source": "ECDICT (skywind3000) — 简明英汉字典增强版, Eudic/欧路兼容开源库",
        "license": "https://github.com/skywind3000/ECDICT",
        "version": f"1.0.28-pack{len(rows)}",
        "count": len(rows),
        "shards": sorted(shards.keys()),
        "note": "Frequency-ranked offline subset for Nesio; full ECDICT ≈ 3.4M entries.",
    }
    (out / "meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")

    total = 0
    for k, items in sorted(shards.items()):
        items.sort(key=lambda x: x[0].lower())
        raw = json.dumps(items, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        gz = gzip.compress(raw, compresslevel=9)
        (out / f"{k}.json.gz").write_bytes(gz)
        total += len(gz)
        print(f"shard {k}: {len(items)} → {len(gz)//1024}KB", flush=True)

    # 中文反查索引(控体积)
    zh_items = sorted(zh_map.items(), key=lambda kv: (-len(kv[1]), kv[0]))[:120_000]
    zh_obj = {k: v for k, v in zh_items}
    zh_gz = gzip.compress(
        json.dumps(zh_obj, ensure_ascii=False, separators=(",", ":")).encode("utf-8"),
        compresslevel=9,
    )
    (out / "zh.json.gz").write_bytes(zh_gz)
    print(f"zh keys {len(zh_obj)} → {len(zh_gz)//1024}KB", flush=True)
    print(f"TOTAL {(total + len(zh_gz))//1024}KB entries {len(rows)}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
