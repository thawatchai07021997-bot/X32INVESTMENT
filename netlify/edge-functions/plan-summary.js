/**
 * POST /api/plan-summary — สรุปผลการวางแผนที่หน้าเว็บคำนวณไว้แล้วให้เป็นภาษาคน
 *
 * ทำไมต้องมี: หน้าวางแผนคืนตัวเลขมาเป็นสิบตัว (มัธยฐาน เปอร์เซ็นไทล์ 10/90
 * โอกาสขาดทุน drawdown มูลค่าหลังเงินเฟ้อ) ซึ่งถูกต้องแต่ผู้ใช้ต้องแปลเองว่า
 * "แล้วยังไง" งานของ AI ตรงนี้คือแปลตัวเลขเป็นข้อสรุปและจุดเสี่ยงที่ต้องรู้
 *
 * **AI ไม่คำนวณอะไรเลย** ตัวเลขทุกตัวคำนวณเสร็จแล้วใน public/assets/finance.js
 * ฝั่งนี้แค่รับตัวเลขมาเรียบเรียง — และรับเฉพาะ "ตัวเลข" กับ "สัญลักษณ์ที่ผ่าน
 * การตรวจรูปแบบ" เท่านั้น ไม่รับข้อความอิสระจากหน้าเว็บมาต่อเข้า prompt
 *
 * อยู่บน Edge ด้วยเหตุผลเดียวกับ chat.js — Function ฝั่ง Node ตันที่ 10 วินาที
 * API key อ่านจาก ANTHROPIC_API_KEY เท่านั้น
 */

import Anthropic from '@anthropic-ai/sdk';

import { tokenFromRequest, verifyToken } from './lib/auth.js';

const MODEL = 'claude-sonnet-5';
const EFFORT = 'low';
const MAX_TOKENS = 2000;

// รูปแบบสัญลักษณ์ที่ยอมรับ — ชุดเดียวกับที่ functions/data.js ใช้กันเส้นทางไฟล์
const SYMBOL_PATTERN = /^[A-Za-z0-9._=-]{1,15}$/;

const SYSTEM_PROMPT = `คุณคือผู้ช่วยอธิบายผลการวางแผนการลงทุนให้เจ้าของแผนคนหนึ่ง
ผู้ใช้กำลังศึกษาการลงทุน ไม่มีพื้นฐานการเงินเชิงลึก และอ่านภาษาไทย

## หน้าที่
แปลตัวเลขผลการจำลองที่ระบบคำนวณมาแล้วให้เป็นข้อสรุปที่ใช้ตัดสินใจได้

## กฎเหล็ก
1. ห้ามคำนวณตัวเลขใหม่ ห้ามเดาตัวเลขที่ไม่ได้ให้มา ใช้เฉพาะตัวเลขในข้อความที่ได้รับ
   ห้ามบวกน้ำหนักรายตัวเข้าด้วยกันเองเด็ดขาด เช่นห้ามเขียนว่า "สามตัวนี้รวมกัน 45%"
   ถ้าไม่ได้ให้ตัวเลขนั้นมาตรงๆ — สัดส่วนรวมที่ใช้ได้อยู่ในหัวข้อ "ความกระจุกตัว"
   ถ้าหัวข้อนั้นไม่มี ให้พูดถึงความกระจุกตัวเป็นคำบรรยายโดยไม่อ้างตัวเลขรวม
2. ห้ามพยากรณ์ว่าผลจะออกมาแบบไหน ห้ามบอกว่า "ควรซื้อ/ควรขาย" หรือ "แผนนี้ดี/ไม่ดี"
   ให้บอกว่าตัวเลขที่เห็นแปลว่าอะไร และมีอะไรที่ผู้ใช้ต้องรับได้ก่อนเริ่ม
3. ต้องพูดถึงด้านลบเสมอ โดยเฉพาะโอกาสขาดทุนและช่วงที่เงินต้นติดลบระหว่างทาง
   ถ้าเขียนแต่ด้านดี ผู้ใช้จะประเมินความเสี่ยงต่ำกว่าความจริง
4. ถ้าเห็นจุดที่แผนเปราะ (กระจุกในตลาดเดียว ระยะเวลาสั้นเกินไปเทียบความผันผวน
   พึ่งปันผลจากไม่กี่ตัว) ให้ชี้ตรงๆ พร้อมบอกว่าปรับอะไรได้บ้าง
5. อย่าลืมว่าตัวเลขจากการจำลองไม่ใช่คำสัญญา ต้องมีประโยคที่บอกเรื่องนี้

## วิธีเขียน
- ภาษาไทย 3-5 ย่อหน้าสั้น ไม่ต้องเกริ่นนำ ขึ้นต้นด้วยข้อสรุปเลย
- อ้างตัวเลขที่ให้มาประกอบทุกข้อสรุป
- อธิบายศัพท์การเงินทุกคำที่ใช้ครั้งแรก
- ห้ามใช้เครื่องหมายมาร์กดาวน์ (** ## | ตาราง) หน้าเว็บแสดงเป็นข้อความล้วน
  ต้องการเน้นหัวข้อให้ขึ้นบรรทัดใหม่แล้วตามด้วยเครื่องหมาย :`;

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

