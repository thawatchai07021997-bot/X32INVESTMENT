"""ดึงราคาย้อนหลังและข้อมูลพื้นฐานจาก Yahoo Finance (yfinance)

**ข้อควรรู้:** yfinance ไม่ใช่ API ทางการของ Yahoo อาจล่มหรือเปลี่ยนโครงสร้าง
ได้ทุกเมื่อ โมดูลนี้จึงเก็บ cache ไว้เสมอ และถ้าดึงข้อมูลใหม่ไม่ได้จะใช้ของเดิม
พร้อมทำเครื่องหมายว่าเป็นข้อมูลเก่า (stale) เพื่อให้เว็บแสดงป้ายเตือนได้
"""

from __future__ import annotations

import json
import logging
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone

import pandas as pd
import yfinance as yf

from config import CACHE_DIR, HISTORY_PERIOD, MIN_BARS

log = logging.getLogger(__name__)

PRICE_CACHE = CACHE_DIR / "prices.parquet"
INFO_CACHE = CACHE_DIR / "info.json"
DIVIDEND_CACHE = CACHE_DIR / "dividends.json"

# ดึง .info ทีละตัวพร้อมกันกี่เส้น — สูงกว่านี้เสี่ยงโดน Yahoo จำกัดอัตราการเรียก
INFO_WORKERS = 6


def fetch_prices(tickers: list[str],
                 use_cache: bool = True) -> tuple[dict[str, pd.DataFrame], bool]:
    """ดึงราคาย้อนหลังของทุก ticker พร้อมกันเป็นชุดเดียว

    Args:
        tickers: รายการสัญลักษณ์
        use_cache: True = เขียน cache หลังดึงสำเร็จ และใช้ cache เมื่อดึงไม่สำเร็จ
            **ต้องตั้ง False เมื่อดึงชุดย่อย** (เช่นดัชนีอ้างอิง 6 ตัว) ไม่งั้น cache
            ของ universe เต็มจะถูกเขียนทับด้วยชุดย่อย แล้ววันที่ yfinance ล่มจริง
            ระบบจะไม่มีราคาหุ้นสำรองเหลือเลย

    Returns:
        (prices, is_stale) — prices เป็น dict ticker → DataFrame OHLCV
        is_stale = True แปลว่าดึงใหม่ไม่สำเร็จ กำลังใช้ข้อมูลจาก cache
    """
    try:
        raw = yf.download(
            tickers=" ".join(tickers),
            period=HISTORY_PERIOD,
            interval="1d",
            group_by="ticker",
            auto_adjust=True,     # ปรับราคาย้อนหลังตามปันผล/แตกพาร์แล้ว
            # ขอคอลัมน์ Dividends มาด้วยในคำขอเดียวกัน — ใช้หา "เดือนที่ปกติจ่ายปันผล"
            # ทางเลือกอื่นคือเรียก Ticker(t).dividends ทีละตัว = 146 คำขอเพิ่ม
            # ซึ่งเสี่ยงโดน Yahoo จำกัดอัตราการเรียกโดยไม่ได้ข้อมูลเพิ่มเลย
            actions=True,
            threads=True,
            progress=False,
        )
        if raw is None or raw.empty:
            raise ValueError("yfinance คืนข้อมูลว่าง")

        prices = _split_by_ticker(raw, tickers)
        if not prices:
            raise ValueError("แยกข้อมูลรายตัวไม่ได้")

        if use_cache:
            _save_price_cache(prices)
        log.info("ดึงราคาสำเร็จ %d/%d ตัว", len(prices), len(tickers))
        return prices, False

    except Exception as exc:                      # noqa: BLE001
        if not use_cache:
            raise
        log.error("ดึงราคาไม่สำเร็จ (%s) — เปลี่ยนไปใช้ cache", exc)
        cached = _load_price_cache(tickers)
        if not cached:
            raise RuntimeError(
                "ดึงราคาไม่ได้และไม่มี cache สำรอง — หยุดการทำงาน"
            ) from exc
        return cached, True


