/**
 * Testy dla TUI komponentów na bazie take4-console.
 * Pokrywają TreePanel, DetailsPanel, StatusBar — w tym integrację z Screen.
 */

import { test, beforeEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { Screen, Pos, Size, type Cell } from 'take4-console';
import Item from '../src/Item.mjs';
import type { Item as ItemInterface } from '../src/types.mjs';
import TreePanel from '../src/TUI/TreePanel.mjs';
import DetailsPanel from '../src/TUI/DetailsPanel.mjs';
import StatusBar from '../src/TUI/StatusBar.mjs';

/**
 * Tworzy świeży Screen dla testu (rejestruje globalny StyleRegistry,
 * wymagany przez konstruktor każdego Window).
 *
 * @param width - Szerokość ekranu
 * @param height - Wysokość ekranu
 * @returns Skonfigurowany Screen
 */
function makeScreen(width: number = 80, height: number = 24): Screen {
  const screen = new Screen({ damageTracking: false });
  screen.resize(width, height);
  return screen;
}

/**
 * Renderuje Window i zwraca jego zawartość jako tekst (jeden string, linie \n).
 *
 * @param win - Window do zrzutu
 * @returns Tekst zrzucony z buffera (bez stylów)
 */
function dumpWindowText(win: { render(): void; getSize(): { width: number; height: number }; getCell(x: number, y: number): Cell }): string {
  win.render();
  const { width, height } = win.getSize();
  const lines: string[] = [];
  for (let y = 0; y < height; y++) {
    let row = '';
    for (let x = 0; x < width; x++) {
      const cell = win.getCell(x, y);
      row += cell.char === '' ? '' : cell.char;
    }
    lines.push(row.trimEnd());
  }
  return lines.join('\n');
}

let screen: Screen;

beforeEach(() => {
  screen = makeScreen();
});

/**
 * Konstruuje TreePanel jako dziecko Screen z domyślnymi proporcjami.
 *
 * @param rootItem - Korzeń drzewa
 * @param onSelectionChanged - Opcjonalny callback selekcji
 * @returns Skonfigurowany TreePanel
 */
function makeTree(rootItem: Item, onSelectionChanged?: (item: ItemInterface | undefined) => void): TreePanel {
  const panel = new TreePanel(
    {
      pos: Pos.topLeft(),
      size: new Size(40, 20),
      border: { top: true, right: true, bottom: true, left: true, style: 'single' },
    },
    { rootItem, onSelectionChanged },
  );
  screen.addChild(panel);
  return panel;
}

/**
 * Konstruuje DetailsPanel jako dziecko Screen.
 *
 * @returns Skonfigurowany DetailsPanel
 */
function makeDetails(): DetailsPanel {
  const panel = new DetailsPanel({
    pos: Pos.topLeft(),
    size: new Size(50, 20),
    border: { top: true, right: true, bottom: true, left: true, style: 'single' },
  });
  screen.addChild(panel);
  return panel;
}

/**
 * Konstruuje StatusBar jako dziecko Screen.
 *
 * @param width - Szerokość paska
 * @returns Skonfigurowany StatusBar
 */
function makeBar(width: number = 80): StatusBar {
  const bar = new StatusBar({
    pos: Pos.topLeft(),
    size: new Size(width, 1),
  });
  screen.addChild(bar);
  return bar;
}

test('TreePanel - constructor initializes with item', () => {
  const root = new Item('root', 'Root Item');
  const panel = makeTree(root);

  assert.ok(panel instanceof TreePanel);
  assert.equal(panel.getSelectedIndex(), 0);
  assert.equal(panel.getSelectedItem()?.getId(), 'root');
});

test('TreePanel - navigation down works', () => {
  const root = new Item('root', 'Root');
  root.addChild(new Item('child1', 'Child 1'));
  root.addChild(new Item('child2', 'Child 2'));

  const panel = makeTree(root);
  panel.setFocused(true);

  assert.equal(panel.getSelectedIndex(), 0);

  panel.handleKey('j');
  assert.equal(panel.getSelectedIndex(), 1);
  assert.equal(panel.getSelectedItem()?.getId(), 'child1');

  panel.handleKey('j');
  assert.equal(panel.getSelectedIndex(), 2);
  assert.equal(panel.getSelectedItem()?.getId(), 'child2');
});

test('TreePanel - navigation up works', () => {
  const root = new Item('root', 'Root');
  root.addChild(new Item('child1', 'Child 1'));

  const panel = makeTree(root);
  panel.setFocused(true);

  panel.handleKey('j');
  assert.equal(panel.getSelectedIndex(), 1);

  panel.handleKey('k');
  assert.equal(panel.getSelectedIndex(), 0);
  assert.equal(panel.getSelectedItem()?.getId(), 'root');
});

test('TreePanel - arrow keys are aliases for jk', () => {
  const root = new Item('root', 'Root');
  root.addChild(new Item('c', 'C'));

  const panel = makeTree(root);
  panel.setFocused(true);

  panel.handleKey('\x1b[B'); // down arrow
  assert.equal(panel.getSelectedIndex(), 1);
  panel.handleKey('\x1b[A'); // up arrow
  assert.equal(panel.getSelectedIndex(), 0);
});

test('TreePanel - fold/unfold toggling', () => {
  const root = new Item('root', 'Root');
  root.addChild(new Item('child', 'Child'));

  const panel = makeTree(root);
  panel.setFocused(true);

  assert.equal(panel.getFlattenedNodes().length, 2);

  panel.handleKey('h');
  assert.equal(panel.getFlattenedNodes().length, 1);

  panel.handleKey('l');
  assert.equal(panel.getFlattenedNodes().length, 2);
});

test('TreePanel - unfocused handleKey is a no-op', () => {
  const root = new Item('root', 'Root');
  root.addChild(new Item('c', 'C'));
  const panel = makeTree(root);
  panel.setFocused(false);

  panel.handleKey('j');
  assert.equal(panel.getSelectedIndex(), 0);
});

test('TreePanel - render produces output with titles', () => {
  const root = new Item('root', 'Root Item', 'WORK-UNIT', ['invariant']);
  root.addChild(new Item('child', 'Child Item', 'TODO'));

  const panel = makeTree(root);
  const dump = dumpWindowText(panel);

  assert.ok(dump.includes('Root Item'), `expected 'Root Item' in:\n${dump}`);
  assert.ok(dump.includes('Child Item'), `expected 'Child Item' in:\n${dump}`);
});

test('TreePanel - onSelectionChanged fires on navigation', () => {
  const root = new Item('root', 'Root');
  root.addChild(new Item('c', 'C'));

  let selectedId: string | undefined;
  const panel = makeTree(root, (item) => {
    selectedId = item?.getId();
  });
  panel.setFocused(true);

  panel.handleKey('j');
  assert.equal(selectedId, 'c');
});

test('TreePanel - setRootItem replaces tree and resets selection', () => {
  const root1 = new Item('r1', 'Root 1');
  root1.addChild(new Item('c1', 'C1'));
  const panel = makeTree(root1);
  panel.setFocused(true);
  panel.handleKey('j');
  assert.equal(panel.getSelectedItem()?.getId(), 'c1');

  const root2 = new Item('r2', 'Root 2');
  panel.setRootItem(root2);
  assert.equal(panel.getSelectedItem()?.getId(), 'r2');
});

test('DetailsPanel - constructor initializes', () => {
  const panel = makeDetails();

  assert.ok(panel instanceof DetailsPanel);
  assert.equal(panel.getItem(), null);
  assert.equal(panel.getEditState().editMode, 'view');
});

test('DetailsPanel - setItem updates current item', () => {
  const item = new Item('item1', 'Test Item', 'TODO');
  const panel = makeDetails();

  panel.setItem(item);
  assert.equal(panel.getItem()?.getId(), 'item1');
});

test('DetailsPanel - entering edit mode', () => {
  const item = new Item('item1', 'Test Item');
  const panel = makeDetails();

  panel.setItem(item);
  panel.setFocused(true);
  panel.handleKey('e');

  const state = panel.getEditState();
  assert.equal(state.editMode, 'edit');
  assert.equal(state.editingField, 'title');
});

test('DetailsPanel - exiting edit mode with Escape', () => {
  const item = new Item('item1', 'Test Item');
  const panel = makeDetails();

  panel.setItem(item);
  panel.setFocused(true);
  panel.handleKey('e');
  assert.equal(panel.getEditState().editMode, 'edit');

  panel.handleKey('\x1b');
  assert.equal(panel.getEditState().editMode, 'view');
});

test('DetailsPanel - render shows item details', () => {
  const props = new Map([['owner', 'alice']]);
  const item = new Item('item1', 'Test Task', 'WORK-UNIT', ['tag1'], 'Some notes', props);
  const panel = makeDetails();

  panel.setItem(item);
  const dump = dumpWindowText(panel);

  assert.ok(dump.includes('Test Task'), `expected 'Test Task' in:\n${dump}`);
  assert.ok(dump.includes('WORK-UNIT'), `expected 'WORK-UNIT' in:\n${dump}`);
  assert.ok(dump.includes('tag1'), `expected 'tag1' in:\n${dump}`);
  assert.ok(dump.includes('Some notes'), `expected 'Some notes' in:\n${dump}`);
});

test('DetailsPanel - blur during edit exits edit mode', () => {
  const item = new Item('item1', 'Test Item');
  const panel = makeDetails();

  panel.setItem(item);
  panel.setFocused(true);
  panel.handleKey('e');
  assert.equal(panel.getEditMode(), 'edit');

  panel.setFocused(false);
  assert.equal(panel.getEditMode(), 'view');
});

test('StatusBar - constructor initializes', () => {
  const bar = makeBar();

  assert.ok(bar instanceof StatusBar);
  assert.equal(bar.getMode(), 'normal');
  assert.equal(bar.isDirty(), false);
});

test('StatusBar - setMode changes mode', () => {
  const bar = makeBar();

  bar.setMode('edit');
  assert.equal(bar.getMode(), 'edit');

  bar.setMode('normal');
  assert.equal(bar.getMode(), 'normal');
});

test('StatusBar - setDirty flag', () => {
  const bar = makeBar();

  bar.setDirty(true);
  assert.equal(bar.isDirty(), true);

  bar.setDirty(false);
  assert.equal(bar.isDirty(), false);
});

test('StatusBar - render includes mode indicator', () => {
  const bar = makeBar();

  bar.setMode('normal');
  let dump = dumpWindowText(bar);
  assert.ok(dump.includes('NORMAL'), `expected 'NORMAL' in:\n${dump}`);

  bar.setMode('edit');
  dump = dumpWindowText(bar);
  assert.ok(dump.includes('EDIT'), `expected 'EDIT' in:\n${dump}`);
});

test('StatusBar - render shows dirty marker', () => {
  const bar = makeBar();
  bar.setDirty(true);
  const dump = dumpWindowText(bar);
  assert.ok(dump.includes('[*]'), `expected dirty marker in:\n${dump}`);
});

test('TreePanel - handles nested hierarchy correctly', () => {
  const root = new Item('root', 'Root');
  const level1 = new Item('l1', 'Level 1');
  const level2 = new Item('l2', 'Level 2');
  const level3 = new Item('l3', 'Level 3');

  root.addChild(level1);
  level1.addChild(level2);
  level2.addChild(level3);

  const panel = makeTree(root);
  panel.setFocused(true);

  const nodes = panel.getFlattenedNodes();
  assert.equal(nodes.length, 4);
  assert.equal(nodes[0].depth, 0);
  assert.equal(nodes[1].depth, 1);
  assert.equal(nodes[2].depth, 2);
  assert.equal(nodes[3].depth, 3);
});