/** ตัวเลขที่เชื่อถือได้เท่านั้น — ค่าที่ไม่ใช่ตัวเลขจะกลายเป็น null ไม่ใช่ NaN หลุดเข้า prompt */
const n = (value) => (Number.isFinite(Number(value)) ? Number(value) : null);
const pct = (value, digits = 1) => (n(value) === null ? 'ไม่มีข้อมูล' : `${(n(value) * 100).toFixed(digits)}%`);
const baht = (value) => (n(value) === null ? 'ไม่มีข้อมูล' : `${Math.round(n(value)).toLocaleString('en-US')} บาท`);

/**
 * บล็อกความกระจุกตัว — คำนวณเสร็จแล้วที่ finance.js ฝั่งนี้แค่จัดรูป
 *
 * มีเพราะการทดสอบจริงพบว่า AI ไปบวกน้ำหนักรายตัวเองเพื่อพูดว่า "สามตัวนี้รวมกัน 45%"
 * ซึ่งขัดกฎข้อ 1 ตรงๆ · ให้ตัวเลขนี้ไปแล้วมันไม่ต้องบวก
 *
 * ค่าที่ยังคำนวณไม่ได้จะถูกข้ามทั้งบรรทัด ไม่ส่ง "0%" เข้าไปให้ AI ตีความผิดว่า
 * พอร์ตกระจายสมบูรณ์แบบ
 */
function concentrationLines(c) {
  if (!c || typeof c !== 'object') return '';
  const lines = [];
  const top3 = n(c.top3Share);
  const max = n(c.maxWeight);
  const groupShare = n(c.topGroupShare);
  const groups = n(c.groupCount);

  if (max !== null && max > 0 && SYMBOL_PATTERN.test(String(c.maxSymbol || ''))) {
    lines.push(`ตัวที่หนักที่สุดในพอร์ต: ${c.maxSymbol} สัดส่วน ${pct(max)}`);
  }
  if (top3 !== null && top3 > 0) lines.push(`สามตัวที่หนักที่สุดรวมกัน: ${pct(top3)}`);
  if (groupShare !== null && groupShare > 0 && typeof c.topGroupLabel === 'string'
      && /^[฀-๿A-Za-z0-9 /:_-]{1,40}$/.test(c.topGroupLabel)) {
    lines.push(`กลุ่มที่หนักที่สุด: ${c.topGroupLabel} สัดส่วน ${pct(groupShare)}`);
  }
  if (groups !== null && groups > 0) lines.push(`พอร์ตกระจายอยู่ใน ${groups} กลุ่ม`);

  // หัวข้อต้องเป็นชื่อเปล่าๆ ห้ามใส่คำสั่งกำกับไว้ในนั้น — ทดสอบจริงแล้วโมเดล
  // ลอกวงเล็บกำกับออกมาเป็นคำตอบให้ผู้ใช้อ่านตรงๆ ("ตัวเลขนี้คำนวณไว้แล้ว
  // ไม่ใช่ตัวเลขบวกเอง") คำสั่งทุกอย่างต้องอยู่ในบล็อกกฎเท่านั้น
  return lines.length ? `\n## ความกระจุกตัว\n${lines.join('\n')}\n` : '';
}

