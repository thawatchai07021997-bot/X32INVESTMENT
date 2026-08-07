"""คะแนนปัจจัยพื้นฐาน (Factor Scoring) — Value / Quality / Momentum / Dividend

อิงแนวคิด factor investing จาก Stocks Trading Master Framework:
งานวิจัยระยะยาวพบว่าหุ้นที่ราคาถูกเทียบมูลค่า (value), กิจการมีคุณภาพ (quality),
ราคากำลังมีโมเมนตัม (momentum) และจ่ายปันผลสม่ำเสมอ (dividend)
มีแนวโน้มให้ผลตอบแทนดีกว่าค่าเฉลี่ยในระยะยาว

**วิธีให้คะแนนเป็นแบบเปรียบเทียบกันเอง (cross-sectional percentile)**
ไม่ใช่เกณฑ์ตายตัว เพราะ P/E ที่ถือว่า "ถูก" ในตลาดไทยกับตลาดสหรัฐฯ ต่างกันมาก
การจัดอันดับภายในกลุ่มเดียวกันจึงยุติธรรมกว่าการตั้งเลขตายตัว
"""

from __future__ import annotations

import logging

import numpy as np
import pandas as pd

log = logging.getLogger(__name__)

# ตัวชี้วัดที่ใช้ในแต่ละปัจจัย
# higher_is_better=False หมายถึงค่ายิ่งน้อยยิ่งดี (เช่น P/E ต่ำ = ถูก)

# ปัจจัยที่ "มีความหมาย" กับสินทรัพย์แต่ละประเภท
# ทองคำไม่มีงบการเงิน ไม่มีกำไร ไม่จ่ายปันผล → ให้คะแนนได้แค่โมเมนตัมราคา
# ETF เป็นตะกร้าหุ้น → ดูปันผลและโมเมนตัมได้ ส่วน P/E รวมของตะกร้ามักไม่มีข้อมูล
APPLICABLE_FACTORS: dict[str, set[str]] = {
    "stock": {"value", "quality", "momentum", "dividend"},
    "etf": {"momentum", "dividend", "value"},
    "gold": {"momentum"},
}

# กลุ่มเปรียบเทียบต้องมีสมาชิกอย่างน้อยเท่านี้ การจัดอันดับถึงจะมีความหมาย
# กลุ่มเล็กกว่านี้จะถูกยุบไปเทียบกับกลุ่มที่กว้างขึ้นแทน
# (กลุ่มที่มีสมาชิกตัวเดียวย่อมได้ที่ 1 เสมอ = 100 คะแนน ซึ่งไร้ความหมาย)
MIN_PEER_GROUP = 8

FACTOR_METRICS: dict[str, list[tuple[str, bool]]] = {
    "value": [
        ("trailing_pe", False),
        ("price_to_book", False),
        ("ev_to_ebitda", False),
        ("fcf_yield", True),
    ],
    "quality": [
        ("roe", True),
        ("profit_margin", True),
        ("debt_to_equity", False),
        ("revenue_growth", True),
    ],
    "momentum": [
        ("ret_3m", True),
        ("ret_6m", True),
        ("ret_1y", True),
    ],
    "dividend": [
        ("dividend_yield", True),
        ("payout_sustainable", True),
    ],
}


