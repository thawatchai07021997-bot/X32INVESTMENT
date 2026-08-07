"""ตัวชี้วัดทางเทคนิค (Technical Indicators) สำหรับข้อมูลรายวัน

เขียนด้วย pandas/numpy ล้วน ไม่พึ่ง TA-Lib หรือ pandas_ta
ดัดแปลงจาก X.15/trading_system/technical_analysis.py (เดิมออกแบบสำหรับ forex
รายชั่วโมง) ให้เหมาะกับแท่งเทียนรายวันและการลงทุนระยะกลาง-ยาว

ทุกฟังก์ชันรับ pandas Series/DataFrame และคืนค่าเป็น Series/DataFrame
ส่วน analyze() คืน dict ที่พร้อมเขียนลง JSON ได้เลย
"""

from __future__ import annotations

import numpy as np
import pandas as pd

# ── ตัวชี้วัดพื้นฐาน ─────────────────────────────────────────────────────


def sma(series: pd.Series, window: int) -> pd.Series:
    """Simple Moving Average — ค่าเฉลี่ยราคาย้อนหลัง n วัน"""
    return series.rolling(window, min_periods=window).mean()


def ema(series: pd.Series, span: int) -> pd.Series:
    """Exponential Moving Average — ถ่วงน้ำหนักราคาล่าสุดมากกว่า"""
    return series.ewm(span=span, adjust=False).mean()


def rsi(series: pd.Series, window: int = 14) -> pd.Series:
    """Relative Strength Index (0-100)

    ใช้ Wilder's smoothing (ewm alpha=1/n) ซึ่งเป็นสูตรดั้งเดิม
    ต่างจากการใช้ rolling mean ธรรมดาที่ให้ค่าเพี้ยนเล็กน้อย
    >70 = ซื้อมากเกินไป, <30 = ขายมากเกินไป
    """
    delta = series.diff()
    gain = delta.clip(lower=0)
    loss = -delta.clip(upper=0)

    avg_gain = gain.ewm(alpha=1 / window, adjust=False, min_periods=window).mean()
    avg_loss = loss.ewm(alpha=1 / window, adjust=False, min_periods=window).mean()

    # กัน division by zero: ถ้าไม่มีวันที่ราคาลงเลย RSI = 100
    rs = avg_gain / avg_loss.replace(0, np.nan)
    out = 100 - (100 / (1 + rs))
    return out.fillna(100.0).where(avg_gain.notna(), np.nan)


def macd(series: pd.Series, fast: int = 12, slow: int = 26,
         signal: int = 9) -> pd.DataFrame:
    """MACD — วัดโมเมนตัมจากส่วนต่างของ EMA สองเส้น

    Returns:
        DataFrame คอลัมน์ macd, signal, hist
    """
    macd_line = ema(series, fast) - ema(series, slow)
    signal_line = ema(macd_line, signal)
    return pd.DataFrame({
        "macd": macd_line,
        "signal": signal_line,
        "hist": macd_line - signal_line,
    })


def bollinger(series: pd.Series, window: int = 20,
              n_std: float = 2.0) -> pd.DataFrame:
    """Bollinger Bands — กรอบราคาที่ ±n เท่าของส่วนเบี่ยงเบนมาตรฐาน

    bb_pct = ตำแหน่งราคาในกรอบ (0 = ขอบล่าง, 1 = ขอบบน)
    width  = ความกว้างกรอบเทียบราคา (แคบ = ตลาดนิ่ง มักตามด้วยการเคลื่อนไหวแรง)
    """
    mid = sma(series, window)
    std = series.rolling(window, min_periods=window).std()
    upper, lower = mid + n_std * std, mid - n_std * std
    span = (upper - lower).replace(0, np.nan)
    return pd.DataFrame({
        "upper": upper,
        "middle": mid,
        "lower": lower,
        "width": span / mid,
        "bb_pct": (series - lower) / span,
    })


def atr(df: pd.DataFrame, window: int = 14) -> pd.Series:
    """Average True Range — ค่าเฉลี่ยช่วงราคาที่แกว่งต่อวัน (ใช้วัดความผันผวน)"""
    high, low, close = df["High"], df["Low"], df["Close"]
    prev_close = close.shift(1)
    true_range = pd.concat([
        high - low,
        (high - prev_close).abs(),
        (low - prev_close).abs(),
    ], axis=1).max(axis=1)
    return true_range.ewm(alpha=1 / window, adjust=False,
                          min_periods=window).mean()


