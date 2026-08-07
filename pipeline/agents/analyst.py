"""Analyst Agent — อธิบายว่าสินทรัพย์แต่ละตัวน่าสนใจในระยะไหน เพราะอะไร

**หลักการที่ห้ามละเมิด**
1. AI ไม่คำนวณตัวเลขเอง — ตัวเลขทุกตัวมาจาก Python (factors/indicators/screener)
   แล้วป้อนเข้าไปเป็น context ป้องกันการแต่งตัวเลข (hallucination)
2. หนึ่ง call ต่อสินทรัพย์หนึ่งตัว ได้ผลครบทั้ง 4 ระยะ + คำอธิบายศัพท์
   (เดิมออกแบบเป็น 3 agents แยก แต่รวมเป็น call เดียวประหยัดกว่ามากและได้มุมมองที่สอดคล้องกัน)
3. ความรู้พื้นฐาน (framework.md ~24,000 ตัวอักษร) วางไว้ใน system block ที่ cache ไว้
   จ่ายเต็มราคาเฉพาะตัวแรก ตัวที่เหลืออ่านจาก cache (~10% ของราคาปกติ)

API key อ่านจาก ANTHROPIC_API_KEY เท่านั้น — ไม่มีการเขียนลงไฟล์หรือ log
"""

from __future__ import annotations

import json
import logging
import os
from datetime import datetime, timezone

from config import (AI_CACHE_FILE, AI_EFFORT, AI_MAX_TOKENS, AI_MODEL,
                    AI_PRICE_INPUT, AI_PRICE_OUTPUT, AI_REFRESH_DAYS,
                    FRAMEWORK_FILE, HORIZON_WEIGHTS, TOP_N_FOR_AI, USD_TO_THB)
from quant.screener import HORIZON_LABELS

log = logging.getLogger(__name__)

# ── โครงสร้างคำตอบที่บังคับให้ AI ตอบตามนี้เท่านั้น ────────────────────
# ใช้ structured outputs ของ API จึงไม่ต้องมีโค้ดแกะ JSON หรือ retry เมื่อ parse ไม่ผ่าน

_HORIZON_ITEM = {
    "type": "object",
    "properties": {
        "verdict": {
            "type": "string",
            "enum": ["น่าสนใจ", "เฝ้าดู", "ยังไม่เหมาะ"],
            "description": "ข้อสรุปสั้นที่สุดสำหรับระยะนี้",
        },
        "reason": {
            "type": "string",
            "description": (
                "เหตุผล 2-3 ประโยค อ้างอิงตัวเลขที่ให้มาเท่านั้น "
                "ใช้ภาษาที่คนไม่มีพื้นฐานการเงินอ่านเข้าใจ"
            ),
        },
    },
    "required": ["verdict", "reason"],
    "additionalProperties": False,
}

ANALYSIS_SCHEMA = {
    "type": "object",
    "properties": {
        "business": {
            "type": "string",
            "description": "บริษัท/สินทรัพย์นี้ทำอะไร หารายได้จากไหน 1-2 ประโยค ภาษาชาวบ้าน",
        },
        "summary": {
            "type": "string",
            "description": "ภาพรวม 3-4 ประโยค ว่าตอนนี้อยู่ในสถานะแบบไหน เหมาะกับใคร",
        },
        "horizons": {
            "type": "object",
            "properties": {
                "short": _HORIZON_ITEM,
                "mid": _HORIZON_ITEM,
                "long": _HORIZON_ITEM,
                "dividend": _HORIZON_ITEM,
            },
            "required": ["short", "mid", "long", "dividend"],
            "additionalProperties": False,
        },
        "risks": {
            "type": "array",
            "items": {"type": "string"},
            "description": "ความเสี่ยงที่เห็นได้จากตัวเลข 2-4 ข้อ ข้อละ 1 ประโยค",
        },
        "jargon": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "term": {"type": "string"},
                    "meaning": {"type": "string", "description": "อธิบาย 1 ประโยค"},
                },
                "required": ["term", "meaning"],
                "additionalProperties": False,
            },
            "description": "ศัพท์การเงินที่ใช้ในคำอธิบายข้างบน พร้อมความหมาย สูงสุด 5 คำ",
        },
    },
    "required": ["business", "summary", "horizons", "risks", "jargon"],
    "additionalProperties": False,
}