def calibrate_dividend_unit(info_map: dict[str, dict]) -> float:
    """หาว่า yfinance คืน dividendYield เป็นทศนิยมหรือเปอร์เซ็นต์ แล้วคืนตัวหาร

    **ทำไมต้องเทียบหน่วย:** yfinance เปลี่ยนหน่วยของ `dividendYield`
    จากทศนิยมเป็นเปอร์เซ็นต์ในเวอร์ชันหลังๆ (ตรวจสอบแล้ว: KO จ่ายปันผล 2.12
    ต่อราคา 86.85 = 2.44% และ yfinance คืนค่า 2.44 ไม่ใช่ 0.0244)
    ถ้าอ่านผิดหน่วยจะได้ตัวเลขเพี้ยน 100 เท่า เช่นแสดงว่าหุ้นปันผล 795%

    วิธีตรวจ: หาสินทรัพย์ที่มีทั้ง dividendRate และราคา แล้วคำนวณอัตราปันผลจริง
    (rate ÷ price ซึ่งหน่วยชัดเจนแน่นอน) มาเทียบกับค่าที่ yfinance ให้
    ใช้ค่ามัธยฐานของอัตราส่วนเพื่อไม่ให้หุ้นตัวเดียวที่ข้อมูลเพี้ยนทำให้ตัดสินผิด

    เทียบทั้ง universe ครั้งเดียวแทนการเดารายตัว เพราะ ETF จำนวนมาก
    ไม่มี dividendRate ให้เทียบ แต่ต้องใช้หน่วยเดียวกับหุ้นเสมอ

    Returns:
        100.0 ถ้าเป็นเปอร์เซ็นต์, 1.0 ถ้าเป็นทศนิยมอยู่แล้ว
    """
    ratios: list[float] = []
    for info in info_map.values():
        try:
            raw = float(info.get("dividendYield") or 0)
            rate = float(info.get("dividendRate") or 0)
            price = float(info.get("currentPrice")
                          or info.get("regularMarketPrice")
                          or info.get("previousClose") or 0)
        except (TypeError, ValueError):
            continue
        if raw > 0 and rate > 0 and price > 0:
            actual = rate / price          # อัตราปันผลจริงในหน่วยทศนิยม
            if actual > 0:
                ratios.append(raw / actual)

    if not ratios:
        # ไม่มีตัวเทียบเลย — ใช้พฤติกรรมของ yfinance รุ่นปัจจุบันเป็นค่าตั้งต้น
        log.warning("เทียบหน่วยอัตราปันผลไม่ได้ ใช้ค่าตั้งต้นเป็นเปอร์เซ็นต์")
        return 100.0

    median_ratio = float(np.median(ratios))
    divisor = 100.0 if median_ratio > 10 else 1.0
    log.info("หน่วยอัตราปันผลจาก yfinance: %s (อัตราส่วนมัธยฐาน %.1f จาก %d ตัวอย่าง)",
             "เปอร์เซ็นต์" if divisor == 100.0 else "ทศนิยม", median_ratio, len(ratios))
    return divisor


def extract_fundamentals(info: dict, dividend_divisor: float = 100.0) -> dict:
    """ดึงตัวชี้วัดพื้นฐานจาก yfinance .info อย่างปลอดภัย

    yfinance คืน dict ที่ฟิลด์ขาดหายบ่อยมาก โดยเฉพาะหุ้นไทย
    ฟังก์ชันนี้จึงคืน None แทนการโยน exception เสมอ
    """
    def num(key: str) -> float | None:
        """อ่านค่าตัวเลข — คืน None ถ้าไม่มี ไม่ใช่ตัวเลข หรือเป็น inf/nan"""
        v = info.get(key)
        if v is None or isinstance(v, (str, bool)):
            return None
        try:
            f = float(v)
        except (TypeError, ValueError):
            return None
        return f if np.isfinite(f) else None

    market_cap = num("marketCap")
    free_cashflow = num("freeCashflow")
    payout = num("payoutRatio")

    # Free cash flow yield = กระแสเงินสดอิสระต่อมูลค่าตลาด
    # ยิ่งสูงยิ่งดี — บอกว่ากิจการสร้างเงินสดจริงได้เท่าไรเทียบราคาที่ต้องจ่าย
    fcf_yield = None
    if free_cashflow is not None and market_cap:
        fcf_yield = free_cashflow / market_cap

    # payout ratio ที่ "ยั่งยืน" คือ 0-70% — จ่ายเกินกำไรมากๆ มักลดปันผลในอนาคต
    # แปลงเป็นคะแนน 0-1 เพื่อให้ทิศทาง "ยิ่งมากยิ่งดี" เหมือนตัวชี้วัดอื่น
    payout_sustainable = None
    if payout is not None:
        if payout <= 0:
            payout_sustainable = 0.0
        elif payout <= 0.70:
            payout_sustainable = 1.0
        else:
            payout_sustainable = float(max(0.0, 1 - (payout - 0.70) / 0.60))

    pe = num("trailingPE")
    pb = num("priceToBook")
    ev_ebitda = num("enterpriseToEbitda")

    # อัตราปันผล: คำนวณจาก dividendRate ÷ ราคา ถ้าทำได้ (แม่นยำที่สุดเพราะ
    # ทั้งสองค่าเป็นสกุลเงินต่อหุ้นเหมือนกัน) ไม่งั้นใช้ค่าที่เทียบหน่วยแล้ว
    rate = num("dividendRate")
    price_now = (num("currentPrice") or num("regularMarketPrice")
                 or num("previousClose"))
    raw_yield = num("dividendYield")
    if rate is not None and price_now:
        dividend_yield = rate / price_now if rate > 0 else 0.0
    elif raw_yield is not None:
        dividend_yield = raw_yield / dividend_divisor
    else:
        dividend_yield = None

    return {
        "name": info.get("longName") or info.get("shortName") or "",
        "sector": info.get("sector") or "",
        "industry": info.get("industry") or "",
        "currency": info.get("currency") or "",
        "market_cap": market_cap,
        # ค่าติดลบแปลว่าขาดทุน — ใช้เปรียบเทียบความถูก/แพงไม่ได้ ตัดเป็น None
        "trailing_pe": pe if (pe is not None and pe > 0) else None,
        "forward_pe": num("forwardPE"),
        "price_to_book": pb if (pb is not None and pb > 0) else None,
        "ev_to_ebitda": ev_ebitda if (ev_ebitda is not None and ev_ebitda > 0) else None,
        "fcf_yield": fcf_yield,
        "roe": num("returnOnEquity"),
        "profit_margin": num("profitMargins"),
        "debt_to_equity": num("debtToEquity"),
        "revenue_growth": num("revenueGrowth"),
        "earnings_growth": num("earningsGrowth"),
        "dividend_yield": dividend_yield,
        "payout_ratio": payout,
        "payout_sustainable": payout_sustainable,
        "beta": num("beta"),
    }


