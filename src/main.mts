/**
 * Main entry point — montuje Screen + WindowManager z take4-console
 * i uruchamia TUI razem z serwerem MCP po Streamable HTTP (localhost:3000/mcp).
 */

import { existsSync } from 'node:fs';
import { stderr } from 'node:process';
import {
  Screen,
  Window,
  WindowManager,
  Pos,
  Size,
  flex,
} from 'take4-console';
import OrgReader from './OrgReader.mjs';
import OrgWriter from './OrgWriter.mjs';
import MCPServer from './MCPServer.mjs';
import TreeOperations from './TreeOperations.mjs';
import Logger from './Logger.mjs';
import TreePanel from './TUI/TreePanel.mjs';
import DetailsPanel from './TUI/DetailsPanel.mjs';
import StatusBar from './TUI/StatusBar.mjs';
import DebugPanel from './TUI/DebugPanel.mjs';
import type { Tree, Item, TodoState } from './types.mjs';

/**
 * FileManager — obsługa wczytywania i zapisywania drzewa do pliku .org.
 */
class FileManager {
  /**
   * Wczytuje Tree z pliku .org.
   *
   * @param filePath - Ścieżka do pliku .org
   * @returns Tree
   */
  public static loadTree(filePath: string): Tree {
    if (!existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }
    const reader = new OrgReader();
    return reader.read(filePath);
  }

  /**
   * Zapisuje Tree do pliku .org.
   *
   * @param tree - Drzewo
   * @param filePath - Ścieżka docelowa
   */
  public static saveTree(tree: Tree, filePath: string): void {
    const writer = new OrgWriter();
    writer.write(tree, filePath);
  }
}

/**
 * ApplicationState — montuje UI (Screen+WindowManager) i spina je z MCP.
 */
class ApplicationState {
  private tree: Tree;
  private readonly filePath: string;
  private readonly screen: Screen;
  private readonly windowManager: WindowManager;
  private readonly rootColumn: Window;
  private readonly splitRow: Window;
  private readonly treeSize: Size;
  private readonly detailsSize: Size;
  private readonly treePanel: TreePanel;
  private readonly detailsPanel: DetailsPanel;
  private readonly statusBar: StatusBar;
  private readonly debugPanel: DebugPanel;
  private readonly mcpServer: MCPServer;
  // Strażnik re-entry: WindowManager.stop() wywołuje swój onExit callback,
  // który u nas wraca do handleExit() — bez tej flagi mamy nieskończoną
  // rekurencję handleExit → stop → onExit → handleExit → ... → stack overflow.
  private exiting = false;
  // Stos historii dla undo. Każda mutacja drzewa (z TUI lub MCP) push'uje
  // poprzedni snapshot przed zastosowaniem. Limit 100 stanów.
  private undoStack: Tree[] = [];
  private static readonly UNDO_LIMIT = 100;
  // Tryb follow: gdy ON, mutacje MCP przenoszą selekcję na dotknięty węzeł
  // (agent prowadzi wzrok usera). Gdy OFF (domyślnie), dotknięte węzły tylko
  // migoczą — user steruje selekcją sam, MCP jej nie kradnie.
  private followMode = false;