INSTRUCTION = """คุณคือนักวิเคราะห์การลงทุนที่อธิบายให้ "คนที่เพิ่งเริ่มศึกษาการลงทุน
และอ่านงบการเงินไม่เป็น" เข้าใจได้ โดยใช้กรอบความรู้ข้างบนเป็นเกณฑ์ตัดสิน

กฎที่ห้ามละเมิด
1. ห้ามคำนวณตัวเลขใหม่ ห้ามเดาตัวเลขที่ไม่ได้ให้มา ถ้าข้อมูลตัวไหนไม่มี ให้บอกตรงๆ
   ว่าไม่มีข้อมูล แล้วลดความมั่นใจของข้อสรุปนั้นลง
2. ห้ามพยากรณ์ราคาหรือให้เป้าหมายราคา ห้ามบอกว่า "ควรซื้อ/ควรขาย"
   หน้าที่คุณคืออธิบายว่าตัวเลขที่เห็นบอกอะไร ไม่ใช่สั่งให้ทำอะไร
3. คะแนน 0-100 ทุกตัวเป็นการเทียบอันดับ "ภายในกลุ่มเดียวกัน" (percentile)
   คะแนน 80 แปลว่าอยู่ท็อป 20% ของกลุ่มตัวเอง ไม่ได้แปลว่าดีกว่าสินทรัพย์นอกกลุ่ม
4. ถ้าตัวเลขขัดแย้งกันเอง ให้ชี้ให้เห็นความขัดแย้งนั้น อย่าเลือกข้างที่ดูดีอย่างเดียว

วิธีเขียน
- ภาษาไทย ประโยคสั้น ตรงไปตรงมา ไม่ต้องเกริ่นนำ
- ใช้ศัพท์การเงินได้ แต่ทุกคำที่ใช้ต้องใส่ไว้ใน jargon พร้อมคำอธิบาย
- ยึดความยาวตามที่ schema กำหนดอย่างเคร่งครัด อย่าเขียนเกิน"""


def _fmt_pct(value: float | None, digits: int = 2, signed: bool = True) -> str:
    """แปลงสัดส่วนทศนิยมเป็นข้อความเปอร์เซ็นต์ (0.0821 → '+8.21%')

    signed=False สำหรับค่าที่ไม่ใช่การเปลี่ยนแปลง เช่นอัตราปันผล — เครื่องหมาย +
    ทำให้อ่านเหมือนราคาขึ้น 8% ซึ่งคนละความหมายกับปันผล 8%
    """
    if value is None:
        return "ไม่มีข้อมูล"
    return f"{value * 100:{'+' if signed else ''}.{digits}f}%"


def _fmt(value, digits: int = 2, suffix: str = "") -> str:
    if value is None:
        return "ไม่มีข้อมูล"
    if isinstance(value, float):
        return f"{value:,.{digits}f}{suffix}"
    return f"{value:,}{suffix}" if isinstance(value, int) else f"{value}{suffix}"