def _percentile_scores(values: pd.Series, higher_is_better: bool) -> pd.Series:
    """แปลงค่าดิบเป็นเปอร์เซ็นไทล์ 0-100 ภายในกลุ่มเดียวกัน

    ใช้ rank(pct=True) ซึ่งทนต่อค่าผิดปกติ (outlier) ได้ดีกว่า z-score
    เช่น หุ้นตัวเดียวที่ P/E = 900 จะไม่ทำให้คะแนนตัวอื่นเพี้ยนทั้งกลุ่ม
    """
    ranked = values.rank(pct=True, ascending=higher_is_better)
    return ranked * 100


def _assign_peer_groups(df: pd.DataFrame) -> pd.Series:
    """กำหนดกลุ่มเปรียบเทียบให้แต่ละสินทรัพย์ พร้อมยุบกลุ่มที่เล็กเกินไป

    ลำดับความละเอียด: (ตลาด|ประเภท) → (ประเภท) → (ทั้ง universe)
    เริ่มจากกลุ่มที่เจาะจงที่สุด ถ้าสมาชิกน้อยกว่า MIN_PEER_GROUP
    ก็เลื่อนไปใช้กลุ่มที่กว้างขึ้น เพื่อไม่ให้เกิดคะแนน 100 จากการ
    เป็นสมาชิกคนเดียวของกลุ่ม
    """
    fine = df["market"].astype(str) + "|" + df["asset_class"].astype(str)
    coarse = df["asset_class"].astype(str)

    fine_sizes = fine.map(fine.value_counts())
    coarse_sizes = coarse.map(coarse.value_counts())

    group = fine.where(fine_sizes >= MIN_PEER_GROUP, coarse)
    # ถ้ากลุ่มตามประเภทก็ยังเล็กเกินไป ให้เทียบกับทั้ง universe
    group = group.where(
        (fine_sizes >= MIN_PEER_GROUP) | (coarse_sizes >= MIN_PEER_GROUP),
        "ALL",
    )
    return group


