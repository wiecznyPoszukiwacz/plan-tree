import { test } from 'node:test';
import * as assert from 'node:assert';
import Item from '../src/Item.mjs';
import TreeOperations from '../src/TreeOperations.mjs';
import type { Tree } from '../src/types.mjs';

/**
 * Helper: tworzy prostą strukturę testową
 */
function createTestTree(): Tree {
  const root = new Item('root', 'Root Plan');
  const item1 = new Item('item1', 'First Task');
  const item2 = new Item('item2', 'Second Task');
  const item1_1 = new Item('item1_1', 'Subtask 1.1');

  root.addChild(item1);
  root.addChild(item2);
  item1.addChild(item1_1);

  const itemsById = new Map([
    ['root', root],
    ['item1', item1],
    ['item2', item2],
    ['item1_1', item1_1],
  ]);

  return { root, itemsById };
}

test('TreeOperations.split() - happy path', () => {
  const tree = createTestTree();
  const result = TreeOperations.split(tree, 'item1', 5);

  assert.ok(result.success, 'split should succeed');
  assert.ok(result.newTree, 'newTree should exist');
  assert.strictEqual(result.newTree.itemsById.size, 5, 'should have 5 items (original 4 + new 1)');
});

test('TreeOperations.split() - invalid position', () => {
  const tree = createTestTree();
  const result = TreeOperations.split(tree, 'item1', 100);

  assert.strictEqual(result.success, false, 'should fail with invalid position');
  assert.ok(result.message.includes('Invalid position'), 'should have meaningful error message');
});

test('TreeOperations.split() - item not found', () => {
  const tree = createTestTree();
  const result = TreeOperations.split(tree, 'nonexistent', 5);

  assert.strictEqual(result.success, false, 'should fail if item not found');
  assert.ok(result.message.includes('not found'), 'should mention item not found');
});

test('TreeOperations.merge() - happy path', () => {
  const tree = createTestTree();
  const result = TreeOperations.merge(tree, 'item1', 'item2');

  assert.ok(result.success, 'merge should succeed');
  assert.ok(result.newTree, 'newTree should exist');
  assert.strictEqual(result.newTree.itemsById.size, 3, 'should have 3 items (4 original - 1 merged)');
});

test('TreeOperations.merge() - non-siblings', () => {
  const tree = createTestTree();
  const result = TreeOperations.merge(tree, 'item1', 'item1_1');

  assert.strictEqual(result.success, false, 'should fail if items are not siblings');
  assert.ok(result.message.includes('different parents'), 'should mention different parents');
});

test('TreeOperations.merge() - items not found', () => {
  const tree = createTestTree();
  const result = TreeOperations.merge(tree, 'item1', 'nonexistent');

  assert.strictEqual(result.success, false, 'should fail if one item not found');
});

test('TreeOperations.extract() - happy path', () => {
  const tree = createTestTree();
  const result = TreeOperations.extract(tree, 'item1');

  assert.ok(result.success, 'extract should succeed');
  assert.ok(result.newTree, 'newTree should exist');
  // item1 jest usuwany, ale item1_1 jest promowany do root'a
  assert.ok(result.newTree.itemsById.has('item1_1'), 'child should be promoted');
});

test('TreeOperations.extract() - root cannot be extracted', () => {
  const tree = createTestTree();
  const result = TreeOperations.extract(tree, 'root');

  assert.strictEqual(result.success, false, 'should fail if trying to extract root');
});

test('TreeOperations.extract() - item not found', () => {
  const tree = createTestTree();
  const result = TreeOperations.extract(tree, 'nonexistent');

  assert.strictEqual(result.success, false, 'should fail if item not found');
});

test('TreeOperations.absorb() - happy path', () => {
  const tree = createTestTree();
  const result = TreeOperations.absorb(tree, 'item1');

  assert.ok(result.success, 'absorb should succeed');
  assert.ok(result.newTree, 'newTree should exist');
  // item1 powinno być wchłonięte, item1_1 powinno pozostać
  assert.ok(!result.newTree.itemsById.has('item1'), 'item1 should be removed');
  assert.ok(result.newTree.itemsById.has('item1_1'), 'child should remain');
});

test('TreeOperations.absorb() - root cannot be absorbed', () => {
  const tree = createTestTree();
  const result = TreeOperations.absorb(tree, 'root');

  assert.strictEqual(result.success, false, 'should fail if trying to absorb root');
});

