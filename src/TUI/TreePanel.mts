/**
 * TreePanel — hierarchiczne drzewo Items jako focusable Window.
 * Obsługuje j/k (góra/dół), h/l (fold/unfold) i strzałki jako aliasy.
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
 * Spłaszczony węzeł drzewa dla renderowania (z głębokością i stanem expanded).
 */
interface TreeNodeUI {
  item: Item;
  isExpanded: boolean;
  depth: number;
}

/**
 * Mapowanie tagów na atrybuty komórek (kolory ANSI 0–255).
 */
const tagAttrMap: Record<string, CellAttributes> = {
  invariant: { foreground: 6 },  // cyan
  proposal:  { foreground: 3 },  // yellow
  question:  { foreground: 5 },  // magenta
  decision:  { foreground: 2 },  // green
  risk:      { foreground: 1 },  // red
};

/**
 * Opcje specyficzne dla TreePanel.
 */
/**
 * High-level akcje emitowane przez TreePanel do ApplicationState.
 * ApplicationState tłumaczy je na konkretne TreeOperations + autosave.
 */
export interface TreePanelActions {
  onCycleTodo?: (item: Item) => void;
  onDelete?: (item: Item) => void;
  onAddChild?: (parent: Item) => void;
  onAddSiblingAfter?: (sibling: Item) => void;
  onMoveUp?: (item: Item) => void;
  onMoveDown?: (item: Item) => void;
  onIndent?: (item: Item) => void;
  onOutdent?: (item: Item) => void;
  onSetPriority?: (item: Item, p: 'A' | 'B' | 'C' | null) => void;
}

export interface TreePanelOptions {
  rootItem: Item;
  /** Wywoływane gdy zmienia się selekcja (po j/k). */
  onSelectionChanged?: (item: Item | undefined) => void;
  actions?: TreePanelActions;
}

/**
 * TreePanel — Window z drzewem; implementuje Focusable.
 */
export default class TreePanel extends Window implements Focusable {
  private rootItem: Item;
  private flattenedNodes: TreeNodeUI[] = [];
  private selectedIndex: number = 0;
  private scrollOffset: number = 0;
  private onSelectionChanged?: (item: Item | undefined) => void;
  /** Stan rozwinięcia per item-id; przeżywa rebuild drzewa. */
  private expansionState: Map<string, boolean> = new Map();
  /** Filtry widoczności — TUI-only, nie wpływają na plik ani MCP. */
  private hideDone = true;
  private hideFrozen = true;
  /** Bundle callbacków do ApplicationState (mutacje przez TreeOperations). */
  private actions: TreePanelActions = {};
  /** Bufor potwierdzenia delete: pierwszy 'd' arms, drugi 'd' wykonuje. */
  private deleteArmed = false;

  /**
   * Tworzy TreePanel jako Window z rootItem i opcjonalnym callbackiem selekcji.
   *
   * @param wp - WindowProperties (pos, size, border)
   * @param opts - TreePanelOptions (rootItem, onSelectionChanged)
   */
  public constructor(wp: WindowProperties, opts: TreePanelOptions) {
    super(wp);
    this.rootItem = opts.rootItem;
    this.onSelectionChanged = opts.onSelectionChanged;
    this.actions = opts.actions ?? {};
    this.rebuildFlattenedNodes();
  }

  /**
   * Po raz drugi ustawia callbacki akcji (np. gdy ApplicationState
   * rejestruje je już po utworzeniu panelu).
   *
   * @param actions - Nowy bundle callbacków
   */
  public setActions(actions: TreePanelActions): void {
    this.actions = actions;
  }

  /**
   * Toggle filtra widoczności węzłów DONE. Domyślnie ukryte.
   */
  public toggleHideDone(): void {
    this.hideDone = !this.hideDone;
    this.rebuildFlattenedNodes();
    this.invalidate();
  }

  /**
   * Toggle filtra widoczności węzłów FROZEN (:FROZEN: t). Domyślnie ukryte.
   */
  public toggleHideFrozen(): void {
    this.hideFrozen = !this.hideFrozen;
    this.rebuildFlattenedNodes();
    this.invalidate();
  }

  /**
   * Zwraca true gdy DONE są aktualnie ukrywane (do statusbara).
   */
  public isHidingDone(): boolean {
    return this.hideDone;
  }

  /**
   * Zwraca true gdy FROZEN są aktualnie ukrywane (do statusbara).
   */
  public isHidingFrozen(): boolean {
    return this.hideFrozen;
  }