/** รายชื่อสินทรัพย์ในแผน — ตัดตัวที่สัญลักษณ์ผิดรูปแบบทิ้ง ไม่ส่งข้อความอิสระเข้า prompt */
function holdingLines(holdings) {
  return (Array.isArray(holdings) ? holdings : [])
    .filter((h) => h && SYMBOL_PATTERN.test(String(h.symbol || '')))
    .slice(0, 20)
    .map((h) => {
      const market = String(h.market || '') === 'TH' ? 'ไทย' : 'ต่างประเทศ';
      const extra = n(h.yield) !== null ? ` | ปันผล ${pct(h.yield, 2)}` : '';
      const months = Array.isArray(h.months)
        ? h.months.filter((m) => Number.isInteger(m) && m >= 1 && m <= 12)
        : [];
      const monthText = months.length ? ` | ปกติจ่ายเดือน ${months.join(', ')}` : '';
      return `- ${h.symbol} (${market}) สัดส่วน ${pct(h.weight)}${extra}${monthText}`;
    })
    .join('\n');
}

function simContext(p) {
  return `## แผนที่ผู้ใช้จำลอง: ลงทุนระยะยาว
เงินก้อนวันนี้: ${baht(p.lumpSum)}
เติมทุกเดือน (DCA): ${baht(p.monthly)}
ระยะเวลาถือ: ${n(p.years)} ปี
เงินที่ใส่ไปทั้งหมดเมื่อครบกำหนด: ${baht(p.invested)}

## ผลการจำลอง (คำนวณด้วย Monte Carlo จบแล้ว ห้ามคำนวณซ้ำ)
กรณีกลาง (มัธยฐาน): ${baht(p.median)}
กรณีดี (เปอร์เซ็นไทล์ 90): ${baht(p.p90)}
กรณีแย่ (เปอร์เซ็นไทล์ 10): ${baht(p.p10)}
โอกาสที่จบลงด้วยเงินน้อยกว่าที่ใส่ไป: ${pct(p.lossProbability)}
ระหว่างทางเคยติดลบจากจุดสูงสุด (กรณีกลาง): ${pct(p.medianDrawdown)}
ระหว่างทางเคยติดลบจากจุดสูงสุด (กรณีแย่): ${pct(p.worstDrawdown)}
มูลค่ากรณีกลางเมื่อคิดเป็นกำลังซื้อเงินวันนี้: ${baht(p.todayValue)}

## คุณสมบัติของพอร์ตที่เลือก
ผลตอบแทนคาดหวังต่อปี: ${pct(p.mu, 2)}
ความผันผวนต่อปี: ${pct(p.sigma, 2)}
beta เทียบตลาด: ${n(p.beta) === null ? 'ไม่มีข้อมูล' : n(p.beta).toFixed(2)}
จำนวนสินทรัพย์: ${n(p.count)} ตัว
สัดส่วนหุ้นไทยในพอร์ต: ${pct(p.thWeight)}
${concentrationLines(p.concentration)}
## รายการสินทรัพย์
${holdingLines(p.holdings) || '- ไม่มีข้อมูลรายตัว'}

สรุปแผนนี้ให้เจ้าของแผนอ่าน ตามกรอบและกฎที่กำหนด`;
}

function incomeContext(p) {
  const gaps = Array.isArray(p.gapMonths)
    ? p.gapMonths.filter((m) => Number.isInteger(m) && m >= 1 && m <= 12)
    : [];
  return `## แผนที่ผู้ใช้จำลอง: พอร์ตกินปันผล
เป้าหมายเงินปันผลสุทธิ: ${baht(p.target)} ต่อเดือน
เงินต้นที่ระบบคำนวณว่าต้องใช้: ${baht(p.capital)}
อัตราปันผลสุทธิของพอร์ต (หลังหักภาษี ณ ที่จ่าย): ${pct(p.netYield, 2)}
ภาษีที่ถูกหักรวมต่อปี: ${baht(p.taxPaid)}
จำนวนหุ้นในพอร์ต: ${n(p.count)} ตัว
สัดส่วนหุ้นไทยในพอร์ต: ${pct(p.thWeight)}
เดือนที่ไม่มีเงินปันผลเข้าเลย: ${gaps.length ? gaps.join(', ') : 'ไม่มี — มีเงินเข้าทุกเดือน'}
เดือนที่เงินเข้ามากที่สุดคิดเป็นสัดส่วนของทั้งปี: ${pct(p.peakMonthShare)}
${concentrationLines(p.concentration)}
## รายการหุ้นในพอร์ต
${holdingLines(p.holdings) || '- ไม่มีข้อมูลรายตัว'}

สรุปแผนนี้ให้เจ้าของแผนอ่าน ตามกรอบและกฎที่กำหนด
ต้องพูดถึงสองเรื่องนี้ด้วยเสมอ: ความสม่ำเสมอของกระแสเงินตลอดปี
และความเสี่ยงที่บริษัทจะลดหรืองดจ่ายปันผลจนเงินต้นที่คำนวณไว้ไม่พอ`;
}