test('TreeOperations.absorb() - item not found', () => {
  const tree = createTestTree();
  const result = TreeOperations.absorb(tree, 'nonexistent');

  assert.strictEqual(result.success, false, 'should fail if item not found');
});

test('TreeOperations.move() - happy path', () => {
  const tree = createTestTree();
  const result = TreeOperations.move(tree, 'item2', 'item1');

  assert.ok(result.success, 'move should succeed');
  assert.ok(result.newTree, 'newTree should exist');
  // item2 powinno być dzieckiem item1
  const movedItem = result.newTree.itemsById.get('item2');
  assert.ok(movedItem, 'item2 should exist in new tree');
});

test('TreeOperations.move() - cycle prevention', () => {
  const tree = createTestTree();
  // Próbujemy przenieść item1 do item1_1 (co by utworzyło cykl)
  const result = TreeOperations.move(tree, 'item1', 'item1_1');

  assert.strictEqual(result.success, false, 'should fail if would create cycle');
  assert.ok(result.message.includes('cycle'), 'should mention cycle');
});

test('TreeOperations.move() - target parent not found', () => {
  const tree = createTestTree();
  const result = TreeOperations.move(tree, 'item1', 'nonexistent');

  assert.strictEqual(result.success, false, 'should fail if target parent not found');
});

test('TreeOperations.move() - item not found', () => {
  const tree = createTestTree();
  const result = TreeOperations.move(tree, 'nonexistent', 'item2');

  assert.strictEqual(result.success, false, 'should fail if item not found');
});

test('Tree consistency - split operation preserves itemsById', () => {
  const tree = createTestTree();
  const result = TreeOperations.split(tree, 'item1', 5);

  assert.ok(result.newTree, 'newTree should exist');
  const itemsById = result.newTree.itemsById;

  // Sprawdzamy, że wszystkie items z itemsById są dostępne przez traversal
  const traversalIds = new Set<string>();
  const stack = [result.newTree.root];
  while (stack.length > 0) {
    const current = stack.pop()!;
    traversalIds.add(current.getId());
    for (const child of current.getChildren()) {
      stack.push(child);
    }
  }

  assert.deepStrictEqual(
    new Set(itemsById.keys()),
    traversalIds,
    'itemsById should match traversal result',
  );
});

test('Tree consistency - merge operation preserves itemsById', () => {
  const tree = createTestTree();
  const result = TreeOperations.merge(tree, 'item1', 'item2');

  assert.ok(result.newTree, 'newTree should exist');
  const itemsById = result.newTree.itemsById;

  const traversalIds = new Set<string>();
  const stack = [result.newTree.root];
  while (stack.length > 0) {
    const current = stack.pop()!;
    traversalIds.add(current.getId());
    for (const child of current.getChildren()) {
      stack.push(child);
    }
  }

  assert.deepStrictEqual(
    new Set(itemsById.keys()),
    traversalIds,
    'itemsById should match traversal result',
  );
});

test('TreeOperations.deleteItem() - leaf removal', () => {
  const tree = createTestTree();
  const result = TreeOperations.deleteItem(tree, 'item1_1');

  assert.ok(result.success, 'delete should succeed on a leaf');
  assert.ok(result.newTree, 'newTree should exist');
  assert.strictEqual(result.newTree.itemsById.size, 3, '4 items - 1 leaf = 3');
  assert.strictEqual(result.newTree.itemsById.has('item1_1'), false, 'leaf gone from index');
  assert.ok(result.diff?.includes('1 item removed'), 'diff reports count = 1');
});

test('TreeOperations.deleteItem() - removes entire subtree', () => {
  const tree = createTestTree();
  const result = TreeOperations.deleteItem(tree, 'item1');

  assert.ok(result.success, 'delete should succeed on a subtree root');
  assert.ok(result.newTree, 'newTree should exist');
  assert.strictEqual(result.newTree.itemsById.size, 2, 'root + item2 remain');
  assert.strictEqual(result.newTree.itemsById.has('item1'), false, 'item1 gone');
  assert.strictEqual(result.newTree.itemsById.has('item1_1'), false, 'child gone with parent');
  assert.ok(result.diff?.includes('2 items removed'), 'diff reports count = 2');
});

test('TreeOperations.deleteItem() - refuses root', () => {
  const tree = createTestTree();
  const result = TreeOperations.deleteItem(tree, 'root');

  assert.strictEqual(result.success, false, 'root deletion must be refused');
  assert.ok(result.message.includes('root'), 'message mentions root');
  assert.strictEqual(result.newTree, undefined, 'no new tree on failure');
});

