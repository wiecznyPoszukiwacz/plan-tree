import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { writeFileSync, unlinkSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import OrgReader from '../src/OrgReader.mjs';

const testDir = '/tmp/plan-tree-test';
mkdirSync(testDir, { recursive: true });

/**
 * Helper: pisze testowy plik .org i zwraca ścieżkę
 */
function createTestFile(filename: string, content: string): string {
  const filePath = join(testDir, filename);
  writeFileSync(filePath, content, 'utf-8');
  return filePath;
}

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

test('OrgReader - reads empty file', () => {
  const content = '';
  const filePath = createTestFile('empty.org', content);

  try {
    const reader = new OrgReader();
    const tree = reader.read(filePath);

    assert.equal(tree.root.getTitle(), 'Plan Root');
    assert.equal(tree.root.getChildren().length, 0);
    assert.equal(tree.itemsById.size, 1); // tylko root
  } finally {
    cleanupTestFile(filePath);
  }
});

test('OrgReader - parses single headline', () => {
  const content = `* Task 1
This is a note for task 1`;
  const filePath = createTestFile('single.org', content);

  try {
    const reader = new OrgReader();
    const tree = reader.read(filePath);

    assert.equal(tree.root.getChildren().length, 1);
    const task1 = tree.root.getChildren()[0];
    assert.equal(task1.getTitle(), 'Task 1');
    assert.equal(task1.getTodo(), 'TODO');
    assert.equal(task1.getNotes(), 'This is a note for task 1');
  } finally {
    cleanupTestFile(filePath);
  }
});

test('OrgReader - parses TODO state', () => {
  const content = `* TODO Task 1
* PROPOSAL Task 2
* WORK-UNIT Task 3
* DROPPED Task 4
* DONE Task 5`;
  const filePath = createTestFile('todos.org', content);

  try {
    const reader = new OrgReader();
    const tree = reader.read(filePath);

    const children = tree.root.getChildren();
    assert.equal(children.length, 5);
    assert.equal(children[0].getTodo(), 'TODO');
    assert.equal(children[1].getTodo(), 'PROPOSAL');
    assert.equal(children[2].getTodo(), 'WORK-UNIT');
    assert.equal(children[3].getTodo(), 'DROPPED');
    assert.equal(children[4].getTodo(), 'DONE');
  } finally {
    cleanupTestFile(filePath);
  }
});

test('OrgReader - parses tags', () => {
  const content = `* Task 1 :tag1:tag2:
* Task 2 :python:urgent:`;
  const filePath = createTestFile('tags.org', content);

  try {
    const reader = new OrgReader();
    const tree = reader.read(filePath);

    const children = tree.root.getChildren();
    assert.deepEqual(children[0].getTags(), ['tag1', 'tag2']);
    assert.deepEqual(children[1].getTags(), ['python', 'urgent']);
  } finally {
    cleanupTestFile(filePath);
  }
});

test('OrgReader - parses properties drawer', () => {
  const content = `* Task 1
:PROPERTIES:
:PRIORITY: high
:OWNER: alice
:END:
Task notes here`;
  const filePath = createTestFile('props.org', content);

  try {
    const reader = new OrgReader();
    const tree = reader.read(filePath);

    const task = tree.root.getChildren()[0];
    const props = task.getProperties();
    assert.equal(props.get('PRIORITY'), 'high');
    assert.equal(props.get('OWNER'), 'alice');
    assert.equal(task.getNotes(), 'Task notes here');
  } finally {
    cleanupTestFile(filePath);
  }
});

test('OrgReader - parses hierarchical headlines', () => {
  const content = `* Parent Task
** Child Task 1
** Child Task 2
*** Grandchild Task
* Another Parent`;
  const filePath = createTestFile('hierarchy.org', content);

  try {
    const reader = new OrgReader();
    const tree = reader.read(filePath);

    const topLevel = tree.root.getChildren();
    assert.equal(topLevel.length, 2);

    const parent1 = topLevel[0];
    assert.equal(parent1.getTitle(), 'Parent Task');
    assert.equal(parent1.getChildren().length, 2);

    const child1 = parent1.getChildren()[0];
    assert.equal(child1.getTitle(), 'Child Task 1');

    const child2 = parent1.getChildren()[1];
    assert.equal(child2.getTitle(), 'Child Task 2');
    assert.equal(child2.getChildren().length, 1);

    const grandchild = child2.getChildren()[0];
    assert.equal(grandchild.getTitle(), 'Grandchild Task');

    const parent2 = topLevel[1];
    assert.equal(parent2.getTitle(), 'Another Parent');
  } finally {
    cleanupTestFile(filePath);
  }
});

test('OrgReader - parses TODO with tags and properties', () => {
  const content = `* PROPOSAL Learn TypeScript :typescript:learning:
:PROPERTIES:
:PRIORITY: high
:DEADLINE: 2026-06-01
:END:
Focus on advanced types and decorators`;
  const filePath = createTestFile('complex.org', content);

  try {
    const reader = new OrgReader();
    const tree = reader.read(filePath);

    const task = tree.root.getChildren()[0];
    assert.equal(task.getTitle(), 'Learn TypeScript');
    assert.equal(task.getTodo(), 'PROPOSAL');
    assert.deepEqual(task.getTags(), ['typescript', 'learning']);
    assert.equal(task.getProperties().get('PRIORITY'), 'high');
    assert.equal(task.getProperties().get('DEADLINE'), '2026-06-01');
    assert.equal(task.getNotes(), 'Focus on advanced types and decorators');
  } finally {
    cleanupTestFile(filePath);
  }
});

test('OrgReader - parses multiline notes', () => {
  const content = `* Task 1
This is line 1 of notes.
This is line 2 of notes.
This is line 3 of notes.`;
  const filePath = createTestFile('multiline.org', content);

  try {
    const reader = new OrgReader();
    const tree = reader.read(filePath);

    const task = tree.root.getChildren()[0];
    const notes = task.getNotes();
    assert(notes.includes('line 1'));
    assert(notes.includes('line 2'));
    assert(notes.includes('line 3'));
  } finally {
    cleanupTestFile(filePath);
  }
});

test('OrgReader - handles empty headlines', () => {
  const content = `* Task 1
* Task 2
* Task 3`;
  const filePath = createTestFile('empty_headlines.org', content);

  try {
    const reader = new OrgReader();
    const tree = reader.read(filePath);

    assert.equal(tree.root.getChildren().length, 3);
    for (const task of tree.root.getChildren()) {
      assert.equal(task.getNotes(), '');
      // Reader wstrzykuje `:ID:` do properties dla każdego węzła bez
      // jawnego ID w pliku (fix stabilności ID, 0.3.1). Innych properties
      // być nie powinno.
      assert.equal(task.getProperties().size, 1);
      assert.ok(task.getProperties().has('ID'), 'auto-generated ID present');
    }
  } finally {
    cleanupTestFile(filePath);
  }
});

test('OrgReader - builds itemsById map correctly', () => {
  const content = `* Parent
** Child 1
** Child 2`;
  const filePath = createTestFile('itemmap.org', content);

  try {
    const reader = new OrgReader();
    const tree = reader.read(filePath);

    // itemsById powinien zawierać root + 3 itemy
    assert.equal(tree.itemsById.size, 4);
    assert(tree.itemsById.has('root'));

    // Każdy item powinien mieć unikatowy id
    const ids = Array.from(tree.itemsById.keys());
    const uniqueIds = new Set(ids);
    assert.equal(uniqueIds.size, ids.length);
  } finally {
    cleanupTestFile(filePath);
  }
});

test('OrgReader - parses real-world example', () => {
  const content = `* Header
** TODO Implementation :feature:
:PROPERTIES:
:CREATED: 2026-05-24
:END:
Implement OrgReader and OrgWriter

** PROPOSAL Documentation :docs:
Need to write comprehensive docs

* Inbox
** PROPOSAL New feature idea
Consider adding support for inline formatting

* Rejected
** DROPPED Old feature
This was superseded by version 2`;
  const filePath = createTestFile('realworld.org', content);

  try {
    const reader = new OrgReader();
    const tree = reader.read(filePath);

    const topLevel = tree.root.getChildren();
    assert.equal(topLevel.length, 3); // Header, Inbox, Rejected

    const header = topLevel[0];
    assert.equal(header.getTitle(), 'Header');
    assert.equal(header.getChildren().length, 2);

    const implementation = header.getChildren()[0];
    assert.equal(implementation.getTitle(), 'Implementation');
    assert.equal(implementation.getTodo(), 'TODO');
    assert.deepEqual(implementation.getTags(), ['feature']);

    const inbox = topLevel[1];
    assert.equal(inbox.getTitle(), 'Inbox');

    const rejected = topLevel[2];
    assert.equal(rejected.getTitle(), 'Rejected');
  } finally {
    cleanupTestFile(filePath);
  }
});
