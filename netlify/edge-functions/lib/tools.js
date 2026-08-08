/**
 * เครื่องมือที่ AI เรียกใช้เพื่อเปิดดูข้อมูลจริงตอนตอบคำถาม
 *
 * หลักการ: AI ไม่ได้รับข้อมูลทั้งก้อนตั้งแต่แรก (dashboard.json ใหญ่ 155 KB
 * ประมาณ 45,000 โทเคน = ~3 บาทต่อคำถาม) แต่ได้ภาพรวมย่อไปก่อน แล้ว "ขอ" ดู
 * รายละเอียดเฉพาะที่จำเป็น ทำให้ตอบคำถามเจาะลึกได้ในราคาประมาณ 1 บาท
 *
 * ข้อสำคัญ: Edge Function อ่านไฟล์ใน data-private/ ตรงๆ ไม่ได้ (รันบน Deno
 * คนละที่กับไฟล์) จึงต้องเรียกผ่าน /api/data ซึ่งเป็น Netlify Function ฝั่ง Node
 * และต้องส่ง cookie ของผู้ใช้ต่อไปด้วย ไม่งั้นจะโดน 401 จากด่านตรวจสิทธิ์เดิม
 */

/** สเปกเครื่องมือที่ส่งให้ Claude — คำอธิบายต้องบอกด้วยว่า "ควรเรียกเมื่อไร" ไม่ใช่แค่ "ทำอะไร" */
export const TOOL_DEFINITIONS = [
  {
    name: 'get_market_overview',
    description:
      'ดูภาพรวมตลาดของวันนี้: จำนวนสินทรัพย์ที่ผ่านเกณฑ์ ดัชนีอ้างอิง (S&P 500, SET ฯลฯ) ' +
      'ตัวที่ขึ้น/ลงแรงสุด และอันดับต้นๆ ของแต่ละระยะการลงทุน ' +
      'เรียกเมื่อผู้ใช้ถามกว้างๆ เช่น "วันนี้ตลาดเป็นยังไง" "มีอะไรน่าสนใจ" หรือเมื่อยังไม่รู้ว่าควรเจาะดูตัวไหน',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'screen_assets',
    description:
      'คัดกรองและจัดอันดับสินทรัพย์ตามเงื่อนไข แล้วคืนรายการย่อพร้อมคะแนน ' +
      'เรียกเมื่อผู้ใช้ถามแบบมีเงื่อนไข เช่น "หุ้นไทยปันผลดีมีตัวไหน" "กองทุนทองน่าซื้อไหม" ' +
      '"หุ้นเทคโนโลยีที่เหมาะระยะยาว" — ใช้ตัวนี้ก่อนเสมอเมื่อต้องเปรียบเทียบหลายตัว',
    input_schema: {
      type: 'object',
      properties: {
        horizon: {
          type: 'string',
          enum: ['short', 'mid', 'long', 'dividend'],
          description: 'ระยะที่ใช้จัดอันดับ: short=สั้น(<1ปี) mid=กลาง(1-3ปี) long=ยาว(3ปีขึ้นไป) dividend=เน้นปันผล',
        },
        asset_class: { type: 'string', enum: ['stock', 'etf', 'gold'], description: 'ประเภทสินทรัพย์' },
        market: { type: 'string', enum: ['TH', 'US'], description: 'ตลาด: TH=ไทย US=สหรัฐฯ' },
        sector: {
          type: 'string',
          description: 'ชื่ออุตสาหกรรมภาษาอังกฤษตามที่ปรากฏในข้อมูล เช่น Technology, Energy, Financial Services',
        },
        min_dividend_yield: { type: 'number', description: 'อัตราปันผลขั้นต่ำเป็นทศนิยม เช่น 0.03 คือ 3%' },
        trend: { type: 'string', enum: ['uptrend', 'downtrend', 'sideways'], description: 'ทิศทางราคาปัจจุบัน' },
        limit: { type: 'integer', description: 'จำนวนที่ต้องการ (ค่าเริ่มต้น 10 สูงสุด 25)' },
      },
      required: [],
    },
  },
  {
    name: 'get_asset_detail',
    description:
      'ดูข้อมูลเชิงลึกของสินทรัพย์ตัวเดียว: งบการเงิน (ROE, อัตรากำไร, หนี้สินต่อทุน) ' +
      'เทคนิค (แนวรับ แนวต้าน MACD) ผลตอบแทนย้อนหลัง และบทวิเคราะห์ AI แยก 4 ระยะถ้ามี ' +
      'เรียกเมื่อผู้ใช้ถามถึงตัวใดตัวหนึ่งโดยเฉพาะ หรือเมื่อต้องเปรียบเทียบสองตัวแบบละเอียด',
    input_schema: {
      type: 'object',
      properties: {
        symbol: { type: 'string', description: 'สัญลักษณ์ เช่น NVDA, PTT, GLD (ไม่ต้องใส่ .BK)' },
      },
      required: ['symbol'],
    },
  },
];

