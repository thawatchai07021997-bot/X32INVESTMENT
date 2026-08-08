/**
 * POST /api/chat — ถาม-ตอบภาษาไทยโดยอ้างอิงข้อมูลจริงของวันนั้น
 *
 * ทำไมเป็น Edge Function ไม่ใช่ Netlify Function ธรรมดา:
 * Function ฝั่ง Node ตันที่ 10 วินาทีบนแผน Free ซึ่งไม่พอสำหรับการวนเรียกเครื่องมือ
 * แล้วให้ AI เรียบเรียงคำตอบ ส่วน Edge Function นับเพดานคนละแบบ — CPU 50 มิลลิวินาที
 * ต่อ request (เวลานั่งรอ Claude ตอบไม่นับ เพราะเราแค่ส่งต่อ stream) และมีเวลา
 * ถึง 40 วินาทีก่อนต้องเริ่มส่ง header กลับ
 *
 * แลกมาด้วยการรันบน Deno: อ่านไฟล์ใน data-private/ ตรงๆ ไม่ได้ ต้องผ่าน /api/data
 * และใช้ node:crypto ไม่ได้ ต้องใช้ Web Crypto (ดู lib/auth.js)
 *
 * API key อ่านจาก ANTHROPIC_API_KEY เท่านั้น ไม่มีการเขียนลงไฟล์หรือ log
 */

import Anthropic from '@anthropic-ai/sdk';

import { tokenFromRequest, verifyToken } from './lib/auth.js';
import { TOOL_DEFINITIONS, runTool } from './lib/tools.js';

const MODEL = 'claude-sonnet-5';
// effort ต่ำเพราะมีเพดาน 40 วินาที และ Sonnet 5 ที่ระดับนี้ยังตอบได้ดี
// ถ้าพบว่าตอบตื้นไปหรือไม่ยอมเปิดดูข้อมูล ให้ขยับเป็น "medium" ที่บรรทัดนี้ที่เดียว
const EFFORT = 'low';
const MAX_TOKENS = 4000;
// กันวนไม่รู้จบถ้า AI เรียกเครื่องมือซ้ำๆ — 4 รอบพอสำหรับ "ดูภาพรวม → คัดกรอง → เจาะ 2 ตัว"
const MAX_TOOL_ROUNDS = 4;

const SYSTEM_PROMPT = `คุณคือผู้ช่วยอธิบายข้อมูลการลงทุนในระบบส่วนตัวของผู้ใช้คนหนึ่ง
ผู้ใช้กำลังศึกษาการลงทุน ไม่มีพื้นฐานการเงินเชิงลึก และอ่านภาษาไทย

## หน้าที่
อธิบายว่าข้อมูลในระบบบอกอะไร ด้วยภาษาที่คนทั่วไปเข้าใจ

## กฎเหล็ก
1. ห้ามตอบจากความจำของคุณเองเกี่ยวกับราคา ผลตอบแทน หรือคะแนนใดๆ
   ต้องเรียกเครื่องมือดูข้อมูลจริงก่อนเสมอ แม้จะคิดว่ารู้คำตอบอยู่แล้ว
2. ห้ามคำนวณตัวเลขใหม่เอง ใช้เฉพาะตัวเลขที่เครื่องมือคืนมา
   ถ้าต้องการตัวเลขที่ไม่มีในข้อมูล ให้บอกตรงๆ ว่าระบบไม่ได้เก็บไว้
3. คุณไม่ใช่ผู้แนะนำการลงทุนที่ได้รับใบอนุญาต ห้ามพูดว่า "ควรซื้อ" "ควรขาย"
   หรือชี้นำให้ตัดสินใจ ให้อธิบายว่าเกณฑ์ของระบบมองตัวนี้อย่างไรและเพราะอะไร
   แล้วปล่อยให้ผู้ใช้ตัดสินใจเอง
4. อธิบายศัพท์การเงินทุกครั้งที่ใช้ครั้งแรก เช่น "P/E 15 เท่า (ราคาหุ้นคิดเป็น 15 เท่า
   ของกำไรต่อปี ยิ่งต่ำยิ่งถือว่าถูกเมื่อเทียบกับกำไร)"
5. ถ้าข้อมูลมีเครื่องหมายว่าเก่า (is_stale) หรือ data_quality ไม่ใช่ full
   ต้องบอกผู้ใช้ด้วย อย่าเสนอตัวเลขที่ไม่น่าเชื่อถือเหมือนว่ามันแน่นอน

## วิธีเขียนคำตอบ
- ตอบตรงคำถามก่อนในประโยคแรก แล้วค่อยขยายความ
- กระชับ ไม่ต้องยกทุกตัวเลขที่เห็น เลือกเฉพาะที่ตอบคำถาม
- เขียนเป็นย่อหน้าปกติ ใช้หัวข้อเฉพาะตอนเทียบหลายตัวจริงๆ
- ปิดท้ายด้วยการบอกว่าข้อมูลนี้เป็นของวันที่เท่าไร

## รูปแบบข้อความ (สำคัญ)
หน้าเว็บแสดงคำตอบเป็นข้อความล้วน ไม่ได้แปลงมาร์กดาวน์ ดังนั้น
เครื่องหมายมาร์กดาวน์จะโผล่เป็นตัวอักษรให้ผู้ใช้เห็น
- ห้ามใช้ ** ** ทำตัวหนา ห้ามใช้ # ทำหัวข้อ ห้ามใช้ | ทำตาราง
- ต้องการเน้นหัวข้อ ให้ขึ้นบรรทัดใหม่แล้วเขียนหัวข้อตามด้วยเครื่องหมาย :
- รายการย่อยใช้ขีดกลางนำหน้า (- ) ได้ตามปกติ`;

