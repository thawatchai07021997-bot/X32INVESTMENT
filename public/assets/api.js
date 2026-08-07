/* ============================================================
   เรียกข้อมูลจาก Netlify Function
   ข้อมูลทั้งหมดอยู่นอก publish directory จึงเข้าถึงได้ทางนี้ทางเดียว
   ============================================================ */

/** ข้อผิดพลาดที่แปลว่า session หมดอายุ — ผู้เรียกไม่ต้องแสดงข้อความ */
export const UNAUTHENTICATED = 'unauthenticated';

/**
 * เรียก /api/data — ถ้า session หมดอายุจะพากลับไปหน้าเข้าสู่ระบบเอง
 * แล้วโยน error UNAUTHENTICATED เพื่อให้ผู้เรียกหยุดทำงานต่อ
 */
export async function api(params) {
  let res;
  try {
    res = await fetch(`/api/data?${new URLSearchParams(params)}`);
  } catch {
    throw new Error('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาลองใหม่');
  }

  if (res.status === 401) {
    const next = encodeURIComponent(location.pathname + location.search);
    location.href = `/login.html?next=${next}`;
    throw new Error(UNAUTHENTICATED);
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `โหลดข้อมูลไม่สำเร็จ (${res.status})`);
  }
  return res.json();
}

/** แสดงข้อความผิดพลาดในกล่องแจ้งเตือน — ข้าม error ที่เป็นการ redirect */
export function showError(err, noticeId = 'notice') {
  if (err.message === UNAUTHENTICATED) return;
  const box = document.getElementById(noticeId);
  if (!box) return;
  box.hidden = false;
  box.textContent = err.message;
}