  /**
   * Podmienia root item (np. po zmianie z MCP) i przebudowuje listę.
   *
   * @param item - Nowy korzeń drzewa
   */
  public setRootItem(item: Item): void {
    this.rootItem = item;
    this.rebuildFlattenedNodes();
    this.invalidate();
  }

  /**
   * Przebudowuje spłaszczoną listę widocznych węzłów według expansionState.
   */
  private rebuildFlattenedNodes(): void {
    const flattened: TreeNodeUI[] = [];

    const isFrozen = (item: Item): boolean => item.getProperties().get('FROZEN') === 't';
    const hasNonHiddenDescendant = (item: Item): boolean => {
      // Pokaż rodzica DONE jeśli ma dzieci nie-DONE (decyzja z planu n14).
      for (const child of item.getChildren()) {
        const childHidden = (this.hideDone && child.getTodo() === 'DONE') || (this.hideFrozen && isFrozen(child));
        if (!childHidden) return true;
        if (hasNonHiddenDescendant(child)) return true;
      }
      return false;
    };

    const traverse = (item: Item, depth: number): void => {
      const id = item.getId();
      const isExpanded = this.expansionState.get(id) ?? true;

      // Root zawsze widoczny.
      const isDone = item.getTodo() === 'DONE';
      const frozen = isFrozen(item);
      const hideByDone = this.hideDone && isDone;
      const hideByFrozen = this.hideFrozen && frozen;
      const filterHides = (hideByDone || hideByFrozen) && depth > 0;
      const keepForChildren = filterHides && hasNonHiddenDescendant(item);

      if (!filterHides || keepForChildren) {
        flattened.push({ item, isExpanded, depth });
      }
      if (isExpanded) {
        for (const child of item.getChildren()) {
          traverse(child, depth + 1);
        }
      }
    };

    traverse(this.rootItem, 0);
    this.flattenedNodes = flattened;

    if (this.selectedIndex >= flattened.length) {
      this.selectedIndex = Math.max(0, flattened.length - 1);
    }
  }

  /**
   * Focusable.handleKey — j/k/strzałki nawigują, h/l zwijа/rozwija.
   *
   * @param key - Surowy klawisz od WindowManager
   */
  public handleKey(key: string): void {
    if (!this.focused) return;
    const current = this.flattenedNodes[this.selectedIndex]?.item;

    // 'd' wymaga drugiego naciśnięcia (potwierdzenie delete). Każdy inny
    // klawisz resetuje arm.
    if (this.deleteArmed && key !== 'd') {
      this.deleteArmed = false;
    }

    switch (key) {
      case 'j': case '\x1b[B': this.moveDown(); break;
      case 'k': case '\x1b[A': this.moveUp(); break;
      case 'h': case '\x1b[D': this.foldCurrent(); break;
      case 'l': case '\x1b[C': this.unfoldCurrent(); break;
      case 'H': this.toggleHideDone(); break;
      case 'F': this.toggleHideFrozen(); break;
      case 't':
        if (current && this.actions.onCycleTodo) this.actions.onCycleTodo(current);
        break;
      case 'a':
        if (current && this.actions.onAddChild) this.actions.onAddChild(current);
        break;
      case 'o':
        if (current && this.actions.onAddSiblingAfter) this.actions.onAddSiblingAfter(current);
        break;
      case 'd':
        if (!current) break;
        if (this.deleteArmed) {
          this.deleteArmed = false;
          if (this.actions.onDelete) this.actions.onDelete(current);
        } else {
          this.deleteArmed = true;
          this.invalidate();
        }
        break;
      case 'J': case '\x1b[1;3B':
        if (current && this.actions.onMoveDown) this.actions.onMoveDown(current);
        break;
      case 'K': case '\x1b[1;3A':
        if (current && this.actions.onMoveUp) this.actions.onMoveUp(current);
        break;
      case '\t':
        if (current && this.actions.onIndent) this.actions.onIndent(current);
        break;
      case '\x1b[Z': // Shift+Tab
        if (current && this.actions.onOutdent) this.actions.onOutdent(current);
        break;
      case 'p':
        // Cykl priorytetu: none → A → B → C → none
        if (current && this.actions.onSetPriority) {
          const cur = current.getPriority();
          const next = cur === null ? 'A' : cur === 'A' ? 'B' : cur === 'B' ? 'C' : null;
          this.actions.onSetPriority(current, next);
        }
        break;
    }
  }

  /**
   * Zwraca true jeśli ostatnie 'd' uzbroiło delete-confirm (StatusBar może to pokazać).
   */
  public isDeleteArmed(): boolean {
    return this.deleteArmed;
  }

