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


# ── ธีมการลงทุนข้ามอุตสาหกรรม ───────────────────────────────────────────
# yfinance ให้ "sector" ตามการจัดประเภทมาตรฐานเท่านั้น (เทคโนโลยี/การเงิน/...)
# แต่ธีมอย่าง "AI และชิป" หรือ "สังคมสูงวัย" กินหลาย sector พร้อมกัน —
# NVDA อยู่ Technology ส่วน DELTA อยู่ Industrials ทั้งที่โตด้วยแรงเดียวกัน
#
# **ธีมทั้งหมดที่นี่เป็นการจัดกลุ่มด้วยมือ ไม่ได้มาจากข้อมูล** จึงต้องบอกผู้ใช้
# บนหน้าเว็บให้ชัด และต้องเขียน rationale กำกับทุกธีมว่าจัดเข้ากลุ่มด้วยเหตุผลอะไร
#
# สัญลักษณ์ที่ไม่มีใน universe จะถูกตัดทิ้งพร้อม log เตือนตอน build
# (ดู build_themes) — กันไม่ให้ธีมค่อยๆ กลายเป็นรายชื่อผีเมื่อ universe เปลี่ยน
THEMES = [
    {
        "id": "ai_chip",
        "label": "AI และเซมิคอนดักเตอร์",
        "rationale": "ทุกตัวในกลุ่มนี้รายได้ผูกกับการลงทุนสร้างศูนย์ข้อมูล AI "
                     "ไม่ว่าจะเป็นผู้ออกแบบชิป ผู้ผลิตเครื่องจักร หรือผู้ประกอบแผงวงจร",
        "th": ["DELTA", "KCE"],
        "foreign": ["NVDA", "AVGO", "AMD", "MU", "AMAT", "TXN", "QCOM", "MSFT", "GOOGL",
               "META", "ORCL", "NOW", "PANW", "XLK"],
    },
    {
        "id": "power_grid",
        "label": "โครงสร้างพื้นฐานไฟฟ้าและพลังงานสะอาด",
        "rationale": "ศูนย์ข้อมูล AI รถยนต์ไฟฟ้า และการเปลี่ยนผ่านพลังงาน "
                     "ทำให้ความต้องการไฟฟ้าโตเร็วกว่าที่ระบบสายส่งเดิมรองรับไหว "
                     "กลุ่มนี้คือผู้ผลิตไฟและผู้วางโครงสร้างพื้นฐาน",
        "th": ["GULF", "GPSC", "BGRIM", "EGCO", "RATCH", "EA", "BANPU"],
        "foreign": ["NEE", "DUK", "SO", "GE", "HON", "CAT"],
    },
    {
        "id": "aging",
        "label": "สังคมสูงวัยและการแพทย์",
        "rationale": "สัดส่วนผู้สูงอายุที่เพิ่มขึ้นทั้งไทยและประเทศพัฒนาแล้ว "
                     "ทำให้ค่าใช้จ่ายด้านสุขภาพ ยา และประกันชีวิตโตต่อเนื่องโดยไม่ขึ้นกับวัฏจักรเศรษฐกิจ",
        "th": ["BDMS", "BH", "TLI"],
        "foreign": ["UNH", "JNJ", "LLY", "ABBV", "MRK", "PFE", "TMO", "ABT", "AMGN",
               "ISRG", "XLV"],
    },
    {
        "id": "cloud_software",
        "label": "คลาวด์และซอฟต์แวร์องค์กร",
        "rationale": "รายได้เป็นค่าบริการรายเดือนที่ลูกค้าเลิกใช้ยาก "
                     "จึงคาดการณ์กระแสเงินสดได้แม่นกว่าธุรกิจที่ขายเป็นครั้งๆ",
        "th": [],
        "foreign": ["MSFT", "GOOGL", "AMZN", "CRM", "ADBE", "NOW", "ORCL", "INTU", "PANW"],
    },
    {
        "id": "th_consumption",
        "label": "การบริโภคและท่องเที่ยวไทย",
        "rationale": "รายได้ผูกกับกำลังซื้อในประเทศและจำนวนนักท่องเที่ยว "
                     "เป็นกลุ่มที่ได้ประโยชน์ตรงที่สุดเมื่อเศรษฐกิจไทยฟื้น",
        "th": ["CPALL", "CRC", "HMPRO", "GLOBAL", "CENTEL", "MINT", "AOT", "BEM",
               "BTS", "OSP", "CBG", "TRUE"],
        "foreign": [],
    },
    {
        "id": "financials_rates",
        "label": "การเงินและอัตราดอกเบี้ย",
        "rationale": "กำไรของกลุ่มนี้ขึ้นกับส่วนต่างดอกเบี้ยและปริมาณธุรกรรม "
                     "จึงเคลื่อนไหวสวนทางกับหุ้นเติบโตเมื่อดอกเบี้ยเปลี่ยนทิศ",
        "th": ["KBANK", "SCB", "BBL", "KTB", "TTB", "TISCO", "MTC", "SAWAD", "KTC"],
        "foreign": ["JPM", "BAC", "WFC", "GS", "MS", "V", "MA", "AXP", "BLK", "BRK-B", "XLF"],
    },
    {
        "id": "energy_materials",
        "label": "พลังงานและวัตถุดิบ",
        "rationale": "ราคาสินค้าโภคภัณฑ์เป็นตัวกำหนดกำไรโดยตรง "
                     "ถือไว้เพื่อชดเชยตอนเงินเฟ้อสูง ซึ่งเป็นช่วงที่หุ้นเติบโตมักทำได้แย่",
        "th": ["PTT", "PTTEP", "TOP", "PTTGC", "IVL", "SCC", "SCGP", "BANPU"],
        "foreign": ["XOM", "CVX", "COP", "XLE"],
    },
    {
        "id": "defensive",
        "label": "สินทรัพย์พักเงินและลดความเสี่ยง",
        "rationale": "ไม่ได้อยู่ในนี้เพราะโตเร็ว แต่เพราะมักไม่ลงพร้อมหุ้น "
                     "ใช้ถ่วงพอร์ตให้ช่วงผลลัพธ์แคบลงในปีที่ตลาดหุ้นแย่",
        "th": [],
        "foreign": ["GC=F", "GLD", "IAU", "TLT", "IEF", "LQD", "KO", "PG", "PEP",
               "WMT", "COST", "XLP"],
    },
]


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

