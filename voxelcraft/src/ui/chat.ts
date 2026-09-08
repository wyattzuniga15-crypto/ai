/** Chat log and command line. */
import { h } from './dom.ts';

export class Chat {
  readonly root: HTMLElement;
  private readonly lines: HTMLElement;
  private readonly input: HTMLInputElement;
  open = false;
  private history: string[] = [];
  private historyPos = -1;
  onSubmit: ((text: string) => void) | null = null;
  onClose: (() => void) | null = null;

  constructor(container: HTMLElement) {
    this.lines = h('div', { class: 'lines' });
    this.input = h('input', { type: 'text', maxlength: 256, autocomplete: 'off', spellcheck: false }) as HTMLInputElement;
    this.root = h('div', { id: 'chat' }, this.lines, this.input);
    container.append(this.root);
    this.input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        const text = this.input.value.trim();
        if (text) {
          this.history.push(text);
          this.onSubmit?.(text);
        }
        this.close();
      } else if (e.key === 'Escape') this.close();
      else if (e.key === 'ArrowUp') {
        if (this.history.length) {
          this.historyPos = this.historyPos < 0 ? this.history.length - 1 : Math.max(0, this.historyPos - 1);
          this.input.value = this.history[this.historyPos];
        }
        e.preventDefault();
      } else if (e.key === 'ArrowDown') {
        if (this.historyPos >= 0) {
          this.historyPos = this.historyPos + 1 >= this.history.length ? -1 : this.historyPos + 1;
          this.input.value = this.historyPos < 0 ? '' : this.history[this.historyPos];
        }
        e.preventDefault();
      }
    });
  }

  show(initial = ''): void {
    this.open = true;
    this.root.classList.add('open');
    this.input.value = initial;
    this.historyPos = -1;
    // focus straight away, so the very next key typed lands in the box rather than the world, and
    // again a tick later because letting go of the pointer lock can pull focus back to the canvas
    this.focusInput(initial.length);
    setTimeout(() => this.focusInput(initial.length), 0);
  }

  private focusInput(caret: number): void {
    if (!this.open) return;
    this.input.focus();
    this.input.setSelectionRange(caret, caret);
  }

  close(): void {
    if (!this.open) return;
    this.open = false;
    this.root.classList.remove('open');
    this.input.value = '';
    this.input.blur();
    this.onClose?.();
  }

  addLine(text: string, color = '#fff'): void {
    const line = h('div', { class: 'line', text });
    line.style.color = color;
    this.lines.append(line);
    while (this.lines.children.length > 20) this.lines.firstChild?.remove();
    setTimeout(() => line.classList.add('old'), 10000);
  }
}
