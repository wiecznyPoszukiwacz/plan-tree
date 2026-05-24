import type { TodoState, Priority, Item as ItemInterface } from './types.mjs';

/**
 * Implementacja klasy Item reprezentującej węzeł drzewa planu.
 * Klasa implementuje immutable pattern dla state (todo, tags, properties),
 * ale dopuszcza mutowanie children (dodawanie/usuwanie).
 */
export default class Item implements ItemInterface {
  private readonly id: string;
  private readonly title: string;
  private readonly todo: TodoState;
  private readonly tags: string[];
  private readonly notes: string;
  private readonly properties: Map<string, string>;
  private readonly priority: Priority;
  private readonly children: Item[] = [];

  /**
   * Tworzy nowy wpis (węzeł drzewa).
   *
   * @param id - Unikalny identyfikator wpisu
   * @param title - Tytuł wpisu
   * @param todo - Stan TODO (TODO, PROPOSAL, QUESTION, WORK-UNIT, DROPPED, DONE)
   * @param tags - Tablica tagów
   * @param notes - Notatki do wpisu
   * @param properties - Mapa właściwości custom
   * @param priority - Org-mode priority cookie (A/B/C/null)
   */
  public constructor(
    id: string,
    title: string,
    todo: TodoState = 'TODO',
    tags: string[] = [],
    notes: string = '',
    properties: Map<string, string> = new Map(),
    priority: Priority = null,
  ) {
    this.id = id;
    this.title = title;
    this.todo = todo;
    this.tags = [...tags];
    this.notes = notes;
    this.properties = new Map(properties);
    this.priority = priority;
  }

  /**
   * Zwraca priority cookie ('A'/'B'/'C' lub null).
   *
   * @returns Priority
   */
  public getPriority(): Priority {
    return this.priority;
  }

  /**
   * Zwraca nowy Item z innym priority. Immutable.
   *
   * @param p - Nowe priority (A/B/C/null)
   * @returns Nowy Item
   */
  public withPriority(p: Priority): Item {
    const newItem = new Item(this.id, this.title, this.todo, this.tags, this.notes, this.properties, p);
    for (const child of this.children) {
      newItem.addChild(child);
    }
    return newItem;
  }

  /**
   * Zwraca identyfikator wpisu.
   *
   * @returns Unikalny identyfikator
   */
  public getId(): string {
    return this.id;
  }

  /**
   * Zwraca tytuł wpisu.
   *
   * @returns Tytuł
   */
  public getTitle(): string {
    return this.title;
  }

  /**
   * Zwraca stan TODO wpisu.
   *
   * @returns Stan TODO
   */
  public getTodo(): TodoState {
    return this.todo;
  }

  /**
   * Zwraca tablicę tagów wpisu.
   *
   * @returns Tablica tagów (kopia)
   */
  public getTags(): string[] {
    return [...this.tags];
  }

  /**
   * Zwraca tablicę dzieci węzła.
   *
   * @returns Tablica Item będących dziećmi
   */
  public getChildren(): Item[] {
    return [...this.children];
  }

  /**
   * Zwraca mapę właściwości custom wpisu.
   *
   * @returns Mapa właściwości (kopia)
   */
  public getProperties(): Map<string, string> {
    return new Map(this.properties);
  }

  /**
   * Zwraca notatki wpisu.
   *
   * @returns Notatki
   */
  public getNotes(): string {
    return this.notes;
  }

  /**
   * Dodaje dziecko do tego wpisu.
   * Mutuje tablicę children.
   *
   * @param item - Wpis do dodania jako dziecko
   */
  public addChild(item: ItemInterface | Item): void {
    this.children.push(item as Item);
  }

  /**
   * Usuwa dziecko o podanym ID.
   * Mutuje tablicę children.
   *
   * @param childId - ID dziecka do usunięcia
   */
  public removeChild(childId: string): void {
    const index = this.children.findIndex((child) => child.getId() === childId);
    if (index !== -1) {
      this.children.splice(index, 1);
    }
  }

