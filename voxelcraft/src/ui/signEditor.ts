/** Sign text editor overlay (four lines of up to 15 characters). */
import { button, h } from './dom.ts';

export function openSignEditor(container: HTMLElement, lines: string[], done: (lines: string[]) => void): () => void {
  const inputs: HTMLInputElement[] = [];
  const box = h('div', { class: 'col' });
  box.style.cssText = 'background:#8f6d43;border:4px solid #3b2a17;padding:24px 32px;display:flex;flex-direction:column;gap:6px;align-items:center;';
  for (let i = 0; i < 4; i++) {
    const inp = h('input', { type: 'text', maxlength: 15, value: lines[i] ?? '' }) as HTMLInputElement;
    inp.style.cssText = 'width:260px;height:32px;background:transparent;border:none;border-bottom:2px solid rgba(0,0,0,0.3);color:#000;font:bold 22px sans-serif;text-align:center;outline:none;';
    inp.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        if (i < 3) inputs[i + 1].focus();
        else finish();
      } else if (e.key === 'Escape') finish();
      else if (e.key === 'ArrowDown' && i < 3) inputs[i + 1].focus();
      else if (e.key === 'ArrowUp' && i > 0) inputs[i - 1].focus();
    });
    inputs.push(inp);
    box.append(inp);
  }
  const root = h('div', { class: 'screen' }, h('h2', { text: 'Edit Sign Message' }), box, button('Done', () => finish()));
  root.addEventListener('mousedown', (e) => e.stopPropagation());
  container.append(root);
  setTimeout(() => inputs[0].focus(), 0);
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    root.remove();
    done(inputs.map((i) => i.value.slice(0, 15)));
  };
  return finish;
}
