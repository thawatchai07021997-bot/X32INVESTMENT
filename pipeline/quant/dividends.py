"""ปฏิทินการจ่ายปันผล — สรุปว่าหุ้นแต่ละตัว "ปกติจ่ายเดือนไหน"

ทำไมต้องมี: ผู้ลงทุนที่หวังกระแสเงินสดต้องรู้ว่าเงินจะเข้าเดือนไหนบ้าง
ถึงจะวางแผนเข้าซื้อก่อนวันขึ้นเครื่องหมาย XD และรู้ว่าเดือนไหนของปีจะขาดช่วง

ข้อมูลเข้ามาจากคอลัมน์ Dividends ที่ yfinance แถมมากับราคา (ไม่มีคำขอเพิ่ม)
ซึ่งเป็น **วันขึ้นเครื่องหมาย XD** ไม่ใช่วันที่เงินเข้าบัญชี — เงินจริงมักเข้าหลัง
จากนั้นราว 2–6 สัปดาห์ ต้องบอกผู้ใช้ให้ชัดบนหน้าเว็บ

ทุกอย่างในไฟล์นี้เป็นการนับจากอดีตล้วน ไม่มีการพยากรณ์
"""

from __future__ import annotations

from collections import Counter, defaultdict
from datetime import date, datetime
from statistics import median

# ดูย้อนหลังกี่ปีในการสรุปรูปแบบการจ่าย — ต้องไม่เกิน HISTORY_PERIOD ของ pipeline
LOOKBACK_YEARS = 3

# ไม่จ่ายมานานเกินกี่เดือนถือว่า "หยุดจ่าย" — ยาวกว่า 1 ปีเผื่อบริษัทที่จ่ายปีละครั้ง
# แล้วประกาศช้ากว่าปกติ 3 เดือน
PAUSED_AFTER_MONTHS = 15


def _parse(events: list[dict]) -> list[tuple[date, float]]:
    """แปลงรายการดิบเป็น (วันที่, จำนวนเงิน) โดยข้ามรายการที่อ่านไม่ได้"""
    out: list[tuple[date, float]] = []
    for e in events or []:
        try:
            d = datetime.strptime(str(e["date"])[:10], "%Y-%m-%d").date()
            amount = float(e.get("amount") or 0)
        except (KeyError, TypeError, ValueError):
            continue
        if amount > 0:
            out.append((d, amount))
    return sorted(out)


