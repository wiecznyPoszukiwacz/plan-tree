import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import Item from '../src/Item.mjs';

test('Item - constructor creates item with all properties', () => {
  const props = new Map([
    ['priority', 'high'],
    ['owner', 'alice'],
  ]);
  const item = new Item(
    'item-1',
    'Learn TypeScript',
    'WORK-UNIT',
    ['typescript', 'learning'],
    'Focus on advanced types',
    props,
  );

  assert.equal(item.getId(), 'item-1');
  assert.equal(item.getTitle(), 'Learn TypeScript');
  assert.equal(item.getTodo(), 'WORK-UNIT');
  assert.deepEqual(item.getTags(), ['typescript', 'learning']);
  assert.equal(item.getNotes(), 'Focus on advanced types');
  assert.deepEqual(item.getProperties(), props);
  assert.deepEqual(item.getChildren(), []);
});

test('Item - constructor with default values', () => {
  const item = new Item('item-2', 'Simple task');

  assert.equal(item.getId(), 'item-2');
  assert.equal(item.getTitle(), 'Simple task');
  assert.equal(item.getTodo(), 'TODO');
  assert.deepEqual(item.getTags(), []);
  assert.equal(item.getNotes(), '');
  assert.deepEqual(item.getProperties(), new Map());
  assert.deepEqual(item.getChildren(), []);
});

test('Item - getTags returns a copy', () => {
  const tags = ['tag1', 'tag2'];
  const item = new Item('item-3', 'Task', 'TODO', tags);

  const retrievedTags = item.getTags();
  retrievedTags.push('tag3');

  assert.deepEqual(item.getTags(), ['tag1', 'tag2']);
});

test('Item - getProperties returns a copy', () => {
  const props = new Map([['key1', 'value1']]);
  const item = new Item('item-4', 'Task', 'TODO', [], '', props);

  const retrievedProps = item.getProperties();
  retrievedProps.set('key2', 'value2');

  assert.deepEqual(item.getProperties(), new Map([['key1', 'value1']]));
});

test('Item - getChildren returns a copy', () => {
  const item1 = new Item('item-1', 'Parent');
  const child1 = new Item('child-1', 'Child 1');
  const child2 = new Item('child-2', 'Child 2');

  item1.addChild(child1);
  item1.addChild(child2);

  const children = item1.getChildren();
  assert.equal(children.length, 2);
  assert.equal(children[0].getId(), 'child-1');
  assert.equal(children[1].getId(), 'child-2');
});

test('Item - addChild adds child to item', () => {
  const parent = new Item('parent', 'Parent Task');
  const child = new Item('child', 'Child Task');

  parent.addChild(child);

  const children = parent.getChildren();
  assert.equal(children.length, 1);
  assert.equal(children[0].getId(), 'child');
});

test('Item - removeChild removes child by id', () => {
  const parent = new Item('parent', 'Parent Task');
  const child1 = new Item('child-1', 'Child 1');
  const child2 = new Item('child-2', 'Child 2');

  parent.addChild(child1);
  parent.addChild(child2);
  assert.equal(parent.getChildren().length, 2);

  parent.removeChild('child-1');
  const children = parent.getChildren();
  assert.equal(children.length, 1);
  assert.equal(children[0].getId(), 'child-2');
});

test('Item - removeChild does nothing if child not found', () => {
  const parent = new Item('parent', 'Parent Task');
  const child = new Item('child', 'Child Task');

  parent.addChild(child);
  parent.removeChild('non-existent');

  assert.equal(parent.getChildren().length, 1);
});

test('Item - setTodo returns new Item with updated todo state', () => {
  const original = new Item('item-1', 'Task', 'TODO');
  const updated = original.setTodo('DONE');

  assert.equal(original.getTodo(), 'TODO');
  assert.equal(updated.getTodo(), 'DONE');
  assert.equal(updated.getId(), original.getId());
  assert.equal(updated.getTitle(), original.getTitle());
});

test('Item - setTodo preserves children in new Item', () => {
  const parent = new Item('parent', 'Parent Task', 'TODO');
  const child = new Item('child', 'Child Task');
  parent.addChild(child);

  const updated = parent.setTodo('WORK-UNIT');

  assert.equal(updated.getTodo(), 'WORK-UNIT');
  assert.equal(updated.getChildren().length, 1);
  assert.equal(updated.getChildren()[0].getId(), 'child');
});

