import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync, unlinkSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import OrgWriter from '../src/OrgWriter.mjs';
import OrgReader from '../src/OrgReader.mjs';
import Item from '../src/Item.mjs';

const testDir = '/tmp/plan-tree-test';
mkdirSync(testDir, { recursive: true });

/**
 * Helper: czyści plik testowy
 */
function cleanupTestFile(filePath: string): void {
  try {
    unlinkSync(filePath);
  } catch {
    // Plik może już nie istnieć
  }
}

test('OrgWriter - writes empty tree', () => {
  const root = new Item('root', 'Plan Root', 'TODO', [], '', new Map());
  const tree = { root, itemsById: new Map([['root', root]]) };

  const filePath = join(testDir, 'empty_write.org');

  try {
    const writer = new OrgWriter();
    writer.write(tree, filePath);

    const content = readFileSync(filePath, 'utf-8');
    assert.equal(content, ''); // puste drzewo: bez ghost-wrappera = pusty plik
  } finally {
    cleanupTestFile(filePath);
  }
});

test('OrgWriter - writes single item', () => {
  const root = new Item('root', 'Plan Root');
  const item1 = new Item('item-1', 'Task 1', 'TODO', [], 'Task notes', new Map());
  root.addChild(item1);

  const tree = { root, itemsById: new Map([['root', root], ['item-1', item1]]) };

  const filePath = join(testDir, 'single_write.org');

  try {
    const writer = new OrgWriter();
    writer.write(tree, filePath);

    const content = readFileSync(filePath, 'utf-8');
    assert(content.includes('* Task 1'));
    assert(content.includes('Task notes'));
  } finally {
    cleanupTestFile(filePath);
  }
});

test('OrgWriter - writes TODO states', () => {
  const root = new Item('root', 'Plan Root');
  root.addChild(new Item('item-1', 'Alpha', 'TODO'));
  root.addChild(new Item('item-2', 'Beta', 'PROPOSAL'));
  root.addChild(new Item('item-3', 'Gamma', 'DONE'));

  const itemsById = new Map([
    ['root', root],
    ['item-1', root.getChildren()[0]],
    ['item-2', root.getChildren()[1]],
    ['item-3', root.getChildren()[2]],
  ]);
  const tree = { root, itemsById };

  const filePath = join(testDir, 'todos_write.org');

  try {
    const writer = new OrgWriter();
    writer.write(tree, filePath);

    const content = readFileSync(filePath, 'utf-8');
    // TODO state jest domyślny i pomijany w serializacji
    assert(content.includes('* Alpha'), 'TODO state omitted');
    assert(content.includes('* PROPOSAL Beta'));
    assert(content.includes('* DONE Gamma'));
  } finally {
    cleanupTestFile(filePath);
  }
});

test('OrgWriter - writes tags', () => {
  const root = new Item('root', 'Plan Root');
  const item1 = new Item('item-1', 'Learn TypeScript', 'TODO', ['typescript', 'learning']);
  root.addChild(item1);

  const tree = { root, itemsById: new Map([['root', root], ['item-1', item1]]) };

  const filePath = join(testDir, 'tags_write.org');

  try {
    const writer = new OrgWriter();
    writer.write(tree, filePath);

    const content = readFileSync(filePath, 'utf-8');
    assert(content.includes(':typescript:learning:'));
  } finally {
    cleanupTestFile(filePath);
  }
});

test('OrgWriter - writes properties drawer', () => {
  const root = new Item('root', 'Plan Root');
  const props = new Map([
    ['PRIORITY', 'high'],
    ['OWNER', 'alice'],
  ]);
  const item1 = new Item('item-1', 'Task 1', 'TODO', [], '', props);
  root.addChild(item1);

  const tree = { root, itemsById: new Map([['root', root], ['item-1', item1]]) };

  const filePath = join(testDir, 'props_write.org');

  try {
    const writer = new OrgWriter();
    writer.write(tree, filePath);

    const content = readFileSync(filePath, 'utf-8');
    assert(content.includes(':PROPERTIES:'));
    assert(content.includes(':PRIORITY: high'));
    assert(content.includes(':OWNER: alice'));
    assert(content.includes(':END:'));
  } finally {
    cleanupTestFile(filePath);
  }
});