test('TreeOperations.deleteItem() - item not found', () => {
  const tree = createTestTree();
  const result = TreeOperations.deleteItem(tree, 'nonexistent');

  assert.strictEqual(result.success, false, 'should fail when item not found');
  assert.ok(result.message.includes('not found'), 'message mentions not found');
});

test('TreeOperations.add() - appends new child to parent', () => {
  const tree = createTestTree();
  const result = TreeOperations.add(tree, 'item1', 'New subtask');

  assert.ok(result.success, 'add should succeed');
  assert.ok(result.newTree, 'newTree should exist');
  assert.strictEqual(result.newTree.itemsById.size, 5, '4 + 1 new item');

  const parent = result.newTree!.itemsById.get('item1')!;
  const children = parent.getChildren();
  const last = children[children.length - 1];
  assert.strictEqual(last.getTitle(), 'New subtask', 'title set');
  assert.strictEqual(last.getTodo(), 'TODO', 'defaults to TODO');
  assert.strictEqual(last.getProperties().get('ID'), last.getId(), ':ID: persisted in properties');
});

test('TreeOperations.add() - under root', () => {
  const tree = createTestTree();
  const result = TreeOperations.add(tree, 'root', 'Top-level item', 'WORK-UNIT');

  assert.ok(result.success);
  const rootChildren = result.newTree!.root.getChildren();
  assert.strictEqual(rootChildren.length, 3, '2 existing + 1 new');
  const last = rootChildren[rootChildren.length - 1];
  assert.strictEqual(last.getTitle(), 'Top-level item');
  assert.strictEqual(last.getTodo(), 'WORK-UNIT');
});

test('TreeOperations.add() - parent not found', () => {
  const tree = createTestTree();
  const result = TreeOperations.add(tree, 'nonexistent', 'X');
  assert.strictEqual(result.success, false);
  assert.ok(result.message.includes('not found'));
});

test('TreeOperations.add() - empty title rejected', () => {
  const tree = createTestTree();
  const result = TreeOperations.add(tree, 'root', '');
  assert.strictEqual(result.success, false);
  assert.ok(result.message.includes('empty'));
});

test('TreeOperations.add() - invalid todo state rejected', () => {
  const tree = createTestTree();
  const result = TreeOperations.add(tree, 'root', 'X', 'GARBAGE');
  assert.strictEqual(result.success, false);
  assert.ok(result.message.includes('Invalid todo'));
});

test('TreeOperations.setTodo - changes state, preserves rest', () => {
  const tree = createTestTree();
  const r = TreeOperations.setTodo(tree, 'item1', 'DONE');
  assert.ok(r.success);
  const item = r.newTree!.itemsById.get('item1')!;
  assert.strictEqual(item.getTodo(), 'DONE');
  assert.strictEqual(item.getTitle(), 'First Task');
  assert.strictEqual(item.getChildren().length, 1);
});

test('TreeOperations.setTodo - rejects invalid state and root', () => {
  const tree = createTestTree();
  assert.strictEqual(TreeOperations.setTodo(tree, 'item1', 'BOGUS').success, false);
  assert.strictEqual(TreeOperations.setTodo(tree, 'root', 'DONE').success, false);
});

test('TreeOperations.rename - changes title', () => {
  const tree = createTestTree();
  const r = TreeOperations.rename(tree, 'item1', 'Renamed');
  assert.ok(r.success);
  assert.strictEqual(r.newTree!.itemsById.get('item1')!.getTitle(), 'Renamed');
});

test('TreeOperations.setNotes - replaces notes', () => {
  const tree = createTestTree();
  const r = TreeOperations.setNotes(tree, 'item1', 'multi\nline notes');
  assert.ok(r.success);
  assert.strictEqual(r.newTree!.itemsById.get('item1')!.getNotes(), 'multi\nline notes');
});

test('TreeOperations.addTag / removeTag - mutates tags', () => {
  const tree = createTestTree();
  const r1 = TreeOperations.addTag(tree, 'item1', 'urgent');
  assert.deepEqual(r1.newTree!.itemsById.get('item1')!.getTags(), ['urgent']);
  const r2 = TreeOperations.removeTag(r1.newTree!, 'item1', 'urgent');
  assert.deepEqual(r2.newTree!.itemsById.get('item1')!.getTags(), []);
});

