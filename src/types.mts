/**
 * Typy dla plan-tree TUI
 */

export type TodoState = 'TODO' | 'PROPOSAL' | 'QUESTION' | 'WORK-UNIT' | 'DROPPED' | 'DONE';

/**
 * Org-mode priority cookie. `[#A]` najwyższy, `[#C]` najniższy.
 * `null` = brak priorytetu (większość węzłów).
 */
export type Priority = 'A' | 'B' | 'C' | null;

export interface ItemProps {
  id: string;
  title: string;
  todo: TodoState;
  tags: string[];
  children: Item[];
  notes: string;
  properties: Map<string, string>;
  priority: Priority;
}

/**
 * Reprezentacja pojedynczego wpisu (węzła drzewa)
 */
export interface Item {
  getId(): string;
  getTitle(): string;
  getTodo(): TodoState;
  getTags(): string[];
  getChildren(): Item[];
  getProperties(): Map<string, string>;
  getNotes(): string;
  getPriority(): Priority;
  addChild(item: Item): void;
  removeChild(childId: string): void;
  setTodo(state: TodoState): Item;
  addTag(tag: string): Item;
  removeTag(tag: string): Item;
  setProperty(key: string, value: string): Item;
  withPriority(p: Priority): Item;
  clone(): Item;
}

/**
 * Drzewo planu
 */
export interface Tree {
  root: Item;
  itemsById: Map<string, Item>;
}

/**
 * Wynik operacji na modelu
 */
export interface OperationResult {
  success: boolean;
  message: string;
  newTree?: Tree;
  diff?: string;
}

/**
 * Nagłówek parsed z pliku .org
 */
export interface Headline {
  level: number;
  title: string;
  todo: TodoState | null;
  tags: string[];
  content: string;
  properties: Map<string, string>;
  priority: Priority;
  children: Headline[];
}