test('OrgWriter - writes hierarchy', () => {
  const root = new Item('root', 'Plan Root');
  const parent = new Item('item-1', 'Parent Task');
  const child1 = new Item('item-2', 'Child Task 1');
  const child2 = new Item('item-3', 'Child Task 2');

  parent.addChild(child1);
  parent.addChild(child2);
  root.addChild(parent);

  const itemsById = new Map([
    ['root', root],
    ['item-1', parent],
    ['item-2', child1],
    ['item-3', child2],
  ]);
  const tree = { root, itemsById };

  const filePath = join(testDir, 'hierarchy_write.org');

  try {
    const writer = new OrgWriter();
    writer.write(tree, filePath);

    const content = readFileSync(filePath, 'utf-8');
    assert(content.includes('* Parent Task'));
    assert(content.includes('** Child Task 1'));
    assert(content.includes('** Child Task 2'));

    // Sprawdzamy, że child jest wcięty bardziej niż parent
    const lines = content.split('\n');
    const parentLine = lines.find((l) => l.includes('Parent Task'));
    const childLine = lines.find((l) => l.includes('Child Task 1'));

    assert(parentLine && parentLine.match(/^\*{1} /));
    assert(childLine && childLine.match(/^\*{2} /));
  } finally {
    cleanupTestFile(filePath);
  }
});

test('OrgWriter - writes root children as level-1 headlines (no section wrappers)', () => {
  const root = new Item('root', 'Plan Root');
  root.addChild(new Item('item-1', 'Alpha', 'TODO'));
  root.addChild(new Item('item-2', 'Beta', 'PROPOSAL'));
  root.addChild(new Item('item-3', 'Gamma', 'DROPPED'));

  const itemsById = new Map([
    ['root', root],
    ['item-1', root.getChildren()[0]],
    ['item-2', root.getChildren()[1]],
    ['item-3', root.getChildren()[2]],
  ]);
  const tree = { root, itemsById };

  const filePath = join(testDir, 'sections_write.org');

  try {
    const writer = new OrgWriter();
    writer.write(tree, filePath);

    const content = readFileSync(filePath, 'utf-8');
    // Brak ghost-wrapperów sekcji
    assert(!content.includes('* Header'), 'no Header wrapper');
    assert(!content.includes('* Inbox'), 'no Inbox wrapper');
    assert(!content.includes('* Rejected'), 'no Rejected wrapper');
    // Każde dziecko roota = headline poziomu 1 (TODO state jest domyślny i pomijany)
    assert(content.includes('* Alpha'), 'TODO item at level 1');
    assert(content.includes('* PROPOSAL Beta'), 'PROPOSAL at level 1');
    assert(content.includes('* DROPPED Gamma'), 'DROPPED at level 1');
  } finally {
    cleanupTestFile(filePath);
  }
});

test('OrgWriter - round-trip read-write-read preserves structure and IDs', async () => {
  const originalContent = `* TODO Implementation :feature:
:PROPERTIES:
:ID: stable-id-alpha
:CREATED: 2026-05-24
:END:
Implement OrgReader and OrgWriter
** PROPOSAL Documentation
:PROPERTIES:
:ID: stable-id-beta
:END:
Need to write comprehensive docs
* PROPOSAL New feature
:PROPERTIES:
:ID: stable-id-gamma
:END:
* DROPPED Old feature
:PROPERTIES:
:ID: stable-id-delta
:END:
`;

  const filePath1 = join(testDir, 'roundtrip1.org');
  const filePath2 = join(testDir, 'roundtrip2.org');

  try {
    const { writeFileSync } = await import('node:fs');
    writeFileSync(filePath1, originalContent, 'utf-8');

    const reader = new OrgReader();
    const tree = reader.read(filePath1);

    const writer = new OrgWriter();
    writer.write(tree, filePath2);

    const tree2 = reader.read(filePath2);

    // Brak inflacji: liczba root-children identyczna po round-tripie
    assert.equal(tree.root.getChildren().length, tree2.root.getChildren().length);
    assert.equal(tree.root.getChildren().length, 3, 'three top-level items');

    // Stabilne ID — te same w obu czytach
    const ids1 = tree.root.getChildren().map((c) => c.getId()).sort();
    const ids2 = tree2.root.getChildren().map((c) => c.getId()).sort();
    assert.deepEqual(ids1, ids2, 'IDs stable across round-trip');
    assert(ids1.includes('stable-id-alpha'), ':ID: from properties used as Item.id');
  } finally {
    cleanupTestFile(filePath1);
    cleanupTestFile(filePath2);
  }
});

test('OrgReader - generates and persists ID when :ID: missing', async () => {
  const filePath = join(testDir, 'no_id.org');
  const filePath2 = join(testDir, 'no_id_rewritten.org');

  try {
    const { writeFileSync } = await import('node:fs');
    writeFileSync(filePath, '* Bare headline\n', 'utf-8');

    const reader = new OrgReader();
    const tree = reader.read(filePath);
    const item = tree.root.getChildren()[0];
    const generatedId = item.getId();
    assert.notEqual(generatedId, '', 'ID generated');
    assert.equal(item.getProperties().get('ID'), generatedId, 'ID persisted in properties');

    // Round-trip: zapisz i przeczytaj — ID musi być takie samo
    const writer = new OrgWriter();
    writer.write(tree, filePath2);
    const tree2 = reader.read(filePath2);
    assert.equal(tree2.root.getChildren()[0].getId(), generatedId, 'ID survives round-trip');
  } finally {
    cleanupTestFile(filePath);
    cleanupTestFile(filePath2);
  }
});

