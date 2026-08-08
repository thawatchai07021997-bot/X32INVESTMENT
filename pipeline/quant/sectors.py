"""จัดกลุ่มสินทรัพย์เป็น "อุตสาหกรรม" และ "ธีม" พร้อมสรุปสถิติของกลุ่ม

สองแกนที่ต่างกันโดยตั้งใจ:
- **อุตสาหกรรม (sector)** มาจากการจัดประเภทของ yfinance แยกไทย/ต่างประเทศ
  เป็นข้อมูลจริง ตรวจสอบย้อนได้ ไม่มีการตีความของระบบ
- **ธีม (theme)** เป็นรายชื่อที่นิยามไว้เองใน config.THEMES เพราะบางแรงขับเคลื่อน
  กินหลายอุตสาหกรรมพร้อมกัน (AI ดันทั้งผู้ออกแบบชิปและผู้ผลิตแผงวงจร)

สถิติของกลุ่มใช้ **มัธยฐาน** ไม่ใช่ค่าเฉลี่ย เพราะกลุ่มหนึ่งมักมีหุ้นตัวเดียว
ที่วิ่ง 300% แล้วดึงค่าเฉลี่ยจนภาพรวมของกลุ่มผิดไปจากที่สมาชิกส่วนใหญ่เป็นจริง

ไฟล์นี้ไม่เรียก AI และไม่แตะเครือข่าย — คำนวณล้วน เพื่อให้ตัวเลขที่ส่งให้ AI
เป็นตัวเลขที่ Python คำนวณแล้วเสมอ (กฎข้อ 1 ของโปรเจกต์)
"""

from __future__ import annotations

import logging
from statistics import median

from config import SECTOR_MIN_MEMBERS, SECTOR_TOP_PICKS, THEMES

log = logging.getLogger(__name__)

# ชื่ออุตสาหกรรมภาษาไทย — yfinance คืนมาเป็นอังกฤษ
# เก็บไว้ที่นี่เพื่อให้ทั้งบทวิเคราะห์ของ AI และหน้าเว็บใช้ชื่อชุดเดียวกัน
SECTOR_TH = {
    "Technology": "เทคโนโลยี",
    "Financial Services": "การเงิน/ธนาคาร",
    "Healthcare": "การแพทย์",
    "Industrials": "อุตสาหกรรม",
    "Consumer Cyclical": "สินค้าฟุ่มเฟือย",
    "Consumer Defensive": "สินค้าจำเป็น",
    "Energy": "พลังงาน",
    "Utilities": "สาธารณูปโภค",
    "Real Estate": "อสังหาริมทรัพย์",
    "Communication Services": "สื่อสาร",
    "Basic Materials": "วัตถุดิบ",
}

REGION_LABELS = {"TH": "ในประเทศ", "FOREIGN": "ต่างประเทศ", "MIXED": "ไทย + ต่างประเทศ"}


def region_of(rec: dict) -> str:
    """ไทย vs ต่างประเทศ — ทองคำ (market=GLOBAL) นับเป็นต่างประเทศ
    เพราะราคาอ้างอิงตลาดโลกและมีความเสี่ยงค่าเงินเหมือนสินทรัพย์ต่างประเทศอื่น
    """
    return "TH" if rec.get("market") == "TH" else "FOREIGN"


def _med(values: list) -> float | None:
    """มัธยฐานของค่าที่เป็นตัวเลขจริง — คืน None เมื่อไม่มีข้อมูลเลย"""
    nums = [float(v) for v in values if isinstance(v, (int, float))]
    return round(median(nums), 4) if nums else None


def _pick_field(members: list[dict], field: str) -> list:
    return [m.get(field) for m in members]


def _horizon(rec: dict, key: str) -> float:
    return (rec.get("horizon_scores", {}).get(key) or {}).get("score") or 0.0