export default async function handler(request) {
  if (request.method !== 'POST') return jsonResponse({ error: 'ต้องเรียกด้วยเมธอด POST' }, 405);

  const sessionSecret = Netlify.env.get('SESSION_SECRET');
  const apiKey = Netlify.env.get('ANTHROPIC_API_KEY');
  if (!sessionSecret || !apiKey) {
    console.error('ตั้งค่าเซิร์ฟเวอร์ไม่ครบสำหรับ /api/plan-summary');
    return jsonResponse({ error: 'ระบบยังตั้งค่าไม่สมบูรณ์ กรุณาติดต่อผู้ดูแล' }, 500);
  }

  const cookie = request.headers.get('cookie') || '';
  if (!(await verifyToken(tokenFromRequest(request), sessionSecret))) {
    return jsonResponse({ error: 'ต้องเข้าสู่ระบบก่อน' }, 401);
  }

  let plan;
  try {
    plan = await request.json();
  } catch {
    return jsonResponse({ error: 'รูปแบบคำขอไม่ถูกต้อง' }, 400);
  }

  const kind = plan?.kind === 'income' ? 'income' : plan?.kind === 'sim' ? 'sim' : null;
  if (!kind) return jsonResponse({ error: 'ไม่รู้จักชนิดของแผน' }, 400);

  // ใช้โควตาก้อนเดียวกับหน้าถาม AI — ผู้ใช้เห็นเพดานค่าใช้จ่ายรวมที่เดียว
  const origin = new URL(request.url).origin;
  const quotaResponse = await fetch(new URL('/api/quota', origin), { method: 'POST', headers: { cookie } });
  const quota = await quotaResponse.json();
  if (!quotaResponse.ok) {
    return jsonResponse({ error: quota.error || 'ใช้โควตาของวันนี้ครบแล้ว' }, quotaResponse.status);
  }

  const context = kind === 'sim' ? simContext(plan) : incomeContext(plan);

  try {
    const message = await new Anthropic({ apiKey }).messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      output_config: { effort: EFFORT },
      system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: context }],
    });

    if (message.stop_reason === 'refusal') {
      return jsonResponse({ error: 'ระบบไม่สามารถสรุปแผนนี้ได้ ลองปรับตัวเลขแล้วกดใหม่' }, 422);
    }

    const text = message.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
    if (!text) return jsonResponse({ error: 'ไม่ได้รับคำตอบจากผู้ช่วย ลองใหม่อีกครั้ง' }, 502);

    const u = message.usage;
    const cost = ((u.input_tokens || 0) * 2 + (u.cache_creation_input_tokens || 0) * 2.5
      + (u.cache_read_input_tokens || 0) * 0.2 + (u.output_tokens || 0) * 10) / 1e6 * 34;
    console.log(`[plan-summary] ${kind} · ≈ ${cost.toFixed(2)} บาท`);

    return jsonResponse({ summary: text, quota: { used: quota.used, limit: quota.limit } });
  } catch (err) {
    console.error('plan-summary ล้มเหลว:', err.message);
    // โควตาถูกหักไปแล้วเพราะจองก่อนเรียก AI — ต้องบอกผู้ใช้ ไม่ให้เข้าใจว่าฟรี
    return jsonResponse({ error: 'สรุปแผนไม่สำเร็จ กรุณาลองใหม่ (ครั้งนี้นับโควตาไปแล้ว)' }, 502);
  }
}

export const config = { path: '/api/plan-summary' };
