/**
 * PopupMenu — lekkie menu kontekstowe rysowane jako overlay wewnątrz
 * dowolnego Window (typowo TreePanel). Nie jest osobnym Window — to
 * helper, którego właściciel woła w swoim render() i którego stan
 * (open/items/selectedIndex) trzyma sam.
 *
 * Sterowanie: j/k oraz strzałki góra/dół nawigują; h, Esc zamykają bez
 * akcji; Space, Enter zatwierdzają wybór. Klawisze są pochłaniane gdy
 * menu jest otwarte (handleKey zwraca true), więc właściciel nie powinien
 * przekazywać ich dalej do swoich własnych skrótów.
 */

import type { Window, CellAttributes } from 'take4-console';

/**
 * Pojedyncza pozycja menu — etykieta widoczna dla użytkownika i akcja
 * wywoływana po zatwierdzeniu Enter/Space.
 */
export interface PopupMenuItem {
  label: string;
  action: () => void;
}

/**
 * Menu pop-up z minimalnym stanem. Bezstanowy renderer + key dispatcher.
 */
export default class PopupMenu {
  private items: PopupMenuItem[] = [];
  private selectedIndex = 0;
  private opened = false;

  /**
   * Otwiera menu z podanymi pozycjami. Brak pozycji — no-op.
   *
   * @param items - Lista pozycji (label + action)
   */
  public open(items: PopupMenuItem[]): void {
    if (items.length === 0) return;
    this.items = items;
    this.selectedIndex = 0;
    this.opened = true;
  }

  /**
   * Zamyka menu i czyści pozycje. Bezpieczne do wywołania nawet gdy zamknięte.
   */
  public close(): void {
    this.opened = false;
    this.items = [];
    this.selectedIndex = 0;
  }

  /**
   * Czy menu jest aktualnie otwarte.
   */
  public isOpen(): boolean {
    return this.opened;
  }

  /**
   * Przetwarza klawisz. Gdy menu otwarte, zawsze zwraca true (klawisz
   * pochłonięty), żeby właściciel nie próbował też go obsłużyć.
   *
   * j/strzałka-dół: następna pozycja; k/strzałka-góra: poprzednia.
   * h, Esc (\x1b): zamknij bez akcji.
   * Space, Enter: wykonaj akcję wybranej pozycji i zamknij.
   *
   * @param key - Surowy klawisz od WindowManager
   * @returns true gdy menu pochłonęło klawisz, false gdy menu zamknięte
   */
  public handleKey(key: string): boolean {
    if (!this.opened) return false;
    switch (key) {
      case 'j':
      case '\x1b[B':
        if (this.selectedIndex < this.items.length - 1) this.selectedIndex++;
        return true;
      case 'k':
      case '\x1b[A':
        if (this.selectedIndex > 0) this.selectedIndex--;
        return true;
      case 'h':
      case '\x1b':
        this.close();
        return true;
      case ' ':
      case '\r':
      case '\n': {
        const it = this.items[this.selectedIndex];
        this.close();
        if (it) it.action();
        return true;
      }
      default:
        return true;
    }
  }

  /**
   * Zwraca pozycje (do testów/diagnostyki).
   */
  public getItems(): readonly PopupMenuItem[] {
    return this.items;
  }

  /**
   * Zwraca aktualnie zaznaczoną pozycję (do testów/diagnostyki).
   */
  public getSelectedIndex(): number {
    return this.selectedIndex;
  }

  /**
   * Rysuje menu w obrębie podanego Window startując od (anchorX, anchorY)
   * w jego inner-coords. Gdy popup nie mieści się — przesuwa go w lewo/górę
   * tak, aby zmieścił się w inner-area; nigdy nie wyjeżdża poza panel.
   *
   * Wywoływać z poziomu render() właściciela PRZED super.render(), żeby
   * blit popupu nadpisał już-narysowane wiersze.
   *
   * @param target - Window-host (np. TreePanel)
   * @param anchorX - Preferowana kolumna lewego górnego rogu menu
   * @param anchorY - Preferowany wiersz lewego górnego rogu menu
   */
  public render(target: Window, anchorX: number, anchorY: number): void {
    if (!this.opened || this.items.length === 0) return;
    const inner = target.getInnerSize();
    if (inner.width <= 0 || inner.height <= 0) return;

    const labelMax = this.items.reduce(
      (m, it) => Math.max(m, target.getTextWidth(it.label)),
      0,
    );
    // Box: '│ <label> │' → wewnętrzna szerokość = labelMax + 2 (padding).
    const desiredWidth = Math.min(inner.width, labelMax + 4);
    const desiredHeight = Math.min(inner.height, this.items.length + 2);
    if (desiredWidth < 3 || desiredHeight < 3) return;

    let x = Math.max(0, anchorX);
    let y = Math.max(0, anchorY);
    if (x + desiredWidth > inner.width) {
      x = Math.max(0, inner.width - desiredWidth);
    }
    if (y + desiredHeight > inner.height) {
      y = Math.max(0, inner.height - desiredHeight);
    }

    const innerBoxWidth = desiredWidth - 2;
    const visibleItems = Math.min(this.items.length, desiredHeight - 2);
    const horizontal = '─'.repeat(innerBoxWidth);
    const bgAttrs: CellAttributes = { background: 236, foreground: 7 };
    const selAttrs: CellAttributes = { background: 236, foreground: 7, inverse: true };

    target.writeText(
      [{ text: '┌' + horizontal + '┐', attrs: bgAttrs }],
      { x, y, style: 0 },
    );
    for (let i = 0; i < visibleItems; i++) {
      const item = this.items[i];
      const labelW = target.getTextWidth(item.label);
      const fill = Math.max(0, innerBoxWidth - labelW - 2);
      const padded = ' ' + item.label + ' '.repeat(fill) + ' ';
      const isSel = i === this.selectedIndex;
      target.writeText(
        [
          { text: '│', attrs: bgAttrs },
          { text: padded, attrs: isSel ? selAttrs : bgAttrs },
          { text: '│', attrs: bgAttrs },
        ],
        { x, y: y + 1 + i, style: 0 },
      );
    }
    target.writeText(
      [{ text: '└' + horizontal + '┘', attrs: bgAttrs }],
      { x, y: y + 1 + visibleItems, style: 0 },
    );
  }
}
