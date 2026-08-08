"""จุดเริ่มการทำงานของ pipeline — รันวันละครั้งบน GitHub Actions

ลำดับการทำงาน:
  1. ดึงราคาย้อนหลังทุกสินทรัพย์ (yfinance เป็นชุดเดียว)
  2. ดึงข้อมูลพื้นฐานรายตัว
  3. วิเคราะห์เทคนิค + สกัดตัวชี้วัดพื้นฐาน
  4. ให้คะแนนปัจจัยแบบเปรียบเทียบกันเองภายในกลุ่ม
  5. คำนวณคะแนนแยกตามระยะการลงทุน แล้วจัดอันดับ
  6. เขียนผลลงไฟล์ JSON ใน data-private/

รันในเครื่อง:  python pipeline/main.py
"""

from __future__ import annotations

import json
import logging
import sys
from datetime import datetime, timezone
from pathlib import Path

# ให้ import โมดูลลูกได้โดยไม่ต้องติดตั้งเป็น package
sys.path.insert(0, str(Path(__file__).resolve().parent))

# อ่านค่าจาก .env เมื่อรันในเครื่อง — บน GitHub Actions ไม่มีไฟล์นี้
# ค่าจะมาจาก Secrets แทน และ load_dotenv() จะไม่ทำอะไรโดยไม่ error
from dotenv import load_dotenv                                  # noqa: E402

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

import pandas as pd                                            # noqa: E402

from config import (ASSET_DIR, BENCHMARKS, DATA_DIR, DISCLAIMER,   # noqa: E402
                    MIN_DIVIDEND_YIELD_FOR_RANK, TOP_N_PER_HORIZON,
                    build_universe)
from agents import analyst                                      # noqa: E402
from quant import factors, indicators, screener                 # noqa: E402
from sources import gold, stocks                                # noqa: E402

# บังคับ UTF-8 ก่อนตั้ง logging — ค่าเริ่มต้นบน Windows คือ cp874 ซึ่งทำให้
# ข้อความไทยใน log กลายเป็นตัวขยะจนอ่านไม่ออก
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-7s %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("pipeline")

# จำนวนแท่งราคาที่ส่งไปวาดกราฟบนเว็บ (1 ปีทำการ) — มากกว่านี้ไฟล์ใหญ่โดยไม่จำเป็น
CHART_BARS = 252


def build_records(prices: dict[str, pd.DataFrame],
                  info_map: dict[str, dict],
                  universe: list[dict]) -> list[dict]:
    """รวมข้อมูลราคา + พื้นฐาน + ผลวิเคราะห์เทคนิค เป็น record ต่อสินทรัพย์"""
    records: list[dict] = []

    # ตรวจหน่วยของอัตราปันผลครั้งเดียวจากทั้ง universe ก่อนใช้งาน
    dividend_divisor = factors.calibrate_dividend_unit(info_map)

    for item in universe:
        ticker = item["ticker"]
        df = prices.get(ticker)
        if df is None or df.empty:
            continue

        try:
            tech = indicators.analyze(df)
        except Exception as exc:                  # noqa: BLE001
            log.warning("วิเคราะห์เทคนิค %s ไม่สำเร็จ: %s", ticker, exc)
            continue

        fundamentals = factors.extract_fundamentals(
            info_map.get(ticker, {}), dividend_divisor
        )

        record = {**item, **fundamentals, **tech}
        record["score_technical"] = indicators.technical_score(tech)
        # ตั้งชื่อสำรองเมื่อ yfinance ไม่คืนชื่อบริษัท (พบบ่อยในหุ้นไทย)
        record["name"] = record.get("name") or item["symbol"]
        records.append(record)

    log.info("สร้าง record สำเร็จ %d ตัว", len(records))
    return records


