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

/** The GUI scale everything on screen is measured in, as the stylesheet currently has it. */
export function guiScale(): number {
  return Number(getComputedStyle(document.documentElement).getPropertyValue('--gui')) || 3;
}

/**
 * The scale to draw at when the setting is left on Auto. Vanilla grows the scale for as long as the
 * screen still measures at least 320 by 240 units, which is what every one of its layouts is drawn
 * against. A phone is shorter than that rule allows for and would land on 1, where nothing on it is
 * big enough to hit with a thumb, so a touch screen never goes below 2.
 */
export function autoGuiScale(): number {
  const floor = navigator.maxTouchPoints > 0 && matchMedia('(pointer: coarse)').matches ? 2 : 1;
  const fits = Math.floor(Math.min(window.innerWidth / 320, window.innerHeight / 240));
  return Math.max(floor, Math.min(4, fits));
}

/** Puts the interface scale on the document, working Auto out against the window as it stands. */
export function applyGuiScale(setting: number): number {
  const scale = setting > 0 ? setting : autoGuiScale();
  document.documentElement.style.setProperty('--gui', String(scale));
  return scale;
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