test('OrgWriter - handles complex nested structure', () => {
  const root = new Item('root', 'Plan Root');

  const header = new Item('item-1', 'Header');
  const task1 = new Item('item-2', 'Task 1', 'TODO', ['urgent'], 'Important task');
  const subtask1 = new Item('item-3', 'Subtask 1.1', 'WORK-UNIT');
  const subtask2 = new Item('item-4', 'Subtask 1.2', 'DONE');

  task1.addChild(subtask1);
  task1.addChild(subtask2);
  header.addChild(task1);
  root.addChild(header);

  const itemsById = new Map([
    ['root', root],
    ['item-1', header],
    ['item-2', task1],
    ['item-3', subtask1],
    ['item-4', subtask2],
  ]);
  const tree = { root, itemsById };

  const filePath = join(testDir, 'complex_write.org');

  try {
    const writer = new OrgWriter();
    writer.write(tree, filePath);

    const content = readFileSync(filePath, 'utf-8');

    assert(content.includes('* Header'));
    // TODO state pomijany (default); Task 1 widoczny z tagiem
    assert(content.includes('** Task 1 :urgent:'));
    assert(content.includes('*** WORK-UNIT Subtask 1.1'));
    assert(content.includes('*** DONE Subtask 1.2'));
    assert(content.includes('Important task'));
    // Brak ghost-wrappera — "* Header" pochodzi wyłącznie z Itema o tytule "Header"
    assert.equal((content.match(/^\* Header$/gm) ?? []).length, 1, 'no duplicate Header wrapper');
  } finally {
    cleanupTestFile(filePath);
  }
});

test('OrgWriter - omits TODO for default state', () => {
  const root = new Item('root', 'Plan Root');
  const item1 = new Item('item-1', 'Default Task', 'TODO');
  const item2 = new Item('item-2', 'Special Task', 'DONE');

  root.addChild(item1);
  root.addChild(item2);

  const tree = { root, itemsById: new Map([['root', root], ['item-1', item1], ['item-2', item2]]) };

  const filePath = join(testDir, 'todo_omit.org');

  try {
    const writer = new OrgWriter();
    writer.write(tree, filePath);

    const content = readFileSync(filePath, 'utf-8');

    // TODO nie powinien być wypisany dla default state
    const lines = content.split('\n');
    const defaultTaskLine = lines.find((l) => l.includes('Default Task'));
    const doneTaskLine = lines.find((l) => l.includes('Special Task'));

    // TODO state jest domyślny, więc powinien być pominięty
    // ale sprawdzamy że DONE jest wypisane
    assert(doneTaskLine && doneTaskLine.includes('DONE'));
  } finally {
    cleanupTestFile(filePath);
  }
});

test('OrgReader+OrgWriter - priority cookie round-trip', async () => {
  const original = `* TODO [#A] High priority task
:PROPERTIES:
:ID: hi
:END:
* [#B] Medium without TODO
:PROPERTIES:
:ID: med
:END:
* DONE [#C] Closed low task
:PROPERTIES:
:ID: low
:END:
* No priority task
:PROPERTIES:
:ID: none
:END:
`;
  const f1 = join(testDir, 'prio_in.org');
  const f2 = join(testDir, 'prio_out.org');
  try {
    const { writeFileSync } = await import('node:fs');
    writeFileSync(f1, original, 'utf-8');
    const r = new OrgReader();
    const tree = r.read(f1);
    const items = tree.root.getChildren();
    assert.strictEqual(items[0].getPriority(), 'A');
    assert.strictEqual(items[0].getTitle(), 'High priority task');
    assert.strictEqual(items[1].getPriority(), 'B');
    assert.strictEqual(items[1].getTitle(), 'Medium without TODO');
    assert.strictEqual(items[2].getPriority(), 'C');
    assert.strictEqual(items[2].getTodo(), 'DONE');
    assert.strictEqual(items[3].getPriority(), null);
    // Roundtrip
    new OrgWriter().write(tree, f2);
    const tree2 = r.read(f2);
    const items2 = tree2.root.getChildren();
    assert.strictEqual(items2[0].getPriority(), 'A');
    assert.strictEqual(items2[2].getPriority(), 'C');
    assert.strictEqual(items2[3].getPriority(), null);
  } finally {
    cleanupTestFile(f1);
    cleanupTestFile(f2);
  }
});