def analyse(events: list[dict], today: date | None = None) -> dict:
    """สรุปรูปแบบการจ่ายปันผลจากประวัติ

    Args:
        events: [{"date": "YYYY-MM-DD", "amount": float}, ...]
        today:  วันอ้างอิง (ใส่เองได้เพื่อให้เทสต์ให้ผลเดิมทุกครั้ง)

    Returns:
        dict ที่พร้อมรวมเข้า record ของสินทรัพย์ — ค่าที่สรุปไม่ได้เป็น None/[]
        - dividend_months        เดือนที่ "ปกติจ่าย" (1-12) เรียงจากน้อยไปมาก
        - dividend_month_weights สัดส่วนเงินปันผลต่อปีที่ตกในแต่ละเดือน (รวม = 1)
        - dividend_freq          จำนวนครั้งที่จ่ายต่อปีโดยประมาณ
        - dividend_pattern       ข้อความสั้นบอกรูปแบบ เช่น "ปีละ 2 ครั้ง"
        - dividend_confidence    high / low — low แปลว่าข้อมูลสั้นหรือจ่ายไม่สม่ำเสมอ
        - dividend_last_date     วันขึ้น XD ครั้งล่าสุดที่พบ
        - dividend_paused        True เมื่อไม่จ่ายมานานผิดปกติ
    """
    empty = {
        "dividend_months": [],
        "dividend_month_weights": {},
        "dividend_freq": None,
        "dividend_pattern": "",
        "dividend_confidence": None,
        "dividend_last_date": None,
        "dividend_paused": False,
        "dividend_events_seen": 0,
    }

    parsed = _parse(events)
    if not parsed:
        return empty

    ref = today or date.today()
    cutoff = date(ref.year - LOOKBACK_YEARS, ref.month, 1)
    window = [(d, a) for d, a in parsed if d >= cutoff]
    if not window:
        # เคยจ่ายแต่ไม่มีรายการในกรอบที่ดู — ถือว่าหยุดจ่ายไปแล้ว
        return {**empty,
                "dividend_last_date": parsed[-1][0].isoformat(),
                "dividend_paused": True,
                "dividend_events_seen": len(parsed)}

    paid_years = sorted({d.year for d, _ in window})
    n_years = len(paid_years)

    month_counts: Counter[int] = Counter(d.month for d, _ in window)
    month_amounts: dict[int, float] = defaultdict(float)
    for d, amount in window:
        month_amounts[d.month] += amount

    # เดือนที่ "ปกติจ่าย" = เดือนที่จ่ายซ้ำอย่างน้อยครึ่งหนึ่งของปีที่มีข้อมูล
    # ถ้ามีข้อมูลปีเดียวก็ยอมรับทุกเดือนที่เจอ แต่ลดความมั่นใจลงแทน
    threshold = 1 if n_years < 2 else (n_years + 1) // 2
    months = sorted(m for m, c in month_counts.items() if c >= threshold)
    # ทุกเดือนกระจายจนไม่มีเดือนไหนถึงเกณฑ์ = จ่ายไม่ตรงเดือนเดิมทุกปี
    # ยังบอกได้ว่าโดยมากตกเดือนไหน แต่ต้องถือว่าปฏิทินนี้เชื่อถือไม่ได้
    repeats = bool(months)
    if not months:
        top = max(month_counts.values())
        months = sorted(m for m, c in month_counts.items() if c == top)

    total_amount = sum(month_amounts.values())
    weights = ({m: round(v / total_amount, 4) for m, v in sorted(month_amounts.items())}
               if total_amount > 0 else {})

    # ความถี่วัดจากมัธยฐานของระยะห่างระหว่างการจ่าย ไม่ใช่ "ครั้ง ÷ จำนวนปีปฏิทิน"
    # เพราะกรอบข้อมูลเริ่มและจบกลางปีเสมอ — หุ้นรายไตรมาส 12 ครั้งที่แตะ 4 ปีปฏิทิน
    # แต่กินเวลาจริง 2.75 ปี จะถูกนับเป็น "ปีละ 3 ครั้ง" ทั้งที่จ่ายทุกไตรมาสตรงเวลา
    gaps = [(b - a).days for a, b in zip(
        [d for d, _ in window], [d for d, _ in window[1:]])]
    gaps = [g for g in gaps if g > 0]
    if gaps:
        freq = max(1, min(12, round(365.25 / median(gaps))))
    else:
        freq = 1 if window else None   # จ่ายครั้งเดียวในกรอบที่ดู

    pattern = {1: "ปีละครั้ง", 2: "ปีละ 2 ครั้ง", 3: "ปีละ 3 ครั้ง",
               4: "ทุกไตรมาส", 12: "ทุกเดือน"}.get(
        freq or 0, f"ปีละ {freq} ครั้ง" if freq else "")

    last_date = window[-1][0]
    months_since = (ref.year - last_date.year) * 12 + (ref.month - last_date.month)
    paused = months_since > PAUSED_AFTER_MONTHS

    # เชื่อถือปฏิทินได้ต่อเมื่อครบ 3 อย่าง: เห็นอย่างน้อย 2 ปี, มีเดือนที่จ่ายซ้ำจริง,
    # และจำนวนเดือนที่สรุปได้สอดคล้องกับความถี่ที่จ่าย
    # (ตัวที่จ่ายปีละครั้งแต่คนละเดือนทุกปีจะตกเกณฑ์ข้อ 2 — ตั้งใจ เพราะปฏิทินของมันเดาไม่ได้)
    consistent = repeats and bool(freq) and abs(len(months) - freq) <= 1
    confidence = "high" if (n_years >= 2 and consistent and not paused) else "low"

    return {
        "dividend_months": months,
        "dividend_month_weights": weights,
        "dividend_freq": freq,
        "dividend_pattern": pattern,
        "dividend_confidence": confidence,
        "dividend_last_date": last_date.isoformat(),
        "dividend_paused": paused,
        "dividend_events_seen": len(window),
    }