  /**
   * Konstruktor — buduje layout, rejestruje fokusowalne kontrolki, podpina MCP.
   *
   * @param tree - Wczytane drzewo
   * @param filePath - Ścieżka do pliku .org
   */
  public constructor(tree: Tree, filePath: string) {
    this.tree = tree;
    this.filePath = filePath;

    this.screen = new Screen({ altScreen: true, hideCursor: true });
    this.screen.fill(' ', this.screen.registerStyle({ background: 234 }));

    // Layout: Screen → rootColumn (column) → [splitRow (row), debugPanel?, statusBar].
    this.rootColumn = new Window({
      pos: Pos.topLeft(),
      size: Size.fill(),
      layout: 'column',
    });
    this.screen.addChild(this.rootColumn);
    const rootColumn = this.rootColumn;

    this.splitRow = new Window({
      pos: Pos.flex(0),
      size: new Size(flex(1, 1), flex(1, 1)),
      layout: 'row',
    });
    rootColumn.addChild(this.splitRow);

    // Trzymamy Size obiekty osobno, żeby móc mutować ich `grow` w spec
    // i dynamicznie przesuwać podział (klawisze `<` / `>`).
    this.treeSize = new Size(flex(50, 1), flex(1, 1));
    this.detailsSize = new Size(flex(50, 1), flex(1, 1));

    // StatusBar musi powstać PRZED TreePanel — konstruktor TreePanel woła
    // rebuildFlattenedNodes() które fire'uje onVisibilityChanged →
    // setFrozenHidden na statusBar. addChild dla statusBar jest niżej w
    // kolejności layoutu (pozycja na dole ekranu).
    this.statusBar = new StatusBar({
      pos: Pos.flex(1),
      size: new Size(flex(1, 1), 1),
    });

    this.treePanel = new TreePanel(
      {
        pos: Pos.flex(0),
        size: this.treeSize,
        border: false,
        padding: [0, 1],
      },
      {
        rootItem: tree.root as Item,
        hideRoot: true,
        onSelectionChanged: (item) => this.handleSelectionChanged(item),
        onVisibilityChanged: ({ frozenHidden }) => {
          this.statusBar.setFrozenHidden(frozenHidden);
          this.screen.render();
        },
        actions: {
          onCycleTodo: (item) => this.cycleTodo(item),
          onDelete: (item) => this.deleteItem(item),
          onAddChild: (parent) => this.addChildAndEdit(parent),
          onAddSiblingAfter: (sibling) => this.addSiblingAndEdit(sibling, 'after'),
          onAddSiblingBefore: (sibling) => this.addSiblingAndEdit(sibling, 'before'),
          onMoveUp: (item) => this.moveSibling(item, 'up'),
          onMoveDown: (item) => this.moveSibling(item, 'down'),
          onIndent: (item) => this.indentItem(item),
          onOutdent: (item) => this.outdentItem(item),
          onSetPriority: (item, p) => this.applyMutation(TreeOperations.setPriority(this.tree, item.getId(), p ?? '')),
          onToggleFreeze: (item) => {
            const isFrozen = item.getProperties().get('FROZEN') === 't';
            this.applyMutation(
              isFrozen
                ? TreeOperations.removeProperty(this.tree, item.getId(), 'FROZEN')
                : TreeOperations.setProperty(this.tree, item.getId(), 'FROZEN', 't'),
            );
          },
          onToggleAnchor: (item) => {
            const isAnchored = item.getProperties().get('ANCHOR') === 't';
            this.applyMutation(
              isAnchored
                ? TreeOperations.unanchor(this.tree, item.getId())
                : TreeOperations.anchor(this.tree, item.getId()),
            );
            this.statusBar.showMessage(
              isAnchored ? `Unanchored ${item.getId()}` : `Anchored ${item.getId()}`,
              1200,
            );
          },
        },
      },
    );
    this.splitRow.addChild(this.treePanel);

    // Brak ramek (kompaktowy layout) — separacja TreePanel/DetailsPanel przez
    // lekko jaśniejsze tło panelu szczegółów (236) względem tła ekranu (234).
    const detailsBackground = this.screen.registerStyle({ background: 236 });
    this.detailsPanel = new DetailsPanel(
      {
        pos: Pos.flex(1),
        size: this.detailsSize,
        border: false,
        background: detailsBackground,
        padding: [0, 1],
      },
      {
        onSaveTitle: (item, title) => this.applyMutation(TreeOperations.rename(this.tree, item.getId(), title)),
        onSaveNotes: (item, notes) => this.applyMutation(TreeOperations.setNotes(this.tree, item.getId(), notes)),
        onEditModeChange: (mode) => {
          this.statusBar.setMode(mode === 'edit' ? 'edit' : 'normal');
          this.screen.render();
        },
      },
    );
    this.splitRow.addChild(this.detailsPanel);

    // Debug panel — ukryty domyślnie, toggleable klawiszem `. Pokazuje
    // zawartość Logger ring-bufora (MCP eventy, błędy autosave itp.).
    // Wysokość 10 wierszy gdy widoczny; invisible window jest pomijany
    // przez layout, więc nie zabiera miejsca gdy ukryty.
    this.debugPanel = new DebugPanel({
      pos: Pos.flex(0.5),
      size: new Size(flex(1, 1), 10),
      border: { top: true, right: true, bottom: true, left: true, style: 'single' },
      label: 'Debug log',
    });
    this.debugPanel.setVisible(false);
    rootColumn.addChild(this.debugPanel);

    rootColumn.addChild(this.statusBar);

    this.windowManager = new WindowManager(this.screen, {
      exitKeys: ['\x03'],
      onExit: () => this.handleExit(),
    });
    this.windowManager.register(this.treePanel);
    this.windowManager.register(this.detailsPanel);

    // Globalne skróty: 1/2 przełączanie fokusa, q wyjście (poza trybem edycji),
    // Ctrl+S — zapis. Skróty fire'ują przed handleKey kontrolki.
    this.windowManager.bindKey('1', () => {
      this.windowManager.setFocus(this.treePanel);
      this.screen.render();
      return true;
    });
    this.windowManager.bindKey('2', () => {
      this.windowManager.setFocus(this.detailsPanel);
      this.screen.render();
      return true;
    });
    this.windowManager.bindKey('q', (ctx) => {
      // W trybie edycji literę 'q' powinien obsłużyć DetailsPanel.
      if (ctx.focusedControl === this.detailsPanel && this.detailsPanel.getEditMode() === 'edit') {
        return false;
      }
      this.handleExit();
      return true;
    });
    this.windowManager.bindKey('\x13', (ctx) => {
      // W trybie edycji w DetailsPanel Ctrl+S zapisuje edytowane pole (title/notes),
      // nie wykonuje globalnego zapisu drzewa do pliku.
      if (ctx.focusedControl === this.detailsPanel && this.detailsPanel.getEditMode() === 'edit') {
        return false;
      }
      this.handleSave();
      return true;
    });
    // Ctrl+Z = undo
    this.windowManager.bindKey('\x1a', () => {
      this.undo();
      return true;
    });
    // 'f' — toggle trybu follow (MCP przenosi selekcję vs tylko miga).
    // W trybie edycji w DetailsPanel literę 'f' obsługuje panel.
    this.windowManager.bindKey('f', (ctx) => {
      if (ctx.focusedControl === this.detailsPanel && this.detailsPanel.getEditMode() === 'edit') {
        return false;
      }
      this.followMode = !this.followMode;
      this.statusBar.setFollowMode(this.followMode);
      this.statusBar.showMessage(`Follow mode: ${this.followMode ? 'ON' : 'OFF'}`, 1200);
      this.screen.render();
      return true;
    });
    // Toggle debug panel. Backtick może być dead-keyem w niektórych
    // układach klawiatury (PL, DE) — dodatkowo `~` i `?` jako fallback.
    const toggleDebug = (): boolean => {
      this.debugPanel.setVisible(!this.debugPanel.isVisible());
      // setVisible nie triggeruje reflow rodzica — wymuszamy ręcznie,
      // żeby splitRow zwęził się o 10 wierszy gdy DebugPanel staje się
      // widoczny (i z powrotem urósł gdy znika).
      const sz = this.rootColumn.getSize();
      this.rootColumn.setSize(sz.width, sz.height);
      this.screen.render();
      return true;
    };
    this.windowManager.bindKey('`', toggleDebug);
    this.windowManager.bindKey('~', toggleDebug);
    this.windowManager.bindKey('?', toggleDebug);
    // < / > — zmiana podziału TreePanel / DetailsPanel o 5 punktów flex-grow.
    // Granice 20/80–80/20: żaden panel poniżej 20%.
    this.windowManager.bindKey('<', () => { this.adjustSplit(-5); return true; });
    this.windowManager.bindKey(',', () => { this.adjustSplit(-5); return true; });
    this.windowManager.bindKey('>', () => { this.adjustSplit(+5); return true; });
    this.windowManager.bindKey('.', () => { this.adjustSplit(+5); return true; });

    this.mcpServer = new MCPServer(
      tree,
      (newTree: Tree, affectedId: string | null) => this.handleTreeChangedFromMCP(newTree, affectedId),
      () => (this.treePanel.getSelectedItem() ?? null) as Item | null,
      3000,
    );
    this.mcpServer.setOnLastCallChanged((ts: Date, tool: string) => {
      this.statusBar.setMcpLastCall(ts, tool);
      this.screen.render();
    });
    // Odczyty MCP (find, tree://item/<id>) — flash bez ruszania selekcji,
    // niezależnie od trybu follow.
    this.mcpServer.setOnItemsTouched((ids: string[]) => {
      this.treePanel.flashItems(ids);
      this.screen.render();
    });
  }