def fetch_benchmarks() -> list[dict]:
    """ดึงดัชนีอ้างอิงตลาดสำหรับแสดงบนหัว Dashboard"""
    tickers = list(BENCHMARKS)
    try:
        prices, _ = stocks.fetch_prices(tickers)
    except Exception as exc:                      # noqa: BLE001
        log.warning("ดึงดัชนีอ้างอิงไม่สำเร็จ: %s", exc)
        return []

    out: list[dict] = []
    for ticker, name in BENCHMARKS.items():
        df = prices.get(ticker)
        if df is None or len(df) < 2:
            continue
        close = df["Close"].astype(float)
        last, prev = float(close.iloc[-1]), float(close.iloc[-2])
        ytd = None
        this_year = close[close.index.year == close.index[-1].year]
        if len(this_year) > 1:
            ytd = round(last / float(this_year.iloc[0]) - 1, 4)
        out.append({
            "ticker": ticker,
            "name": name,
            "price": round(last, 2),
            "change_1d": round(last / prev - 1, 4) if prev else None,
            "change_ytd": ytd,
        })
    return out


# ชื่อที่ Windows สงวนไว้ให้อุปกรณ์ — ห้ามใช้เป็นชื่อไฟล์แม้จะมีนามสกุลต่อท้าย
# COM7.BK (หุ้นไทย) เคยทำให้ git index ไฟล์ไม่ได้มาแล้ว
WINDOWS_RESERVED = {"CON", "PRN", "AUX", "NUL",
                    *(f"COM{i}" for i in range(1, 10)),
                    *(f"LPT{i}" for i in range(1, 10))}


def safe_filename(symbol: str) -> str:
    """แปลงสัญลักษณ์เป็นชื่อไฟล์ที่ปลอดภัยทุกระบบปฏิบัติการ

    ต้องตรงกับ safeFilename() ใน public/assets/asset.js เสมอ
    ถ้าแก้ที่นี่แล้วไม่แก้อีกฝั่ง หน้ารายตัวจะขึ้น 404 เฉพาะบางตัว
    """
    safe = symbol.replace("=", "_").replace("/", "_")
    if safe.upper() in WINDOWS_RESERVED:
        safe += "_"
    return safe


def write_asset_files(records: list[dict], prices: dict[str, pd.DataFrame],
                      generated_at: str, ai: dict | None = None) -> None:
    """เขียนไฟล์รายละเอียดรายตัว พร้อมข้อมูลกราฟ 1 ปี และผลวิเคราะห์ของ AI (ถ้ามี)"""
    ai = ai or {}
    ai_assets = ai.get("assets", {})
    ai_at = ai.get("generated_at")
    for rec in records:
        df = prices.get(rec["ticker"])
        history = []
        if df is not None:
            tail = df.tail(CHART_BARS)
            history = [
                {"d": idx.strftime("%Y-%m-%d"), "c": round(float(row["Close"]), 4)}
                for idx, row in tail.iterrows()
            ]

        analysis = ai_assets.get(rec["symbol"])
        payload = {**rec, "history": history, "disclaimer": DISCLAIMER,
                   "generated_at": generated_at, "ai": analysis,
                   # บทวิเคราะห์อาจเก่ากว่าตัวเลขได้ถึง 1 สัปดาห์ ต้องบอกผู้ใช้ให้ชัด
                   "ai_generated_at": ai_at if analysis else None}
        # ชื่อไฟล์ต้องปลอดภัยกับระบบไฟล์ (เช่น BRK-B, GC=F, COM7)
        (ASSET_DIR / f"{safe_filename(rec['symbol'])}.json").write_text(
            json.dumps(payload, ensure_ascii=False, allow_nan=False),
            encoding="utf-8",
        )


def slim(rec: dict) -> dict:
    """ตัด record ให้เหลือเฉพาะฟิลด์ที่ Dashboard ใช้ — ลดขนาดไฟล์ที่ส่งให้เว็บ"""
    keys = (
        "symbol", "ticker", "name", "asset_class", "market", "sector", "currency",
        "price", "trend", "trend_strength", "rsi", "data_quality",
        "ret_1w", "ret_1m", "ret_3m", "ret_6m", "ret_1y",
        "dividend_yield", "trailing_pe", "market_cap",
        "score_value", "score_quality", "score_momentum", "score_dividend",
        "score_technical", "horizon_scores",
        # ── ใช้โดยหน้าวางแผนการลงทุน (planner.html) ──
        # beta + volatility ป้อนโมเดล single-index ที่ใช้คำนวณความเสี่ยงของพอร์ต
        # max_drawdown_3y ใช้บอกว่าอดีตเคยติดลบหนักแค่ไหน (ตัวเลขที่คนมักประเมินต่ำไป)
        # payout_ratio + payout_sustainable ใช้กรองหุ้นที่จ่ายปันผลเกินกำไรออกจากพอร์ตปันผล
        # ถ้าไม่ใส่ตรงนี้ หน้าเว็บต้องยิงโหลดไฟล์รายตัวทีละ 146 ไฟล์
        "beta", "volatility", "max_drawdown_3y", "payout_ratio", "payout_sustainable",
    )
    return {k: rec.get(k) for k in keys}


