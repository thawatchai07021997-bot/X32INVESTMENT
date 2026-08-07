"""ค่าตั้งต้นทั้งหมดของ pipeline — universe, เกณฑ์คัดกรอง, path

แก้ universe ที่ไฟล์นี้ที่เดียว โมดูลอื่นอ่านจากที่นี่
"""

from __future__ import annotations

from pathlib import Path

# ── Path ────────────────────────────────────────────────────────────────
ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data-private"        # ผลลัพธ์ JSON (ไม่ถูก publish โดย Netlify)
ASSET_DIR = DATA_DIR / "assets"         # ไฟล์วิเคราะห์รายตัว
CACHE_DIR = ROOT / ".cache"             # ราคาย้อนหลัง (ไม่เข้า git)

for _d in (DATA_DIR, ASSET_DIR, CACHE_DIR):
    _d.mkdir(parents=True, exist_ok=True)

# ── ช่วงเวลาที่ดึงข้อมูล ─────────────────────────────────────────────────
HISTORY_PERIOD = "3y"    # ยาวพอสำหรับ SMA200 + momentum 12 เดือน + backtest สั้นๆ
MIN_BARS = 60            # น้อยกว่านี้ถือว่าข้อมูลไม่พอ ข้ามการวิเคราะห์

# ── Universe ────────────────────────────────────────────────────────────
# หุ้นไทย SET50 (yfinance ใช้ suffix .BK)
TH_STOCKS = [
    "ADVANC", "AOT", "AWC", "BANPU", "BBL", "BDMS", "BEM", "BGRIM", "BH", "BTS",
    "CBG", "CENTEL", "COM7", "CPALL", "CPF", "CPN", "CRC", "DELTA", "EA", "EGCO",
    # INTUCH ถูกถอดออก — ควบรวมกับ GULF แล้ว yfinance ไม่มีข้อมูลราคา
    "GLOBAL", "GPSC", "GULF", "HMPRO", "IVL", "KBANK", "KCE", "KTB", "KTC",
    "LH", "MINT", "MTC", "OR", "OSP", "PTT", "PTTEP", "PTTGC", "RATCH", "SAWAD",
    "SCB", "SCC", "SCGP", "TISCO", "TLI", "TOP", "TRUE", "TTB", "TU", "WHA",
]

# หุ้นสหรัฐฯ — ผสม growth / value / dividend
US_STOCKS = [
    # Mega-cap tech
    "AAPL", "MSFT", "GOOGL", "AMZN", "META", "NVDA", "AVGO", "TSLA", "AMD", "ORCL",
    "CRM", "ADBE", "NFLX", "QCOM", "TXN", "INTU", "NOW", "PANW", "MU", "AMAT",
    # Healthcare
    "UNH", "JNJ", "LLY", "ABBV", "MRK", "PFE", "TMO", "ABT", "AMGN", "ISRG",
    # Financials
    "BRK-B", "JPM", "V", "MA", "BAC", "WFC", "GS", "MS", "AXP", "BLK",
    # Consumer / Industrial
    "WMT", "COST", "PG", "KO", "PEP", "MCD", "HD", "NKE", "SBUX", "DIS",
    "CAT", "DE", "HON", "GE", "UNP", "LMT", "RTX", "BA", "UPS", "MMM",
    # Energy / Utilities / Dividend-heavy
    "XOM", "CVX", "COP", "NEE", "DUK", "SO", "T", "VZ", "PM", "MO",
]

# ETF ต่างประเทศ — index / sector / bond / commodity
ETFS = [
    "SPY", "QQQ", "VTI", "VOO", "IWM", "DIA",      # ดัชนีหลัก
    "VEA", "VWO", "EFA", "EEM",                     # ต่างประเทศ / ตลาดเกิดใหม่
    "XLK", "XLV", "XLF", "XLE", "XLY", "XLP",       # รายกลุ่มอุตสาหกรรม
    "SCHD", "VYM", "DVY",                           # เน้นปันผล
    "TLT", "IEF", "LQD", "HYG",                     # ตราสารหนี้
    "VNQ",                                          # อสังหาฯ
]

# ทอง
GOLD = ["GC=F", "GLD", "IAU"]

# ดัชนีอ้างอิงตลาด (ใช้บน Dashboard ไม่เข้าการคัดกรอง)
BENCHMARKS = {
    "^GSPC": "S&P 500",
    "^IXIC": "Nasdaq",
    "^SET.BK": "SET Index",
    "GC=F": "ทองคำโลก",
    "THB=X": "USD/THB",
    "^VIX": "VIX",
}


def build_universe() -> list[dict]:
    """คืนรายการสินทรัพย์ทั้งหมดพร้อม metadata

    Returns:
        list ของ dict: {ticker, symbol, name_hint, asset_class, market}
        - ticker  = สัญลักษณ์ที่ใช้เรียก yfinance (หุ้นไทยมี .BK ต่อท้าย)
        - symbol  = สัญลักษณ์ที่แสดงบนเว็บ (ไม่มี .BK)
    """
    items: list[dict] = []
    for s in TH_STOCKS:
        items.append({"ticker": f"{s}.BK", "symbol": s,
                      "asset_class": "stock", "market": "TH"})
    for s in US_STOCKS:
        items.append({"ticker": s, "symbol": s,
                      "asset_class": "stock", "market": "US"})
    for s in ETFS:
        items.append({"ticker": s, "symbol": s,
                      "asset_class": "etf", "market": "US"})
    for s in GOLD:
        items.append({"ticker": s, "symbol": s,
                      "asset_class": "gold", "market": "GLOBAL"})
    return items