test('TreeOperations.addTag - rejects bad tag', () => {
  const tree = createTestTree();
  assert.strictEqual(TreeOperations.addTag(tree, 'item1', 'with space').success, false);
  assert.strictEqual(TreeOperations.addTag(tree, 'item1', 'with:colon').success, false);
});

test('TreeOperations.setProperty - sets and rejects ID', () => {
  const tree = createTestTree();
  const r = TreeOperations.setProperty(tree, 'item1', 'PRIORITY', 'high');
  assert.strictEqual(r.newTree!.itemsById.get('item1')!.getProperties().get('PRIORITY'), 'high');
  assert.strictEqual(TreeOperations.setProperty(tree, 'item1', 'ID', 'evil').success, false);
});

test('TreeOperations.moveBefore - reorders siblings', () => {
  const tree = createTestTree();
  // item1 i item2 są root-childrami (kolejność: item1, item2)
  const r = TreeOperations.moveBefore(tree, 'item2', 'item1');
  assert.ok(r.success, r.message);
  const order = r.newTree!.root.getChildren().map((c) => c.getId());
  assert.deepEqual(order, ['item2', 'item1']);
});

test('TreeOperations.moveAfter - reorders siblings', () => {
  const tree = createTestTree();
  const r = TreeOperations.moveAfter(tree, 'item1', 'item2');
  assert.ok(r.success, r.message);
  const order = r.newTree!.root.getChildren().map((c) => c.getId());
  assert.deepEqual(order, ['item2', 'item1']);
});

test('TreeOperations.moveBefore - rejects non-siblings', () => {
  const tree = createTestTree();
  assert.strictEqual(TreeOperations.moveBefore(tree, 'item1_1', 'item1').success, false);
});

test('TreeOperations.find - by title substring', () => {
  const tree = createTestTree();
  const r = TreeOperations.find(tree, { titleContains: 'first' });
  const matches = JSON.parse(r.diff!) as Array<{ id: string }>;
  assert.strictEqual(matches.length, 1);
  assert.strictEqual(matches[0].id, 'item1');
});

test('TreeOperations.find - empty filters returns all non-root', () => {
  const tree = createTestTree();
  const r = TreeOperations.find(tree, {});
  const matches = JSON.parse(r.diff!) as Array<unknown>;
  assert.strictEqual(matches.length, 3, 'item1 + item2 + item1_1');
});

test('TreeOperations.add - with notes and tags', () => {
  const tree = createTestTree();
  const r = TreeOperations.add(tree, 'root', 'Task', 'WORK-UNIT', 'extra info', ['alpha', 'beta']);
  const last = r.newTree!.root.getChildren().slice(-1)[0];
  assert.strictEqual(last.getNotes(), 'extra info');
  assert.deepEqual(last.getTags(), ['alpha', 'beta']);
});

test('TreeOperations.generateId - n<N> format with seeded counter', () => {
  TreeOperations.setIdCounter(41);
  assert.strictEqual(TreeOperations.generateId(), 'n42');
  assert.strictEqual(TreeOperations.generateId(), 'n43');
});

test('TreeOperations.seedIdCounter - picks max from tree', () => {
  const tree = createTestTree();
  // Stwórz pseudo-tree z mieszanką ID
  tree.itemsById.set('n100', tree.root); // syntetyczny
  tree.itemsById.set('n7', tree.root);
  TreeOperations.seedIdCounter(tree);
  assert.strictEqual(TreeOperations.generateId(), 'n101');
});

test('TreeOperations.setPriority - A/B/C and clear', () => {
  const tree = createTestTree();
  const r1 = TreeOperations.setPriority(tree, 'item1', 'A');
  assert.strictEqual(r1.newTree!.itemsById.get('item1')!.getPriority(), 'A');
  const r2 = TreeOperations.setPriority(r1.newTree!, 'item1', '');
  assert.strictEqual(r2.newTree!.itemsById.get('item1')!.getPriority(), null);
});

test('TreeOperations.setPriority - rejects invalid', () => {
  const tree = createTestTree();
  assert.strictEqual(TreeOperations.setPriority(tree, 'item1', 'X').success, false);
});

