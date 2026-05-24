/**
 * DetailsPanel — szczegóły wybranego Item jako focusable Window.
 * Wspiera tryby view/edit; w view klawisz 'e' wchodzi w edycję, Escape wychodzi.
 */

import { Window } from 'take4-console';
import type {
  CellAttributes,
  Focusable,
  WindowProperties,
  WriteTextSegment,
} from 'take4-console';
import type { Item } from '../types.mjs';

/**
 * Tryb edycji panelu.
 */
type EditMode = 'view' | 'edit';

/**
 * Stan wewnętrzny panelu szczegółów.
 */
interface DetailsPanelState {
  currentItem: Item | null;
  editMode: EditMode;
  editingField: 'title' | 'notes' | null;
  editValue: string;
}

/**
 * DetailsPanel — Window z opcjonalną edycją tytułu.
 */
/**
 * Bundle akcji do ApplicationState (analogiczne do TreePanelActions).
 */
export interface DetailsPanelActions {
  onSaveTitle?: (item: Item, newTitle: string) => void;
  onSaveNotes?: (item: Item, newNotes: string) => void;
}

export default class DetailsPanel extends Window implements Focusable {
  private state: DetailsPanelState;
  private actions: DetailsPanelActions = {};

  /**
   * Tworzy DetailsPanel jako Window.
   *
   * @param wp - WindowProperties (pos, size, border)
   * @param actions - Bundle callbacków save (opcjonalny, można ustawić później)
   */
  public constructor(wp: WindowProperties, actions: DetailsPanelActions = {}) {
    super(wp);
    this.state = {
      currentItem: null,
      editMode: 'view',
      editingField: null,
      editValue: '',
    };
    this.actions = actions;
  }

  /**
   * Ustawia callbacki akcji po konstrukcji (gdy ApplicationState potrzebuje
   * referencji do panelu przed przekazaniem callbacków).
   *
   * @param actions - Nowy bundle callbacków
   */
  public setActions(actions: DetailsPanelActions): void {
    this.actions = actions;
  }

  /**
   * Override setFocused — wyjście z edycji przy utracie fokusa.
   *
   * @param focused - Nowy stan fokusa
   */
  public override setFocused(focused: boolean): void {
    super.setFocused(focused);
    if (!focused && this.state.editMode === 'edit') {
      this.exitEditMode();
    }
  }

  /**
   * Ustawia bieżący Item do wyświetlenia. Wyjście z edycji jeśli była aktywna.
   *
   * @param item - Item do wyświetlenia lub null
   */
  public setItem(item: Item | null): void {
    if (this.state.editMode === 'edit') {
      this.exitEditMode();
    }
    this.state.currentItem = item;
    this.invalidate();
  }

  /**
   * Zwraca aktualny Item.
   *
   * @returns Item lub null
   */
  public getItem(): Item | null {
    return this.state.currentItem;
  }

  /**
   * Focusable.handleKey — w trybie view: 'e' → edycja; w edycji: Esc/Enter/Backspace/znaki.
   *
   * @param key - Surowy klawisz
   */
  public handleKey(key: string): void {
    if (!this.focused) return;

    if (this.state.editMode === 'view') {
      if (key === 'e') { this.enterEditMode('title'); this.invalidate(); }
      else if (key === 'n') { this.enterEditMode('notes'); this.invalidate(); }
      return;
    }

    // edit mode
    if (key === '\x1b' || key === 'Escape') {
      this.exitEditMode();
      this.invalidate();
      return;
    }
    // Title: Enter = save. Notes: Enter = nowa linia, Ctrl+S = save.
    if (this.state.editingField === 'title' && (key === '\r' || key === '\n' || key === 'Enter')) {
      this.saveEditedValue();
      this.invalidate();
      return;
    }
    if (this.state.editingField === 'notes' && key === '\x13' /* Ctrl+S */) {
      this.saveEditedValue();
      this.invalidate();
      return;
    }
    if (this.state.editingField === 'notes' && (key === '\r' || key === '\n')) {
      this.state.editValue += '\n';
      this.invalidate();
      return;
    }
    if (key === '\x7f' || key === '\b' || key === 'Backspace') {
      this.state.editValue = this.state.editValue.slice(0, -1);
      this.invalidate();
      return;
    }
    if (key.length === 1 && key >= ' ') {
      this.state.editValue += key;
      this.invalidate();
    }
  }