def build_context(rec: dict) -> str:
    """เรียบเรียงตัวเลขที่ Python คำนวณแล้วให้ AI อ่าน

    ตั้งใจเขียนเป็นข้อความมีป้ายกำกับแทน JSON ดิบ เพราะโมเดลตีความหน่วยผิดน้อยกว่า
    (เช่น 0.0821 คือ 8.21% ไม่ใช่ 0.08%)
    """
    horizon_lines = []
    for key, label in HORIZON_LABELS.items():
        score = rec.get("horizon_scores", {}).get(key, {})
        weights = ", ".join(f"{k} {int(v * 100)}%" for k, v in HORIZON_WEIGHTS[key].items())
        if score.get("score") is None:
            horizon_lines.append(f"- {label}: ให้คะแนนไม่ได้ (ข้อมูลไม่พอ) | สูตร: {weights}")
        else:
            horizon_lines.append(
                f"- {label}: {score['score']} คะแนน "
                f"(คิดจากข้อมูล {int(score.get('confidence', 1) * 100)}% ของที่ควรมี) "
                f"| สูตร: {weights}"
            )

    return f"""## สินทรัพย์ที่ต้องวิเคราะห์
ชื่อ: {rec.get('name')} ({rec.get('symbol')})
ประเภท: {rec.get('asset_class')} | ตลาด: {rec.get('market')} | กลุ่มอุตสาหกรรม: {rec.get('sector') or 'ไม่ระบุ'}
กลุ่มที่ใช้เทียบคะแนน: {rec.get('peer_group')} ({rec.get('peer_count')} ตัว)
ความครบของข้อมูลพื้นฐาน: {rec.get('data_quality')}

## ราคาและผลตอบแทนที่ผ่านมา (คำนวณแล้ว ห้ามคำนวณซ้ำ)
ราคาล่าสุด: {_fmt(rec.get('price'))} {rec.get('currency') or ''}
1 สัปดาห์: {_fmt_pct(rec.get('ret_1w'))} | 1 เดือน: {_fmt_pct(rec.get('ret_1m'))}
3 เดือน: {_fmt_pct(rec.get('ret_3m'))} | 6 เดือน: {_fmt_pct(rec.get('ret_6m'))}
1 ปี: {_fmt_pct(rec.get('ret_1y'))}

## สัญญาณทางเทคนิค
แนวโน้ม: {rec.get('trend')} (ความแรง {_fmt(rec.get('trend_strength'))})
RSI: {_fmt(rec.get('rsi'), 1)}  [ต่ำกว่า 30 = ขายมากเกินไป, สูงกว่า 70 = ซื้อมากเกินไป]

## ข้อมูลพื้นฐาน
P/E: {_fmt(rec.get('trailing_pe'), 1)}
อัตราปันผล: {_fmt_pct(rec.get('dividend_yield'), signed=False)}
มูลค่าตลาด: {_fmt(rec.get('market_cap'), 0)}

## คะแนนปัจจัย (0-100 เทียบภายในกลุ่ม {rec.get('peer_group')} เท่านั้น)
ความถูกของราคา (value): {_fmt(rec.get('score_value'), 1)}
คุณภาพกิจการ (quality): {_fmt(rec.get('score_quality'), 1)}
โมเมนตัมราคา (momentum): {_fmt(rec.get('score_momentum'), 1)}
ปันผล (dividend): {_fmt(rec.get('score_dividend'), 1)}
เทคนิค (technical): {_fmt(rec.get('score_technical'), 1)}

## คะแนนรวมแต่ละระยะ
{chr(10).join(horizon_lines)}

วิเคราะห์สินทรัพย์ตัวนี้ตามกรอบและกฎที่กำหนด"""


def select_for_ai(records: list[dict], ranked: dict[str, list[dict]],
                  limit: int = TOP_N_FOR_AI) -> list[dict]:
    """เลือกสินทรัพย์ที่คุ้มค่าจะจ่ายเงินให้ AI วิเคราะห์

    เกณฑ์: ตัวที่ติดอันดับ Top 10 "หลายระยะพร้อมกัน" มาก่อน เพราะเป็นตัวที่
    ผู้ใช้มีโอกาสกดดูสูงสุดไม่ว่าจะเข้ามาจากแท็บไหน ถ้าเสมอกันใช้อันดับที่ดีที่สุด
    ที่เคยทำได้เป็นตัวตัดสิน
    """
    hits: dict[str, dict] = {}
    for items in ranked.values():
        for position, rec in enumerate(items):
            entry = hits.setdefault(
                rec["symbol"], {"rec": rec, "count": 0, "best": position}
            )
            entry["count"] += 1
            entry["best"] = min(entry["best"], position)

    ordered = sorted(hits.values(), key=lambda e: (-e["count"], e["best"]))
    return [e["rec"] for e in ordered[:limit]]