# ── เกณฑ์คัดกรอง ────────────────────────────────────────────────────────
# เป้าหมายผู้ใช้คือผลตอบแทนเฉลี่ย >10%/ปี — ใช้เป็น "เกณฑ์คัดกรอง" ไม่ใช่คำสัญญา
TARGET_ANNUAL_RETURN = 0.10

# น้ำหนักของแต่ละปัจจัยในคะแนนรวม (รวมกันได้ 1.0)
# อิงงานวิจัย factor investing: value / quality / momentum / dividend
FACTOR_WEIGHTS = {
    "value": 0.25,
    "quality": 0.30,
    "momentum": 0.30,
    "dividend": 0.15,
}

# น้ำหนักปัจจัยสำหรับแต่ละระยะการลงทุน (ใช้จัดอันดับแยกตามระยะ)
HORIZON_WEIGHTS = {
    "short": {"momentum": 0.60, "technical": 0.40},              # 1–3 เดือน
    "mid":   {"momentum": 0.35, "quality": 0.35, "value": 0.30},  # 6–18 เดือน
    # ระยะยาวเน้นคุณภาพและความถูก แต่ยังต้องมีน้ำหนักโมเมนตัมไว้บ้าง
    # ไม่งั้นสินทรัพย์ที่ราคาไม่โตแต่จ่ายปันผลสม่ำเสมอ (เช่น กองทุนพันธบัตร)
    # จะลอยขึ้นอันดับต้นทั้งที่ขัดกับเป้าหมายผลตอบแทนของผู้ใช้
    "long":  {"quality": 0.40, "value": 0.30, "dividend": 0.15, "momentum": 0.15},
    "dividend": {"dividend": 0.60, "quality": 0.40},              # เน้นกระแสเงินสด
}

# ระยะ "เน้นปันผล" ต้องจ่ายปันผลจริงอย่างน้อยเท่านี้ถึงมีสิทธิ์ติดอันดับ
# เหตุผล: สูตรระยะนี้มีน้ำหนักคุณภาพกิจการ 40% หุ้นคุณภาพสูงที่แทบไม่จ่ายปันผล
# (เช่น NVDA ปันผล 0.45%) จึงเคยขึ้นอันดับ 1 ของระยะปันผลได้ ซึ่งขัดกับ
# สิ่งที่ผู้ใช้คาดหวังเมื่อกดดู "เน้นปันผล" — เห็นชัดเมื่อกรองเฉพาะกลุ่มเทคโนโลยี
MIN_DIVIDEND_YIELD_FOR_RANK = 0.015

TOP_N_PER_HORIZON = 10    # แสดงกี่ตัวต่อระยะบน Dashboard
TOP_N_FOR_AI = 10         # ส่งให้ AI วิเคราะห์เชิงลึกกี่ตัว (คุมค่าใช้จ่าย)

# ── AI Agents (เฟส 2) ───────────────────────────────────────────────────
# ความรู้ที่ใช้เป็นฐานการวิเคราะห์ — สกัดจาก Stocks_Trading_Master_Framework.docx
KNOWLEDGE_DIR = ROOT / "pipeline" / "knowledge"
FRAMEWORK_FILE = KNOWLEDGE_DIR / "framework.md"

AI_MODEL = "claude-sonnet-5"
# effort คุมความลึกของการคิดและค่าใช้จ่าย — low เพียงพอเพราะตัวเลขทั้งหมด
# Python คำนวณมาให้แล้ว งานของ AI คือ "อธิบาย" ไม่ใช่ "คำนวณ"
AI_EFFORT = "low"
AI_MAX_TOKENS = 8000      # เผื่อทั้งส่วนที่โมเดลใช้คิดและคำตอบ JSON

# วิเคราะห์ใหม่ทุกกี่วัน — บทวิเคราะห์เชิงคุณภาพ ("ธนาคารนี้หารายได้จากดอกเบี้ย")
# แทบไม่เปลี่ยนรายวัน ต่างจากตัวเลขที่อัปเดตทุกวัน จึงไม่คุ้มจะจ่ายเงินวิเคราะห์ใหม่ทุกรอบ
# ตั้ง env AI_FORCE=1 เพื่อบังคับวิเคราะห์ใหม่ทันทีโดยไม่รอครบกำหนด
AI_REFRESH_DAYS = 7
AI_CACHE_FILE = DATA_DIR / "ai_analysis.json"

# ราคาต่อ 1 ล้านโทเคนของ Sonnet 5 (ราคาโปรโมชันถึง 2026-08-31 · ปกติ $3/$15)
# ใช้ประมาณค่าใช้จ่ายในบันทึกการทำงานเท่านั้น ไม่ได้มีผลต่อการเรียก API
AI_PRICE_INPUT = 2.0
AI_PRICE_OUTPUT = 10.0
USD_TO_THB = 34.0

# ── ข้อความกำกับที่ต้องแสดงทุกหน้า ──────────────────────────────────────
DISCLAIMER = (
    "ข้อมูลในระบบนี้จัดทำเพื่อการศึกษาเท่านั้น ไม่ใช่คำแนะนำการลงทุน "
    "ผลตอบแทนในอดีตไม่ได้รับประกันผลตอบแทนในอนาคต "
    "การลงทุนมีความเสี่ยง ผู้ลงทุนควรศึกษาข้อมูลก่อนตัดสินใจลงทุน"
)