  /**
   * Wchodzi w tryb edycji tytułu.
   */
  private enterEditMode(field: 'title' | 'notes'): void {
    if (!this.state.currentItem) return;
    this.state.editMode = 'edit';
    this.state.editingField = field;
    this.state.editValue = field === 'title' ? this.state.currentItem.getTitle() : this.state.currentItem.getNotes();
  }

  /**
   * Zewnętrzny trigger — pozwala ApplicationState (po add child) od razu
   * wejść w edycję tytułu świeżo utworzonego węzła.
   */
  public beginEditTitle(): void {
    this.enterEditMode('title');
    this.invalidate();
  }

  /**
   * Wychodzi z trybu edycji bez zapisu.
   */
  private exitEditMode(): void {
    this.state.editMode = 'view';
    this.state.editingField = null;
    this.state.editValue = '';
  }

  /**
   * Zapisuje wartość pola edycji (obecnie tylko exit; integracja z Item TODO).
   */
  private saveEditedValue(): void {
    if (!this.state.currentItem || !this.state.editingField) return;
    const value = this.state.editValue;
    if (this.state.editingField === 'title') {
      if (value.trim().length > 0 && this.actions.onSaveTitle) {
        this.actions.onSaveTitle(this.state.currentItem, value);
      }
    } else if (this.state.editingField === 'notes') {
      if (this.actions.onSaveNotes) {
        this.actions.onSaveNotes(this.state.currentItem, value);
      }
    }
    this.exitEditMode();
  }

  /**
   * Zwraca bieżący tryb edycji (do testów).
   *
   * @returns 'view' lub 'edit'
   */
  public getEditMode(): EditMode {
    return this.state.editMode;
  }

  /**
   * Zwraca pełny stan edycji (do testów).
   *
   * @returns Obiekt z editMode i editingField
   */
  public getEditState(): { editMode: EditMode; editingField: 'title' | 'notes' | null } {
    return { editMode: this.state.editMode, editingField: this.state.editingField };
  }

  /**
   * Łamie tekst na linie wizualne o maks. szerokości `width`.
   * Preferuje granicę słowa (spację); jeśli pojedyncze słowo jest dłuższe
   * niż width — łamie twardo. Puste linie ze źródła zachowuje.
   *
   * @param text - Tekst (może zawierać \n)
   * @param width - Maks. szerokość kolumny w znakach
   * @returns Tablica linii wizualnych
   */
  private static wrapText(text: string, width: number): string[] {
    if (width <= 0) return [];
    const out: string[] = [];
    for (const sourceLine of text.split('\n')) {
      if (sourceLine.length === 0) {
        out.push('');
        continue;
      }
      let remaining = sourceLine;
      while (remaining.length > width) {
        // Szukaj ostatniej spacji w polu [0..width]
        let breakAt = remaining.lastIndexOf(' ', width);
        if (breakAt <= 0) {
          breakAt = width; // hard break
          out.push(remaining.slice(0, breakAt));
          remaining = remaining.slice(breakAt);
        } else {
          out.push(remaining.slice(0, breakAt));
          remaining = remaining.slice(breakAt + 1); // pomiń złamaną spację
        }
      }
      out.push(remaining);
    }
    return out;
  }