  /**
   * Zmienia proporcję podziału TreePanel:DetailsPanel o `delta` punktów
   * flex-grow (TreePanel rośnie, DetailsPanel maleje przy delta>0).
   * Mutuje grow w spec'ach Size przy zachowaniu sumy = 100; clampuje do
   * [20, 80]. Trigger reflow przez setSize na splitRow (te same wymiary).
   *
   * @param delta - Ile punktów dodać do TreePanel (ujemne = zabrać)
   */
  private adjustSplit(delta: number): void {
    const treeSpec = this.treeSize.getWidthSpec();
    const detailsSpec = this.detailsSize.getWidthSpec();
    if (treeSpec.mode !== 'flex' || detailsSpec.mode !== 'flex') return;
    const newTree = Math.max(20, Math.min(80, treeSpec.grow + delta));
    const newDetails = 100 - newTree;
    if (newTree === treeSpec.grow) return;
    treeSpec.grow = newTree;
    detailsSpec.grow = newDetails;
    const sz = this.splitRow.getSize();
    this.splitRow.setSize(sz.width, sz.height);
    this.screen.render();
  }

  /**
   * Reakcja na zmianę selekcji w TreePanel — aktualizacja DetailsPanel + status.
   *
   * @param item - Wybrany Item
   */
  private handleSelectionChanged(item: Item | undefined): void {
    this.detailsPanel.setItem(item ?? null);
    this.screen.render();
  }

