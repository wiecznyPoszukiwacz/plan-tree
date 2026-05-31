/**
 * StatusBar — pasek statusu jako Window z take4-console.
 * Wysokość 1, bez ramki, tryb inverse na całej szerokości.
 */

import { Window } from 'take4-console';
import type { StyleId, WindowProperties } from 'take4-console';

/**
 * Stan paska statusu (mode + tymczasowa wiadomość).
 * Focus per panel renderuje take4-console przez BUILTIN_BORDER_FOCUSED (border),
 * dirty flag był niewidoczny przez autosave, inbox count nie był nigdzie wired —
 * wszystkie trzy usunięte.
 */
interface StatusBarState {
  mode: 'normal' | 'edit';
  mcpLastCallTs: Date | null;
  mcpLastCallTool: string;
  message: string;
  frozenHidden: number;
  followMode: boolean;
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
      mcpLastCallTs: null,
      mcpLastCallTool: '',
      message: '',
      frozenHidden: 0,
      followMode: false,
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
   * Ustawia znacznik ostatniego wywołania MCP toola. Wyświetlany jako
   * "⏱ HH:MM:SS <tool>" po prawej stronie statusbara.
   *
   * @param ts - Timestamp wywołania
   * @param tool - Nazwa narzędzia (add/delete/move/…)
   */
  /**
   * Ustawia liczbę węzłów aktualnie ukrytych przez filtr FROZEN. W trybie
   * NORMAL i gdy N>0 wyświetlany jest sufiks `(+N frozen)` w lewej części
   * statusbara — sygnał dla usera, że coś jest poza widokiem.
   *
   * @param n - Liczba ukrytych frozen-węzłów (0 = nic do pokazania).
   */
  public setFrozenHidden(n: number): void {
    if (this.state.frozenHidden === n) return;
    this.state.frozenHidden = n;
    this.invalidate();
  }

  /**
   * Ustawia stan trybu follow. Gdy ON, w lewej części statusbara (tryb NORMAL)
   * pojawia się znacznik `⟳follow` — sygnał, że MCP przenosi selekcję.
   *
   * @param on - Czy follow jest aktywny
   */
  public setFollowMode(on: boolean): void {
    if (this.state.followMode === on) return;
    this.state.followMode = on;
    this.invalidate();
  }

  public setMcpLastCall(ts: Date, tool: string): void {
    this.state.mcpLastCallTs = ts;
    this.state.mcpLastCallTool = tool;
    this.invalidate();
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

    const modeStr = `[${this.state.mode === 'normal' ? 'NORMAL' : 'EDIT'}]`;
    // Key hints widoczne tylko w trybie normalnym (w EDIT pole tekstowe przejmuje wejście).
    const frozenSuffix = this.state.mode === 'normal' && this.state.frozenHidden > 0
      ? `  (+${this.state.frozenHidden} frozen)`
      : '';
    const followSuffix = this.state.mode === 'normal' && this.state.followMode
      ? '  ⟳follow'
      : '';
    const leftStr = this.state.mode === 'normal'
      ? `${modeStr}  1-3/0:prio  p:cycle  f:follow${frozenSuffix}${followSuffix}`
      : modeStr;
    // Right side: temporary message wins; else MCP last-call indicator
    // (icon + HH:MM:SS + tool name) gdy jakiekolwiek wywołanie miało miejsce.
    // Brak wywołań → tylko mode po lewej.
    let rightPart = '';
    if (this.state.message) {
      rightPart = this.state.message;
    } else if (this.state.mcpLastCallTs) {
      const ts = this.state.mcpLastCallTs;
      const pad = (n: number): string => n.toString().padStart(2, '0');
      const hms = `${pad(ts.getHours())}:${pad(ts.getMinutes())}:${pad(ts.getSeconds())}`;
      rightPart = ` ${hms} ${this.state.mcpLastCallTool}`;
    }

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
