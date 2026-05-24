/**
 * StatusBar — pasek statusu jako Window z take4-console.
 * Wysokość 1, bez ramki, tryb inverse na całej szerokości.
 */

import { Window } from 'take4-console';
import type { StyleId, WindowProperties } from 'take4-console';

/**
 * Stan paska statusu (mode, dirty flag, focused panel, inbox, tymczasowa wiadomość).
 */
interface StatusBarState {
  mode: 'normal' | 'edit';
  isDirty: boolean;
  focusedPanel: 'tree' | 'details' | null;
  inboxCount: number;
  message: string;
}

/**
 * Status bar widoczny zawsze na dole — kontrolka nieaktywna w cyklu fokusa.
 */
export default class StatusBar extends Window {
  private state: StatusBarState;
  private messageTimeout: ReturnType<typeof setTimeout> | null = null;
  private inverseStyleId: StyleId;

  /**
   * Tworzy nowy StatusBar jako Window z biblioteki.
   *
   * @param wp - Właściwości okna (pozycja, rozmiar, layout-slot)
   */
  public constructor(wp: WindowProperties) {
    super(wp);
    this.state = {
      mode: 'normal',
      isDirty: false,
      focusedPanel: null,
      inboxCount: 0,
      message: '',
    };
    this.inverseStyleId = this.registry.register({ inverse: true });
  }

  /**
   * Ustawia tryb aplikacji.
   *
   * @param mode - 'normal' lub 'edit'
   */
  public setMode(mode: 'normal' | 'edit'): void {
    if (this.state.mode === mode) return;
    this.state.mode = mode;
    this.invalidate();
  }

  /**
   * Zwraca bieżący tryb.
   *
   * @returns Bieżący tryb
   */
  public getMode(): 'normal' | 'edit' {
    return this.state.mode;
  }

  /**
   * Ustawia flagę niezapisanych zmian.
   *
   * @param isDirty - true gdy są niezapisane zmiany
   */
  public setDirty(isDirty: boolean): void {
    if (this.state.isDirty === isDirty) return;
    this.state.isDirty = isDirty;
    this.invalidate();
  }

  /**
   * Zwraca flagę niezapisanych zmian.
   *
   * @returns true gdy są niezapisane zmiany
   */
  public isDirty(): boolean {
    return this.state.isDirty;
  }

  /**
   * Ustawia który panel ma fokus.
   *
   * @param panel - 'tree', 'details' lub null
   */
  public setFocusedPanel(panel: 'tree' | 'details' | null): void {
    if (this.state.focusedPanel === panel) return;
    this.state.focusedPanel = panel;
    this.invalidate();
  }

  /**
   * Zwraca który panel ma fokus.
   *
   * @returns Wskazanie panelu
   */
  public getFocusedPanel(): 'tree' | 'details' | null {
    return this.state.focusedPanel;
  }

  /**
   * Ustawia licznik elementów w inbox.
   *
   * @param count - Liczba elementów
   */
  public setInboxCount(count: number): void {
    if (this.state.inboxCount === count) return;
    this.state.inboxCount = count;
    this.invalidate();
  }

  /**
   * Zwraca licznik elementów w inbox.
   *
   * @returns Liczba elementów
   */
  public getInboxCount(): number {
    return this.state.inboxCount;
  }

  /**
   * Wyświetla tymczasową wiadomość gasnącą po `duration` ms.
   *
   * @param message - Treść
   * @param duration - Czas wyświetlania w ms
   */
  public showMessage(message: string, duration: number = 2000): void {
    this.state.message = message;
    this.invalidate();

    if (this.messageTimeout) {
      clearTimeout(this.messageTimeout);
    }

    this.messageTimeout = setTimeout(() => {
      this.state.message = '';
      this.messageTimeout = null;
      this.invalidate();
    }, duration);
  }

  /**
   * Zwraca bieżącą wiadomość.
   *
   * @returns Wiadomość lub pusty string
   */
  public getMessage(): string {
    return this.state.message;
  }

  /**
   * Override Window.render — rysuje stan jako jedna linia inverse.
   */
  public override render(): void {
    this.clear();
    this.fill(' ', this.inverseStyleId);

    const inner = this.getInnerSize();
    const width = inner.width;
    if (width <= 0) {
      super.render();
      return;
    }

    const parts: string[] = [];
    parts.push(`[${this.state.mode === 'normal' ? 'NORMAL' : 'EDIT'}]`);
    if (this.state.isDirty) parts.push('[*]');
    if (this.state.focusedPanel === 'tree') parts.push('[Tree]');
    else if (this.state.focusedPanel === 'details') parts.push('[Details]');

    let rightPart = '';
    if (this.state.message) rightPart = this.state.message;
    else if (this.state.inboxCount > 0) rightPart = `Inbox: ${this.state.inboxCount}`;

    const leftStr = parts.join(' ');
    let line = leftStr;
    if (rightPart) {
      const padding = Math.max(1, width - this.getTextWidth(leftStr) - this.getTextWidth(rightPart));
      line = leftStr + ' '.repeat(padding) + rightPart;
    }

    if (this.getTextWidth(line) > width) {
      line = line.substring(0, Math.max(0, width - 1)) + '…';
    }

    this.writeText(line, { x: 0, y: 0, style: this.inverseStyleId });
    super.render();
  }

  /**
   * Zatrzymuje pending timeout (cleanup).
   */
  public stopMessageTimer(): void {
    if (this.messageTimeout) {
      clearTimeout(this.messageTimeout);
      this.messageTimeout = null;
    }
  }
}
