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
 * Znane properties renderowane nad notatkami jako kolorowa ikona NerdFonts
 * + krótki label. Klucze to nazwy property z drawer org-mode. Ikony to glify
 * z zakresu NerdFonts (terminal ma zainstalowane NF). `fg` to ANSI 0–255.
 */
const KNOWN_PROPS: Record<string, { icon: string; label: string; fg: number }> = {
  FROZEN:        { icon: '\u{f2dc}', label: 'frozen',      fg: 6 },  // snowflake, cyan
  'ROCK-SOLID':  { icon: '\u{f132}', label: 'rock-solid',  fg: 4 },  // shield, blue
  ANCHOR:        { icon: '\u{f13d}', label: 'anchor',      fg: 3 },  // anchor, yellow
  'AGENT-INBOX': { icon: '\u{f01c}', label: 'agent-inbox', fg: 5 },  // inbox, magenta
};

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
  onEditModeChange?: (mode: EditMode) => void;
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
    // Title: Enter lub Ctrl+S = save. Notes: Enter = nowa linia, Ctrl+S = save.
    if (key === '\x13' /* Ctrl+S */) {
      this.saveEditedValue();
      this.invalidate();
      return;
    }
    if (this.state.editingField === 'title' && (key === '\r' || key === '\n' || key === 'Enter')) {
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
    this.actions.onEditModeChange?.('edit');
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
    const wasEditing = this.state.editMode === 'edit';
    this.state.editMode = 'view';
    this.state.editingField = null;
    this.state.editValue = '';
    if (wasEditing) this.actions.onEditModeChange?.('view');
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

    // ── Nagłówek: ID (szary) + tytuł (bold, akcent) z hanging indent ──
    // Zastępuje etykietę "Title:" oraz "Properties: ID:" — numer zadania
    // siedzi obok tytułu, więc obie etykiety są zbędne.
    const editingTitle = this.state.editMode === 'edit' && this.state.editingField === 'title';
    const titleText = editingTitle ? this.state.editValue : item.getTitle();
    const idPrefix = item.getId() + '  ';
    const titleWidth = Math.max(1, inner.width - idPrefix.length);
    const titleLines = DetailsPanel.wrapText(titleText, titleWidth);
    const titleAttrs: CellAttributes = editingTitle ? { inverse: true } : { bold: true };
    for (let i = 0; i < titleLines.length; i++) {
      if (y >= inner.height) break;
      const lead = i === 0
        ? ({ text: idPrefix, attrs: { foreground: 8 } } as WriteTextSegment)
        : ({ text: ' '.repeat(idPrefix.length) } as WriteTextSegment);
      this.writeText([lead, { text: titleLines[i], attrs: titleAttrs }], { x: 0, y });
      y += 1;
    }

    // Separator graficzny pod nagłówkiem.
    if (y < inner.height) {
      this.writeText([{ text: '─'.repeat(inner.width), attrs: { dim: true } }], { x: 0, y });
      y += 1;
    }

    // ── Status + tagi w jednej zwartej linii ──
    if (y < inner.height) {
      const tags = item.getTags();
      const segments: WriteTextSegment[] = [{ text: item.getTodo(), attrs: { bold: true } }];
      if (tags.length > 0) {
        segments.push({ text: '   ' + tags.map((t) => '#' + t).join(' '), attrs: { dim: true } });
      }
      this.writeText(segments, { x: 0, y });
      y += 1;
    }

    // ── Properties ──
    // Znane → kolorowa ikona NerdFonts + label w jednej linii. ID pomijane
    // (jest w nagłówku). Nieznane → kompaktowo "key: value".
    const props = item.getProperties();
    const knownSegments: WriteTextSegment[] = [];
    const unknown: Array<[string, string]> = [];
    for (const [key, value] of props.entries()) {
      if (key === 'ID') continue;
      const known = KNOWN_PROPS[key];
      if (known) {
        if (knownSegments.length > 0) knownSegments.push({ text: '   ' });
        knownSegments.push({ text: known.icon + ' ' + known.label, attrs: { foreground: known.fg } });
      } else {
        unknown.push([key, value]);
      }
    }
    if (knownSegments.length > 0 && y < inner.height) {
      this.writeText(knownSegments, { x: 0, y });
      y += 1;
    }
    for (const [key, value] of unknown) {
      if (y >= inner.height) break;
      const wrapped = DetailsPanel.wrapText(`${key}: ${value}`, Math.max(1, inner.width));
      for (const line of wrapped) {
        if (y >= inner.height) break;
        this.writeText([{ text: line, attrs: { dim: true } }], { x: 0, y });
        y += 1;
      }
    }

    // ── Notatki ──
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