test('TreeOperations.find - priority filter', () => {
  const tree = createTestTree();
  const t2 = TreeOperations.setPriority(tree, 'item1', 'A').newTree!;
  const r = TreeOperations.find(t2, { priority: 'A' });
  const matches = JSON.parse(r.diff!) as Array<{ id: string; priority?: string }>;
  assert.strictEqual(matches.length, 1);
  assert.strictEqual(matches[0].priority, 'A');
});

test('TreeOperations.find - includeFrozen=false cascades: hides FROZEN node AND its subtree', () => {
  const tree = createTestTree();
  const t2 = TreeOperations.setProperty(tree, 'item1', 'FROZEN', 't').newTree!;
  const hidden = JSON.parse(TreeOperations.find(t2, {}).diff!) as Array<{ id: string }>;
  const visible = JSON.parse(TreeOperations.find(t2, { includeFrozen: true }).diff!) as Array<{ id: string }>;
  assert.strictEqual(hidden.find((m) => m.id === 'item1'), undefined, 'frozen item1 hidden by default');
  assert.strictEqual(hidden.find((m) => m.id === 'item1_1'), undefined, 'item1_1 (child of frozen) also hidden — cascade');
  assert.ok(hidden.find((m) => m.id === 'item2'), 'sibling item2 still visible');
  assert.ok(visible.find((m) => m.id === 'item1'), 'item1 visible with includeFrozen');
  assert.ok(visible.find((m) => m.id === 'item1_1'), 'item1_1 visible with includeFrozen');
});

// ============ ANCHOR (n40) ============

test('TreeOperations.anchor/unanchor - round-trip sets and clears :ANCHOR: t', () => {
  let tree = createTestTree();
  const r1 = TreeOperations.anchor(tree, 'item1');
  assert.ok(r1.success, 'anchor should succeed');
  tree = r1.newTree!;
  assert.strictEqual(tree.itemsById.get('item1')!.getProperties().get('ANCHOR'), 't', 'item1 has :ANCHOR: t');

  const r2 = TreeOperations.unanchor(tree, 'item1');
  assert.ok(r2.success, 'unanchor should succeed');
  tree = r2.newTree!;
  assert.strictEqual(tree.itemsById.get('item1')!.getProperties().has('ANCHOR'), false, 'item1 no longer anchored');
});

test('TreeOperations - anchored node blocks content mutations (self)', () => {
  const tree = TreeOperations.anchor(createTestTree(), 'item1').newTree!;
  for (const r of [
    TreeOperations.rename(tree, 'item1', 'X'),
    TreeOperations.setNotes(tree, 'item1', 'X'),
    TreeOperations.setTodo(tree, 'item1', 'DONE'),
    TreeOperations.addTag(tree, 'item1', 'foo'),
    TreeOperations.setPriority(tree, 'item1', 'A'),
    TreeOperations.setProperty(tree, 'item1', 'FOO', 'bar'),
  ]) {
    assert.strictEqual(r.success, false, 'mutation on anchored node rejected');
    assert.ok(r.message.includes('anchored'), 'message mentions anchored');
  }
});

test('TreeOperations - mutation of a child inside an anchored subtree is blocked (cascade down)', () => {
  // item1 anchored → item1_1 (its child) is locked too.
  const tree = TreeOperations.anchor(createTestTree(), 'item1').newTree!;
  const r = TreeOperations.rename(tree, 'item1_1', 'X');
  assert.strictEqual(r.success, false, 'child of anchored node cannot be renamed');
  assert.ok(r.message.includes('item1'), 'blocked by the anchored ancestor item1');
});

test('TreeOperations - deleting a non-anchored parent with an anchored child is blocked (the żelazna kotwica case)', () => {
  // Anchor the CHILD; deleting the non-anchored PARENT would destroy it.
  const tree = TreeOperations.anchor(createTestTree(), 'item1_1').newTree!;
  const r = TreeOperations.deleteItem(tree, 'item1');
  assert.strictEqual(r.success, false, 'delete of parent with anchored descendant rejected');
  assert.ok(r.message.includes('item1_1'), 'blocked by anchored descendant item1_1');
});

test('TreeOperations - extract/absorb/move of a node with an anchored descendant is blocked', () => {
  const tree = TreeOperations.anchor(createTestTree(), 'item1_1').newTree!;
  assert.strictEqual(TreeOperations.extract(tree, 'item1').success, false, 'extract blocked');
  assert.strictEqual(TreeOperations.absorb(tree, 'item1').success, false, 'absorb blocked');
  assert.strictEqual(TreeOperations.move(tree, 'item1', 'item2').success, false, 'move blocked');
});