const encoder = new TextEncoder();

/** ห่อข้อความหนึ่งก้อนเป็น Server-Sent Event หนึ่งเฟรม */
function sse(payload) {
  return encoder.encode(`data: ${JSON.stringify(payload)}\n\n`);
}

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

export default async function handler(request) {
  if (request.method !== 'POST') {
    return jsonError('ต้องเรียกด้วยเมธอด POST', 405);
  }

  const sessionSecret = Netlify.env.get('SESSION_SECRET');
  const apiKey = Netlify.env.get('ANTHROPIC_API_KEY');
  if (!sessionSecret || !apiKey) {
    // ไม่บอกว่าตัวไหนหาย เพื่อไม่ให้ผู้เรียกรู้โครงสร้าง env ของระบบ
    console.error('ตั้งค่าเซิร์ฟเวอร์ไม่ครบสำหรับ /api/chat');
    return jsonError('ระบบยังตั้งค่าไม่สมบูรณ์ กรุณาติดต่อผู้ดูแล', 500);
  }

  const cookie = request.headers.get('cookie') || '';
  if (!(await verifyToken(tokenFromRequest(request), sessionSecret))) {
    return jsonError('ต้องเข้าสู่ระบบก่อน', 401);
  }

  let question = '';
  let history = [];
  try {
    const body = await request.json();
    question = String(body.question || '').trim();
    // เก็บบทสนทนาย้อนหลังแค่ 3 คู่ล่าสุด — ยาวกว่านี้ค่าใช้จ่ายโตโดยไม่ช่วยให้ตอบดีขึ้น
    history = Array.isArray(body.history) ? body.history.slice(-6) : [];
  } catch {
    return jsonError('รูปแบบคำขอไม่ถูกต้อง', 400);
  }

  if (!question) return jsonError('กรุณาพิมพ์คำถาม', 400);
  if (question.length > 1000) return jsonError('คำถามยาวเกินไป (จำกัด 1,000 ตัวอักษร)', 400);

  const origin = new URL(request.url).origin;

  // จองสิทธิ์ก่อนเรียก AI — ถ้าจองไม่ผ่านจะได้ไม่เสียค่า API ฟรีๆ
  const quotaResponse = await fetch(new URL('/api/quota', origin), {
    method: 'POST',
    headers: { cookie },
  });
  const quota = await quotaResponse.json();
  if (!quotaResponse.ok) {
    return jsonError(quota.error || 'ใช้โควตาคำถามของวันนี้ครบแล้ว', quotaResponse.status);
  }

  const client = new Anthropic({ apiKey });
  const ctx = { origin, cookie };

  const messages = [
    ...history
      .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
      .map((m) => ({ role: m.role, content: m.content })),
    { role: 'user', content: question },
  ];

  // สะสมโทเคนข้ามทุกรอบ เพราะหนึ่งคำถามอาจเรียก AI หลายครั้ง
  const totalUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

  const body = new ReadableStream({
    async start(controller) {
      try {
        for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
          const stream = client.messages.stream({
            model: MODEL,
            max_tokens: MAX_TOKENS,
            output_config: { effort: EFFORT },
            // system เป็น array เพื่อวาง cache_control ได้ — prompt กับสเปกเครื่องมือ
            // ไม่เปลี่ยนระหว่างคำถาม จึงถูกอ่านจาก cache แทนที่จะจ่ายเต็มราคาทุกครั้ง
            system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
            tools: TOOL_DEFINITIONS,
            messages,
          });

          // ส่งข้อความทยอยให้ผู้ใช้เห็นทันทีที่ AI พิมพ์ ไม่ต้องรอจบทั้งคำตอบ
          stream.on('text', (text) => controller.enqueue(sse({ type: 'text', text })));

          const message = await stream.finalMessage();

          totalUsage.input += message.usage.input_tokens || 0;
          totalUsage.output += message.usage.output_tokens || 0;
          totalUsage.cacheRead += message.usage.cache_read_input_tokens || 0;
          totalUsage.cacheWrite += message.usage.cache_creation_input_tokens || 0;

          if (message.stop_reason !== 'tool_use') {
            // บันทึกต้นทุนไว้ตรวจสอบย้อนหลังได้ — ราคาต่อ 1 ล้านโทเคนของ Sonnet 5
            // (ราคาโปรโมชัน input 2 / output 10 ดอลลาร์) ต้องตรงกับ pipeline/config.py
            const cost = (totalUsage.input * 2 + totalUsage.cacheWrite * 2.5
              + totalUsage.cacheRead * 0.2 + totalUsage.output * 10) / 1e6 * 34;
            console.log(
              `[chat] ${round + 1} รอบ · เข้า ${totalUsage.input} · cache อ่าน ${totalUsage.cacheRead}`
              + ` เขียน ${totalUsage.cacheWrite} · ออก ${totalUsage.output} · ≈ ${cost.toFixed(2)} บาท`,
            );
            controller.enqueue(sse({
              type: 'done',
              quota: { used: quota.used, limit: quota.limit },
            }));
            controller.close();
            return;
          }

          messages.push({ role: 'assistant', content: message.content });

          const toolUses = message.content.filter((block) => block.type === 'tool_use');
          const results = [];
          for (const toolUse of toolUses) {
            controller.enqueue(sse({ type: 'tool', name: toolUse.name }));
            try {
              const result = await runTool(toolUse.name, toolUse.input, ctx);
              results.push({
                type: 'tool_result',
                tool_use_id: toolUse.id,
                content: JSON.stringify(result),
              });
            } catch (err) {
              // ส่งข้อผิดพลาดกลับเป็นผลของเครื่องมือ ไม่ใช่โยนทิ้ง
              // AI จะได้รู้ว่าพลาดตรงไหนแล้วลองทางอื่น แทนที่จะคิดว่าไม่มีข้อมูล
              results.push({
                type: 'tool_result',
                tool_use_id: toolUse.id,
                content: `ผิดพลาด: ${err.message}`,
                is_error: true,
              });
            }
          }
          // ผลของทุกเครื่องมือต้องอยู่ในข้อความเดียว ไม่งั้น AI จะเลิกเรียกหลายตัวพร้อมกัน
          messages.push({ role: 'user', content: results });

          // วางจุด cache ไว้ท้ายผลลัพธ์ล่าสุด เพราะรอบถัดไปต้องส่งบทสนทนาทั้งหมดซ้ำ
          // (API ไม่เก็บสถานะให้) ผลลัพธ์ก้อนใหญ่จึงถูกคิดเงินเต็มราคาซ้ำทุกรอบถ้าไม่ cache
          // ราคาอ่านจาก cache อยู่ที่ราว 1 ใน 10 ของราคาปกติ
          //
          // API จำกัดจุด cache ไว้ 4 จุดต่อคำขอ — จุดหนึ่งใช้กับ system prompt ไปแล้ว
          // จึงเหลือให้ผลลัพธ์เครื่องมือได้ 3 จุด ต้องถอดจุดเก่าที่สุดออกก่อนวางจุดใหม่
          const marked = messages
            .flatMap((m) => (Array.isArray(m.content) ? m.content : []))
            .filter((block) => block.cache_control);
          while (marked.length >= 3) delete marked.shift().cache_control;
          results[results.length - 1].cache_control = { type: 'ephemeral' };
        }

        controller.enqueue(sse({
          type: 'error',
          message: 'ค้นข้อมูลหลายรอบแล้วยังตอบไม่ได้ ลองถามให้เจาะจงขึ้นอีกนิดครับ',
        }));
        controller.close();
      } catch (err) {
        console.error('chat ล้มเหลว:', err.message);
        // แยกปัญหาเครือข่ายออกจากปัญหาอื่น เพราะวิธีรับมือต่างกัน:
        // เชื่อมต่อไม่ติด = กดถามใหม่ได้เลย ส่วนอย่างอื่นอาจต้องแก้ที่ระบบ
        // และต้องบอกด้วยว่าโควตาถูกหักไปแล้ว เพราะจองก่อนเรียก AI เสมอ
        const isNetwork = /connection|network|fetch|timeout|ECONN/i.test(err.message || '');
        controller.enqueue(sse({
          type: 'error',
          message: isNetwork
            ? 'เชื่อมต่อกับผู้ให้บริการ AI ไม่ได้ชั่วคราว กดถามใหม่ได้เลย (คำถามนี้นับโควตาไปแล้ว)'
            : 'ระบบขัดข้องระหว่างตอบคำถาม กรุณาลองใหม่ (คำถามนี้นับโควตาไปแล้ว)',
        }));
        controller.close();
      }
    },
  });

  return new Response(body, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
    },
  });
}

export const config = { path: '/api/chat' };