/**
 * ── จุดที่ต้องตัดสินใจ: เลือกว่าจะส่ง field ไหนให้ AI ตอนคัดกรอง ─────────────
 *
 * ทุก field ที่ใส่ในนี้จะถูกคูณด้วยจำนวนสินทรัพย์ที่คืนกลับไป (สูงสุด 25 ตัว)
 * แล้วส่งเข้า context ของ AI ทุกครั้งที่เรียก screen_assets
 *
 * ใส่น้อยไป → AI ตอบว่า "ตัวนี้คะแนนดี" แต่บอกไม่ได้ว่าดีเพราะอะไร
 * ใส่มากไป → ค่าใช้จ่ายต่อคำถามเพิ่ม และ AI จมกับตัวเลขจนตอบไม่ตรงคำถาม
 *
 * field ที่มีให้เลือกทั้งหมด (จาก dashboard.json):
 *   ระบุตัว    symbol, ticker, name, asset_class, market, sector, currency
 *   ราคา       price, trend, trend_strength, rsi
 *   ผลตอบแทน   ret_1w, ret_1m, ret_3m, ret_6m, ret_1y
 *   พื้นฐาน     dividend_yield, trailing_pe, market_cap
 *   คะแนน      score_value, score_quality, score_momentum, score_dividend, score_technical
 *   คุณภาพ     data_quality  (full / partial — บอกว่าข้อมูลครบแค่ไหน)
 *   ต่อระยะ    horizon_scores.<ระยะ>.score และ .confidence
 *
 * เวอร์ชันด้านล่างคือชุดขั้นต่ำที่ทำงานได้ ให้ปรับตามที่คิดว่าคนกำลังศึกษาการลงทุน
 * ต้องเห็นอะไรจึงจะเข้าใจว่า "ทำไมตัวนี้ถึงติดอันดับ"
 * ──────────────────────────────────────────────────────────────────────────
 */
function summarizeAsset(asset, horizon) {
  const horizonScore = asset.horizon_scores?.[horizon];
  return {
    symbol: asset.symbol,
    name: asset.name,
    market: asset.market,
    sector: asset.sector,
    price: asset.price,
    currency: asset.currency,
    trend: asset.trend,
    ret_1y: asset.ret_1y,
    dividend_yield: asset.dividend_yield,
    score: horizonScore?.score,
    confidence: horizonScore?.confidence,
    data_quality: asset.data_quality,
  };
}

// ชื่ออุปกรณ์สงวนของ Windows — ไฟล์ชื่อพวกนี้สร้างไม่ได้ ต้องเติม _ ต่อท้าย
const WINDOWS_RESERVED = new Set([
  'CON', 'PRN', 'AUX', 'NUL',
  ...Array.from({ length: 9 }, (_, i) => `COM${i + 1}`),
  ...Array.from({ length: 9 }, (_, i) => `LPT${i + 1}`),
]);