def compute_factor_scores(records: list[dict]) -> list[dict]:
    """คำนวณคะแนน 4 ปัจจัยให้ทุกสินทรัพย์ โดยเปรียบเทียบภายในกลุ่มเดียวกัน

    จัดกลุ่มตาม (market, asset_class) เช่น หุ้นไทยแข่งกับหุ้นไทย
    ETF แข่งกับ ETF — ไม่เอา ETF ไปแข่ง P/E กับหุ้นรายตัว
    กลุ่มที่มีสมาชิกน้อยเกินไปจะถูกยุบรวมโดย _assign_peer_groups()

    ปัจจัยที่ไม่มีความหมายกับสินทรัพย์ประเภทนั้น (เช่น "คุณภาพกิจการ" ของทองคำ)
    จะถูกตั้งเป็น None ไม่ใช่คำนวณออกมาเป็นตัวเลขที่ตีความไม่ได้

    Args:
        records: list ของ dict ที่มี key ของตัวชี้วัดต่างๆ อยู่ระดับบนสุด

    Returns:
        records เดิม (แก้ในตัว) โดยเพิ่ม key: score_value, score_quality,
        score_momentum, score_dividend, coverage_* และ peer_count
    """
    if not records:
        return records

    df = pd.DataFrame(records)
    df["_group"] = _assign_peer_groups(df)
    peer_counts = df["_group"].map(df["_group"].value_counts())

    for factor, metrics in FACTOR_METRICS.items():
        # เก็บคะแนนย่อยของแต่ละตัวชี้วัดไว้เฉลี่ยทีหลัง
        sub_scores: list[pd.Series] = []
        for metric, higher_better in metrics:
            if metric not in df.columns:
                continue
            col = pd.to_numeric(df[metric], errors="coerce")
            if col.notna().sum() < 3:
                continue    # ข้อมูลน้อยเกินกว่าจะจัดอันดับอย่างมีความหมาย
            scored = col.groupby(df["_group"]).transform(
                lambda s: _percentile_scores(s, higher_better)
            )
            sub_scores.append(scored)

        if sub_scores:
            stacked = pd.concat(sub_scores, axis=1)
            df[f"score_{factor}"] = stacked.mean(axis=1, skipna=True)
            # นับว่าคะแนนนี้คิดมาจากตัวชี้วัดกี่ตัว — ใช้บอกผู้ใช้ว่าข้อมูลครบแค่ไหน
            df[f"coverage_{factor}"] = stacked.notna().sum(axis=1)
        else:
            df[f"score_{factor}"] = np.nan
            df[f"coverage_{factor}"] = 0

    # เขียนค่ากลับเข้า records เดิม — แปลง NaN เป็น None ให้ JSON เขียนได้
    for i, rec in enumerate(records):
        applicable = APPLICABLE_FACTORS.get(rec.get("asset_class", ""), set())
        rec["peer_group"] = str(df.at[i, "_group"])
        rec["peer_count"] = int(peer_counts.iloc[i])

        for factor in FACTOR_METRICS:
            if factor not in applicable:
                # ปัจจัยนี้ไม่มีความหมายกับสินทรัพย์ประเภทนี้
                rec[f"score_{factor}"] = None
                rec[f"coverage_{factor}"] = 0
                continue
            raw = df.at[i, f"score_{factor}"]
            rec[f"score_{factor}"] = (
                None if pd.isna(raw) else round(float(raw), 1)
            )
            rec[f"coverage_{factor}"] = int(df.at[i, f"coverage_{factor}"])
    return records


def data_quality(rec: dict) -> str:
    """ประเมินความครบถ้วนของข้อมูลพื้นฐาน เพื่อแสดงป้ายกำกับบนเว็บ

    สำคัญเพราะหุ้นไทยหลายตัวใน yfinance ไม่มีงบการเงิน
    ผู้ใช้ควรรู้ว่าคะแนนตัวไหนคิดจากข้อมูลครบ ตัวไหนคิดจากเทคนิคอย่างเดียว
    """
    total = sum(rec.get(f"coverage_{f}", 0) for f in FACTOR_METRICS)
    if total >= 8:
        return "full"        # ข้อมูลพื้นฐานครบ
    if total >= 4:
        return "partial"     # มีบางส่วน
    return "technical_only"  # ไม่มีงบการเงิน ใช้เทคนิคล้วน