test('TreeOperations - moving a node INTO an anchored subtree is blocked', () => {
  const tree = TreeOperations.anchor(createTestTree(), 'item2').newTree!;
  const r = TreeOperations.move(tree, 'item1', 'item2');
  assert.strictEqual(r.success, false, 'cannot move into anchored target');
  assert.ok(r.message.includes('item2'), 'blocked by anchored target item2');
});

test('TreeOperations - add child under anchored node is blocked', () => {
  const tree = TreeOperations.anchor(createTestTree(), 'item1').newTree!;
  const r = TreeOperations.add(tree, 'item1', 'New child');
  assert.strictEqual(r.success, false, 'cannot add under anchored node');
});

test('TreeOperations - non-anchored siblings remain mutable while one is anchored', () => {
  const tree = TreeOperations.anchor(createTestTree(), 'item1').newTree!;
  const r = TreeOperations.rename(tree, 'item2', 'Renamed');
  assert.ok(r.success, 'sibling item2 stays mutable');
});

test('TreeOperations - renaming a non-anchored ancestor of an anchored node is allowed (content edit, up-only)', () => {
  // item1_1 anchored. Renaming item1 (its parent) does not touch item1_1, so allowed.
  const tree = TreeOperations.anchor(createTestTree(), 'item1_1').newTree!;
  const r = TreeOperations.rename(tree, 'item1', 'Parent renamed');
  assert.ok(r.success, 'content edit of ancestor allowed — does not destroy/relocate anchored descendant');
});

test('TreeOperations - ANCHOR key is protected from setProperty/removeProperty', () => {
  const tree = createTestTree();
  const rs = TreeOperations.setProperty(tree, 'item1', 'ANCHOR', 't');
  assert.strictEqual(rs.success, false, 'setProperty ANCHOR rejected');
  const anchored = TreeOperations.anchor(tree, 'item1').newTree!;
  const rr = TreeOperations.removeProperty(anchored, 'item1', 'ANCHOR');
  assert.strictEqual(rr.success, false, 'removeProperty ANCHOR rejected (user-only via TUI)');
});

test('TreeOperations.find - flags anchored items with anchored:true', () => {
  const tree = TreeOperations.anchor(createTestTree(), 'item1').newTree!;
  const matches = JSON.parse(TreeOperations.find(tree, {}).diff!) as Array<{ id: string; anchored?: true }>;
  assert.strictEqual(matches.find((m) => m.id === 'item1')!.anchored, true, 'item1 flagged anchored');
  assert.strictEqual(matches.find((m) => m.id === 'item2')!.anchored, undefined, 'item2 not flagged');
});

// ============ Freeze-depth (N36) ============

test('TreeOperations.freezeDepth/unfreezeDepth - round-trip sets and clears :FREEZE-DEPTH: t', () => {
  let tree = createTestTree();
  const r1 = TreeOperations.freezeDepth(tree, 'item1');
  assert.ok(r1.success, 'freezeDepth should succeed');
  tree = r1.newTree!;
  assert.strictEqual(tree.itemsById.get('item1')!.getProperties().get('FREEZE-DEPTH'), 't', 'item1 has :FREEZE-DEPTH: t');

  const r2 = TreeOperations.unfreezeDepth(tree, 'item1');
  assert.ok(r2.success, 'unfreezeDepth should succeed');
  tree = r2.newTree!;
  assert.strictEqual(tree.itemsById.get('item1')!.getProperties().has('FREEZE-DEPTH'), false, 'item1 no longer depth-frozen');
});

test('TreeOperations - add a child under a depth-frozen node is blocked', () => {
  const tree = TreeOperations.freezeDepth(createTestTree(), 'item1').newTree!;
  const r = TreeOperations.add(tree, 'item1', 'New detail');
  assert.strictEqual(r.success, false, 'add under depth-frozen node rejected');
  assert.ok(r.message.includes('depth-frozen'), 'message mentions depth-frozen');
  assert.ok(r.message.includes('item1'), 'blocked by item1');
});

test('TreeOperations - add a child deeper inside a depth-frozen subtree is blocked (cascade)', () => {
  // item1 depth-frozen → adding under its child item1_1 is also blocked.
  const tree = TreeOperations.freezeDepth(createTestTree(), 'item1').newTree!;
  const r = TreeOperations.add(tree, 'item1_1', 'Deeper detail');
  assert.strictEqual(r.success, false, 'add under descendant of depth-frozen node rejected');
  assert.ok(r.message.includes('item1'), 'blocked by depth-frozen ancestor item1');
});

