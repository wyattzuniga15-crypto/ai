/** Tiny DOM helpers. */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string | number | boolean | ((e: Event) => void)> = {}, ...children: (Node | string | null | undefined)[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (typeof v === 'function') el.addEventListener(k, v as EventListener);
    else if (k === 'class') el.className = String(v);
    else if (k === 'text') el.textContent = String(v);
    else if (typeof v === 'boolean') {
      if (v) el.setAttribute(k, '');
    } else el.setAttribute(k, String(v));
  }
  for (const c of children) if (c != null) el.append(c);
  return el;
}

export function button(label: string, onClick: () => void, cls = ''): HTMLButtonElement {
  return h('button', { class: `btn ${cls}`, click: () => onClick() }, label);
}

export function slider(label: (v: number) => string, min: number, max: number, step: number, value: number, onChange: (v: number) => void): HTMLDivElement {
  const knob = h('div', { class: 'knob' });
  const text = h('div', { class: 'label', text: label(value) });
  const input = h('input', { type: 'range', min, max, step, value }) as HTMLInputElement;
  const update = () => {
    const v = Number(input.value);
    knob.style.left = `calc(${((v - min) / (max - min)) * 100}% - ${((v - min) / (max - min)) * 8}px)`;
    text.textContent = label(v);
  };
  input.addEventListener('input', () => {
    update();
    onChange(Number(input.value));
  });
  update();
  return h('div', { class: 'slider' }, input, knob, text);
}

export function textField(label: string, value: string, placeholder = ''): { el: HTMLDivElement; input: HTMLInputElement } {
  const input = h('input', { type: 'text', value, placeholder }) as HTMLInputElement;
  return { el: h('div', { class: 'field' }, h('label', { text: label }), input), input };
}