  /**
   * Override Window.render — rysuje pola Item z zawijaniem do szerokości panelu.
   */
  public override render(): void {
    this.clear();
    const inner = this.getInnerSize();
    if (inner.width <= 0 || inner.height <= 0) {
      super.render();
      return;
    }

    const item = this.state.currentItem;
    let y = 0;

    if (!item) {
      this.writeText('(brak wybranego elementu)', { x: 0, y });
      super.render();
      return;
    }

    // Pomocnik: pisze etykietę + zawiniętą wartość. Pierwsza linia ma prefix
    // (np. "Title: "), kolejne są wcięte o jego długość, żeby kolumny się
    // wyrównywały. Zwraca nową wartość `y` po wypisaniu.
    const writeWrapped = (
      prefix: string,
      value: string,
      attrs?: CellAttributes,
    ): number => {
      if (y >= inner.height) return y;
      const indent = ' '.repeat(prefix.length);
      const wrapped = DetailsPanel.wrapText(value, Math.max(1, inner.width - prefix.length));
      for (let i = 0; i < wrapped.length; i++) {
        if (y >= inner.height) break;
        const linePrefix = i === 0 ? prefix : indent;
        const segments: WriteTextSegment[] = [
          { text: linePrefix },
          { text: wrapped[i], ...(attrs ? { attrs } : {}) },
        ];
        this.writeText(segments, { x: 0, y });
        y += 1;
      }
      return y;
    };

    // Tytuł
    const titleAttrs: CellAttributes | undefined =
      this.state.editMode === 'edit' && this.state.editingField === 'title'
        ? { inverse: true }
        : undefined;
    const titleText = this.state.editMode === 'edit' && this.state.editingField === 'title'
      ? this.state.editValue
      : item.getTitle();
    writeWrapped('Title: ', titleText, titleAttrs);
    y += 1;

    if (y >= inner.height) { super.render(); return; }
    writeWrapped('Status: ', item.getTodo());
    y += 1;

    const tags = item.getTags();
    if (tags.length > 0 && y < inner.height) {
      writeWrapped('Tags: ', tags.join(', '));
      y += 1;
    }

    const inEditNotes = this.state.editMode === 'edit' && this.state.editingField === 'notes';
    const notesText = inEditNotes ? this.state.editValue : item.getNotes();
    if ((notesText || inEditNotes) && y < inner.height) {
      this.writeText('Notes:', { x: 0, y });
      y += 1;
      const wrapped = DetailsPanel.wrapText(notesText, Math.max(1, inner.width - 2));
      for (const line of wrapped) {
        if (y >= inner.height) break;
        const attrs: CellAttributes | undefined = inEditNotes ? { inverse: true } : undefined;
        this.writeText([
          { text: '  ' },
          { text: line, ...(attrs ? { attrs } : {}) },
        ], { x: 0, y });
        y += 1;
      }
      y += 1;
    }

    const props = item.getProperties();
    if (props.size > 0 && y < inner.height) {
      this.writeText('Properties:', { x: 0, y });
      y += 1;
      for (const [key, value] of props.entries()) {
        if (y >= inner.height) break;
        const wrapped = DetailsPanel.wrapText(`${key}: ${value}`, Math.max(1, inner.width - 2));
        for (const line of wrapped) {
          if (y >= inner.height) break;
          this.writeText(`  ${line}`, { x: 0, y });
          y += 1;
        }
      }
      y += 1;
    }

    const children = item.getChildren();
    if (children.length > 0 && y < inner.height) {
      this.writeText(`Children: ${children.length}`, { x: 0, y });
      y += 1;
    }

    if (y < inner.height - 1) {
      y = inner.height - 1;
    }
    if (y < inner.height) {
      let hint: string;
      if (this.state.editMode === 'edit') {
        hint = this.state.editingField === 'notes'
          ? '[NOTES] Ctrl+S=save Enter=newline Esc=cancel'
          : '[TITLE] Enter=save Esc=cancel';
      } else {
        hint = 'e=edit title  n=edit notes';
      }
      const hintAttrs: CellAttributes | undefined =
        this.state.editMode === 'edit' ? { inverse: true } : undefined;
      this.writeText(
        [{ text: hint, ...(hintAttrs ? { attrs: hintAttrs } : {}) }],
        { x: 0, y },
      );
    }

    super.render();
  }
}
