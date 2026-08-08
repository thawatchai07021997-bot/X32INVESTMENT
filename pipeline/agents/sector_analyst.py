"""Sector Analyst — บทวิเคราะห์แนวโน้มระยะกลาง-ยาวรายอุตสาหกรรมและรายธีม

ต่างจาก analyst.py ตรงหน่วยของการวิเคราะห์: อันนั้นวิเคราะห์ "หุ้นหนึ่งตัว"
อันนี้วิเคราะห์ "ทั้งกลุ่ม" แล้วอธิบายว่าหุ้นเด่นในกลุ่มเชื่อมโยงกับแรงขับเคลื่อน
ของกลุ่มอย่างไร ผู้ใช้จึงอ่านได้ยาวๆ เพื่อทำความเข้าใจภาพใหญ่ก่อนเลือกรายตัว

**เส้นแบ่งที่ต้องรักษา**
- ตัวเลขทุกตัว (ผลตอบแทน มัธยฐาน P/E คะแนน) มาจาก quant/sectors.py เท่านั้น
- ส่วนที่เป็น "ทำไมอุตสาหกรรมนี้ถึงโต" เป็นความรู้ทั่วไปของโมเดลซึ่งมีวันหมดอายุ
  จึงบังคับให้เขียนเป็นกลไกเชิงโครงสร้าง ห้ามอ้างเหตุการณ์เฉพาะวันเวลา
  และหน้าเว็บต้องติดป้ายกำกับให้ผู้ใช้เห็นเสมอ

เขียนใหม่ทุก SECTOR_AI_REFRESH_DAYS วัน (ตั้ง SECTOR_AI_FORCE=1 เพื่อบังคับ)
"""

from __future__ import annotations

import json
import logging
import os
from datetime import datetime, timezone

from config import (AI_MODEL, AI_PRICE_INPUT, AI_PRICE_OUTPUT,
                    FRAMEWORK_FILE, SECTOR_AI_CACHE_FILE, SECTOR_AI_EFFORT,
                    SECTOR_AI_MAX_TOKENS, SECTOR_AI_REFRESH_DAYS, USD_TO_THB)

log = logging.getLogger(__name__)

# **ข้อจำกัดของ structured output ที่ต้องรู้:** API รับ minItems ได้แค่ 0 หรือ 1
# และไม่รับ maxItems เลย — ใส่ไปแล้วจะได้ 400 Bad Request ทั้งคำขอ
# จำนวนข้อที่ต้องการจึงต้องเขียนไว้ใน description แทนการบังคับด้วย schema
_POINT = {
    "type": "object",
    "properties": {
        "title": {"type": "string", "description": "หัวข้อสั้น ไม่เกิน 12 คำ"},
        "detail": {
            "type": "string",
            "description": "อธิบาย 3-5 ประโยค บอกกลไกว่าอะไรทำให้เกิดอะไร "
                           "ไม่ใช่แค่ระบุว่ามีสิ่งนี้อยู่",
        },
    },
    "required": ["title", "detail"],
    "additionalProperties": False,
}