  /**
   * Pozwala ApplicationState ustawić selekcję bezpośrednio (np. po add child
   * — focus na nowo utworzonym węźle).
   *
   * @param itemId - ID elementu który ma być zaznaczony; brak — no-op
   */
  public selectById(itemId: string): void {
    const idx = this.flattenedNodes.findIndex((n) => n.item.getId() === itemId);
    if (idx >= 0) {
      this.selectedIndex = idx;
      this.ensureSelectionVisible();
      this.invalidate();
      this.emitSelectionChanged();
    }
  }

  /**
   * Przesuwa selekcję w dół i wywołuje callback.
   */
  private moveDown(): void {
    if (this.selectedIndex >= this.flattenedNodes.length - 1) return;
    this.selectedIndex++;
    this.ensureSelectionVisible();
    this.invalidate();
    this.emitSelectionChanged();
  }

  /**
   * Przesuwa selekcję w górę i wywołuje callback.
   */
  private moveUp(): void {
    if (this.selectedIndex <= 0) return;
    this.selectedIndex--;
    this.ensureSelectionVisible();
    this.invalidate();
    this.emitSelectionChanged();
  }

  /**
   * Zwija bieżący węzeł, jeśli ma dzieci.
   */
  private foldCurrent(): void {
    const node = this.flattenedNodes[this.selectedIndex];
    if (!node || node.item.getChildren().length === 0) return;
    this.expansionState.set(node.item.getId(), false);
    this.rebuildFlattenedNodes();
    this.invalidate();
  }

  /**
   * Rozwija bieżący węzeł, jeśli ma dzieci.
   */
  private unfoldCurrent(): void {
    const node = this.flattenedNodes[this.selectedIndex];
    if (!node || node.item.getChildren().length === 0) return;
    this.expansionState.set(node.item.getId(), true);
    this.rebuildFlattenedNodes();
    this.invalidate();
  }

  /**
   * Wymusza scroll tak, aby zaznaczony wiersz mieścił się w viewportcie.
   */
  private ensureSelectionVisible(): void {
    const innerHeight = Math.max(1, this.getInnerSize().height);
    if (this.selectedIndex < this.scrollOffset) {
      this.scrollOffset = this.selectedIndex;
    } else if (this.selectedIndex >= this.scrollOffset + innerHeight) {
      this.scrollOffset = this.selectedIndex - innerHeight + 1;
    }
  }

  /**
   * Powiadamia opcjonalny callback o nowej selekcji.
   */
  private emitSelectionChanged(): void {
    if (this.onSelectionChanged) {
      this.onSelectionChanged(this.getSelectedItem());
    }
  }

  /**
   * Zwraca aktualnie zaznaczony Item.
   *
   * @returns Wybrany Item lub undefined
   */
  public getSelectedItem(): Item | undefined {
    return this.flattenedNodes[this.selectedIndex]?.item;
  }

  /**
   * Zwraca indeks zaznaczonego elementu w spłaszczonej liście.
   *
   * @returns Indeks lub 0 gdy pusto
   */
  public getSelectedIndex(): number {
    return this.selectedIndex;
  }

  /**
   * Zwraca spłaszczoną listę węzłów (do testów i diagnostyki).
   *
   * @returns Tablica TreeNodeUI w aktualnym porządku
   */
  public getFlattenedNodes(): readonly TreeNodeUI[] {
    return this.flattenedNodes;
  }

  /**
   * Override Window.render — rysuje widoczne wiersze drzewa.
   */
  public override render(): void {
    this.clear();
    const inner = this.getInnerSize();
    const innerWidth = inner.width;
    const innerHeight = inner.height;
    if (innerWidth <= 0 || innerHeight <= 0) {
      super.render();
      return;
    }

    this.ensureSelectionVisible();
    const visibleEnd = Math.min(this.scrollOffset + innerHeight, this.flattenedNodes.length);

    for (let i = this.scrollOffset; i < visibleEnd; i++) {
      const node = this.flattenedNodes[i];
      const isSelected = i === this.selectedIndex;
      const segments = this.buildRowSegments(node, innerWidth, isSelected);
      this.writeText(segments, { x: 0, y: i - this.scrollOffset, style: 0 });
    }

    super.render();
  }

