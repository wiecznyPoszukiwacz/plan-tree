/**
 * DebugPanel — okno renderujące zawartość Logger ring-bufora.
 *
 * Domyślnie ukryte (setVisible(false)) — toggleable klawiszem zdefiniowanym
 * w ApplicationState (obecnie backtick). Subskrybuje Logger i invalidate'uje
 * się przy każdym nowym wpisie, więc gdy jest widoczny — pokazuje aktualną
 * końcówkę bufora.
 */

import { Window } from 'take4-console';
import type { CellAttributes, WindowProperties, WriteTextSegment } from 'take4-console';
import Logger, { type LogEntry, type LogLevel } from '../Logger.mjs';

/**
 * Mapowanie poziomu logu na kolor (256-color palette).
 */
const levelAttrs: Record<LogLevel, CellAttributes> = {
  info: { foreground: 7 },   // light gray
  warn: { foreground: 11 },  // bright yellow
  error: { foreground: 9 },  // bright red
};

/**
 * DebugPanel — bezstanowy widok bufora loggera.
 */
export default class DebugPanel extends Window {
  private unsubscribe: (() => void) | null = null;

  /**
   * Tworzy panel debug. Subskrybuje Logger — invalidate przy każdym nowym wpisie.
   *
   * @param wp - WindowProperties (pos, size, border)
   */
  public constructor(wp: WindowProperties) {
    super(wp);
    this.unsubscribe = Logger.subscribe(() => {
      if (this.isVisible()) this.invalidate();
    });
  }

  /**
   * Zwalnia subskrypcję loggera. Wołać przed dispose Screen, żeby Logger
   * nie trzymał referencji do martwego panelu.
   */
  public dispose(): void {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
  }

  /**
   * Formatuje timestamp do HH:MM:SS.
   *
   * @param d - Data wpisu
   * @returns String HH:MM:SS
   */
  private static formatTime(d: Date): string {
    const pad = (n: number): string => n.toString().padStart(2, '0');
    return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }

  /**
   * Override Window.render — rysuje końcówkę bufora dopasowaną do wysokości.
   */
  public override render(): void {
    this.clear();
    const inner = this.getInnerSize();
    if (inner.width <= 0 || inner.height <= 0) {
      super.render();
      return;
    }

    const entries = Logger.getEntries();
    // Wybierz końcówkę pasującą do wysokości panelu.
    const visible: LogEntry[] = entries.slice(Math.max(0, entries.length - inner.height));

    for (let i = 0; i < visible.length; i++) {
      const entry = visible[i];
      const ts = DebugPanel.formatTime(entry.timestamp);
      const prefix = `${ts} [${entry.source}] `;
      const attrs = levelAttrs[entry.level];
      const segments: WriteTextSegment[] = [
        { text: prefix, attrs: { dim: true } },
        { text: entry.message, attrs },
      ];
      this.writeText(segments, { x: 0, y: i });
    }

    super.render();
  }
}
