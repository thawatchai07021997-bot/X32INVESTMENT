/* ============================================================
   X32 — คณิตศาสตร์การเงินสำหรับหน้าวางแผนการลงทุน

   ไฟล์นี้ไม่ยุ่งกับ DOM เลย รับตัวเลขเข้า คืนตัวเลขออก
   เพื่อให้ตรวจสอบความถูกต้องได้แยกจากหน้าเว็บ

   หลักการที่ยึด: ความผันผวนพยากรณ์ได้ ผลตอบแทนพยากรณ์ไม่ได้
   จึงใช้ volatility กับ beta ที่วัดจากราคาจริง แต่ไม่ใช้ผลตอบแทนย้อนหลัง
   ของหุ้นรายตัวมาทำนายอนาคต (หุ้นที่วิ่งแรงปีนี้มักไม่วิ่งแรงต่อ)
   ============================================================ */

/**
 * ผลตอบแทนคาดหวังระยะยาวต่อปี แยกตามกลุ่มสินทรัพย์
 * ตัวเลขเหล่านี้คือค่าเฉลี่ยระยะยาวของตลาด ไม่ใช่ผลงานปีที่ผ่านมา
 * ผู้ใช้ปรับได้จากหน้าเว็บ — ค่าที่ตั้งไว้เป็นเพียงจุดตั้งต้นที่ไม่ก้าวร้าวเกินไป
 */
export const DEFAULT_ASSUMPTIONS = {
  marketReturn: { TH: 0.08, US: 0.10 },  // ผลตอบแทนตลาดหุ้นต่อปี
  goldReturn: 0.06,                       // ทองคำ
  bondReturn: 0.04,                       // กองทุนพันธบัตร
  riskFree: 0.03,                         // ผลตอบแทนที่ถือว่าไร้ความเสี่ยง
  marketVolatility: 0.16,                 // ความผันผวนของตลาดโดยรวมต่อปี
  inflation: 0.02,                        // ใช้แปลงเป็นมูลค่าเงินวันนี้
};

/** ภาษีหัก ณ ที่จ่ายของเงินปันผล แยกตามตลาด */
export const DIVIDEND_TAX = { TH: 0.10, US: 0.15 };

/** ตัวเลขที่ใช้กับ ETF พันธบัตร — จำแนกจากชื่อเพราะข้อมูลไม่ได้ระบุประเภทย่อยไว้ */
const BOND_ETFS = new Set(['TLT', 'IEF', 'LQD', 'HYG', 'BND', 'AGG', 'SHY', 'TIP']);

/**
 * ผลตอบแทนคาดหวังของสินทรัพย์หนึ่งตัว
 *
 * ใช้แนวคิด CAPM: สินทรัพย์ที่แกว่งตามตลาดแรงกว่า (beta สูง) ควรได้ผลตอบแทน
 * ชดเชยความเสี่ยงมากกว่า — ไม่ใช่เพราะมันเคยขึ้นแรง แต่เพราะมันเสี่ยงกว่า
 */
export function expectedReturn(asset, assumptions = DEFAULT_ASSUMPTIONS) {
  if (asset.asset_class === 'gold') return assumptions.goldReturn;
  if (BOND_ETFS.has(asset.symbol)) return assumptions.bondReturn;

  const marketReturn = assumptions.marketReturn[asset.market] ?? assumptions.marketReturn.US;
  // beta ว่างแปลว่าไม่มีข้อมูล ให้ถือว่าแกว่งเท่าตลาด (1.0) ดีกว่าตัดทิ้ง
  const beta = Number.isFinite(asset.beta) ? asset.beta : 1;
  // จำกัด beta ไม่ให้เกิน 2.5 — beta สูงมากมักมาจากข้อมูลสั้นและทำให้ผลลัพธ์เพี้ยน
  const capped = Math.max(Math.min(beta, 2.5), 0.2);

  return assumptions.riskFree + capped * (marketReturn - assumptions.riskFree);
}