# ── Sector Analyst (บทวิเคราะห์รายอุตสาหกรรม/ธีม) ───────────────────────
# บทวิเคราะห์แนวโน้มระยะกลาง-ยาวของทั้งอุตสาหกรรมเปลี่ยนช้ากว่าบทวิเคราะห์รายตัวมาก
# (โครงสร้างการเติบโตของอุตสาหกรรมไม่ได้พลิกใน 1 สัปดาห์) จึงวิเคราะห์ใหม่ทุก 30 วัน
# บังคับเขียนใหม่ทันทีด้วย env SECTOR_AI_FORCE=1
SECTOR_AI_REFRESH_DAYS = 30
SECTOR_AI_CACHE_FILE = DATA_DIR / "sector_analysis.json"
# **max_tokens ต้องรวมโทเคนที่โมเดลใช้คิดด้วย ไม่ใช่แค่ความยาวคำตอบ**
# ตั้งไว้ 12000 กับ effort medium แล้วเจอ JSON ถูกตัดกลางประโยคทุกครั้ง
# เพราะการคิดกินไปเกือบหมดก่อนจะเริ่มเขียน · ภาษาไทยกินโทเคนมากกว่าอังกฤษราวเท่าตัว
SECTOR_AI_MAX_TOKENS = 20000
# effort low พอสำหรับงานนี้ เพราะโครงของบทความถูกกำหนดด้วย schema ไว้แล้ว
# และตัวเลขทุกตัว Python คำนวณมาให้ — งานของโมเดลคือเชื่อมโยงและอธิบาย ไม่ใช่ค้นหาคำตอบ
# ขยับเป็น medium ได้ถ้าพบว่าบทความตื้นไป แต่ต้องเผื่อ max_tokens เพิ่มด้วย
SECTOR_AI_EFFORT = "low"
# กลุ่มที่มีสมาชิกน้อยกว่านี้ไม่ส่งให้ AI เขียน — เขียนถึง "แนวโน้มอุตสาหกรรม"
# จากหุ้นตัวเดียวไม่ได้ และเปลืองเงินโดยได้บทความที่พูดถึงบริษัทเดียว
SECTOR_MIN_MEMBERS = 3
# หุ้นเด่นที่ยกมาประกอบบทวิเคราะห์ต่อกลุ่ม
SECTOR_TOP_PICKS = 5

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
