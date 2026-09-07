/**
 * Books: the reading view vanilla shows for a written book or a lectern, and the writing view for a
 * book and quill. Both are drawn over vanilla's book background.
 */
import { h, button } from './dom.ts';

const PAGE_CHARS = 256;
const BOOK_BG = `${import.meta.env.BASE_URL}textures/gui/book.png`;

function frame(): HTMLElement {
  const box = h('div', { class: 'col' });
  // vanilla's book texture is 146x180 in a 256x256 sheet
  box.style.cssText = `width:${146 * 3}px;height:${180 * 3}px;background:url('${BOOK_BG}') 0 0 / ${256 * 3}px ${256 * 3}px no-repeat;image-rendering:pixelated;position:relative;`;
  return box;
}

/** Reading: pages of a written book or the one open on a lectern. */
export function openBookReader(container: HTMLElement, title: string, pages: string[], page: number, onPage: (n: number) => void, onClose: () => void, onTake?: () => void): () => void {
  const box = frame();
  const text = h('div');
  text.style.cssText = 'position:absolute;left:90px;top:96px;width:300px;height:360px;color:#000;font:15px/21px sans-serif;white-space:pre-wrap;overflow:hidden;';
  const label = h('div');
  label.style.cssText = 'position:absolute;right:60px;top:60px;color:#000;font:13px sans-serif;';
  box.append(text, label);
  let current = Math.max(0, Math.min(page, Math.max(0, pages.length - 1)));
  const draw = (): void => {
    text.textContent = pages[current] ?? '';
    label.textContent = `Page ${current + 1} of ${Math.max(1, pages.length)}`;
    onPage(current);
  };
  const prev = button('<', () => {
    current = Math.max(0, current - 1);
    draw();
  }, 'tiny');
  const next = button('>', () => {
    current = Math.min(Math.max(0, pages.length - 1), current + 1);
    draw();
  }, 'tiny');
  const controls = h('div', { class: 'row' }, prev, next, button(onTake ? 'Take Book' : 'Close', () => {
    if (onTake) onTake();
    finish();
  }, 'tiny'));
  controls.style.cssText = 'display:flex;gap:8px;margin-top:8px;';
  const root = h('div', { class: 'screen' }, h('h2', { text: title }), box, controls);
  root.addEventListener('mousedown', (e) => e.stopPropagation());
  container.append(root);
  draw();
  let finished = false;
  const finish = (): void => {
    if (finished) return;
    finished = true;
    root.remove();
    onClose();
  };
  return finish;
}

/** Writing: a book and quill, one page at a time, signed with a title when it is finished. */
export function openBookEditor(container: HTMLElement, pages: string[], done: (pages: string[], title?: string) => void): () => void {
  const text = pages.length ? [...pages] : [''];
  let current = 0;
  const box = frame();
  const area = h('textarea', { maxlength: String(PAGE_CHARS) }) as HTMLTextAreaElement;
  area.style.cssText = 'position:absolute;left:90px;top:96px;width:300px;height:360px;background:transparent;border:none;outline:none;resize:none;color:#000;font:15px/21px sans-serif;';
  area.value = text[0];
  area.addEventListener('keydown', (e) => e.stopPropagation());
  area.addEventListener('input', () => { text[current] = area.value; });
  const label = h('div');
  label.style.cssText = 'position:absolute;right:60px;top:60px;color:#000;font:13px sans-serif;';
  box.append(area, label);
  const show = (): void => {
    area.value = text[current] ?? '';
    label.textContent = `Page ${current + 1} of ${text.length}`;
  };
  const controls = h('div', { class: 'row' },
    button('<', () => {
      if (current > 0) current--;
      show();
    }, 'tiny'),
    button('>', () => {
      current++;
      if (current >= text.length) text.push('');
      show();
    }, 'tiny'),
    button('Sign', () => {
      // vanilla asks for the title on the book itself rather than in a dialog
      titleRow.hidden = !titleRow.hidden;
      if (!titleRow.hidden) setTimeout(() => titleInput.focus(), 0);
    }, 'tiny'),
    button('Done', () => finish(), 'tiny'));
  controls.style.cssText = 'display:flex;gap:8px;margin-top:8px;';
  const titleInput = h('input', { type: 'text', maxlength: '32', placeholder: 'Book title' }) as HTMLInputElement;
  titleInput.style.cssText = 'width:220px;height:32px;background:#000;border:2px solid #a0a0a0;color:#e0e0e0;font:15px sans-serif;padding:0 8px;outline:none;';
  titleInput.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') finish(titleInput.value.slice(0, 32) || 'Book');
  });
  const titleRow = h('div', { class: 'row' }, titleInput, button('Sign and Close', () => finish(titleInput.value.slice(0, 32) || 'Book'), 'tiny'));
  titleRow.style.cssText = 'display:flex;gap:8px;margin-top:8px;';
  titleRow.hidden = true;
  const root = h('div', { class: 'screen' }, h('h2', { text: 'Book and Quill' }), box, controls, titleRow);
  root.addEventListener('mousedown', (e) => e.stopPropagation());
  container.append(root);
  setTimeout(() => area.focus(), 0);
  show();
  let finished = false;
  const finish = (title?: string): void => {
    if (finished) return;
    finished = true;
    root.remove();
    // trailing blank pages are dropped, as vanilla drops them when a book is signed
    while (text.length > 1 && !text[text.length - 1].trim()) text.pop();
    done(text, title);
  };
  return () => finish();
}