def _split_by_ticker(raw: pd.DataFrame,
                     tickers: list[str]) -> dict[str, pd.DataFrame]:
    """แยก DataFrame คอลัมน์ซ้อน (MultiIndex) ของ yfinance ออกเป็นรายตัว"""
    out: dict[str, pd.DataFrame] = {}
    needed = ["Open", "High", "Low", "Close", "Volume"]
    # Dividends มาเมื่อขอ actions=True — ถือเป็นของแถม ขาดไปก็ยังวิเคราะห์ราคาได้
    optional = ["Dividends"]

    for ticker in tickers:
        try:
            if isinstance(raw.columns, pd.MultiIndex):
                if ticker not in raw.columns.get_level_values(0):
                    continue
                df = raw[ticker].copy()
            else:
                # ดึง ticker เดียว yfinance คืนคอลัมน์ชั้นเดียว
                df = raw.copy()

            if not all(c in df.columns for c in needed):
                continue

            keep = needed + [c for c in optional if c in df.columns]
            df = df[keep].dropna(subset=["Close"])
            if len(df) < MIN_BARS:
                log.warning("%s มีข้อมูลแค่ %d แท่ง — ข้าม", ticker, len(df))
                continue

            df.index = pd.to_datetime(df.index)
            out[ticker] = df.sort_index()
        except Exception as exc:                  # noqa: BLE001
            log.warning("แยกข้อมูล %s ไม่ได้: %s", ticker, exc)
    return out


def fetch_info(tickers: list[str]) -> dict[str, dict]:
    """ดึงข้อมูลพื้นฐาน (P/E, ROE, ปันผล ฯลฯ) ทีละตัวแบบขนาน

    ตัวที่ดึงไม่ได้จะใช้ค่าจาก cache แทน ถ้าไม่มี cache จะได้ dict ว่าง
    ซึ่งระบบจะจัดให้เป็นสินทรัพย์ที่วิเคราะห์ได้เฉพาะทางเทคนิค
    """
    cached = _load_info_cache()
    results: dict[str, dict] = {}

    def one(ticker: str) -> tuple[str, dict]:
        for attempt in range(2):
            try:
                info = yf.Ticker(ticker).info
                if info and info.get("symbol"):
                    return ticker, info
            except Exception as exc:              # noqa: BLE001
                if attempt == 0:
                    time.sleep(1.5)               # หน่วงก่อนลองใหม่ครั้งเดียว
                    continue
                log.debug("ดึง info %s ไม่ได้: %s", ticker, exc)
        return ticker, {}

    with ThreadPoolExecutor(max_workers=INFO_WORKERS) as pool:
        futures = [pool.submit(one, t) for t in tickers]
        for fut in as_completed(futures):
            ticker, info = fut.result()
            # ดึงไม่ได้ → ใช้ของเดิมจาก cache ดีกว่าไม่มีข้อมูลเลย
            results[ticker] = info or cached.get(ticker, {})

    got = sum(1 for v in results.values() if v)
    log.info("ดึงข้อมูลพื้นฐานสำเร็จ %d/%d ตัว", got, len(tickers))

    _save_info_cache({**cached, **{k: v for k, v in results.items() if v}})
    return results


def extract_dividends(prices: dict[str, pd.DataFrame]) -> dict[str, list[dict]]:
    """แยกรายการจ่ายปันผลออกจากคอลัมน์ Dividends ที่มาพร้อมราคา

    ไม่มีการเรียกเครือข่ายเพิ่ม — คอลัมน์นี้มาจาก actions=True ใน fetch_prices()

    Returns:
        {ticker: [{"date": "YYYY-MM-DD", "amount": float}, ...]} เรียงตามวันที่
        ตัวที่รอบนี้อ่านคอลัมน์ไม่ได้ (เช่นใช้ cache ราคารุ่นเก่าที่ยังไม่มีคอลัมน์นี้)
        จะใช้ข้อมูลจากไฟล์ cache แทน เพื่อให้ปฏิทินปันผลไม่หายไปทั้งหน้า
    """
    cached = _load_dividend_cache()
    fresh: dict[str, list[dict]] = {}
    covered: set[str] = set()

    for ticker, df in prices.items():
        if "Dividends" not in df.columns:
            continue
        covered.add(ticker)
        series = pd.to_numeric(df["Dividends"], errors="coerce").fillna(0.0)
        paid = series[series > 0]
        if paid.empty:
            continue
        fresh[ticker] = [
            {"date": idx.strftime("%Y-%m-%d"), "amount": round(float(v), 6)}
            for idx, v in paid.items()
        ]

    # ตัวที่อ่านคอลัมน์ได้ถือเป็นข้อมูลสดเสมอ ต้องทับของเดิมแม้จะกลายเป็น "ไม่มีการจ่าย"
    # ไม่งั้นบริษัทที่เลิกจ่ายปันผลจะยังโชว์ปฏิทินเดิมค้างอยู่ตลอดไป
    merged = {t: v for t, v in cached.items() if t not in covered}
    merged.update(fresh)

    if covered:
        _save_dividend_cache(merged)
        log.info("อ่านประวัติปันผลได้ %d ตัว (จากราคาที่ดึงมาแล้ว ไม่มีคำขอเพิ่ม)", len(fresh))
    else:
        log.warning("ราคาที่ได้ไม่มีคอลัมน์ Dividends — ใช้ปฏิทินปันผลจาก cache %d ตัว",
                    len(merged))
    return merged