test('TreeOperations - splitting a descendant of a depth-frozen node is blocked', () => {
  // item1 depth-frozen → splitting its child item1_1 (deepens granularity below) is blocked.
  const tree = TreeOperations.freezeDepth(createTestTree(), 'item1').newTree!;
  const r = TreeOperations.split(tree, 'item1_1', 3);
  assert.strictEqual(r.success, false, 'split of descendant rejected');
  assert.ok(r.message.includes('depth-frozen'), 'message mentions depth-frozen');
});

test('TreeOperations - splitting the depth-frozen node itself is allowed (sibling outside subtree)', () => {
  const tree = TreeOperations.freezeDepth(createTestTree(), 'item1').newTree!;
  const r = TreeOperations.split(tree, 'item1', 3);
  assert.ok(r.success, 'splitting the frozen node itself produces a sibling, not depth — allowed');
});

test('TreeOperations - depth-freeze does not block add under unrelated nodes', () => {
  const tree = TreeOperations.freezeDepth(createTestTree(), 'item1').newTree!;
  const r = TreeOperations.add(tree, 'item2', 'Fine here');
  assert.ok(r.success, 'add under sibling subtree unaffected by depth-freeze on item1');
});

// ============ Add-lock-depth (N75) ============

test('TreeOperations.setAddLockDepth - sets and clears :ADD-LOCK-DEPTH: on root', () => {
  let tree = createTestTree();
  const r1 = TreeOperations.setAddLockDepth(tree, 1);
  assert.ok(r1.success, 'setAddLockDepth(1) should succeed');
  tree = r1.newTree!;
  assert.strictEqual(tree.root.getProperties().get('ADD-LOCK-DEPTH'), '1', 'root has :ADD-LOCK-DEPTH: 1');

  const r0 = TreeOperations.setAddLockDepth(tree, 0);
  assert.ok(r0.success, 'setAddLockDepth(0) should succeed (disable)');
  tree = r0.newTree!;
  assert.strictEqual(tree.root.getProperties().has('ADD-LOCK-DEPTH'), false, 'lock removed when set to 0');
});

test('TreeOperations.setAddLockDepth - rejects invalid depth', () => {
  const tree = createTestTree();
  assert.strictEqual(TreeOperations.setAddLockDepth(tree, -1).success, false, 'negative rejected');
  assert.strictEqual(TreeOperations.setAddLockDepth(tree, 1.5).success, false, 'non-integer rejected');
});

test('TreeOperations - add-lock-depth=1 blocks top-level add (parent=root)', () => {
  const tree = TreeOperations.setAddLockDepth(createTestTree(), 1).newTree!;
  const r = TreeOperations.add(tree, 'root', 'New top-level');
  assert.strictEqual(r.success, false, 'top-level add rejected under add-lock-depth 1');
  assert.ok(r.message.includes('add-lock-depth'), 'message mentions add-lock-depth');
});

test('TreeOperations - add-lock-depth=1 still allows add under non-root parents', () => {
  const tree = TreeOperations.setAddLockDepth(createTestTree(), 1).newTree!;
  const r = TreeOperations.add(tree, 'item1', 'Child of item1');
  assert.ok(r.success, 'add under depth-1 parent allowed when lock depth is 1');
});

test('TreeOperations - add-lock-depth=2 also blocks add under root children', () => {
  const tree = TreeOperations.setAddLockDepth(createTestTree(), 2).newTree!;
  const rRoot = TreeOperations.add(tree, 'root', 'X');
  assert.strictEqual(rRoot.success, false, 'top-level blocked');
  const rChild = TreeOperations.add(tree, 'item1', 'X'); // item1 at depth 1 < 2
  assert.strictEqual(rChild.success, false, 'add under depth-1 parent blocked when lock depth is 2');
  const rDeep = TreeOperations.add(tree, 'item1_1', 'X'); // item1_1 at depth 2, not < 2
  assert.ok(rDeep.success, 'add under depth-2 parent allowed');
});

test('TreeOperations - no add-lock-depth property means no restriction (opt-in)', () => {
  const tree = createTestTree();
  const r = TreeOperations.add(tree, 'root', 'New top-level');
  assert.ok(r.success, 'top-level add allowed when lock not configured');
});