SECTOR_SCHEMA = {
    "type": "object",
    "properties": {
        "headline": {
            "type": "string",
            "description": "สรุปแนวโน้มระยะกลาง-ยาวของกลุ่มนี้ใน 1 ประโยค",
        },
        "verdict": {
            "type": "string",
            "enum": ["โครงสร้างเติบโตชัด", "เติบโตแต่ต้องเลือกตัว",
                     "ทรงตัว/ตามวัฏจักร", "เผชิญแรงกดดันเชิงโครงสร้าง"],
            "description": "ข้อสรุปแนวโน้มระยะกลาง-ยาวของทั้งกลุ่ม",
        },
        "what_is_it": {
            "type": "string",
            "description": "กลุ่มนี้ทำธุรกิจอะไร หาเงินจากไหน ใครคือลูกค้า "
                           "3-4 ประโยค ภาษาชาวบ้าน สำหรับคนที่ไม่รู้จักกลุ่มนี้มาก่อน",
        },
        "growth_drivers": {
            "type": "array",
            "items": _POINT,
            "description": "แรงขับเคลื่อนการเติบโตระยะกลาง-ยาว 3-5 ข้อ เรียงจากสำคัญที่สุด",
        },
        "structural_view": {
            "type": "string",
            "description": "มุมมองระยะ 3-10 ปี 6-9 ประโยค ว่าโครงสร้างของกลุ่มนี้ "
                           "กำลังเปลี่ยนไปทางไหนและเพราะอะไร ต้องมีทั้งด้านที่หนุน "
                           "และด้านที่ฉุด ไม่ใช่เชียร์อย่างเดียว",
        },
        "cycle_position": {
            "type": "string",
            "description": "ตอนนี้กลุ่มนี้อยู่ช่วงไหนเทียบกับอดีต 3-5 ประโยค "
                           "ต้องอ้างตัวเลขที่ให้มา (ผลตอบแทนมัธยฐาน P/E สัดส่วนขาขึ้น) "
                           "และบอกว่าราคาที่เห็นสะท้อนความคาดหวังไปแล้วแค่ไหน",
        },
        "risks": {
            "type": "array",
            "items": _POINT,
            "description": "ความเสี่ยงที่จะทำให้แนวโน้มข้างบนไม่เป็นจริง 3-4 ข้อ",
        },
        "watch_signals": {
            "type": "array",
            "items": {"type": "string"},
            "description": "สัญญาณที่ผู้ใช้ควรตามดูเพื่อรู้ว่าแนวโน้มยังจริงอยู่ไหม 3-5 ข้อ "
                           "ข้อละ 1 ประโยค ต้องเป็นสิ่งที่คนทั่วไปหาดูเองได้",
        },
        "top_picks": {
            "type": "array",
            "minItems": 1,
            "items": {
                "type": "object",
                "properties": {
                    "symbol": {"type": "string", "description": "ต้องเป็นสัญลักษณ์ที่ให้มาเท่านั้น"},
                    "role": {
                        "type": "string",
                        "description": "บทบาทในกลุ่มใน 3-8 คำ เช่น 'ผู้ออกแบบชิปต้นน้ำ'",
                    },
                    "why": {
                        "type": "string",
                        "description": "3-4 ประโยค: เชื่อมโยงว่าตัวนี้เกาะแรงขับเคลื่อนข้อไหน "
                                       "ของกลุ่ม แล้วอ้างคะแนน/ตัวเลขที่ให้มาว่าทำไมถึงโดดเด่น "
                                       "ถ้าตัวเลขบางด้านอ่อนต้องบอกด้วย",
                    },
                },
                "required": ["symbol", "role", "why"],
                "additionalProperties": False,
            },
        },
        "who_fits": {
            "type": "string",
            "description": "กลุ่มนี้เหมาะกับคนแบบไหน ควรถือกี่ปี และควรให้น้ำหนัก "
                           "ในพอร์ตประมาณเท่าไรจึงจะไม่กระจุก 2-3 ประโยค",
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
            "description": "ศัพท์ที่ใช้ในบทความนี้ พร้อมความหมาย สูงสุด 6 คำ",
        },
    },
    "required": ["headline", "verdict", "what_is_it", "growth_drivers",
                 "structural_view", "cycle_position", "risks", "watch_signals",
                 "top_picks", "who_fits", "jargon"],
    "additionalProperties": False,
}

INSTRUCTION = """คุณคือนักวิเคราะห์ที่เขียน "บทวิเคราะห์อุตสาหกรรม" ให้คนที่เพิ่งเริ่ม
ศึกษาการลงทุนและอ่านงบการเงินไม่เป็น อ่านจบแล้วต้องเข้าใจว่ากลุ่มนี้โตด้วยอะไร
และหุ้นแต่ละตัวในกลุ่มเกี่ยวข้องกับสิ่งนั้นอย่างไร

## เส้นแบ่งของข้อมูลสองชนิด (สำคัญที่สุด)
1. **ตัวเลข** — ใช้ได้เฉพาะตัวเลขในข้อความที่ให้มา ห้ามคำนวณใหม่ ห้ามเดา
   ถ้าไม่มีตัวเลขที่ต้องการ ให้บอกว่าระบบไม่ได้เก็บไว้ แล้วเลี่ยงการสรุปที่ต้องใช้ตัวเลขนั้น
2. **กลไกของอุตสาหกรรม** — ใช้ความรู้ของคุณได้ แต่ต้องเขียนเป็นกลไกเชิงโครงสร้าง
   ที่ยังจริงอยู่ในอีกหลายปี เช่น "ศูนย์ข้อมูลกินไฟมากกว่าอาคารสำนักงานหลายเท่า
   ความต้องการไฟจึงโตตามการลงทุน AI"
   **ห้ามอ้างเหตุการณ์ที่ผูกกับวันเวลา** เช่น ตัวเลข GDP ล่าสุด ผลประชุมธนาคารกลาง
   ดีลที่เพิ่งเกิด หรือ "เมื่อปีที่แล้ว..." เพราะคุณไม่รู้ว่าวันนี้คือวันที่เท่าไร
   และผู้ใช้จะอ่านบทความนี้ไปอีกหนึ่งเดือน

## กฎอื่นที่ห้ามละเมิด
- ห้ามพยากรณ์ราคา ห้ามให้เป้าหมายราคา ห้ามบอกว่า "ควรซื้อ/ควรขาย"
- ต้องเขียนด้านลบด้วยเสมอ บทความที่มีแต่ด้านดีคือบทความที่ใช้ตัดสินใจไม่ได้
- คะแนน 0-100 ทุกตัวเป็นการเทียบอันดับภายในกลุ่มเดียวกัน ไม่ใช่คะแนนสัมบูรณ์
- หุ้นเด่นที่ยกมา ให้ใช้เฉพาะสัญลักษณ์ที่ระบบส่งมาให้ ห้ามเพิ่มตัวอื่นเอง
- ถ้าตัวเลขขัดกับเรื่องเล่าเชิงโครงสร้าง (เช่น กลุ่มโตดีแต่ราคาลงทั้งกลุ่ม)
  ให้ชี้ความขัดแย้งนั้นตรงๆ นั่นคือส่วนที่มีค่าที่สุดของบทความ

## วิธีเขียน
- ภาษาไทย ประโยคชัด ไม่วกวน ไม่ต้องเกริ่นนำ เข้าเรื่องเลย
- เขียนให้ยาวและละเอียดตามที่ schema กำหนด ผู้ใช้ตั้งใจมาอ่านยาว
- ห้ามใช้เครื่องหมายมาร์กดาวน์ (** ## | -) เพราะหน้าเว็บแสดงเป็นข้อความล้วน
- ศัพท์การเงินทุกคำที่ใช้ ต้องใส่ไว้ใน jargon พร้อมคำอธิบาย"""