  /**
   * Zwraca nowy Item z zaktualizowanym stanem TODO.
   * Immutable — nie modyfikuje bieżący obiekt.
   *
   * @param state - Nowy stan TODO
   * @returns Nowy Item z zaktualizowanym stanem
   */
  public setTodo(state: TodoState): Item {
    const newItem = new Item(
      this.id,
      this.title,
      state,
      this.tags,
      this.notes,
      this.properties,
      this.priority,
    );
    for (const child of this.children) {
      newItem.addChild(child);
    }
    return newItem;
  }

  /**
   * Zwraca nowy Item z dodanym tagiem.
   * Immutable — nie modyfikuje bieżący obiekt.
   *
   * @param tag - Tag do dodania
   * @returns Nowy Item z dodanym tagiem
   */
  public addTag(tag: string): Item {
    const newTags = [...this.tags];
    if (!newTags.includes(tag)) {
      newTags.push(tag);
    }
    const newItem = new Item(
      this.id,
      this.title,
      this.todo,
      newTags,
      this.notes,
      this.properties,
      this.priority,
    );
    for (const child of this.children) {
      newItem.addChild(child);
    }
    return newItem;
  }

  /**
   * Zwraca nowy Item z usuniętym tagiem.
   * Immutable — nie modyfikuje bieżący obiekt.
   *
   * @param tag - Tag do usunięcia
   * @returns Nowy Item bez podanego tagu
   */
  public removeTag(tag: string): Item {
    const newTags = this.tags.filter((t) => t !== tag);
    const newItem = new Item(
      this.id,
      this.title,
      this.todo,
      newTags,
      this.notes,
      this.properties,
      this.priority,
    );
    for (const child of this.children) {
      newItem.addChild(child);
    }
    return newItem;
  }

  /**
   * Zwraca nowy Item z innym tytułem. Immutable.
   *
   * @param title - Nowy tytuł
   * @returns Nowy Item
   */
  public withTitle(title: string): Item {
    const newItem = new Item(this.id, title, this.todo, this.tags, this.notes, this.properties, this.priority);
    for (const child of this.children) {
      newItem.addChild(child);
    }
    return newItem;
  }

  /**
   * Zwraca nowy Item z innymi notes. Immutable.
   *
   * @param notes - Nowe notes
   * @returns Nowy Item
   */
  public withNotes(notes: string): Item {
    const newItem = new Item(this.id, this.title, this.todo, this.tags, notes, this.properties, this.priority);
    for (const child of this.children) {
      newItem.addChild(child);
    }
    return newItem;
  }

  /**
   * Zwraca nowy Item z usuniętą właściwością. Immutable.
   *
   * @param key - Klucz właściwości do usunięcia
   * @returns Nowy Item
   */
  public removeProperty(key: string): Item {
    const newProperties = new Map(this.properties);
    newProperties.delete(key);
    const newItem = new Item(this.id, this.title, this.todo, this.tags, this.notes, newProperties, this.priority);
    for (const child of this.children) {
      newItem.addChild(child);
    }
    return newItem;
  }

  /**
   * Zwraca nowy Item z zaktualizowaną właściwością.
   * Immutable — nie modyfikuje bieżący obiekt.
   *
   * @param key - Klucz właściwości
   * @param value - Wartość właściwości
   * @returns Nowy Item z zaktualizowaną właściwością
   */
  public setProperty(key: string, value: string): Item {
    const newProperties = new Map(this.properties);
    newProperties.set(key, value);
    const newItem = new Item(
      this.id,
      this.title,
      this.todo,
      this.tags,
      this.notes,
      newProperties,
      this.priority,
    );
    for (const child of this.children) {
      newItem.addChild(child);
    }
    return newItem;
  }

  /**
   * Tworzy głęboką kopię tego Item wraz ze wszystkimi dziećmi.
   *
   * @returns Nowy Item będący kopią bieżącego
   */
  public clone(): Item {
    const clonedItem = new Item(
      this.id,
      this.title,
      this.todo,
      this.tags,
      this.notes,
      this.properties,
      this.priority,
    );
    for (const child of this.children) {
      clonedItem.addChild(child.clone());
    }
    return clonedItem;
  }
}