def main() -> int:
    started = datetime.now(timezone.utc)
    log.info("เริ่ม pipeline")

    universe = build_universe()
    tickers = [u["ticker"] for u in universe]
    log.info("universe ทั้งหมด %d สินทรัพย์", len(tickers))

    prices, is_stale = stocks.fetch_prices(tickers)
    info_map = stocks.fetch_info(list(prices))

    records = build_records(prices, info_map, universe)
    if not records:
        log.error("ไม่มีข้อมูลให้วิเคราะห์เลย — หยุดการทำงาน")
        return 1

    factors.compute_factor_scores(records)
    for rec in records:
        rec["data_quality"] = factors.data_quality(rec)
        screener.compute_horizon_scores(rec)

    ranked = screener.rank_by_horizon(records)

    # วิเคราะห์ด้วย AI เฉพาะอันดับต้น — ถ้าไม่มี API key หรือเรียกไม่สำเร็จ
    # จะคืน dict ว่างและ pipeline ทำงานต่อได้ตามปกติ
    ai_analysis = analyst.analyse(records, ranked)

    dashboard = {
        "generated_at": started.isoformat(),
        "is_stale": is_stale,
        "stale_note": (
            "ดึงข้อมูลใหม่ไม่สำเร็จ กำลังแสดงข้อมูลจากรอบก่อนหน้า"
            if is_stale else ""
        ),
        "summary": screener.summarise(records),
        # เกณฑ์ที่ใช้จัดอันดับ — ส่งไปให้เว็บด้วย เพราะหน้า Dashboard จัดอันดับ
        # ซ้ำเองเมื่อผู้ใช้กรองตามกลุ่ม/อุตสาหกรรม ต้องใช้เกณฑ์ชุดเดียวกัน
        # ไม่งั้นอันดับ "ทั้งหมด" ที่คำนวณสองที่จะไม่ตรงกัน
        "screening": {
            "min_confidence": screener.MIN_CONFIDENCE,
            "min_dividend_yield": MIN_DIVIDEND_YIELD_FOR_RANK,
            "top_n": TOP_N_PER_HORIZON,
        },
        "benchmarks": fetch_benchmarks(),
        "thai_gold": gold.fetch_thai_gold(),
        "horizons": {
            horizon: {
                "label": screener.HORIZON_LABELS[horizon],
                "items": [slim(r) for r in items],
            }
            for horizon, items in ranked.items()
        },
        "movers": {
            key: [slim(r) for r in items]
            for key, items in screener.movers(records).items()
        },
        "all_assets": [slim(r) for r in records],
        # บอกเว็บว่าตัวไหนมีบทวิเคราะห์ AI จะได้ขึ้นป้ายบอกได้โดยไม่ต้องโหลดไฟล์รายตัว
        "ai_symbols": sorted(ai_analysis.get("assets", {})),
        "disclaimer": DISCLAIMER,
    }

    (DATA_DIR / "dashboard.json").write_text(
        json.dumps(dashboard, ensure_ascii=False, allow_nan=False),
        encoding="utf-8",
    )
    write_asset_files(records, prices, started.isoformat(), ai_analysis)

    elapsed = (datetime.now(timezone.utc) - started).total_seconds()
    log.info("เสร็จสิ้นใน %.1f วินาที — เขียน dashboard.json + %d ไฟล์รายตัว",
             elapsed, len(records))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