def _fmt_pct(value, digits: int = 2, signed: bool = True) -> str:
    if value is None:
        return "ไม่มีข้อมูล"
    return f"{value * 100:{'+' if signed else ''}.{digits}f}%"


def _fmt(value, digits: int = 1) -> str:
    if value is None:
        return "ไม่มีข้อมูล"
    if isinstance(value, float):
        return f"{value:,.{digits}f}"
    return f"{value:,}" if isinstance(value, int) else str(value)


def build_context(group: dict) -> str:
    """เรียบเรียงตัวเลขของกลุ่มให้ AI อ่าน — ข้อความมีป้ายกำกับ ไม่ใช่ JSON ดิบ"""
    s = group["stats"]

    pick_lines = []
    for p in group["top"]:
        pick_lines.append(
            f"- {p['symbol']} ({p['name']}) | ตลาด {p['market']}"
            f" | อุตสาหกรรม {p['sector'] or 'ไม่ระบุ'}\n"
            f"  คะแนนระยะกลาง-ยาว {_fmt(p['mid_long_score'])}"
            f" | value {_fmt(p['score_value'])} · quality {_fmt(p['score_quality'])}"
            f" · momentum {_fmt(p['score_momentum'])} · dividend {_fmt(p['score_dividend'])}\n"
            f"  P/E {_fmt(p['trailing_pe'])} | ปันผล {_fmt_pct(p['dividend_yield'], signed=False)}"
            f" | 6 เดือน {_fmt_pct(p['ret_6m'])} | 1 ปี {_fmt_pct(p['ret_1y'])}"
            f" | แนวโน้ม {p['trend']} | ความครบข้อมูล {p['data_quality']}"
        )

    kind_line = (
        f"ประเภทกลุ่ม: ธีมข้ามอุตสาหกรรม (ระบบจัดรายชื่อเอง ไม่ใช่การจัดประเภทมาตรฐาน)\n"
        f"เหตุผลที่จัดกลุ่มนี้: {group['rationale']}"
        if group["kind"] == "theme"
        else "ประเภทกลุ่ม: อุตสาหกรรมตามการจัดประเภทมาตรฐาน"
    )

    return f"""## กลุ่มที่ต้องวิเคราะห์
ชื่อกลุ่ม: {group['label']} ({group['region_label']})
{kind_line}
จำนวนสมาชิกในระบบ: {s['count']} ตัว
รายชื่อสมาชิกทั้งหมด: {', '.join(group['members'])}

## ภาพรวมของกลุ่ม (คำนวณแล้ว ห้ามคำนวณซ้ำ · ทุกค่าเป็นมัธยฐานของสมาชิก)
ผลตอบแทน 1 เดือน: {_fmt_pct(s['median_ret_1m'])}
ผลตอบแทน 3 เดือน: {_fmt_pct(s['median_ret_3m'])}
ผลตอบแทน 6 เดือน: {_fmt_pct(s['median_ret_6m'])}
ผลตอบแทน 1 ปี: {_fmt_pct(s['median_ret_1y'])}
P/E: {_fmt(s['median_pe'])}
อัตราปันผล: {_fmt_pct(s['median_dividend_yield'], signed=False)}
สมาชิกที่อยู่ในแนวโน้มขาขึ้น: {s['uptrend_count']} จาก {s['count']} ตัว ({_fmt(s['uptrend_pct'])}%)

## คะแนนปัจจัยของกลุ่ม (0-100 เทียบภายในกลุ่มเปรียบเทียบของแต่ละตัว)
ความถูกของราคา (value): {_fmt(s['median_score_value'])}
คุณภาพกิจการ (quality): {_fmt(s['median_score_quality'])}
โมเมนตัมราคา (momentum): {_fmt(s['median_score_momentum'])}
ปันผล (dividend): {_fmt(s['median_score_dividend'])}
คะแนนรวมระยะกลาง-ยาว: {_fmt(s['median_mid_long'])}

## หุ้นเด่นของกลุ่ม (เรียงตามคะแนนระยะกลาง-ยาว — ใช้ได้เฉพาะรายชื่อนี้)
{chr(10).join(pick_lines)}

เขียนบทวิเคราะห์กลุ่มนี้ตามกรอบและกฎที่กำหนด"""