def _mid_long_score(rec: dict) -> float:
    """คะแนนที่ใช้เรียง "หุ้นเด่นของกลุ่ม"

    เฉลี่ยระยะกลางกับระยะยาว เพราะผู้ใช้อ่านหน้านี้เพื่อดูแนวโน้มระยะกลาง-ยาว
    ไม่ใช่หาจังหวะเข้าซื้อรายสัปดาห์ (ระยะสั้นจึงไม่มีน้ำหนักเลย)
    """
    return round((_horizon(rec, "mid") + _horizon(rec, "long")) / 2, 1)


def group_stats(members: list[dict]) -> dict:
    """สถิติสรุปของกลุ่มหนึ่ง — ตัวเลขทุกตัวที่ AI จะได้เห็นมาจากที่นี่"""
    uptrend = sum(1 for m in members if m.get("trend") == "uptrend")
    currencies = {m.get("currency") for m in members if m.get("currency")}

    # รวมมูลค่าตลาดได้เฉพาะเมื่อทุกตัวใช้สกุลเงินเดียวกัน
    # กลุ่มธีมที่มีทั้งหุ้นไทยและสหรัฐฯ บวกกันตรงๆ จะได้ตัวเลขที่ไม่มีความหมาย
    caps = [m.get("market_cap") for m in members if isinstance(m.get("market_cap"), (int, float))]
    total_cap = round(sum(caps), 0) if (len(currencies) == 1 and caps) else None

    return {
        "count": len(members),
        "uptrend_count": uptrend,
        "uptrend_pct": round(uptrend / len(members) * 100, 1) if members else 0.0,
        "currency": next(iter(currencies)) if len(currencies) == 1 else None,
        "total_market_cap": total_cap,
        "median_ret_1m": _med(_pick_field(members, "ret_1m")),
        "median_ret_3m": _med(_pick_field(members, "ret_3m")),
        "median_ret_6m": _med(_pick_field(members, "ret_6m")),
        "median_ret_1y": _med(_pick_field(members, "ret_1y")),
        "median_pe": _med(_pick_field(members, "trailing_pe")),
        "median_dividend_yield": _med(_pick_field(members, "dividend_yield")),
        "median_score_value": _med(_pick_field(members, "score_value")),
        "median_score_quality": _med(_pick_field(members, "score_quality")),
        "median_score_momentum": _med(_pick_field(members, "score_momentum")),
        "median_score_dividend": _med(_pick_field(members, "score_dividend")),
        "median_mid_long": _med([_mid_long_score(m) for m in members]),
    }


def top_picks(members: list[dict], limit: int = SECTOR_TOP_PICKS) -> list[dict]:
    """หุ้นเด่นของกลุ่ม พร้อมตัวเลขที่ใช้ตัดสินว่าทำไมถึงเด่น

    ส่งตัวเลขไปกับชื่อด้วยเสมอ เพื่อให้ AI เขียน "เด่นเพราะอะไร" จากข้อมูลจริง
    ไม่ใช่จากความจำของโมเดลเกี่ยวกับบริษัทนั้น
    """
    ordered = sorted(members, key=_mid_long_score, reverse=True)[:limit]
    return [{
        "symbol": m.get("symbol"),
        "name": m.get("name"),
        "market": m.get("market"),
        "sector": m.get("sector") or "",
        "price": m.get("price"),
        "currency": m.get("currency"),
        "mid_long_score": _mid_long_score(m),
        "score_value": m.get("score_value"),
        "score_quality": m.get("score_quality"),
        "score_momentum": m.get("score_momentum"),
        "score_dividend": m.get("score_dividend"),
        "trailing_pe": m.get("trailing_pe"),
        "dividend_yield": m.get("dividend_yield"),
        "ret_6m": m.get("ret_6m"),
        "ret_1y": m.get("ret_1y"),
        "trend": m.get("trend"),
        "data_quality": m.get("data_quality"),
    } for m in ordered]