  /**
   * Reakcja na zmianę drzewa z MCP — odświeżenie root, render, autosave.
   * Po zastosowaniu przesuwa selekcję na `affectedId` (jeśli istnieje
   * w nowym drzewie) — user widzi gdzie nastąpiła zmiana, nie ryzykuje
   * usunięcia czegoś innego niż zamierzał.
   *
   * @param newTree - Nowe drzewo
   * @param affectedId - ID węzła do podświetlenia (lub null)
   */
  private handleTreeChangedFromMCP(newTree: Tree, affectedId: string | null): void {
    this.pushUndo();
    this.applyTree(newTree);
    if (affectedId) {
      if (this.followMode) {
        // Follow ON: przenieś selekcję na zmieniony węzeł — agent prowadzi wzrok.
        this.treePanel.selectById(affectedId);
        this.detailsPanel.setItem(this.treePanel.getSelectedItem() ?? null);
      } else {
        // Follow OFF: nie ruszaj selekcji, tylko mignij węzłem.
        this.treePanel.flashItems([affectedId]);
      }
      this.screen.render();
    }
  }

  /**
   * Wspólny apply: aktualizuje stan, panele, zapisuje autosave.
   */
  private applyTree(newTree: Tree): void {
    this.tree = newTree;
    this.mcpServer.setTree(newTree);
    this.treePanel.setRootItem(newTree.root as Item);
    this.detailsPanel.setItem(this.treePanel.getSelectedItem() ?? null);
    this.screen.render();
    this.autoSave();
  }

  /**
   * Push aktualnego drzewa do undo-stosu z limitem.
   */
  private pushUndo(): void {
    this.undoStack.push({ root: this.tree.root.clone(), itemsById: new Map(this.tree.itemsById) });
    while (this.undoStack.length > ApplicationState.UNDO_LIMIT) {
      this.undoStack.shift();
    }
  }

  /**
   * Ctrl+Z — cofnij ostatnią mutację.
   */
  private undo(): void {
    const prev = this.undoStack.pop();
    if (!prev) {
      this.statusBar.showMessage('Nothing to undo', 1200);
      this.screen.render();
      return;
    }
    this.applyTree(prev);
    this.statusBar.showMessage('Undone', 800);
    this.screen.render();
  }

  /**
   * Aplikuje wynik dowolnej TreeOperations: push undo + apply + status.
   *
   * @param result - Output z TreeOperations.* method
   */
  private applyMutation(result: { success: boolean; message: string; newTree?: Tree }): void {
    if (!result.success || !result.newTree) {
      this.statusBar.showMessage(result.message, 1800);
      this.screen.render();
      return;
    }
    this.pushUndo();
    this.applyTree(result.newTree);
  }

