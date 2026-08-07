/* ============================================================
   กราฟเส้นราคา วาดด้วย SVG เอง — ไม่พึ่งไลบรารีภายนอก

   เหตุผลที่ไม่ใช้ Chart.js:
   - ไม่ต้องพึ่ง CDN → เว็บทำงานได้เสมอ และไม่มีบุคคลที่สามเห็นว่า
     ผู้ใช้เปิดดูสินทรัพย์ตัวไหน (เว็บนี้ตั้งใจให้เป็นส่วนตัว)
   - เส้นคมชัดตามภาษาของ brutalism ควบคุมได้ทุกจุด
   - เบากว่ามาก
   ============================================================ */

const SVG_NS = 'http://www.w3.org/2000/svg';

// ระบบพิกัดภายในของ SVG — CSS จะย่อขยายให้พอดีความกว้างจริง
const W = 1000;
const H = 340;
const PAD = { top: 16, right: 16, bottom: 34, left: 62 };

function svgEl(tag, attrs = {}) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) {
    node.setAttribute(key, String(value));
  }
  return node;
}

/** เลือกช่วงแกน Y ให้ลงตัวสวยงาม (1, 2, 2.5, 5 × 10^n) */
function niceStep(range, targetTicks) {
  const rough = range / targetTicks;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  for (const multiple of [1, 2, 2.5, 5, 10]) {
    if (rough <= magnitude * multiple) return magnitude * multiple;
  }
  return magnitude * 10;
}

function formatPrice(value) {
  const digits = Math.abs(value) >= 1000 ? 0 : 2;
  return value.toLocaleString('th-TH', {
    minimumFractionDigits: digits, maximumFractionDigits: digits,
  });
}

/**
 * วาดกราฟเส้นราคาลงใน container
 *
 * @param {HTMLElement} container  กล่องที่จะใส่ SVG
 * @param {Array<{d:string,c:number}>} points  ข้อมูลเรียงตามวันที่
 */
export function lineChart(container, points) {
  container.replaceChildren();
  if (!points || points.length < 2) {
    container.append(Object.assign(document.createElement('p'),
      { className: 'skeleton', textContent: 'ไม่มีข้อมูลราคาเพียงพอสำหรับวาดกราฟ' }));
    return;
  }

  const values = points.map((p) => p.c);
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  const step = niceStep((rawMax - rawMin) || rawMax * 0.1 || 1, 5);
  const yMin = Math.floor(rawMin / step) * step;
  const yMax = Math.ceil(rawMax / step) * step;

  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const xAt = (i) => PAD.left + (i / (points.length - 1)) * plotW;
  const yAt = (v) => PAD.top + (1 - (v - yMin) / (yMax - yMin || 1)) * plotH;

  const svg = svgEl('svg', {
    viewBox: `0 0 ${W} ${H}`,
    // ปล่อยให้เบราว์เซอร์คำนวณความสูงจากสัดส่วน viewBox เอง
    // ไม่ใช้ preserveAspectRatio="none" เพราะจะทำให้ตัวอักษรยืดผิดรูป
    style: 'width:100%;height:auto;display:block',
    role: 'img',
    'aria-label': `กราฟราคาตั้งแต่ ${points[0].d} ถึง ${points[points.length - 1].d}`,
  });

  // ── เส้นกริดแนวนอน + ป้ายราคา ──
  for (let v = yMin; v <= yMax + 1e-9; v += step) {
    const y = yAt(v);
    svg.append(svgEl('line', {
      x1: PAD.left, y1: y, x2: W - PAD.right, y2: y,
      stroke: 'currentColor', 'stroke-width': 1, opacity: 0.18,
    }));
    const label = svgEl('text', {
      x: PAD.left - 10, y: y + 4, 'text-anchor': 'end',
      fill: 'currentColor', 'font-size': 13, 'font-family': 'IBM Plex Mono, monospace',
      opacity: 0.75,
    });
    label.textContent = formatPrice(v);
    svg.append(label);
  }

  // ── ป้ายวันที่แกน X (6 จุด) ──
  const labelCount = Math.min(6, points.length);
  for (let i = 0; i < labelCount; i += 1) {
    const index = Math.round((i / (labelCount - 1)) * (points.length - 1));
    const text = svgEl('text', {
      x: xAt(index), y: H - 10,
      'text-anchor': i === 0 ? 'start' : i === labelCount - 1 ? 'end' : 'middle',
      fill: 'currentColor', 'font-size': 13,
      'font-family': 'IBM Plex Mono, monospace', opacity: 0.75,
    });
    // แสดงแค่ ปี-เดือน ให้อ่านง่าย
    text.textContent = points[index].d.slice(0, 7);
    svg.append(text);
  }

  // ── กรอบพื้นที่กราฟ (เส้นหนาแบบ brutalism) ──
  svg.append(svgEl('rect', {
    x: PAD.left, y: PAD.top, width: plotW, height: plotH,
    fill: 'none', stroke: 'currentColor', 'stroke-width': 2,
  }));

  // ── เส้นราคา ──
  const rising = values[values.length - 1] >= values[0];
  const color = rising ? 'var(--up)' : 'var(--down)';
  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${xAt(i).toFixed(1)},${yAt(p.c).toFixed(1)}`).join(' ');

  svg.append(svgEl('path', {
    d: path, fill: 'none', stroke: color,
    'stroke-width': 3, 'stroke-linejoin': 'round', 'stroke-linecap': 'round',
  }));

  // ── ตัวชี้ตำแหน่งเมื่อเอาเมาส์ชี้ ──
  const cursor = svgEl('g', { opacity: 0 });
  const cursorLine = svgEl('line', {
    y1: PAD.top, y2: PAD.top + plotH, stroke: 'currentColor', 'stroke-width': 2,
  });
  const cursorDot = svgEl('rect', {
    width: 10, height: 10, fill: color, stroke: 'currentColor', 'stroke-width': 2,
  });
  cursor.append(cursorLine, cursorDot);
  svg.append(cursor);

  // พื้นที่รับเมาส์ทั้งกราฟ
  const hit = svgEl('rect', {
    x: PAD.left, y: PAD.top, width: plotW, height: plotH, fill: 'transparent',
  });
  svg.append(hit);

  const readout = document.createElement('div');
  readout.className = 'mono small';
  readout.style.cssText = 'margin-top:6px;min-height:1.4em;text-align:right';
  readout.textContent = `${points[points.length - 1].d} · ${formatPrice(values[values.length - 1])}`;

  const moveCursor = (event) => {
    const box = svg.getBoundingClientRect();
    // แปลงพิกัดหน้าจอกลับเป็นพิกัดภายใน SVG (เพราะ SVG ถูกย่อขยายด้วย CSS)
    const svgX = ((event.clientX - box.left) / box.width) * W;
    const ratio = (svgX - PAD.left) / plotW;
    const index = Math.max(0, Math.min(points.length - 1,
      Math.round(ratio * (points.length - 1))));
    const point = points[index];

    cursor.setAttribute('opacity', '1');
    cursorLine.setAttribute('x1', xAt(index));
    cursorLine.setAttribute('x2', xAt(index));
    cursorDot.setAttribute('x', xAt(index) - 5);
    cursorDot.setAttribute('y', yAt(point.c) - 5);
    readout.textContent = `${point.d} · ${formatPrice(point.c)}`;
  };

  hit.addEventListener('mousemove', moveCursor);
  hit.addEventListener('mouseleave', () => {
    cursor.setAttribute('opacity', '0');
    readout.textContent =
      `${points[points.length - 1].d} · ${formatPrice(values[values.length - 1])}`;
  });

  container.append(svg, readout);
}
