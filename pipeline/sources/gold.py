"""ราคาทองคำไทย จาก API ของสมาคมค้าทองคำ (goldtraders.or.th)

endpoint นี้เป็นตัวเดียวกับที่หน้าเว็บทางการเรียกใช้แสดงราคา จึงเป็นข้อมูล
ชุดเดียวกับที่ประกาศบนเว็บ ไม่ใช่การ scrape HTML (หน้าเว็บเป็น Next.js
ที่โหลดราคาด้วย JavaScript — อ่านจาก HTML ตรงๆ ไม่ได้)

ถ้า endpoint ล่มหรือเปลี่ยนโครงสร้าง ฟังก์ชันจะคืน None
ซึ่งถูกออกแบบให้ไม่ทำให้ pipeline ทั้งระบบล้ม — ทองโลก (GC=F, GLD)
ดึงผ่าน yfinance แยกต่างหากและยังทำงานได้เสมอ
"""

from __future__ import annotations

import json
import logging
import time

import requests

from config import CACHE_DIR

log = logging.getLogger(__name__)

GOLD_CACHE = CACHE_DIR / "thai_gold.json"
RETRIES = 3

GOLD_API = "https://www.goldtraders.or.th/api/GoldPrices/Latest"
TIMEOUT = 15
HEADERS = {
    # ต้องส่ง User-Agent แบบเบราว์เซอร์ ไม่งั้น Cloudflare หน้าเว็บจะตัดการเชื่อมต่อ
    "User-Agent": ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                   "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36"),
    "Accept": "application/json",
    "Referer": "https://www.goldtraders.or.th/UpdatePriceList.aspx",
}

# ราคาทองไทยอยู่หลักหมื่นบาทต่อบาททองคำ — ใช้ตรวจว่าค่าที่ได้สมเหตุสมผล
MIN_SANE_PRICE = 10_000
MAX_SANE_PRICE = 300_000


def fetch_thai_gold() -> dict | None:
    """ดึงราคาทองคำไทยล่าสุด

    ลองใหม่ได้หลายครั้ง และถ้ายังไม่สำเร็จจะใช้ค่าจากรอบก่อนพร้อมทำเครื่องหมาย
    ว่าเป็นข้อมูลเก่า — พบว่า endpoint นี้ล้มเหลวชั่วคราวเป็นครั้งคราว
    (น่าจะเป็นการจำกัดอัตราการเรียกของ Cloudflare) การปล่อยให้ข้อมูลหายไป
    ทั้งที่ราคาเมื่อวานยังมีประโยชน์อยู่นั้นแย่กว่าการแสดงพร้อมป้ายกำกับ

    Returns:
        dict ราคาทอง หรือ None ถ้าดึงไม่ได้และไม่มี cache เลย
    """
    data = None
    for attempt in range(RETRIES):
        try:
            resp = requests.get(GOLD_API, params={"readjson": "false"},
                                headers=HEADERS, timeout=TIMEOUT)
            resp.raise_for_status()
            data = resp.json()
            break
        except Exception as exc:                  # noqa: BLE001
            if attempt < RETRIES - 1:
                time.sleep(2 * (attempt + 1))     # หน่วงเพิ่มขึ้นทุกครั้งที่ลองใหม่
                continue
            log.warning("ดึงราคาทองไทยไม่สำเร็จหลังลอง %d ครั้ง: %s", RETRIES, exc)

    if data is None:
        return _load_cache()

    def num(key: str) -> float | None:
        value = data.get(key)
        try:
            return round(float(value), 2) if value is not None else None
        except (TypeError, ValueError):
            return None

    bar_buy, bar_sell = num("bL_BuyPrice"), num("bL_SellPrice")

    # ตรวจความสมเหตุสมผลก่อนใช้ — กันกรณี API เปลี่ยนความหมายของฟิลด์
    if bar_buy is None or not (MIN_SANE_PRICE <= bar_buy <= MAX_SANE_PRICE):
        log.warning("ราคาทองไทยที่ได้ไม่สมเหตุสมผล (%s) — ใช้ค่าจากรอบก่อนแทน", bar_buy)
        return _load_cache()

    result = {
        "updated_at": data.get("asTime"),
        "is_stale": False,
        "bar_buy": bar_buy,             # ทองคำแท่ง 96.5% ราคารับซื้อ
        "bar_sell": bar_sell,           # ทองคำแท่ง 96.5% ราคาขายออก
        "ornament_buy": num("oM965_BuyPrice"),    # ทองรูปพรรณ รับซื้อ
        "ornament_sell": num("oM965_SellPrice"),  # ทองรูปพรรณ ขายออก
        "change_from_prev_day": num("priceChangeFromPrevDayLast"),
        "gold_spot_usd": num("goldSpot"),         # ราคาทองโลก USD ต่อออนซ์
        "baht_per_usd": num("bahtPerUSD"),
        "unit": "บาท ต่อ 1 บาททองคำ (ความบริสุทธิ์ 96.5%)",
        "source": "สมาคมค้าทองคำแห่งประเทศไทย",
        "source_url": "https://www.goldtraders.or.th/UpdatePriceList.aspx",
    }
    _save_cache(result)
    return result


def _save_cache(payload: dict) -> None:
    """เก็บราคาที่ดึงสำเร็จไว้ใช้เมื่อรอบถัดไปดึงไม่ได้"""
    try:
        GOLD_CACHE.write_text(json.dumps(payload, ensure_ascii=False),
                              encoding="utf-8")
    except Exception as exc:                      # noqa: BLE001
        log.warning("เขียน cache ราคาทองไม่สำเร็จ: %s", exc)


def _load_cache() -> dict | None:
    """อ่านราคาทองจากรอบก่อน พร้อมทำเครื่องหมายว่าเป็นข้อมูลเก่า"""
    if not GOLD_CACHE.exists():
        log.warning("ไม่มี cache ราคาทอง — หน้าเว็บจะไม่แสดงส่วนทองคำ")
        return None
    try:
        payload = json.loads(GOLD_CACHE.read_text(encoding="utf-8"))
        payload["is_stale"] = True
        log.info("ใช้ราคาทองจากรอบก่อน (ณ %s)", payload.get("updated_at"))
        return payload
    except Exception as exc:                      # noqa: BLE001
        log.warning("อ่าน cache ราคาทองไม่สำเร็จ: %s", exc)
        return None