  /**
   * Cykl TODO state: TODO → WORK-UNIT → DONE → TODO. Inne stany (PROPOSAL,
   * QUESTION, DROPPED) zmienione tylko przez `T` (TODO).
   *
   * @param item - Aktualnie zaznaczony Item
   */
  private cycleTodo(item: Item): void {
    const order: TodoState[] = ['TODO', 'WORK-UNIT', 'DONE'];
    const cur = item.getTodo();
    const idx = order.indexOf(cur);
    // Jeśli aktualny stan poza ciągiem (PROPOSAL/QUESTION/DROPPED) — przeskocz na TODO.
    const next = idx === -1 ? 'TODO' : order[(idx + 1) % order.length];
    this.applyMutation(TreeOperations.setTodo(this.tree, item.getId(), next));
  }

  /**
   * Delete z prostym potwierdzeniem (TreePanel dwukrotne 'd' już to wymaga).
   */
  private deleteItem(item: Item): void {
    this.applyMutation(TreeOperations.deleteItem(this.tree, item.getId()));
  }

  /**
   * Dodaje dziecko z placeholderem "(new)" i wchodzi w edycję jego tytułu.
   */
  private addChildAndEdit(parent: Item): void {
    const result = TreeOperations.add(this.tree, parent.getId(), '(new)');
    if (!result.success || !result.newTree) {
      this.statusBar.showMessage(result.message, 1800);
      this.screen.render();
      return;
    }
    this.pushUndo();
    this.applyTree(result.newTree);
    // Selekcja: ostatnie dziecko rodzica
    const newParent = result.newTree.itemsById.get(parent.getId());
    if (newParent) {
      const children = newParent.getChildren();
      const newChild = children[children.length - 1];
      if (newChild) {
        this.treePanel.selectById(newChild.getId());
        // Wymuś focus na DetailsPanel i wejdź w edycję title
        this.windowManager.setFocus(this.detailsPanel);
        this.detailsPanel.setItem(newChild);
        this.detailsPanel.beginEditTitle();
        this.screen.render();
      }
    }
  }

  /**
   * Dodaje rodzeństwo wskazanego węzła i wchodzi w edycję tytułu.
   *
   * @param sibling - Istniejące rodzeństwo (kotwica pozycji).
   * @param position - 'after' = po sibling (klawisz `o`), 'before' = przed (klawisz `O`).
   */
  private addSiblingAndEdit(sibling: Item, position: 'after' | 'before'): void {
    // Znajdź rodzica
    const parentId = this.findParentIdOf(this.tree, sibling.getId());
    if (!parentId) {
      this.statusBar.showMessage('Cannot add sibling to root', 1500);
      this.screen.render();
      return;
    }
    const r1 = TreeOperations.add(this.tree, parentId, '(new)');
    if (!r1.success || !r1.newTree) {
      this.statusBar.showMessage(r1.message, 1800);
      this.screen.render();
      return;
    }
    // Znajdź ID nowo dodanego (last child of parent)
    const newParent = r1.newTree.itemsById.get(parentId);
    if (!newParent) return;
    const newChildren = newParent.getChildren();
    const newChild = newChildren[newChildren.length - 1];
    if (!newChild) return;
    const newId = newChild.getId();
    // Przesuń na pozycję względem sibling
    const moveOp = position === 'after' ? TreeOperations.moveAfter : TreeOperations.moveBefore;
    const r2 = moveOp(r1.newTree, newId, sibling.getId());
    if (!r2.success || !r2.newTree) {
      this.applyMutation(r1);
      return;
    }
    this.pushUndo();
    this.applyTree(r2.newTree);
    this.treePanel.selectById(newId);
    this.windowManager.setFocus(this.detailsPanel);
    this.detailsPanel.setItem(r2.newTree.itemsById.get(newId) ?? null);
    this.detailsPanel.beginEditTitle();
    this.screen.render();
  }