def build_sector_groups(records: list[dict]) -> list[dict]:
    """กลุ่มตามอุตสาหกรรมจริง แยกไทย/ต่างประเทศ

    ETF และทองไม่มี sector จึงไม่เข้ากลุ่มใดเลย — ตั้งใจ เพราะ "อุตสาหกรรม"
    ของตะกร้าหุ้นทั้งตะกร้าไม่ใช่ข้อมูลที่ yfinance ให้มา การเดาแทนจะทำให้
    ตัวเลขมัธยฐานของกลุ่มเพี้ยน
    """
    buckets: dict[tuple[str, str], list[dict]] = {}
    for rec in records:
        sector = (rec.get("sector") or "").strip()
        if not sector:
            continue
        buckets.setdefault((region_of(rec), sector), []).append(rec)

    groups = []
    for (region, sector), members in buckets.items():
        if len(members) < SECTOR_MIN_MEMBERS:
            log.debug("ข้ามกลุ่ม %s/%s — มีแค่ %d ตัว", region, sector, len(members))
            continue
        groups.append({
            "id": f"sector:{region}:{sector}",
            "kind": "sector",
            "region": region,
            "region_label": REGION_LABELS[region],
            "sector": sector,
            "label": SECTOR_TH.get(sector, sector),
            "rationale": "",
            "members": [m["symbol"] for m in members],
            "stats": group_stats(members),
            "top": top_picks(members),
        })

    # เรียงตามขนาดกลุ่ม — กลุ่มใหญ่คือกลุ่มที่ผู้ใช้มีโอกาสถือหุ้นอยู่แล้วมากที่สุด
    groups.sort(key=lambda g: (g["region"] != "TH", -g["stats"]["count"]))
    return groups


def build_theme_groups(records: list[dict]) -> list[dict]:
    """กลุ่มตามธีมที่นิยามไว้ใน config.THEMES

    ตรวจรายชื่อกับ universe จริงทุกครั้ง — สัญลักษณ์ที่หาไม่เจอจะถูกตัดทิ้ง
    พร้อม log เตือน กันไม่ให้ธีมกลายเป็นรายชื่อผีเงียบๆ เมื่อ universe เปลี่ยน
    """
    by_symbol = {r["symbol"]: r for r in records}
    groups = []

    for theme in THEMES:
        wanted = list(theme.get("th", [])) + list(theme.get("foreign", []))
        members = [by_symbol[s] for s in wanted if s in by_symbol]
        missing = [s for s in wanted if s not in by_symbol]
        if missing:
            log.warning("ธีม '%s' มีสัญลักษณ์ที่ไม่อยู่ใน universe: %s",
                        theme["label"], ", ".join(missing))
        if len(members) < SECTOR_MIN_MEMBERS:
            log.warning("ธีม '%s' เหลือสมาชิกแค่ %d ตัว — ข้าม",
                        theme["label"], len(members))
            continue

        regions = {region_of(m) for m in members}
        region = regions.pop() if len(regions) == 1 else "MIXED"
        groups.append({
            "id": f"theme:{theme['id']}",
            "kind": "theme",
            "region": region,
            "region_label": REGION_LABELS[region],
            "sector": "",
            "label": theme["label"],
            "rationale": theme["rationale"],
            "members": [m["symbol"] for m in members],
            "members_th": [m["symbol"] for m in members if region_of(m) == "TH"],
            "members_foreign": [m["symbol"] for m in members if region_of(m) != "TH"],
            "stats": group_stats(members),
            "top": top_picks(members),
        })
    return groups


def build_all(records: list[dict]) -> list[dict]:
    """ทุกกลุ่มที่ระบบรู้จัก — อุตสาหกรรมก่อน แล้วตามด้วยธีม"""
    groups = build_sector_groups(records) + build_theme_groups(records)
    log.info("จัดกลุ่มได้ %d กลุ่ม (อุตสาหกรรม %d · ธีม %d)",
             len(groups),
             sum(1 for g in groups if g["kind"] == "sector"),
             sum(1 for g in groups if g["kind"] == "theme"))
    return groups