/**
 * ความผันผวนและผลตอบแทนของทั้งพอร์ต ด้วยโมเดล single-index
 *
 * ความเสี่ยงของพอร์ตไม่ใช่ค่าเฉลี่ยความเสี่ยงของแต่ละตัว เพราะหุ้นไม่ได้ขึ้นลง
 * พร้อมกันเป๊ะ ส่วนที่แกว่งไปด้วยกัน (ตามตลาด) กระจายความเสี่ยงไม่ได้
 * แต่ส่วนที่เป็นเรื่องเฉพาะตัวบริษัทกระจายได้ — โมเดลนี้แยกสองส่วนนั้นออกจากกัน
 *
 * @param holdings [{asset, weight}] โดยผลรวม weight = 1
 */
export function portfolioStats(holdings, assumptions = DEFAULT_ASSUMPTIONS) {
  const sigmaMarket = assumptions.marketVolatility;
  let mu = 0;
  let portfolioBeta = 0;
  let idiosyncraticVariance = 0;

  for (const { asset, weight } of holdings) {
    mu += weight * expectedReturn(asset, assumptions);

    const beta = Math.max(Math.min(Number.isFinite(asset.beta) ? asset.beta : 1, 2.5), 0.2);
    portfolioBeta += weight * beta;

    // ความผันผวนรวมของหุ้นตัวนี้ ถ้าไม่มีข้อมูลให้ประมาณจาก beta
    const totalVol = Number.isFinite(asset.volatility) && asset.volatility > 0
      ? asset.volatility
      : beta * sigmaMarket * 1.3;

    // ส่วนที่เป็นความเสี่ยงเฉพาะตัว = ความผันผวนรวม หักส่วนที่อธิบายได้ด้วยตลาด
    // ติดลบไม่ได้ในทางคณิตศาสตร์ แต่เกิดได้จากข้อมูลสั้น จึงตัดที่ 0
    const specific = Math.max(totalVol ** 2 - (beta * sigmaMarket) ** 2, 0);
    idiosyncraticVariance += weight ** 2 * specific;
  }

  const variance = (portfolioBeta * sigmaMarket) ** 2 + idiosyncraticVariance;
  return { mu, sigma: Math.sqrt(variance), beta: portfolioBeta };
}