def annualised_volatility(series: pd.Series, window: int = 60) -> pd.Series:
    """ความผันผวนต่อปี คำนวณจากส่วนเบี่ยงเบนของผลตอบแทนรายวัน (252 วันทำการ)"""
    return series.pct_change().rolling(window).std() * np.sqrt(252)


def max_drawdown(series: pd.Series) -> float:
    """การขาดทุนสูงสุดจากจุดสูงสุด (เป็นค่าลบ เช่น -0.35 = เคยลง 35%)"""
    if series.empty:
        return 0.0
    running_max = series.cummax()
    return float((series / running_max - 1).min())


# ── การตีความ ───────────────────────────────────────────────────────────


def _support_resistance(df: pd.DataFrame, lookback: int = 120,
                        n_levels: int = 3) -> tuple[list[float], list[float]]:
    """หาแนวรับ/แนวต้านจากจุดกลับตัวในอดีต (swing high/low)

    วิธี: หาแท่งที่ราคาสูง/ต่ำกว่าเพื่อนบ้าน 5 แท่งทั้งสองข้าง
    แล้วเลือกระดับที่ใกล้ราคาปัจจุบันที่สุด
    """
    window = df.tail(lookback)
    if len(window) < 20:
        return [], []

    high, low, price = window["High"], window["Low"], float(window["Close"].iloc[-1])
    k = 5
    is_swing_high = (high == high.rolling(k * 2 + 1, center=True).max())
    is_swing_low = (low == low.rolling(k * 2 + 1, center=True).min())

    resistances = sorted({round(float(v), 4) for v in high[is_swing_high] if v > price})
    supports = sorted({round(float(v), 4) for v in low[is_swing_low] if v < price},
                      reverse=True)
    return supports[:n_levels], resistances[:n_levels]


def _detect_trend(close: pd.Series) -> tuple[str, float]:
    """ระบุแนวโน้มจากการเรียงตัวของเส้นค่าเฉลี่ย + ความชัน

    Returns:
        (trend, strength) — trend: uptrend/downtrend/sideways, strength 0-100
    """
    if close.notna().sum() < 60:
        return "sideways", 0.0

    ma20 = sma(close, 20).iloc[-1]
    ma50 = sma(close, 50).iloc[-1]
    ma200 = sma(close, 200).iloc[-1] if close.notna().sum() >= 200 else np.nan
    price = float(close.iloc[-1])

    # ความชันของ MA50 ในรอบ 20 วัน (คิดเป็น % ของราคา)
    ma50_series = sma(close, 50)
    slope = 0.0
    if ma50_series.notna().sum() > 20:
        slope = float((ma50_series.iloc[-1] - ma50_series.iloc[-21]) / price)

    checks_up = [price > ma20, ma20 > ma50, slope > 0]
    checks_down = [price < ma20, ma20 < ma50, slope < 0]
    if not np.isnan(ma200):
        checks_up.append(price > ma200)
        checks_down.append(price < ma200)

    up_score = sum(checks_up) / len(checks_up)
    down_score = sum(checks_down) / len(checks_down)

    if up_score >= 0.75:
        return "uptrend", round(up_score * 100, 1)
    if down_score >= 0.75:
        return "downtrend", round(down_score * 100, 1)
    return "sideways", round(max(up_score, down_score) * 100, 1)


