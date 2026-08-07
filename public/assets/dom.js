/* ============================================================
   ตัวช่วยสร้าง DOM แบบปลอดภัย
   ใช้แทน innerHTML ทั้งหมด — ข้อความทุกชิ้นถูกใส่ผ่าน textContent
   จึงไม่มีทางที่ชื่อบริษัทหรือข้อมูลจาก API ภายนอกจะกลายเป็นสคริปต์ได้
   ============================================================ */

/**
 * สร้าง element หนึ่งตัว
 *
 * @param {string} tag         ชื่อแท็ก เช่น 'div', 'td'
 * @param {object} props       class / text / title / attrs / on (event handlers)
 * @param {...(Node|string|null)} children  ลูกที่จะใส่ต่อท้าย
 */
export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);

  if (props.class) node.className = props.class;
  if (props.text !== undefined && props.text !== null) node.textContent = String(props.text);
  if (props.title) node.title = props.title;
  if (props.href) node.href = props.href;
  if (props.attrs) {
    for (const [key, value] of Object.entries(props.attrs)) {
      if (value !== null && value !== undefined) node.setAttribute(key, String(value));
    }
  }
  if (props.style) node.style.cssText = props.style;
  if (props.on) {
    for (const [event, fn] of Object.entries(props.on)) node.addEventListener(event, fn);
  }

  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

/** ล้างลูกทั้งหมดของ element แล้วใส่ชุดใหม่ */
export function replace(target, ...children) {
  target.replaceChildren(...children.flat().filter(Boolean));
  return target;
}

/** ข้อความธรรมดาที่ปลอดภัยเสมอ */
export function text(value) {
  return document.createTextNode(String(value ?? ''));
}
