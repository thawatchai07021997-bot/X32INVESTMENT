"""การคัดกรองและจัดอันดับสินทรัพย์ตามระยะการลงทุน

รวมคะแนนปัจจัยพื้นฐาน (factors.py) กับคะแนนเทคนิค (indicators.py)
เป็นคะแนนรวมของแต่ละระยะ: สั้น / กลาง / ยาว / ปันผล

**หลักการสำคัญ:** ถ้าข้อมูลบางส่วนขาด จะเฉลี่ยเฉพาะส่วนที่มี แล้วบันทึกไว้ว่า
คิดจากน้ำหนักเท่าไรของทั้งหมด (`confidence`) แทนการเดาค่าที่ขาดเป็น 0
ซึ่งจะลงโทษหุ้นที่แค่ "ไม่มีข้อมูล" ให้ดูแย่กว่าความจริง
"""

from __future__ import annotations

import logging

from config import (HORIZON_WEIGHTS, MIN_DIVIDEND_YIELD_FOR_RANK,
                    TARGET_ANNUAL_RETURN, TOP_N_PER_HORIZON)

log = logging.getLogger(__name__)

HORIZON_LABELS = {
    "short": "ระยะสั้น (1–3 เดือน)",
    "mid": "ระยะกลาง (6–18 เดือน)",
    "long": "ระยะยาว (3 ปีขึ้นไป)",
    "dividend": "เน้นปันผล",
}

# ต้องมีน้ำหนักข้อมูลอย่างน้อยเท่านี้ถึงจะจัดอันดับได้อย่างมีความหมาย
MIN_CONFIDENCE = 0.5


def compute_horizon_scores(rec: dict) -> None:
    """คำนวณคะแนนของทุกระยะให้สินทรัพย์หนึ่งตัว (แก้ dict ในตัว)

    เพิ่ม key: horizon_scores = {horizon: {"score": float, "confidence": float}}
    """
    scores: dict[str, dict] = {}

    for horizon, weights in HORIZON_WEIGHTS.items():
        total_weight = 0.0
        weighted_sum = 0.0

        for component, weight in weights.items():
            value = rec.get(f"score_{component}")
            if value is None:
                continue
            weighted_sum += float(value) * weight
            total_weight += weight

        if total_weight == 0:
            scores[horizon] = {"score": None, "confidence": 0.0}
            continue

        # เฉลี่ยเฉพาะน้ำหนักที่มีข้อมูลจริง
        score = weighted_sum / total_weight
        confidence = total_weight / sum(weights.values())
        scores[horizon] = {
            "score": round(score, 1),
            "confidence": round(confidence, 2),
        }

    rec["horizon_scores"] = scores


def qualifies(rec: dict, horizon: str) -> bool:
    """ผ่านเงื่อนไขขั้นต่ำของระยะนั้นหรือไม่ (นอกเหนือจากการมีคะแนน)

    ตอนนี้มีเงื่อนไขเดียว: ระยะ "เน้นปันผล" ต้องจ่ายปันผลจริงถึงเกณฑ์
    ดูเหตุผลที่ MIN_DIVIDEND_YIELD_FOR_RANK ใน config.py

    **หมายเหตุ:** หน้า Dashboard จัดอันดับซ้ำเองเมื่อผู้ใช้กรองตามกลุ่ม
    เงื่อนไขที่เพิ่มที่นี่ต้องส่งค่าไปให้เว็บผ่าน dashboard.json ด้วยเสมอ
    """
    if horizon != "dividend":
        return True
    dy = rec.get("dividend_yield")
    return dy is not None and dy >= MIN_DIVIDEND_YIELD_FOR_RANK


def rank_by_horizon(records: list[dict],
                    top_n: int = TOP_N_PER_HORIZON) -> dict[str, list[dict]]:
    """จัดอันดับสินทรัพย์แยกตามระยะการลงทุน

    Returns:
        dict horizon → list ของสินทรัพย์ที่ได้คะแนนสูงสุด เรียงจากมากไปน้อย
    """
    ranked: dict[str, list[dict]] = {}

    for horizon in HORIZON_WEIGHTS:
        eligible = [
            r for r in records
            if (r.get("horizon_scores", {}).get(horizon, {}).get("score") is not None
                and r["horizon_scores"][horizon]["confidence"] >= MIN_CONFIDENCE
                and qualifies(r, horizon))
        ]
        eligible.sort(
            key=lambda r: r["horizon_scores"][horizon]["score"], reverse=True
        )
        ranked[horizon] = eligible[:top_n]
        log.info("จัดอันดับ %s: มีสิทธิ์ %d ตัว เลือก %d ตัว",
                 horizon, len(eligible), len(ranked[horizon]))

    return ranked


def movers(records: list[dict], n: int = 8) -> dict[str, list[dict]]:
    """หาสินทรัพย์ที่เคลื่อนไหวโดดเด่นในรอบสัปดาห์ — ใช้แสดงบน Dashboard"""
    with_return = [r for r in records if r.get("ret_1w") is not None]
    by_week = sorted(with_return, key=lambda r: r["ret_1w"], reverse=True)
    return {
        "gainers": by_week[:n],
        "losers": by_week[-n:][::-1],
    }


def meets_target(rec: dict) -> bool:
    """ผ่านเกณฑ์ผลตอบแทนเป้าหมายหรือไม่ (ดูจากผลย้อนหลัง 1 ปี)

    **ย้ำ:** นี่คือการดูผลที่ *ผ่านมาแล้ว* ไม่ใช่การพยากรณ์อนาคต
    ใช้เป็นตัวกรองเบื้องต้นเท่านั้น
    """
    ret = rec.get("ret_1y")
    return ret is not None and ret >= TARGET_ANNUAL_RETURN


def summarise(records: list[dict]) -> dict:
    """สรุปภาพรวมของทั้ง universe สำหรับแสดงบนหัว Dashboard"""
    total = len(records)
    hit_target = sum(1 for r in records if meets_target(r))
    uptrend = sum(1 for r in records if r.get("trend") == "uptrend")
    full_data = sum(1 for r in records if r.get("data_quality") == "full")

    return {
        "total_assets": total,
        "meets_target_1y": hit_target,
        "meets_target_pct": round(hit_target / total * 100, 1) if total else 0.0,
        "uptrend_count": uptrend,
        "uptrend_pct": round(uptrend / total * 100, 1) if total else 0.0,
        "full_fundamental_data": full_data,
        "target_threshold": TARGET_ANNUAL_RETURN,
    }