def _client():
    """สร้าง client — คืน None ถ้าไม่มี API key เพื่อให้ pipeline ทำงานต่อได้"""
    if not os.getenv("ANTHROPIC_API_KEY"):
        log.warning("ไม่พบ ANTHROPIC_API_KEY — ข้ามขั้นตอนวิเคราะห์ด้วย AI")
        return None
    import anthropic  # import ที่นี่เพื่อให้ pipeline รันได้แม้ยังไม่ติดตั้ง

    return anthropic.Anthropic()


def _system_blocks(framework: str) -> list[dict]:
    """system prompt สองก้อน: ความรู้ + คำสั่ง — cache ทั้งคู่ด้วยจุดเดียวที่ท้าย

    เรียงจาก "นิ่งที่สุด" ไปหา "เปลี่ยนบ่อยที่สุด" เพราะ cache เป็นการจับคู่จากต้น
    ถ้ามีอะไรเปลี่ยนกลางทาง ทุกอย่างหลังจากนั้นใช้ cache ไม่ได้
    """
    return [
        {"type": "text", "text": framework},
        {"type": "text", "text": INSTRUCTION, "cache_control": {"type": "ephemeral"}},
    ]


def _load_cache() -> tuple[dict[str, dict], datetime | None]:
    """อ่านบทวิเคราะห์รอบก่อน — คืน dict ว่างถ้าไฟล์เสียหรือยังไม่มี"""
    if not AI_CACHE_FILE.exists():
        return {}, None
    try:
        payload = json.loads(AI_CACHE_FILE.read_text(encoding="utf-8"))
        return payload.get("assets", {}), datetime.fromisoformat(payload["generated_at"])
    except (json.JSONDecodeError, KeyError, ValueError) as exc:
        log.warning("อ่าน %s ไม่สำเร็จ (%s) — จะวิเคราะห์ใหม่", AI_CACHE_FILE.name, exc)
        return {}, None


def _save_cache(assets: dict[str, dict], generated_at: datetime) -> None:
    AI_CACHE_FILE.write_text(
        json.dumps({"generated_at": generated_at.isoformat(), "assets": assets},
                   ensure_ascii=False, allow_nan=False),
        encoding="utf-8",
    )