def _client():
    if not os.getenv("ANTHROPIC_API_KEY"):
        log.warning("ไม่พบ ANTHROPIC_API_KEY — ข้ามบทวิเคราะห์รายอุตสาหกรรม")
        return None
    import anthropic

    return anthropic.Anthropic()


def _load_cache() -> tuple[dict[str, dict], datetime | None]:
    if not SECTOR_AI_CACHE_FILE.exists():
        return {}, None
    try:
        payload = json.loads(SECTOR_AI_CACHE_FILE.read_text(encoding="utf-8"))
        return payload.get("groups", {}), datetime.fromisoformat(payload["generated_at"])
    except (json.JSONDecodeError, KeyError, ValueError) as exc:
        log.warning("อ่าน %s ไม่สำเร็จ (%s) — จะเขียนใหม่",
                    SECTOR_AI_CACHE_FILE.name, exc)
        return {}, None


def _save_cache(groups: dict[str, dict], generated_at: datetime) -> None:
    SECTOR_AI_CACHE_FILE.write_text(
        json.dumps({"generated_at": generated_at.isoformat(), "groups": groups},
                   ensure_ascii=False, allow_nan=False),
        encoding="utf-8",
    )


def analyse(groups: list[dict]) -> dict:
    """เขียนบทวิเคราะห์ให้ทุกกลุ่ม (หรือใช้ของเดิมถ้ายังไม่ถึงกำหนด)

    Returns:
        {"generated_at": iso | None, "groups": {group_id: บทวิเคราะห์}}
        คืน groups ว่างได้เสมอ — หน้าเว็บต้องแสดงตัวเลขของกลุ่มได้แม้ไม่มีบทความ
    """
    now = datetime.now(timezone.utc)
    cached, cached_at = _load_cache()

    if cached and cached_at and os.getenv("SECTOR_AI_FORCE") != "1":
        age_days = (now - cached_at).days
        # กลุ่มใหม่ที่เพิ่งเพิ่มเข้ามา (เช่นเพิ่มธีม) ต้องได้บทความทันทีโดยไม่ต้องรอครบรอบ
        missing = [g for g in groups if g["id"] not in cached]
        if age_days < SECTOR_AI_REFRESH_DAYS and not missing:
            log.info("ใช้บทวิเคราะห์อุตสาหกรรมเดิมอายุ %d วัน (%d กลุ่ม) — เขียนใหม่ทุก %d วัน",
                     age_days, len(cached), SECTOR_AI_REFRESH_DAYS)
            return {"generated_at": cached_at.isoformat(), "groups": cached}
        if missing:
            log.info("พบกลุ่มใหม่ %d กลุ่มที่ยังไม่มีบทวิเคราะห์ — เขียนเฉพาะกลุ่มนั้น",
                     len(missing))
            groups = missing

    client = _client()
    if client is None:
        return {"generated_at": cached_at.isoformat() if cached_at else None,
                "groups": cached}

    if not FRAMEWORK_FILE.exists():
        log.warning("ไม่พบ %s — ข้ามบทวิเคราะห์รายอุตสาหกรรม", FRAMEWORK_FILE.name)
        return {"generated_at": cached_at.isoformat() if cached_at else None,
                "groups": cached}

    system = [
        {"type": "text", "text": FRAMEWORK_FILE.read_text(encoding="utf-8")},
        {"type": "text", "text": INSTRUCTION, "cache_control": {"type": "ephemeral"}},
    ]

    log.info("ส่งให้ AI เขียนบทวิเคราะห์ %d กลุ่ม (โมเดล %s · effort %s)",
             len(groups), AI_MODEL, SECTOR_AI_EFFORT)

    results: dict[str, dict] = {}
    used = {"input": 0, "output": 0, "cache_write": 0, "cache_read": 0}
    allowed_symbols = {g["id"]: {p["symbol"] for p in g["top"]} for g in groups}

    for group in groups:
        try:
            response = client.messages.create(
                model=AI_MODEL,
                max_tokens=SECTOR_AI_MAX_TOKENS,
                system=system,
                output_config={
                    "effort": SECTOR_AI_EFFORT,
                    "format": {"type": "json_schema", "schema": SECTOR_SCHEMA},
                },
                messages=[{"role": "user", "content": build_context(group)}],
            )
        except Exception as exc:                       # noqa: BLE001
            log.warning("เขียนบทวิเคราะห์ %s ไม่สำเร็จ: %s", group["label"], exc)
            continue

        if response.stop_reason == "refusal":
            log.warning("โมเดลปฏิเสธคำขอสำหรับกลุ่ม %s", group["label"])
            continue

        # ชนเพดานโทเคน = JSON ถูกตัดกลางประโยค แกะไม่ได้แน่นอน
        # ต้องแยกออกจาก "คำตอบไม่ใช่ JSON" เพราะวิธีแก้คนละอย่าง (ขยาย max_tokens
        # ไม่ใช่ไปแก้ prompt) ถ้าไม่แยก จะไล่หาสาเหตุผิดทางทุกครั้งที่เกิด
        if response.stop_reason == "max_tokens":
            log.warning("กลุ่ม %s เขียนไม่จบใน %d โทเคน — ข้ามและควรขยาย "
                        "SECTOR_AI_MAX_TOKENS", group["label"], SECTOR_AI_MAX_TOKENS)
            continue

        text = next((b.text for b in response.content if b.type == "text"), None)
        if not text:
            log.warning("ไม่ได้คำตอบสำหรับกลุ่ม %s (stop_reason=%s)",
                        group["label"], response.stop_reason)
            continue

        try:
            analysis = json.loads(text)
        except json.JSONDecodeError as exc:
            log.warning("คำตอบของกลุ่ม %s ไม่ใช่ JSON: %s", group["label"], exc)
            continue

        # ด่านสุดท้ายกันโมเดลยกหุ้นนอกรายชื่อที่ให้ไป — schema บังคับรูปแบบได้
        # แต่บังคับ "ค่า" ไม่ได้ ถ้าปล่อยผ่าน หน้าเว็บจะมีลิงก์ไปหุ้นที่ระบบไม่มีข้อมูล
        picks = [p for p in analysis.get("top_picks", [])
                 if p.get("symbol") in allowed_symbols[group["id"]]]
        dropped = len(analysis.get("top_picks", [])) - len(picks)
        if dropped:
            log.warning("กลุ่ม %s: ตัดหุ้นที่ไม่อยู่ในรายชื่อที่ส่งไปออก %d ตัว",
                        group["label"], dropped)
        analysis["top_picks"] = picks
        results[group["id"]] = analysis

        u = response.usage
        used["input"] += u.input_tokens or 0
        used["output"] += u.output_tokens or 0
        used["cache_write"] += getattr(u, "cache_creation_input_tokens", 0) or 0
        used["cache_read"] += getattr(u, "cache_read_input_tokens", 0) or 0

    merged = {**cached, **results}
    if results:
        _save_cache(merged, now)

    cost = (used["input"] + used["cache_write"] * 1.25 + used["cache_read"] * 0.1) \
        / 1_000_000 * AI_PRICE_INPUT + used["output"] / 1_000_000 * AI_PRICE_OUTPUT
    log.info("บทวิเคราะห์อุตสาหกรรมสำเร็จ %d/%d กลุ่ม · ≈ %.2f บาท "
             "(เขียนใหม่ทุก %d วัน ≈ %.0f บาท/เดือน)",
             len(results), len(groups), cost * USD_TO_THB,
             SECTOR_AI_REFRESH_DAYS, cost * USD_TO_THB * 30 / SECTOR_AI_REFRESH_DAYS)

    return {"generated_at": now.isoformat() if results else (
        cached_at.isoformat() if cached_at else None), "groups": merged}
