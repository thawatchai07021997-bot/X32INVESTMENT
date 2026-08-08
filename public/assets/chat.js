/* ============================================================
   X32 — หน้าถาม-ตอบ AI

   คำตอบมาเป็น Server-Sent Events ไม่ใช่ JSON ก้อนเดียว เพราะ AI ต้องใช้เวลา
   เปิดดูข้อมูลหลายรอบก่อนตอบ ถ้ารอจนจบแล้วค่อยแสดงจะดูเหมือนเว็บค้าง
   ============================================================ */

import { api, showError, UNAUTHENTICATED } from './api.js';
import { el, replace } from './dom.js';
import { thaiDateTime } from './format.js';

const EXAMPLES = [
  'วันนี้มีอะไรน่าสนใจบ้าง',
  'หุ้นไทยตัวไหนปันผลดีและราคายังไม่แพง',
  'ถ้าจะถือยาว 5 ปี ระบบมองตัวไหนดีที่สุด เพราะอะไร',
  'ทองตอนนี้เป็นยังไงเทียบกับหุ้น',
];

// ชื่อเครื่องมือ → ข้อความบอกผู้ใช้ว่ากำลังทำอะไร
// ถ้าไม่บอก ผู้ใช้จะเห็นแค่หน้าจอนิ่งๆ หลายวินาทีแล้วคิดว่าพัง
const TOOL_LABEL = {
  get_market_overview: 'กำลังดูภาพรวมตลาดวันนี้…',
  screen_assets: 'กำลังคัดกรองสินทรัพย์…',
  get_asset_detail: 'กำลังเปิดข้อมูลเชิงลึก…',
};

const thread = document.getElementById('thread');
const form = document.getElementById('ask');
const input = document.getElementById('q');
const sendBtn = document.getElementById('send');
const quotaLabel = document.getElementById('quota');

/** ประวัติที่ส่งกลับไปให้ AI — เก็บเฉพาะข้อความ ไม่เก็บสถานะ UI */
let history = [];
let busy = false;

function bubble(role, text) {
  const box = el('div', { class: `bubble bubble-${role}` }, text);
  thread.append(box);
  box.scrollIntoView({ behavior: 'smooth', block: 'end' });
  return box;
}

function setBusy(state) {
  busy = state;
  sendBtn.disabled = state;
  input.disabled = state;
  sendBtn.textContent = state ? 'กำลังตอบ…' : 'ถาม';
}

function renderQuota(quota) {
  if (!quota) return;
  const left = Math.max(quota.limit - quota.used, 0);
  quotaLabel.textContent = `เหลือ ${left} จาก ${quota.limit} คำถามของวันนี้`;
}

/**
 * อ่าน SSE ทีละเฟรม
 * เฟรมหนึ่งจบด้วยบรรทัดว่างสองครั้ง และอาจถูกตัดกลางคันระหว่าง chunk
 * จึงต้องเก็บเศษที่ค้างไว้ต่อกับ chunk ถัดไป ไม่ใช่แยกทีละ chunk
 */
async function* readEvents(response) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const frames = buffer.split('\n\n');
    buffer = frames.pop() || '';
    for (const frame of frames) {
      const line = frame.trim();
      if (!line.startsWith('data: ')) continue;
      try {
        yield JSON.parse(line.slice(6));
      } catch {
        // เฟรมเสียหนึ่งอันไม่ควรทำให้ทั้งคำตอบล่ม — ข้ามไปอ่านอันถัดไป
      }
    }
  }
}

async function ask(question) {
  setBusy(true);
  bubble('user', question);

  const answer = bubble('ai', '');
  const status = el('p', { class: 'muted small bubble-status' }, 'กำลังคิด…');
  answer.append(status);
  let text = '';

  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question, history }),
    });

    if (response.status === 401) {
      const next = encodeURIComponent(location.pathname);
      location.href = `/login.html?next=${next}`;
      throw new Error(UNAUTHENTICATED);
    }
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.error || `ถามไม่สำเร็จ (${response.status})`);
    }

    for await (const event of readEvents(response)) {
      if (event.type === 'tool') {
        status.textContent = TOOL_LABEL[event.name] || 'กำลังเปิดดูข้อมูล…';
      } else if (event.type === 'text') {
        status.remove();
        text += event.text;
        answer.textContent = text;
        answer.scrollIntoView({ behavior: 'smooth', block: 'end' });
      } else if (event.type === 'error') {
        status.remove();
        answer.classList.add('bubble-error');
        answer.textContent = text ? `${text}\n\n(${event.message})` : event.message;
      } else if (event.type === 'done') {
        status.remove();
        renderQuota(event.quota);
      }
    }

    if (text) {
      history.push({ role: 'user', content: question }, { role: 'assistant', content: text });
      // เก็บ 3 คู่ล่าสุดพอ — ฝั่งเซิร์ฟเวอร์ตัดให้อีกชั้นอยู่แล้ว
      history = history.slice(-6);
    }
  } catch (err) {
    status.remove();
    if (err.message !== UNAUTHENTICATED) {
      answer.classList.add('bubble-error');
      answer.textContent = err.message;
    }
  } finally {
    setBusy(false);
    input.focus();
  }
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  const question = input.value.trim();
  if (!question || busy) return;
  input.value = '';
  ask(question);
});

// Enter ส่งคำถาม, Shift+Enter ขึ้นบรรทัดใหม่ — พฤติกรรมที่คนคุ้นจากแอปแชททั่วไป
input.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    form.requestSubmit();
  }
});

document.getElementById('clear').addEventListener('click', () => {
  history = [];
  replace(thread, []);
  input.focus();
});

function renderExamples() {
  replace(
    document.getElementById('examples'),
    EXAMPLES.map((question) => el('button', {
      class: 'example',
      text: question,
      attrs: { type: 'button' },
      on: {
        click: () => {
          if (busy) return;
          ask(question);
        },
      },
    })),
  );
}

async function boot() {
  renderExamples();
  try {
    // ดึง disclaimer กับวันที่ข้อมูลจากไฟล์เดียวกับที่ Dashboard ใช้ เพื่อไม่ให้ข้อความสองที่ไม่ตรงกัน
    const dashboard = await api({ file: 'dashboard' });
    document.getElementById('disclaimer').textContent = dashboard.disclaimer;
    if (dashboard.generated_at) {
      quotaLabel.title = `ข้อมูลอัปเดตล่าสุด ${thaiDateTime(dashboard.generated_at)}`;
    }

    const quota = await fetch('/api/quota').then((r) => r.json());
    renderQuota(quota);
  } catch (err) {
    showError(err);
  }
}

boot();
