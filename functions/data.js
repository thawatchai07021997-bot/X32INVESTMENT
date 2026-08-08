/**
 * GET /api/data?file=dashboard
 * GET /api/data?file=asset&symbol=AAPL
 *
 * ประตูเดียวที่เข้าถึงข้อมูลใน data-private/ ได้ — ต้องมี session cookie ที่ถูกต้อง
 * โฟลเดอร์นั้นไม่ได้อยู่ใน publish directory จึงไม่มี URL สาธารณะให้เข้าถึงตรงๆ
 */

import fs from 'node:fs/promises';
import path from 'node:path';

import { json, requireAuth } from './_auth.js';

// อนุญาตเฉพาะอักขระที่ใช้ในสัญลักษณ์หลักทรัพย์จริง (เช่น BRK-B, GC_F)
// เป็นด่านกัน path traversal — ไม่ให้ ".." หรือ "/" หลุดเข้าไปในชื่อไฟล์
const SYMBOL_PATTERN = /^[A-Za-z0-9._-]{1,15}$/;

/**
 * หาโฟลเดอร์ data-private ให้เจอ
 * ตำแหน่ง cwd ของ Netlify Function ต่างกันระหว่างรันในเครื่องกับบนคลาวด์
 * จึงลองหลายที่แทนการ hardcode ที่เดียว
 */
async function resolveDataDir() {
  const candidates = [
    path.join(process.cwd(), 'data-private'),
    path.join(process.cwd(), '..', 'data-private'),
    path.resolve('data-private'),
  ];
  for (const dir of candidates) {
    try {
      await fs.access(dir);
      return dir;
    } catch {
      // ลองที่ถัดไป
    }
  }
  return null;
}

export default async function handler(request) {
  const denied = requireAuth(request);
  if (denied) return denied;

  const url = new URL(request.url);
  const file = url.searchParams.get('file') || 'dashboard';

  const dataDir = await resolveDataDir();
  if (!dataDir) {
    console.error('หาโฟลเดอร์ data-private ไม่พบ, cwd =', process.cwd());
    return json({ error: 'ยังไม่มีข้อมูลในระบบ กรุณารัน pipeline ก่อน' }, 503);
  }

  let target;
  if (file === 'dashboard') {
    target = path.join(dataDir, 'dashboard.json');
  } else if (file === 'sectors') {
    // บทวิเคราะห์รายอุตสาหกรรม/ธีม — แยกไฟล์เพราะยาวและมีแค่หน้าเดียวที่ใช้
    target = path.join(dataDir, 'sectors.json');
  } else if (file === 'asset') {
    const symbol = url.searchParams.get('symbol') || '';
    if (!SYMBOL_PATTERN.test(symbol)) {
      return json({ error: 'สัญลักษณ์ไม่ถูกต้อง' }, 400);
    }
    target = path.join(dataDir, 'assets', `${symbol}.json`);
  } else {
    return json({ error: 'ไม่รู้จักไฟล์ที่ขอ' }, 400);
  }

  // ป้องกันชั้นสุดท้าย: เส้นทางที่ได้ต้องอยู่ใต้ dataDir เสมอ
  if (!path.resolve(target).startsWith(path.resolve(dataDir))) {
    return json({ error: 'เส้นทางไฟล์ไม่ถูกต้อง' }, 400);
  }

  try {
    const content = await fs.readFile(target, 'utf-8');
    return new Response(content, {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    if (err.code === 'ENOENT') {
      return json({ error: 'ไม่พบข้อมูลที่ขอ' }, 404);
    }
    console.error('อ่านไฟล์ข้อมูลไม่สำเร็จ:', err.message);
    return json({ error: 'อ่านข้อมูลไม่สำเร็จ' }, 500);
  }
}