test('Item - addTag returns new Item with added tag', () => {
  const original = new Item('item-1', 'Task', 'TODO', ['tag1']);
  const updated = original.addTag('tag2');

  assert.deepEqual(original.getTags(), ['tag1']);
  assert.deepEqual(updated.getTags(), ['tag1', 'tag2']);
});

test('Item - addTag does not add duplicate tag', () => {
  const original = new Item('item-1', 'Task', 'TODO', ['tag1']);
  const updated = original.addTag('tag1');

  assert.deepEqual(updated.getTags(), ['tag1']);
});

test('Item - removeTag returns new Item without tag', () => {
  const original = new Item('item-1', 'Task', 'TODO', ['tag1', 'tag2']);
  const updated = original.removeTag('tag1');

  assert.deepEqual(original.getTags(), ['tag1', 'tag2']);
  assert.deepEqual(updated.getTags(), ['tag2']);
});

test('Item - removeTag does nothing if tag not found', () => {
  const original = new Item('item-1', 'Task', 'TODO', ['tag1']);
  const updated = original.removeTag('non-existent');

  assert.deepEqual(updated.getTags(), ['tag1']);
});

test('Item - setProperty returns new Item with updated property', () => {
  const original = new Item('item-1', 'Task');
  const updated = original.setProperty('key1', 'value1');

  assert.deepEqual(original.getProperties(), new Map());
  assert.deepEqual(updated.getProperties(), new Map([['key1', 'value1']]));
});

test('Item - setProperty overwrites existing property', () => {
  const props = new Map([['key1', 'old-value']]);
  const original = new Item('item-1', 'Task', 'TODO', [], '', props);
  const updated = original.setProperty('key1', 'new-value');

  assert.equal(original.getProperties().get('key1'), 'old-value');
  assert.equal(updated.getProperties().get('key1'), 'new-value');
});

test('Item - clone creates deep copy with same values', () => {
  const props = new Map([['priority', 'high']]);
  const original = new Item(
    'item-1',
    'Task',
    'WORK-UNIT',
    ['tag1', 'tag2'],
    'Some notes',
    props,
  );
  const child = new Item('child-1', 'Child');
  original.addChild(child);

  const cloned = original.clone();

  assert.equal(cloned.getId(), original.getId());
  assert.equal(cloned.getTitle(), original.getTitle());
  assert.equal(cloned.getTodo(), original.getTodo());
  assert.deepEqual(cloned.getTags(), original.getTags());
  assert.equal(cloned.getNotes(), original.getNotes());
  assert.deepEqual(cloned.getProperties(), original.getProperties());
  assert.equal(cloned.getChildren().length, 1);
  assert.equal(cloned.getChildren()[0].getId(), 'child-1');
});

test('Item - clone creates independent copy', () => {
  const original = new Item('item-1', 'Task', 'TODO', ['tag1']);
  const cloned = original.clone();

  const modifiedClone = cloned.addTag('tag2');

  assert.deepEqual(original.getTags(), ['tag1']);
  assert.deepEqual(modifiedClone.getTags(), ['tag1', 'tag2']);
});

/**
 * Regression: priority must survive every immutable update (setTodo, addTag,
 * removeTag, withTitle, withNotes, setProperty, removeProperty, clone). The
 * Item constructor takes priority as the 7th positional argument with default
 * null, so any rebuild that forgets to forward this.priority silently drops it.
 */
test('Item - priority survives all immutable updates', () => {
  const base = new Item('p1', 't', 'TODO', ['a'], 'n', new Map([['k', 'v']]), 'A');

  assert.equal(base.setTodo('DONE').getPriority(), 'A', 'setTodo');
  assert.equal(base.addTag('b').getPriority(), 'A', 'addTag');
  assert.equal(base.removeTag('a').getPriority(), 'A', 'removeTag');
  assert.equal(base.withTitle('x').getPriority(), 'A', 'withTitle');
  assert.equal(base.withNotes('x').getPriority(), 'A', 'withNotes');
  assert.equal(base.setProperty('k2', 'v2').getPriority(), 'A', 'setProperty');
  assert.equal(base.removeProperty('k').getPriority(), 'A', 'removeProperty');
  assert.equal(base.clone().getPriority(), 'A', 'clone');
});