# ── Cache ───────────────────────────────────────────────────────────────


def _save_dividend_cache(data: dict[str, list[dict]]) -> None:
    try:
        DIVIDEND_CACHE.write_text(
            json.dumps({"updated": datetime.now(timezone.utc).isoformat(),
                        "data": data}, ensure_ascii=False),
            encoding="utf-8",
        )
    except Exception as exc:                      # noqa: BLE001
        log.warning("เขียน cache ปันผลไม่สำเร็จ: %s", exc)


def _load_dividend_cache() -> dict[str, list[dict]]:
    if not DIVIDEND_CACHE.exists():
        return {}
    try:
        return json.loads(DIVIDEND_CACHE.read_text(encoding="utf-8")).get("data", {})
    except Exception as exc:                      # noqa: BLE001
        log.warning("อ่าน cache ปันผลไม่สำเร็จ: %s", exc)
        return {}


def _save_price_cache(prices: dict[str, pd.DataFrame]) -> None:
    """เก็บราคาทุกตัวเป็นตารางเดียวในรูปแบบ parquet (เล็กและอ่านเร็ว)"""
    try:
        frames = []
        for ticker, df in prices.items():
            tmp = df.copy()
            tmp["ticker"] = ticker
            frames.append(tmp.reset_index().rename(columns={"index": "Date"}))
        if frames:
            pd.concat(frames, ignore_index=True).to_parquet(PRICE_CACHE, index=False)
    except Exception as exc:                      # noqa: BLE001
        log.warning("เขียน cache ราคาไม่สำเร็จ: %s", exc)


def _load_price_cache(tickers: list[str]) -> dict[str, pd.DataFrame]:
    """อ่านราคาจาก cache — ใช้เมื่อดึงข้อมูลสดไม่สำเร็จ"""
    if not PRICE_CACHE.exists():
        return {}
    try:
        df = pd.read_parquet(PRICE_CACHE)
        date_col = "Date" if "Date" in df.columns else df.columns[0]
        out: dict[str, pd.DataFrame] = {}
        for ticker, grp in df[df["ticker"].isin(tickers)].groupby("ticker"):
            g = grp.drop(columns=["ticker"]).set_index(date_col).sort_index()
            g.index = pd.to_datetime(g.index)
            if len(g) >= MIN_BARS:
                out[str(ticker)] = g
        return out
    except Exception as exc:                      # noqa: BLE001
        log.warning("อ่าน cache ราคาไม่สำเร็จ: %s", exc)
        return {}


def _save_info_cache(info_map: dict[str, dict]) -> None:
    """เก็บเฉพาะฟิลด์ที่ใช้จริง — .info เต็มๆ ใหญ่มากและมีข้อมูลที่ไม่ได้ใช้เยอะ"""
    keep = {
        "symbol", "longName", "shortName", "sector", "industry", "currency",
        "marketCap", "trailingPE", "forwardPE", "priceToBook", "enterpriseToEbitda",
        "freeCashflow", "returnOnEquity", "profitMargins", "debtToEquity",
        "revenueGrowth", "earningsGrowth", "dividendYield", "payoutRatio", "beta",
        # จำเป็นสำหรับเทียบหน่วยอัตราปันผล — ขาดไปแล้วรอบที่ใช้ cache จะเทียบไม่ได้
        "dividendRate", "currentPrice", "regularMarketPrice", "previousClose",
    }
    try:
        slim = {
            t: {k: v for k, v in info.items() if k in keep}
            for t, info in info_map.items() if info
        }
        INFO_CACHE.write_text(
            json.dumps({"updated": datetime.now(timezone.utc).isoformat(),
                        "data": slim}, ensure_ascii=False),
            encoding="utf-8",
        )
    except Exception as exc:                      # noqa: BLE001
        log.warning("เขียน cache ข้อมูลพื้นฐานไม่สำเร็จ: %s", exc)


def _load_info_cache() -> dict[str, dict]:
    """อ่านข้อมูลพื้นฐานจาก cache"""
    if not INFO_CACHE.exists():
        return {}
    try:
        payload = json.loads(INFO_CACHE.read_text(encoding="utf-8"))
        return payload.get("data", {})
    except Exception as exc:                      # noqa: BLE001
        log.warning("อ่าน cache ข้อมูลพื้นฐานไม่สำเร็จ: %s", exc)
        return {}