  /**
   * Przesuwa rodzeństwo o jedną pozycję w górę/dół.
   */
  private moveSibling(item: Item, direction: 'up' | 'down'): void {
    const parentId = this.findParentIdOf(this.tree, item.getId());
    if (!parentId) return;
    const parent = this.tree.itemsById.get(parentId);
    if (!parent) return;
    const siblings = parent.getChildren();
    const idx = siblings.findIndex((s) => s.getId() === item.getId());
    if (idx === -1) return;
    const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (targetIdx < 0 || targetIdx >= siblings.length) return;
    const targetSibling = siblings[targetIdx];
    const op = direction === 'up' ? TreeOperations.moveBefore : TreeOperations.moveAfter;
    this.applyMutation(op(this.tree, item.getId(), targetSibling.getId()));
  }

  /**
   * Indent: przenosi pod poprzedniego siblinga (staje się jego dzieckiem).
   */
  private indentItem(item: Item): void {
    const parentId = this.findParentIdOf(this.tree, item.getId());
    if (!parentId) return;
    const parent = this.tree.itemsById.get(parentId);
    if (!parent) return;
    const siblings = parent.getChildren();
    const idx = siblings.findIndex((s) => s.getId() === item.getId());
    if (idx <= 0) {
      this.statusBar.showMessage('No previous sibling to indent under', 1500);
      this.screen.render();
      return;
    }
    const prevSibling = siblings[idx - 1];
    this.applyMutation(TreeOperations.move(this.tree, item.getId(), prevSibling.getId()));
  }

  /**
   * Outdent: wyciąga do dziadka (staje się rodzeństwem rodzica).
   */
  private outdentItem(item: Item): void {
    const parentId = this.findParentIdOf(this.tree, item.getId());
    if (!parentId || parentId === this.tree.root.getId()) {
      this.statusBar.showMessage('Already at top level', 1500);
      this.screen.render();
      return;
    }
    const grandparentId = this.findParentIdOf(this.tree, parentId);
    if (!grandparentId) return;
    this.applyMutation(TreeOperations.move(this.tree, item.getId(), grandparentId));
  }

  /**
   * Lokalny helper: znajdź ID rodzica danego węzła. Duplikuje TreeOperations.findParentId
   * (ten jest private — żeby nie eksponować helper'a publicznie, dla TUI mamy własny).
   */
  private findParentIdOf(tree: Tree, itemId: string): string | null {
    if (itemId === tree.root.getId()) return null;
    const stack: { item: Item; pid: string | null }[] = [{ item: tree.root, pid: null }];
    while (stack.length) {
      const cur = stack.pop()!;
      for (const child of cur.item.getChildren()) {
        if (child.getId() === itemId) return cur.item.getId();
        stack.push({ item: child, pid: cur.item.getId() });
      }
    }
    return null;
  }

  /**
   * Zapisuje drzewo i pokazuje komunikat.
   */
  private handleSave(): void {
    this.autoSave();
    this.statusBar.showMessage('Saved!', 1500);
    this.screen.render();
  }

  /**
   * Czyste wyjście z aplikacji.
   */
  private handleExit(): void {
    if (this.exiting) {
      return;
    }
    this.exiting = true;
    this.autoSave();
    this.statusBar.stopMessageTimer();
    this.debugPanel.dispose();
    this.mcpServer.stopServer();
    this.windowManager.stop();
    this.screen.dispose();
    stderr.write(`[APP] Shutting down.\n`);
    process.exit(0);
  }

  /**
   * Autosave do pliku .org.
   */
  private autoSave(): void {
    try {
      FileManager.saveTree(this.tree, this.filePath);
    } catch (error) {
      Logger.error('APP', `Error saving tree: ${(error as Error).message}`);
      this.statusBar.showMessage('Save failed!', 2500);
    }
  }

  /**
   * Startuje MCP, ustawia początkowy fokus i uruchamia pętlę zdarzeń.
   */
  public start(): void {
    this.mcpServer.startServer();
    this.windowManager.setFocus(this.treePanel);
    this.detailsPanel.setItem(this.treePanel.getSelectedItem() ?? null);
    this.windowManager.run();
  }
}

/**
 * Main entry point.
 */
function main(): void {
  const filePath = process.argv[2] || 'plan.org';
  try {
    const tree = FileManager.loadTree(filePath);
    const app = new ApplicationState(tree, filePath);
    app.start();
  } catch (error) {
    stderr.write(`[APP] Fatal error: ${(error as Error).message}\n`);
    process.exit(1);
  }
}

main();