/**
 * แปลงสัญลักษณ์เป็นชื่อไฟล์ที่ฝั่งเซิร์ฟเวอร์ใช้จริง (เช่น GC=F → GC_F, COM7 → COM7_)
 * ต้องตรงกับ safe_filename() ใน pipeline/main.py และ safeFilename() ใน public/assets/asset.js
 * ทั้งสามที่เสมอ ไม่งั้นจะ 404 เฉพาะบางตัวโดยที่ตัวอื่นยังปกติ
 */
function safeFilename(symbol) {
  const safe = symbol.replace(/[=/]/g, '_');
  return WINDOWS_RESERVED.has(safe.toUpperCase()) ? `${safe}_` : safe;
}

/** ดึงไฟล์จาก /api/data โดยส่ง cookie ของผู้ใช้ต่อไป (ด่านตรวจสิทธิ์อยู่ที่นั่น) */
async function fetchData(ctx, params) {
  const url = new URL('/api/data', ctx.origin);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);

  const response = await fetch(url, { headers: { cookie: ctx.cookie } });
  if (!response.ok) {
    throw new Error(`อ่านข้อมูลไม่สำเร็จ (${response.status})`);
  }
  return response.json();
}

/**
 * รันเครื่องมือหนึ่งตัวแล้วคืนผลเป็นข้อความ
 * ข้อผิดพลาดถูกโยนออกไปให้ผู้เรียกจัดการ เพื่อส่งกลับเป็น tool_result ที่มี is_error
 * — AI จะได้รู้ว่าพลาดแล้วลองวิธีอื่น แทนที่จะคิดว่าไม่มีข้อมูล
 */
export async function runTool(name, input, ctx) {
  if (name === 'get_market_overview') {
    const dashboard = await fetchData(ctx, { file: 'dashboard' });
    return {
      generated_at: dashboard.generated_at,
      is_stale: dashboard.is_stale,
      summary: dashboard.summary,
      benchmarks: dashboard.benchmarks,
      top_gainers: dashboard.movers.gainers.slice(0, 5).map((a) => summarizeAsset(a, 'short')),
      top_losers: dashboard.movers.losers.slice(0, 5).map((a) => summarizeAsset(a, 'short')),
      horizons: Object.fromEntries(
        Object.entries(dashboard.horizons).map(([key, value]) => [
          key,
          { label: value.label, items: value.items.slice(0, 5).map((a) => summarizeAsset(a, key)) },
        ]),
      ),
    };
  }

  if (name === 'screen_assets') {
    const dashboard = await fetchData(ctx, { file: 'dashboard' });
    const horizon = input.horizon || 'long';
    const limit = Math.min(Math.max(Number(input.limit) || 10, 1), 25);

    const matched = dashboard.all_assets.filter((asset) => {
      if (input.asset_class && asset.asset_class !== input.asset_class) return false;
      if (input.market && asset.market !== input.market) return false;
      if (input.trend && asset.trend !== input.trend) return false;
      // เทียบชื่ออุตสาหกรรมแบบไม่สนตัวพิมพ์ เพราะ AI อาจส่ง "technology" มา
      if (input.sector && (asset.sector || '').toLowerCase() !== input.sector.toLowerCase()) return false;
      if (input.min_dividend_yield && (asset.dividend_yield || 0) < input.min_dividend_yield) return false;
      return true;
    });

    matched.sort(
      (a, b) => (b.horizon_scores?.[horizon]?.score || 0) - (a.horizon_scores?.[horizon]?.score || 0),
    );

    return {
      horizon,
      horizon_label: dashboard.horizons[horizon]?.label,
      matched_count: matched.length,
      returned: Math.min(matched.length, limit),
      assets: matched.slice(0, limit).map((a) => summarizeAsset(a, horizon)),
    };
  }

  if (name === 'get_asset_detail') {
    // สัญลักษณ์ในข้อมูลเป็นตัวพิมพ์ใหญ่ทั้งหมด แปลงก่อนเผื่อ AI ส่ง "nvda" มา
    return fetchData(ctx, { file: 'asset', symbol: safeFilename(String(input.symbol || '').toUpperCase()) });
  }

  throw new Error(`ไม่รู้จักเครื่องมือ ${name}`);
}