def analyze(df: pd.DataFrame) -> dict:
    """วิเคราะห์เทคนิคครบชุดจาก OHLCV รายวัน

    Args:
        df: DataFrame ที่มีคอลัมน์ Open/High/Low/Close/Volume เรียงตามวันที่

    Returns:
        dict พร้อมเขียนลง JSON — ค่าที่คำนวณไม่ได้จะเป็น None ไม่ใช่ NaN
        (json.dump เขียน NaN ออกมาเป็น NaN ซึ่ง JSON.parse ฝั่งเว็บอ่านไม่ได้)
    """
    close = df["Close"].astype(float)
    n = len(df)

    macd_df = macd(close)
    bb = bollinger(close)
    supports, resistances = _support_resistance(df)
    trend, trend_strength = _detect_trend(close)

    def last(series: pd.Series) -> float | None:
        """ค่าล่าสุดที่ไม่ใช่ NaN — คืน None ถ้าคำนวณไม่ได้"""
        if series is None or series.dropna().empty:
            return None
        return round(float(series.dropna().iloc[-1]), 4)

    def pct_return(days: int) -> float | None:
        """ผลตอบแทนย้อนหลัง n วันทำการ (ทศนิยม เช่น 0.12 = +12%)"""
        if n <= days:
            return None
        past = float(close.iloc[-days - 1])
        if past == 0:
            return None
        return round(float(close.iloc[-1]) / past - 1, 4)

    price = float(close.iloc[-1])
    ma50, ma200 = last(sma(close, 50)), last(sma(close, 200))
    atr_val = last(atr(df))
    macd_hist = last(macd_df["hist"])

    # Golden cross / death cross ในรอบ 30 วันที่ผ่านมา
    cross = "none"
    if n >= 200:
        diff = (sma(close, 50) - sma(close, 200)).dropna()
        if len(diff) > 30:
            recent = diff.tail(30)
            if (recent.iloc[0] < 0) and (recent.iloc[-1] > 0):
                cross = "golden_cross"
            elif (recent.iloc[0] > 0) and (recent.iloc[-1] < 0):
                cross = "death_cross"

    return {
        "price": round(price, 4),
        "trend": trend,
        "trend_strength": trend_strength,
        "rsi": last(rsi(close)),
        "macd_hist": macd_hist,
        "macd_bullish": bool(macd_hist is not None and macd_hist > 0),
        "bb_pct": last(bb["bb_pct"]),
        "bb_width": last(bb["width"]),
        "sma50": ma50,
        "sma200": ma200,
        "price_vs_sma50": round(price / ma50 - 1, 4) if ma50 else None,
        "price_vs_sma200": round(price / ma200 - 1, 4) if ma200 else None,
        "cross": cross,
        "atr": atr_val,
        "atr_pct": round(atr_val / price, 4) if atr_val and price else None,
        "volatility": last(annualised_volatility(close)),
        "max_drawdown_3y": round(max_drawdown(close), 4),
        "ret_1w": pct_return(5),
        "ret_1m": pct_return(21),
        "ret_3m": pct_return(63),
        "ret_6m": pct_return(126),
        "ret_1y": pct_return(252),
        "support": supports,
        "resistance": resistances,
        "bars": n,
    }


def technical_score(tech: dict) -> float:
    """แปลงผลวิเคราะห์เทคนิคเป็นคะแนน 0-100 สำหรับจัดอันดับ

    ให้คะแนนจาก 5 มิติที่ถ่วงน้ำหนักเท่าๆ กัน — จงใจให้เรียบง่ายและตรวจสอบได้
    มากกว่าจะซับซ้อนจนอธิบายที่มาของคะแนนให้ผู้ใช้ไม่ได้
    """
    score, weight_used = 0.0, 0.0

    def add(points: float, weight: float = 1.0) -> None:
        nonlocal score, weight_used
        score += points * weight
        weight_used += weight

    # 1) แนวโน้ม
    add({"uptrend": 100, "sideways": 50, "downtrend": 0}[tech["trend"]])

    # 2) ราคาเทียบเส้นค่าเฉลี่ยระยะยาว — อยู่เหนือ SMA200 คือสัญญาณขาขึ้นระยะยาว
    if tech.get("price_vs_sma200") is not None:
        # -20% → 0 คะแนน, +20% → 100 คะแนน
        add(float(np.clip((tech["price_vs_sma200"] + 0.20) / 0.40 * 100, 0, 100)))

    # 3) RSI — ให้คะแนนสูงสุดที่โซน 45-65 (มีแรงแต่ยังไม่ร้อนเกิน)
    if tech.get("rsi") is not None:
        r = tech["rsi"]
        if 45 <= r <= 65:
            add(100)
        elif r < 30 or r > 80:
            add(20)          # สุดขั้วทั้งสองทางถือว่าเสี่ยง
        else:
            add(60)

    # 4) โมเมนตัม MACD
    if tech.get("macd_hist") is not None:
        add(100 if tech["macd_hist"] > 0 else 30)

    # 5) โมเมนตัมราคา 6 เดือน
    if tech.get("ret_6m") is not None:
        # -30% → 0 คะแนน, +30% → 100 คะแนน
        add(float(np.clip((tech["ret_6m"] + 0.30) / 0.60 * 100, 0, 100)))

    # โบนัส/โทษจากสัญญาณตัดกันของเส้นค่าเฉลี่ย
    base = score / weight_used if weight_used else 50.0
    if tech.get("cross") == "golden_cross":
        base += 5
    elif tech.get("cross") == "death_cross":
        base -= 5

    return round(float(np.clip(base, 0, 100)), 1)