  /**
   * Buduje segmenty stylowanego tekstu dla jednego wiersza drzewa.
   *
   * @param node - Węzeł do narysowania
   * @param innerWidth - Szerokość obszaru wewnętrznego (po wcięciu border+padding)
   * @param isSelected - Czy ten wiersz jest aktualnie wybrany
   * @returns Lista segmentów do przekazania do writeText
   */
  private buildRowSegments(
    node: TreeNodeUI,
    innerWidth: number,
    isSelected: boolean,
  ): WriteTextSegment[] {
    const indent = '  '.repeat(node.depth);
    const expandIcon = node.item.getChildren().length > 0
      ? (node.isExpanded ? '▼ ' : '▶ ')
      : '  ';
    const todoChar = this.getTodoChar(node.item.getTodo());
    // Priority cookie wizualnie (zamiast ★★★ w tytule): akcent + neutral
    const priority = node.item.getPriority();
    const priorityMark = priority === 'A' ? '! ' : priority === 'B' ? '· ' : '  ';
    const frozen = node.item.getProperties().get('FROZEN') === 't';
    const frozenMark = frozen ? '❄ ' : '';
    const prefix = `${indent}${expandIcon}${todoChar} ${priorityMark}${frozenMark}`;

    const tags = node.item.getTags();
    const tagsText = tags.length > 0
      ? ' ' + tags.join(' ')
      : '';
    const tagsWidth = this.getTextWidth(tagsText);

    const prefixWidth = this.getTextWidth(prefix);
    const availableForTitle = Math.max(0, innerWidth - prefixWidth - tagsWidth);
    const title = node.item.getTitle();
    const titleWidth = this.getTextWidth(title);
    const truncatedTitle = titleWidth > availableForTitle
      ? this.truncateToWidth(title, Math.max(0, availableForTitle - 1)) + '…'
      : title;

    const usedWidth = prefixWidth + this.getTextWidth(truncatedTitle) + tagsWidth;
    const padWidth = Math.max(0, innerWidth - usedWidth);

    // Kolory tytułu wg: priorytetu (A=czerwony, B=pomarańczowy), QUESTION (cyjan),
    // DONE (dim), FROZEN (dim). Selekcja zawsze przez inverse.
    let titleAttrs: CellAttributes = {};
    if (node.item.getTodo() === 'QUESTION') titleAttrs.foreground = 6; // cyan
    if (priority === 'A') titleAttrs.foreground = 9;   // bright red
    else if (priority === 'B') titleAttrs.foreground = 11; // bright yellow / amber
    if (node.item.getTodo() === 'DONE' || frozen) titleAttrs.dim = true;
    if (isSelected) titleAttrs.inverse = true;
    const baseAttrs: CellAttributes | undefined = isSelected ? { inverse: true } : undefined;
    const segments: WriteTextSegment[] = [];

    segments.push({ text: prefix, ...(baseAttrs ? { attrs: baseAttrs } : {}) });
    segments.push({ text: truncatedTitle, attrs: titleAttrs });

    if (tags.length > 0) {
      segments.push({ text: ' ', ...(baseAttrs ? { attrs: baseAttrs } : {}) });
      for (let i = 0; i < tags.length; i++) {
        const tag = tags[i];
        const tagAttrs: CellAttributes = {
          ...(tagAttrMap[tag] ?? {}),
          ...(isSelected ? { inverse: true } : {}),
        };
        segments.push({ text: tag, attrs: tagAttrs });
        if (i < tags.length - 1) {
          segments.push({ text: ' ', ...(baseAttrs ? { attrs: baseAttrs } : {}) });
        }
      }
    }

    if (padWidth > 0) {
      segments.push({ text: ' '.repeat(padWidth), ...(baseAttrs ? { attrs: baseAttrs } : {}) });
    }

    return segments;
  }

  /**
   * Obcina string do podanej szerokości terminalowej (z uwzględnieniem szerokich znaków).
   *
   * @param text - Wejście
   * @param maxWidth - Maksymalna szerokość komórek
   * @returns Obcięty string
   */
  private truncateToWidth(text: string, maxWidth: number): string {
    if (maxWidth <= 0) return '';
    let acc = '';
    let width = 0;
    for (const ch of text) {
      const w = this.getTextWidth(ch);
      if (width + w > maxWidth) break;
      acc += ch;
      width += w;
    }
    return acc;
  }

  /**
   * Zwraca symbol dla stanu TODO.
   *
   * @param todo - Stan TODO
   * @returns Pojedynczy znak
   */
  private getTodoChar(todo: string): string {
    switch (todo) {
      case 'TODO': return '☐';
      case 'PROPOSAL': return '◇';
      case 'QUESTION': return '?';
      case 'WORK-UNIT': return '○';
      case 'DONE': return '✓';
      case 'DROPPED': return '✗';
      default: return '•';
    }
  }
}