/** สุ่มเลขจากการแจกแจงปกติมาตรฐาน (Box–Muller) */
function randomNormal() {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/**
 * จำลองการเติบโตของเงินลงทุนหลายพันเส้นทาง แล้วสรุปเป็นช่วง
 *
 * ใช้แบบจำลอง geometric Brownian motion ซึ่งเป็นมาตรฐานของการจำลองราคาสินทรัพย์
 * จุดสำคัญคือพจน์ −σ²/2 ที่หักออก: ถ้าไม่หัก ค่าเฉลี่ยของผลลัพธ์จะสูงเกินจริง
 * เพราะการขึ้น 50% แล้วลง 50% ไม่ได้กลับมาที่เดิม แต่เหลือ 75%
 *
 * @param {object} p
 * @param {number} p.mu      ผลตอบแทนคาดหวังต่อปี
 * @param {number} p.sigma   ความผันผวนต่อปี
 * @param {number} p.years   จำนวนปีที่ถือ
 * @param {number} p.lumpSum เงินก้อนที่ลงวันนี้
 * @param {number} p.monthly เงินที่เติมทุกเดือน (DCA)
 * @param {number} p.runs    จำนวนเส้นทางที่จำลอง
 */
export function simulate({ mu, sigma, years, lumpSum = 0, monthly = 0, runs = 3000 }) {
  const months = Math.round(years * 12);
  const drift = (mu - (sigma ** 2) / 2) / 12;
  const shock = sigma / Math.sqrt(12);

  const finals = new Float64Array(runs);
  const drawdowns = new Float64Array(runs);
  // เก็บมูลค่า ณ สิ้นปีแต่ละปีไว้วาดกราฟช่วง — เก็บรายปีพอ ถ้าเก็บรายเดือน
  // ทุกเส้นทางจะกินหน่วยความจำหลายเมกะไบต์โดยไม่ได้ทำให้กราฟอ่านง่ายขึ้น
  const wholeYears = Math.floor(years);
  const yearly = Array.from({ length: wholeYears + 1 }, () => new Float64Array(runs));

  for (let run = 0; run < runs; run += 1) {
    let value = lumpSum;
    let peak = lumpSum;
    let worstDrawdown = 0;
    yearly[0][run] = value;

    for (let m = 0; m < months; m += 1) {
      // เติมเงิน DCA ต้นเดือน แล้วจึงให้ตลาดทำงานตลอดเดือนนั้น
      value += monthly;
      value *= Math.exp(drift + shock * randomNormal());

      // วัดว่าระหว่างทางเคยตกจากจุดสูงสุดไปกี่เปอร์เซ็นต์
      // เทียบกับยอดเงินที่ใส่ไปแล้วเท่านั้น ไม่งั้น DCA จะทำให้ตัวเลขนี้ไร้ความหมาย
      if (value > peak) peak = value;
      const dd = peak > 0 ? (value - peak) / peak : 0;
      if (dd < worstDrawdown) worstDrawdown = dd;

      const yearIndex = (m + 1) / 12;
      if (Number.isInteger(yearIndex) && yearIndex <= wholeYears) yearly[yearIndex][run] = value;
    }

    finals[run] = value;
    drawdowns[run] = worstDrawdown;
  }

  finals.sort();
  drawdowns.sort();

  const at = (arr, q) => arr[Math.min(Math.floor(q * arr.length), arr.length - 1)];
  const invested = lumpSum + monthly * months;

  const path = yearly.map((values, year) => {
    const sorted = values.slice().sort();
    return {
      year,
      invested: lumpSum + monthly * year * 12,
      p10: at(sorted, 0.10),
      median: at(sorted, 0.50),
      p90: at(sorted, 0.90),
    };
  });

  return {
    invested,
    months,
    path,
    p10: at(finals, 0.10),
    p25: at(finals, 0.25),
    median: at(finals, 0.50),
    p75: at(finals, 0.75),
    p90: at(finals, 0.90),
    // โอกาสที่จบลงด้วยเงินน้อยกว่าที่ใส่ไป — ตัวเลขที่คนมักไม่อยากดูแต่ต้องรู้
    lossProbability: finals.reduce((n, v) => n + (v < invested ? 1 : 0), 0) / runs,
    medianDrawdown: at(drawdowns, 0.50),
    worstDrawdown: at(drawdowns, 0.10),
  };
}

/**
 * แปลงมูลค่าในอนาคตกลับเป็นกำลังซื้อของเงินวันนี้
 * เงิน 1 ล้านในอีก 10 ปี ซื้อของได้น้อยกว่า 1 ล้านวันนี้
 */
export function toTodayValue(futureValue, years, inflation = DEFAULT_ASSUMPTIONS.inflation) {
  return futureValue / (1 + inflation) ** years;
}

/**
 * จัดพอร์ตปันผลให้ได้กระแสเงินตามเป้าหมาย
 *
 * คิดย้อนจากเป้าหมาย: อยากได้เงินสุทธิเท่านี้ต่อเดือน → ต่อปีเท่าไร →
 * ก่อนหักภาษีเท่าไร → ด้วยอัตราปันผลของพอร์ตนี้ต้องใช้เงินต้นเท่าไร
 *
 * @param {number} monthlyTarget เงินที่ต้องการได้รับสุทธิต่อเดือน (บาท)
 * @param {Array}  candidates    สินทรัพย์ที่ผ่านการคัดกรองแล้ว
 * @param {object} opt           { count, applyTax }
 */
/**
 * กลุ่มที่ใช้จำกัดการกระจุกตัว
 * ETF ในระบบไม่มีข้อมูล sector จึงต้องจัดกลุ่มด้วยประเภทสินทรัพย์แทน —
 * ถ้าไม่ทำ กองตราสารหนี้สหรัฐฯ หลายตัวจะถูกนับเป็นคนละกลุ่มทั้งที่ขึ้นลงตาม
 * อัตราดอกเบี้ยเหมือนกันหมด กลายเป็นการกระจายที่กระจายแค่ในนาม
 */
function groupOf(asset) {
  if (asset.sector) return `${asset.market}:${asset.sector}`;
  return `${asset.market}:${asset.asset_class}`;
}

/**
 * เลือกสินทรัพย์แบบไล่จากคะแนนสูงสุด แต่ข้ามตัวที่กลุ่มเต็มโควตาแล้ว
 * ถ้าเลือกได้ไม่ครบเพราะติดเพดาน จะวนอีกรอบโดยผ่อนเพดานให้ครบจำนวนที่ขอ
 */
export function selectDiversified(candidates, count, maxPerGroup = 2) {
  const picked = [];
  const used = new Map();

  for (const asset of candidates) {
    if (picked.length >= count) break;
    const group = groupOf(asset);
    const n = used.get(group) || 0;
    if (n >= maxPerGroup) continue;
    used.set(group, n + 1);
    picked.push(asset);
  }

  // ยังไม่ครบ (ตัวเลือกน้อยหรือกระจุกในไม่กี่กลุ่ม) — เติมจากที่เหลือตามลำดับคะแนน
  if (picked.length < count) {
    for (const asset of candidates) {
      if (picked.length >= count) break;
      if (!picked.includes(asset)) picked.push(asset);
    }
  }

  return picked;
}

export function dividendPortfolio(monthlyTarget, candidates, opt = {}) {
  const { count = 6, applyTax = true, maxPerGroup = 2 } = opt;
  const picks = selectDiversified(candidates, count, maxPerGroup);
  if (!picks.length) return null;

  // ถ่วงน้ำหนักด้วยคะแนนคุณภาพ ไม่ใช่ลงเท่ากันทุกตัว และไม่ใช่ทุ่มไปที่ตัวปันผลสูงสุด
  // เพราะอัตราปันผลที่สูงผิดปกติมักมาจากราคาที่ร่วงแรง ไม่ใช่กิจการที่ดีขึ้น
  const rawWeights = picks.map((a) => Math.max(a.score_quality ?? 50, 10));
  const weightSum = rawWeights.reduce((s, w) => s + w, 0);
  const weights = rawWeights.map((w) => w / weightSum);

  // อัตราปันผลสุทธิของทั้งพอร์ต = ผลรวมถ่วงน้ำหนักของอัตราแต่ละตัวหลังหักภาษีตามตลาด
  let netYield = 0;
  picks.forEach((asset, i) => {
    const tax = applyTax ? (DIVIDEND_TAX[asset.market] ?? 0) : 0;
    netYield += weights[i] * (asset.dividend_yield || 0) * (1 - tax);
  });

  if (netYield <= 0) return null;

  const annualTarget = monthlyTarget * 12;
  const capital = annualTarget / netYield;

  return {
    capital,
    netYield,
    annualTarget,
    holdings: picks.map((asset, i) => {
      const amount = capital * weights[i];
      const tax = applyTax ? (DIVIDEND_TAX[asset.market] ?? 0) : 0;
      const gross = amount * (asset.dividend_yield || 0);
      return {
        asset,
        weight: weights[i],
        amount,
        grossAnnual: gross,
        netAnnual: gross * (1 - tax),
        taxRate: tax,
      };
    }),
  };
}

/**
 * คัดสินทรัพย์ที่เหมาะกับพอร์ตปันผล
 *
 * ตัดตัวที่จ่ายปันผลเกินกำไรออก เพราะจ่ายแบบนั้นต่อไปไม่ได้นาน
 * และตัดอัตราปันผลที่สูงเกิน 12% ออกด้วย — ระดับนั้นมักเป็นสัญญาณว่าราคาเพิ่งร่วงแรง
 * หรือเป็นการจ่ายพิเศษครั้งเดียว ไม่ใช่กระแสเงินที่พึ่งพาได้
 */
export function screenDividendAssets(assets, { minYield = 0.03, maxYield = 0.12 } = {}) {
  return assets
    .filter((a) => {
      const y = a.dividend_yield || 0;
      if (y < minYield || y > maxYield) return false;
      if (a.payout_sustainable === 0) return false;
      if (Number.isFinite(a.payout_ratio) && a.payout_ratio > 1) return false;
      return true;
    })
    .sort((a, b) => (b.score_dividend || 0) - (a.score_dividend || 0));
}