def analyse(records: list[dict], ranked: dict[str, list[dict]]) -> dict:
    """วิเคราะห์สินทรัพย์อันดับต้นด้วย AI (หรือใช้ผลรอบก่อนถ้ายังไม่ถึงกำหนด)

    Returns:
        {"generated_at": iso | None, "assets": {symbol: ผลวิเคราะห์}}
        คืน assets ว่างได้เสมอ — pipeline ต้องทำงานต่อได้แม้ AI ล้มทั้งหมด
    """
    now = datetime.now(timezone.utc)
    cached, cached_at = _load_cache()

    # ยังไม่ถึงกำหนดวิเคราะห์ใหม่ → ใช้ของเดิม ไม่เสียค่า API
    if cached and cached_at and os.getenv("AI_FORCE") != "1":
        age_days = (now - cached_at).days
        if age_days < AI_REFRESH_DAYS:
            log.info("ใช้บทวิเคราะห์เดิมอายุ %d วัน (%d ตัว) — วิเคราะห์ใหม่ทุก %d วัน "
                     "หรือตั้ง AI_FORCE=1 เพื่อบังคับ",
                     age_days, len(cached), AI_REFRESH_DAYS)
            return {"generated_at": cached_at.isoformat(), "assets": cached}

    client = _client()
    if client is None:
        return {"generated_at": cached_at.isoformat() if cached_at else None,
                "assets": cached}

    if not FRAMEWORK_FILE.exists():
        log.warning("ไม่พบ %s — ข้ามขั้นตอนวิเคราะห์ด้วย AI", FRAMEWORK_FILE.name)
        return {"generated_at": None, "assets": {}}

    framework = FRAMEWORK_FILE.read_text(encoding="utf-8")
    system = _system_blocks(framework)
    targets = select_for_ai(records, ranked)
    log.info("ส่งให้ AI วิเคราะห์ %d ตัว (โมเดล %s)", len(targets), AI_MODEL)

    results: dict[str, dict] = {}
    # นับโทเคนแยกประเภทเพื่อรายงานค่าใช้จ่ายจริงหลังรันเสร็จ
    used = {"input": 0, "output": 0, "cache_write": 0, "cache_read": 0}

    for rec in targets:
        try:
            response = client.messages.create(
                model=AI_MODEL,
                max_tokens=AI_MAX_TOKENS,
                system=system,
                output_config={
                    "effort": AI_EFFORT,
                    "format": {"type": "json_schema", "schema": ANALYSIS_SCHEMA},
                },
                messages=[{"role": "user", "content": build_context(rec)}],
            )
        except Exception as exc:                       # noqa: BLE001
            log.warning("วิเคราะห์ %s ไม่สำเร็จ: %s", rec["symbol"], exc)
            continue

        # ต้องดู stop_reason ก่อนอ่าน content เสมอ — เมื่อถูกปฏิเสธ content จะว่าง
        if response.stop_reason == "refusal":
            log.warning("โมเดลปฏิเสธคำขอสำหรับ %s — ข้ามตัวนี้", rec["symbol"])
            continue

        text = next((b.text for b in response.content if b.type == "text"), None)
        if not text:
            log.warning("ไม่ได้คำตอบสำหรับ %s (stop_reason=%s)",
                        rec["symbol"], response.stop_reason)
            continue

        try:
            results[rec["symbol"]] = json.loads(text)
        except json.JSONDecodeError as exc:
            log.warning("คำตอบของ %s ไม่ใช่ JSON ที่ถูกต้อง: %s", rec["symbol"], exc)
            continue

        u = response.usage
        used["input"] += u.input_tokens or 0
        used["output"] += u.output_tokens or 0
        used["cache_write"] += getattr(u, "cache_creation_input_tokens", 0) or 0
        used["cache_read"] += getattr(u, "cache_read_input_tokens", 0) or 0

    # ตัวที่วิเคราะห์รอบนี้ไม่สำเร็จ ให้ใช้ของรอบก่อนไปก่อน ดีกว่าหน้าเว็บว่างเปล่า
    merged = {s: cached[s] for s in (t["symbol"] for t in targets) if s in cached}
    merged.update(results)

    if results:
        _save_cache(merged, now)

    # cache: เขียนคิด 1.25 เท่าของราคา input · อ่านคิด 0.1 เท่า
    cost = (used["input"] + used["cache_write"] * 1.25 + used["cache_read"] * 0.1) \
        / 1_000_000 * AI_PRICE_INPUT + used["output"] / 1_000_000 * AI_PRICE_OUTPUT
    saved = used["cache_read"] * 0.9 / 1_000_000 * AI_PRICE_INPUT

    log.info("AI วิเคราะห์สำเร็จ %d/%d ตัว | ใช้ผลเดิมเสริม %d ตัว",
             len(results), len(targets), len(merged) - len(results))
    log.info("โทเคน: ป้อนใหม่ %s · เขียน cache %s · อ่าน cache %s · ตอบกลับ %s",
             *(f"{used[k]:,}" for k in ("input", "cache_write", "cache_read", "output")))
    log.info("ค่าใช้จ่ายรอบนี้ ≈ %.2f บาท (ประหยัดจาก cache ไปได้ %.2f บาท) "
             "· วิเคราะห์ใหม่ทุก %d วัน ≈ %.0f บาท/เดือน",
             cost * USD_TO_THB, saved * USD_TO_THB, AI_REFRESH_DAYS,
             cost * USD_TO_THB * 30 / AI_REFRESH_DAYS)
    return {"generated_at": now.isoformat(), "assets": merged}
