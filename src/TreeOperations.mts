import type { Tree, OperationResult } from './types.mjs';
import ItemClass from './Item.mjs';

/**
 * TreeOperations — funkcje do manipulacji strukturą drzewa planu.
 * Wszystkie operacje implementują immutable pattern — zwracają nowe drzewo,
 * nigdy nie modyfikują istniejącego.
 *
 * Uwaga: Prace wewnętrzne używają `any` z powodu niezgodności między interfejsem Item
 * a klasą Item w TypeScript. Funkcje publiczne zachowują silne typowanie.
 */
export default class TreeOperations {
  /**
   * Dzieli wpis na dwa: rozdziela od podanej pozycji.
   * Wszystko od position w dół staje się nowym wpisem.
   *
   * @param tree - Drzewo do modyfikacji
   * @param itemId - ID wpisu do podzielenia
   * @param position - Pozycja w tytule gdzie podzielić (0-based)
   * @returns OperationResult z nowym drzewem lub błędem
   */
  public static split(tree: Tree, itemId: string, position: number): OperationResult {
    const item = tree.itemsById.get(itemId) as any;
    if (!item) {
      return {
        success: false,
        message: `Item ${itemId} not found`,
      };
    }

    if (position < 0 || position > item.getTitle().length) {
      return {
        success: false,
        message: `Invalid position ${position} for item title of length ${item.getTitle().length}`,
      };
    }

    // Split mutates the original node's title; anchored descendants stay intact
    // under part1, so an upward check suffices.
    const splitAnchor = this.findAnchorAtOrAbove(tree, itemId);
    if (splitAnchor) {
      return this.anchorBlocked(splitAnchor, `split ${itemId}`);
    }

    const title = item.getTitle();
    const part1 = title.substring(0, position);
    const part2 = title.substring(position);

    const parentId = this.findParentId(tree, itemId);
    if (!parentId && itemId !== tree.root.getId()) {
      return {
        success: false,
        message: `Cannot split root item`,
      };
    }

    // Klonujemy drzewo
    const newRoot = tree.root.clone();

    // Modyfikujemy oryginalny wpis (zachowujemy dzieci)
    const modifiedItem = new ItemClass(
      itemId,
      part1,
      item.getTodo(),
      item.getTags(),
      '',
      item.getProperties(),
    ) as any;
    for (const child of (item as any).getChildren()) {
      modifiedItem.addChild((child.clone() as any) as ItemClass);
    }

    // Zamieniamy item na modifiedItem w tree
    let updatedRoot = this.replaceItemInTree(newRoot, itemId, modifiedItem);
    if (!updatedRoot) {
      return {
        success: false,
        message: `Failed to update tree structure`,
      };
    }

    // Tworzymy nowy wpis z drugą częścią tytułu (bez dzieci — przepadają do part1).
    // ID musi trafić do properties (jako :ID:), żeby przeżył write→read round-trip.
    // Nie kopiujemy properties z oryginału — :ID: by się sklonował i kolidował.
    const newId = this.generateId();
    const newProperties = new Map<string, string>(item.getProperties() as Map<string, string>);
    newProperties.set('ID', newId);
    const newItem = (new ItemClass(
      newId,
      part2,
      item.getTodo(),
      item.getTags(),
      item.getNotes(),
      newProperties,
    )) as any;

    // Dodajemy nowy wpis jako sibling (do tego samego rodzica)
    const parentItem = (parentId ? this.findItemInTree(updatedRoot, parentId) : updatedRoot) as any;
    if (parentItem) {
      parentItem.addChild(newItem as any);
    }

    const finalItemsById = this.rebuildItemsById(updatedRoot);
    const finalTree: Tree = {
      root: updatedRoot,
      itemsById: finalItemsById,
    };

    return {
      success: true,
      message: `Split item ${itemId} at position ${position}`,
      newTree: finalTree,
      diff: `Split: "${part1}" + "${part2}"`,
    };
  }

  /**
   * Scala dwa wpisy: zawartość drugiego trafia do pierwszego, drugi jest usuwany.
   *
   * @param tree - Drzewo do modyfikacji
   * @param itemId1 - ID pierwszego wpisu (ten zostanie)
   * @param itemId2 - ID drugiego wpisu (ten będzie usunięty)
   * @returns OperationResult z nowym drzewem lub błędem
   */
  public static merge(tree: Tree, itemId1: string, itemId2: string): OperationResult {
    const item1 = tree.itemsById.get(itemId1) as any;
    const item2 = tree.itemsById.get(itemId2) as any;

    if (!item1 || !item2) {
      return {
        success: false,
        message: `One or both items not found: ${itemId1}, ${itemId2}`,
      };
    }

    // Sprawdzamy, czy są sąsiadami (obaj mają tego samego rodzica)
    const parent1Id = this.findParentId(tree, itemId1);
    const parent2Id = this.findParentId(tree, itemId2);

    if (parent1Id !== parent2Id) {
      return {
        success: false,
        message: `Items are not siblings (different parents)`,
      };
    }

    // Merge destroys item2 and relocates its children into item1; block when
    // either item (self/ancestor/descendant) is anchored.
    const mergeAnchor =
      this.findAnchorAtOrBelow(tree, itemId1) ?? this.findAnchorAtOrAbove(tree, itemId1) ??
      this.findAnchorAtOrBelow(tree, itemId2) ?? this.findAnchorAtOrAbove(tree, itemId2);
    if (mergeAnchor) {
      return this.anchorBlocked(mergeAnchor, `merge ${itemId1}/${itemId2}`);
    }

    const newRoot = tree.root.clone();

    // Scala tytuły bez separatora (zgodnie z docstring/MCP tool description).
    // Scala notes: jeśli oba puste — zostaw puste; jeśli jeden pusty — bierz drugi;
    // jeśli oba mają treść — łącz newline-em.
    const mergedTitle = item1.getTitle() + item2.getTitle();
    const mergedNotes = [item1.getNotes(), item2.getNotes()]
      .filter((n: string) => n.length > 0)
      .join('\n');
    const mergedItem = (new ItemClass(
      itemId1,
      mergedTitle,
      item1.getTodo(),
      [...new Set([...item1.getTags(), ...item2.getTags()])], // Unika duplikatów
      mergedNotes,
      new Map([...item1.getProperties(), ...item2.getProperties()]),
    )) as any;

    // Dodajemy dzieci z obu itemów
    for (const child of (item1 as any).getChildren()) {
      mergedItem.addChild((child.clone() as any) as ItemClass);
    }
    for (const child of (item2 as any).getChildren()) {
      mergedItem.addChild((child.clone() as any) as ItemClass);
    }

    // Zamieniamy item1 na merged
    const afterMerge = this.replaceItemInTree(newRoot, itemId1, mergedItem);
    if (!afterMerge) {
      return {
        success: false,
        message: `Failed to merge items`,
      };
    }

    // Usuwamy item2 z rodzica
    const finalRoot = this.removeItemFromTree(afterMerge, itemId2);
    if (!finalRoot) {
      return {
        success: false,
        message: `Failed to remove second item`,
      };
    }

    const finalItemsById = this.rebuildItemsById(finalRoot);
    const finalTree: Tree = {
      root: finalRoot,
      itemsById: finalItemsById,
    };

    return {
      success: true,
      message: `Merged items ${itemId1} and ${itemId2}`,
      newTree: finalTree,
      diff: `Merge: "${item1.getTitle()}" + "${item2.getTitle()}"`,
    };
  }

  /**
   * Wyodrębnia wpis — jego dzieci stają się jego rodzeństwem (przesuwają się na poziom wyżej).
   *
   * @param tree - Drzewo do modyfikacji
   * @param itemId - ID wpisu do wyodrębnienia
   * @returns OperationResult z nowym drzewem lub błędem
   */
  public static extract(tree: Tree, itemId: string): OperationResult {
    const item = tree.itemsById.get(itemId) as any;
    if (!item) {
      return {
        success: false,
        message: `Item ${itemId} not found`,
      };
    }

    if (itemId === tree.root.getId()) {
      return {
        success: false,
        message: `Cannot extract root item`,
      };
    }

    // Extract destroys the node and promotes its children; block when the node,
    // an ancestor, or a descendant is anchored.
    const extractAnchor = this.findAnchorAtOrBelow(tree, itemId) ?? this.findAnchorAtOrAbove(tree, itemId);
    if (extractAnchor) {
      return this.anchorBlocked(extractAnchor, `extract ${itemId}`);
    }

    const parentId = this.findParentId(tree, itemId);

    const newRoot = tree.root.clone();
    const newItemsById = this.rebuildItemsById(newRoot);

    // Znajdujemy rodzica
    const parent = (parentId ? newItemsById.get(parentId) : newRoot) as any;
    if (!parent) {
      return {
        success: false,
        message: `Parent not found`,
      };
    }

    // Usuwamy item z rodzica
    parent.removeChild(itemId);

    // Dodajemy dzieci item'u do rodzica
    for (const child of (item as ItemClass).getChildren()) {
      parent.addChild((child.clone() as any) as ItemClass);
    }

    const finalItemsById = this.rebuildItemsById(newRoot);
    const finalTree: Tree = {
      root: newRoot,
      itemsById: finalItemsById,
    };

    return {
      success: true,
      message: `Extracted item ${itemId}`,
      newTree: finalTree,
      diff: `Extract: "${item.getTitle()}" children promoted`,
    };
  }

  /**
   * Wchłania wpis — jego dzieci trafiają do niego, a sam wpis zostaje wchłonięty przez rodzica.
   *
   * @param tree - Drzewo do modyfikacji
   * @param itemId - ID wpisu do wchłonięcia
   * @returns OperationResult z nowym drzewem lub błędem
   */
  public static absorb(tree: Tree, itemId: string): OperationResult {
    const item = tree.itemsById.get(itemId) as any;
    if (!item) {
      return {
        success: false,
        message: `Item ${itemId} not found`,
      };
    }

    if (itemId === tree.root.getId()) {
      return {
        success: false,
        message: `Cannot absorb root item`,
      };
    }

    // Absorb destroys the node, merges its content into the parent and relocates
    // its children; block when the node, an ancestor, or a descendant is anchored.
    const absorbAnchor = this.findAnchorAtOrBelow(tree, itemId) ?? this.findAnchorAtOrAbove(tree, itemId);
    if (absorbAnchor) {
      return this.anchorBlocked(absorbAnchor, `absorb ${itemId}`);
    }

    const parentId = this.findParentId(tree, itemId);
    if (!parentId) {
      return {
        success: false,
        message: `Parent not found`,
      };
    }

    const newRoot = tree.root.clone();
    const newItemsById = this.rebuildItemsById(newRoot);

    const parent = newItemsById.get(parentId) as any;
    if (!parent) {
      return {
        success: false,
        message: `Parent not found in rebuilt tree`,
      };
    }

    // Tworzymy nowy parent z zawartością item'u dodaną do notek
    const newParent = (new ItemClass(
      parentId,
      parent.getTitle(),
      parent.getTodo(),
      parent.getTags(),
      parent.getNotes() + '\n' + item.getTitle() + '\n' + item.getNotes(),
      parent.getProperties(),
    )) as any;

    // Dodajemy wszystkie dzieci parent'a z wyjątkiem absorbuowanego item'u
    for (const child of (parent as any).getChildren()) {
      if (child.getId() !== itemId) {
        newParent.addChild((child.clone() as any) as ItemClass);
      } else {
        // Zamiast item'u dodajemy jego dzieci
        for (const grandchild of child.clone().getChildren()) {
          newParent.addChild((grandchild.clone() as any) as ItemClass);
        }
      }
    }

    const updatedRoot = this.replaceItemInTree(newRoot, parentId, newParent);
    if (!updatedRoot) {
      return {
        success: false,
        message: `Failed to update parent`,
      };
    }

    const finalItemsById = this.rebuildItemsById(updatedRoot);
    const finalTree: Tree = {
      root: updatedRoot,
      itemsById: finalItemsById,
    };

    return {
      success: true,
      message: `Absorbed item ${itemId} into parent`,
      newTree: finalTree,
      diff: `Absorb: "${item.getTitle()}" merged into parent`,
    };
  }

  /**
   * Przenosi wpis do nowego rodzica.
   *
   * @param tree - Drzewo do modyfikacji
   * @param itemId - ID wpisu do przeniesienia
   * @param targetParentId - ID nowego rodzica
   * @returns OperationResult z nowym drzewem lub błędem
   */
  public static move(tree: Tree, itemId: string, targetParentId: string): OperationResult {
    const item = tree.itemsById.get(itemId) as any;
    const targetParent = tree.itemsById.get(targetParentId) as ItemClass | undefined;

    if (!item) {
      return {
        success: false,
        message: `Item ${itemId} not found`,
      };
    }

    if (!targetParent) {
      return {
        success: false,
        message: `Target parent ${targetParentId} not found`,
      };
    }

    // Sprawdzamy cykl: czy itemId jest przodkiem targetParentId?
    if (this.isAncestor(tree, itemId, targetParentId)) {
      return {
        success: false,
        message: `Cannot move item to its own descendant (would create cycle)`,
      };
    }

    // Block moving an anchored/within-anchored node (self/ancestor/descendant),
    // and block moving anything INTO an anchored subtree (target chain).
    const moveAnchor = this.findAnchorAtOrBelow(tree, itemId) ?? this.findAnchorAtOrAbove(tree, itemId);
    if (moveAnchor) {
      return this.anchorBlocked(moveAnchor, `move ${itemId}`);
    }
    const targetAnchor = this.findAnchorAtOrAbove(tree, targetParentId);
    if (targetAnchor) {
      return this.anchorBlocked(targetAnchor, `move ${itemId} into ${targetParentId}`);
    }

    const newRoot = tree.root.clone();
    const newItemsById = this.rebuildItemsById(newRoot);

    // Usuwamy item ze starego rodzica
    const oldParentId = this.findParentId(tree, itemId);
    if (oldParentId) {
      const oldParent = newItemsById.get(oldParentId);
      if (oldParent) {
        oldParent.removeChild(itemId);
      }
    }

    // Dodajemy do nowego rodzica
    const newTargetParent = newItemsById.get(targetParentId) as any;
    if (newTargetParent) {
      newTargetParent.addChild(((item as any).clone() as any) as ItemClass);
    }

    const finalItemsById = this.rebuildItemsById(newRoot);
    const finalTree: Tree = {
      root: newRoot,
      itemsById: finalItemsById,
    };

    return {
      success: true,
      message: `Moved item ${itemId} to parent ${targetParentId}`,
      newTree: finalTree,
      diff: `Move: "${item.getTitle()}" to new parent`,
    };
  }

  // ============ Mutacje zawartości węzła ============

  /**
   * Zmienia stan TODO istniejącego węzła. Zachowuje ID, tytuł, dzieci, notes.
   *
   * @param tree - Drzewo
   * @param itemId - ID węzła
   * @param todo - Nowy stan
   * @returns OperationResult
   */
  public static setTodo(tree: Tree, itemId: string, todo: string): OperationResult {
    const validTodos = ['TODO', 'PROPOSAL', 'QUESTION', 'WORK-UNIT', 'DROPPED', 'DONE'];
    if (!validTodos.includes(todo)) {
      return { success: false, message: `Invalid todo state: ${todo}. Allowed: ${validTodos.join(', ')}` };
    }
    return this.mutateItem(tree, itemId, (item) => item.setTodo(todo as any), `setTodo: ${itemId} → ${todo}`);
  }

  /**
   * Zmienia tytuł istniejącego węzła.
   *
   * @param tree - Drzewo
   * @param itemId - ID węzła
   * @param title - Nowy tytuł
   * @returns OperationResult
   */
  public static rename(tree: Tree, itemId: string, title: string): OperationResult {
    if (title.length === 0) {
      return { success: false, message: `Title must not be empty` };
    }
    return this.mutateItem(tree, itemId, (item) => item.withTitle(title), `rename: ${itemId} → "${title}"`);
  }

  /**
   * Ustawia notes (zastępuje, nie dokleja).
   *
   * @param tree - Drzewo
   * @param itemId - ID węzła
   * @param notes - Nowa treść notes (może być pusta)
   * @returns OperationResult
   */
  public static setNotes(tree: Tree, itemId: string, notes: string): OperationResult {
    return this.mutateItem(tree, itemId, (item) => item.withNotes(notes), `setNotes: ${itemId} (${notes.length} chars)`);
  }

  /**
   * Dodaje tag (no-op jeśli już jest).
   *
   * @param tree - Drzewo
   * @param itemId - ID węzła
   * @param tag - Tag do dodania
   * @returns OperationResult
   */
  public static addTag(tree: Tree, itemId: string, tag: string): OperationResult {
    if (tag.length === 0 || /[\s:]/.test(tag)) {
      return { success: false, message: `Invalid tag "${tag}" — must be non-empty and contain no whitespace or ':'` };
    }
    return this.mutateItem(tree, itemId, (item) => item.addTag(tag), `addTag: ${itemId} +${tag}`);
  }

  /**
   * Usuwa tag (no-op jeśli nie było).
   */
  public static removeTag(tree: Tree, itemId: string, tag: string): OperationResult {
    return this.mutateItem(tree, itemId, (item) => item.removeTag(tag), `removeTag: ${itemId} -${tag}`);
  }

  /**
   * Ustawia priority cookie [#A]/[#B]/[#C]. Pusty string lub null = wyczyść.
   *
   * @param tree - Drzewo
   * @param itemId - ID węzła
   * @param priority - 'A'/'B'/'C' albo ''/null
   * @returns OperationResult
   */
  public static setPriority(tree: Tree, itemId: string, priority: string | null): OperationResult {
    const p = (priority === '' || priority === null) ? null : (priority as 'A' | 'B' | 'C');
    if (p !== null && !['A', 'B', 'C'].includes(p)) {
      return { success: false, message: `Invalid priority "${priority}". Allowed: A, B, C, '' (clear)` };
    }
    return this.mutateItem(tree, itemId, (item) => item.withPriority(p), `setPriority: ${itemId} → ${p ?? 'none'}`);
  }

  /**
   * Ustawia property. Klucz ID jest chroniony — nie można nadpisać.
   */
  public static setProperty(tree: Tree, itemId: string, key: string, value: string): OperationResult {
    if (key === 'ID') {
      return { success: false, message: `Property "ID" is protected — use the auto-generated value` };
    }
    if (key === 'ANCHOR') {
      return { success: false, message: `Property "ANCHOR" is protected — use the "anchor" tool; unanchoring is user-only via the TUI (Shift+A)` };
    }
    if (key.length === 0 || /[\s:]/.test(key)) {
      return { success: false, message: `Invalid property key "${key}"` };
    }
    return this.mutateItem(tree, itemId, (item) => item.setProperty(key, value), `setProperty: ${itemId} ${key}=${value}`);
  }

  /**
   * Usuwa property (poza ID).
   */
  public static removeProperty(tree: Tree, itemId: string, key: string): OperationResult {
    if (key === 'ID') {
      return { success: false, message: `Property "ID" is protected and cannot be removed` };
    }
    if (key === 'ANCHOR') {
      return { success: false, message: `Property "ANCHOR" is protected — unanchoring is user-only via the TUI (Shift+A)` };
    }
    return this.mutateItem(tree, itemId, (item) => item.removeProperty(key), `removeProperty: ${itemId} -${key}`);
  }

  // ============ Anchor (kontrakt user/agent) ============

  /**
   * Kotwiczy węzeł — ustawia property :ANCHOR: t. Zakotwiczony węzeł i całe
   * jego poddrzewo są chronione przed mutacją (rename/setTodo/setNotes/move/
   * delete/extract/absorb/merge/reorder). Pomija guard, bo kotwiczenie tylko
   * zwiększa ochronę. Odkotwiczenie dostępne wyłącznie z TUI (brak tool MCP).
   *
   * @param tree - Drzewo
   * @param itemId - ID węzła do zakotwiczenia
   * @returns OperationResult
   */
  public static anchor(tree: Tree, itemId: string): OperationResult {
    return this.mutateItem(tree, itemId, (item) => item.setProperty('ANCHOR', 't'), `anchor: ${itemId}`, true);
  }

  /**
   * Odkotwicza węzeł — usuwa property :ANCHOR:. Pomija guard (to jedyna ścieżka
   * zdjęcia kotwicy). Wywoływane tylko z TUI (Shift+A) — agent nie ma tego tool.
   *
   * @param tree - Drzewo
   * @param itemId - ID węzła do odkotwiczenia
   * @returns OperationResult
   */
  public static unanchor(tree: Tree, itemId: string): OperationResult {
    return this.mutateItem(tree, itemId, (item) => item.removeProperty('ANCHOR'), `unanchor: ${itemId}`, true);
  }

  /**
   * Szuka zakotwiczonego węzła wśród itemId i jego przodków (w górę do korzenia).
   * Używane przez guard mutacji treści — modyfikacja czegokolwiek wewnątrz
   * zakotwiczonego poddrzewa jest zablokowana.
   *
   * @param tree - Drzewo
   * @param itemId - ID węzła startowego
   * @returns ID najbliższego zakotwiczonego węzła (self/przodek) lub null
   */
  private static findAnchorAtOrAbove(tree: Tree, itemId: string): string | null {
    let cursor: string | null = itemId;
    while (cursor) {
      const node = tree.itemsById.get(cursor) as any;
      if (node && node.getProperties().get('ANCHOR') === 't') return cursor;
      cursor = this.findParentId(tree, cursor);
    }
    return null;
  }

  /**
   * Szuka zakotwiczonego węzła wśród itemId i jego potomków (w dół poddrzewa).
   * Używane przez guard operacji niszczących/przenoszących — usunięcie lub
   * przeniesienie nieanchorowanego węzła nie może zniszczyć/relokować
   * zakotwiczonego potomka (żelazna kotwica całego poddrzewa).
   *
   * @param tree - Drzewo
   * @param itemId - ID węzła startowego
   * @returns ID pierwszego znalezionego zakotwiczonego węzła (self/potomek) lub null
   */
  private static findAnchorAtOrBelow(tree: Tree, itemId: string): string | null {
    const item = tree.itemsById.get(itemId) as any;
    if (!item) return null;
    const stack: any[] = [item];
    while (stack.length > 0) {
      const node = stack.pop();
      if (node.getProperties().get('ANCHOR') === 't') return node.getId();
      for (const child of node.getChildren()) stack.push(child);
    }
    return null;
  }

  /**
   * Buduje OperationResult odrzucający operację z powodu kotwicy.
   *
   * @param anchorId - ID zakotwiczonego węzła, który zablokował operację
   * @param attempted - Opis próbowanej operacji (np. "delete n5")
   * @returns OperationResult z success:false i czytelnym komunikatem
   */
  private static anchorBlocked(anchorId: string, attempted: string): OperationResult {
    return {
      success: false,
      message: `Item ${anchorId} is anchored (user-locked); cannot ${attempted}. Ask the user to unanchor it via the TUI (Shift+A) — never attempt to unanchor silently.`,
    };
  }

  // ============ Wspólny szkielet mutacji single-item ============

  /**
   * Wspólna baza dla setTodo/rename/setNotes/tagi/properties — clone drzewa,
   * znajdź item, zastosuj transformację, podmień, zbuduj nowe Tree.
   *
   * @param tree - Drzewo wejściowe
   * @param itemId - ID modyfikowanego węzła
   * @param transform - Funkcja (item) → nowy item (immutable)
   * @param diff - Tekst do pola diff w OperationResult
   * @returns OperationResult
   */
  private static mutateItem(
    tree: Tree,
    itemId: string,
    transform: (item: any) => any,
    diff: string,
    skipAnchorGuard: boolean = false,
  ): OperationResult {
    const original = tree.itemsById.get(itemId) as any;
    if (!original) {
      return { success: false, message: `Item ${itemId} not found` };
    }
    if (itemId === tree.root.getId()) {
      return { success: false, message: `Cannot mutate root item` };
    }
    // Content mutation: blocked when the node itself or any ancestor is anchored
    // (the anchored subtree is user-locked). The dedicated anchor()/unanchor()
    // pass skipAnchorGuard=true — they are the only sanctioned ANCHOR-key writers.
    if (!skipAnchorGuard) {
      const anchoredAt = this.findAnchorAtOrAbove(tree, itemId);
      if (anchoredAt) {
        return this.anchorBlocked(anchoredAt, `modify ${itemId}`);
      }
    }

    const newRoot = tree.root.clone();
    const target = this.findItemInTree(newRoot, itemId);
    if (!target) {
      return { success: false, message: `Failed to locate ${itemId} in cloned tree` };
    }
    const replacement = transform(target);
    // Zachowaj dzieci — withTitle/setTodo/etc na klonie nie kopiują children z `target`
    // bo używają this.children. Wszystko OK — Item.with* iterują po this.children.

    const updatedRoot = this.replaceItemInTree(newRoot, itemId, replacement);
    if (!updatedRoot) {
      return { success: false, message: `Failed to replace ${itemId} in tree` };
    }

    return {
      success: true,
      message: `Mutated item ${itemId}`,
      newTree: { root: updatedRoot, itemsById: this.rebuildItemsById(updatedRoot) },
      diff,
    };
  }

  // ============ Reorder ============

  /**
   * Przesuwa itemId przed sibling (oba muszą być dziećmi tego samego rodzica).
   */
  public static moveBefore(tree: Tree, itemId: string, siblingId: string): OperationResult {
    return this.reorderRelative(tree, itemId, siblingId, 'before');
  }

  /**
   * Przesuwa itemId za sibling (oba muszą być dziećmi tego samego rodzica).
   */
  public static moveAfter(tree: Tree, itemId: string, siblingId: string): OperationResult {
    return this.reorderRelative(tree, itemId, siblingId, 'after');
  }

  /**
   * Wspólna implementacja moveBefore/moveAfter. Wymaga, by oba węzły miały
   * tego samego rodzica (reorderowanie *między* rodzicami robi się przez move).
   */
  private static reorderRelative(
    tree: Tree,
    itemId: string,
    siblingId: string,
    position: 'before' | 'after',
  ): OperationResult {
    if (itemId === siblingId) {
      return { success: false, message: `Cannot move item relative to itself` };
    }
    const parentItemId = this.findParentId(tree, itemId);
    const parentSiblingId = this.findParentId(tree, siblingId);
    if (!parentItemId || !parentSiblingId) {
      return { success: false, message: `Item or sibling has no parent (root)` };
    }
    if (parentItemId !== parentSiblingId) {
      return { success: false, message: `Items are not siblings — use 'move' first to bring them under a common parent` };
    }

    // Reorder relocates the node among its siblings; block when the node, an
    // ancestor (the shared parent's subtree is locked), or a descendant is anchored.
    const reorderAnchor = this.findAnchorAtOrBelow(tree, itemId) ?? this.findAnchorAtOrAbove(tree, itemId);
    if (reorderAnchor) {
      return this.anchorBlocked(reorderAnchor, `reorder ${itemId}`);
    }

    const newRoot = tree.root.clone();
    const parent = this.findItemInTree(newRoot, parentItemId) as any;
    if (!parent) {
      return { success: false, message: `Parent not found in cloned tree` };
    }

    const children = parent.getChildren();
    const movedChild = children.find((c: any) => c.getId() === itemId);
    if (!movedChild) {
      return { success: false, message: `Failed to locate ${itemId} under its parent` };
    }
    // Wyciągnij i włóż na nową pozycję
    parent.removeChild(itemId);
    const remaining = parent.getChildren();
    const siblingIdx = remaining.findIndex((c: any) => c.getId() === siblingId);
    if (siblingIdx === -1) {
      return { success: false, message: `Sibling ${siblingId} not found after detach` };
    }
    const targetIdx = position === 'before' ? siblingIdx : siblingIdx + 1;

    // Item nie ma insertChild(at:) — implementuję ręcznie przez podmianę listy.
    // Klonujemy children, wstawiamy, podmieniamy parent metodą "rebuild".
    const newChildren: any[] = [];
    for (let i = 0; i < remaining.length; i++) {
      if (i === targetIdx) newChildren.push(movedChild);
      newChildren.push(remaining[i]);
    }
    if (targetIdx === remaining.length) newChildren.push(movedChild);
    // Item przechowuje children w private array; jedyne API: addChild/removeChild.
    // Najprościej: usuń wszystkie i dodaj w nowej kolejności.
    for (const c of remaining) parent.removeChild(c.getId());
    for (const c of newChildren) parent.addChild(c);

    const finalItemsById = this.rebuildItemsById(newRoot);
    return {
      success: true,
      message: `Moved ${itemId} ${position} ${siblingId}`,
      newTree: { root: newRoot, itemsById: finalItemsById },
      diff: `Move ${position}: ${itemId} → ${siblingId}`,
    };
  }

  // ============ Find ============

  /**
   * Znajduje węzły pasujące do filtrów. Wszystkie filtry łączone AND;
   * pominięty filtr nie ogranicza.
   *
   * @param tree - Drzewo
   * @param filters - titleContains (case-insensitive substring), todo, tag
   * @returns OperationResult z dodatkowym polem `matches` w diff (JSON)
   */
  public static find(
    tree: Tree,
    filters: {
      titleContains?: string;
      todo?: string;
      tag?: string;
      priority?: string;
      includeFrozen?: boolean;
    },
  ): OperationResult {
    const titleQ = filters.titleContains?.toLowerCase();
    const todoQ = filters.todo;
    const tagQ = filters.tag;
    const priorityQ = filters.priority;
    const includeFrozen = filters.includeFrozen ?? false;

    const matches: Array<{ id: string; title: string; todo: string; tags: string[]; depth: number; priority?: 'A' | 'B' | 'C'; anchored?: true }> = [];

    const walk = (node: any, depth: number): void => {
      if (depth > 0) {
        const isFrozen = node.getProperties().get('FROZEN') === 't';
        if (!includeFrozen && isFrozen) {
          // Cascade: frozen węzeł znaczy "ta cała gałąź jest na pauzie" —
          // pomijamy także potomków (nawet jeśli sami nie mają :FROZEN: t).
          // includeFrozen=true wyłącza tę kaskadę i pokazuje wszystko.
          return;
        } else {
          const titleOk = titleQ === undefined || node.getTitle().toLowerCase().includes(titleQ);
          const todoOk = todoQ === undefined || node.getTodo() === todoQ;
          const tagOk = tagQ === undefined || node.getTags().includes(tagQ);
          const prioOk = priorityQ === undefined || node.getPriority() === priorityQ;
          if (titleOk && todoOk && tagOk && prioOk) {
            const entry: { id: string; title: string; todo: string; tags: string[]; depth: number; priority?: 'A' | 'B' | 'C'; anchored?: true } = {
              id: node.getId(),
              title: node.getTitle(),
              todo: node.getTodo(),
              tags: node.getTags(),
              depth,
            };
            const p = node.getPriority();
            if (p) entry.priority = p;
            if (node.getProperties().get('ANCHOR') === 't') entry.anchored = true;
            matches.push(entry);
          }
        }
      }
      for (const child of node.getChildren()) walk(child, depth + 1);
    };
    walk(tree.root, 0);

    return {
      success: true,
      message: `Found ${matches.length} match${matches.length === 1 ? '' : 'es'}`,
      diff: JSON.stringify(matches),
    };
  }

  /**
   * Dodaje nowy wpis jako ostatnie dziecko wskazanego rodzica.
   * Tytuł i opcjonalny stan TODO są podawane przez wywołującego;
   * ID jest generowane i zapisywane do properties drawer jako :ID:,
   * żeby przetrwało round-trip zapis→odczyt.
   *
   * @param tree - Drzewo do modyfikacji
   * @param parentId - ID rodzica, pod którym powstanie nowy węzeł
   * @param title - Tytuł nowego węzła
   * @param todo - Stan TODO (opcjonalny, domyślnie 'TODO')
   * @returns OperationResult z nowym drzewem lub błędem
   */
  public static add(
    tree: Tree,
    parentId: string,
    title: string,
    todo?: string,
    notes?: string,
    tags?: string[],
  ): OperationResult {
    const parent = tree.itemsById.get(parentId) as any;
    if (!parent) {
      return {
        success: false,
        message: `Parent ${parentId} not found`,
      };
    }

    if (title.length === 0) {
      return {
        success: false,
        message: `Title must not be empty`,
      };
    }

    // Adding a child mutates the parent's subtree; block when the parent or any
    // of its ancestors is anchored.
    const addAnchor = this.findAnchorAtOrAbove(tree, parentId);
    if (addAnchor) {
      return this.anchorBlocked(addAnchor, `add a child under ${parentId}`);
    }

    const todoState = (todo ?? 'TODO') as any;
    const validTodos = ['TODO', 'PROPOSAL', 'QUESTION', 'WORK-UNIT', 'DROPPED', 'DONE'];
    if (!validTodos.includes(todoState)) {
      return {
        success: false,
        message: `Invalid todo state: ${todoState}. Allowed: ${validTodos.join(', ')}`,
      };
    }

    const newId = this.generateId();
    const properties = new Map<string, string>([['ID', newId]]);
    const safeTags = (tags ?? []).filter((t) => t.length > 0 && !/[\s:]/.test(t));
    const newItem = (new ItemClass(
      newId,
      title,
      todoState,
      safeTags,
      notes ?? '',
      properties,
    )) as any;

    const newRoot = tree.root.clone();
    const updatedParent = this.findItemInTree(newRoot, parentId);
    if (!updatedParent) {
      return {
        success: false,
        message: `Failed to locate parent in cloned tree`,
      };
    }
    updatedParent.addChild(newItem);

    const finalItemsById = this.rebuildItemsById(newRoot);
    const finalTree: Tree = {
      root: newRoot,
      itemsById: finalItemsById,
    };

    return {
      success: true,
      message: `Added item ${newId} under ${parentId}`,
      newTree: finalTree,
      diff: `Add: "${title}" [${todoState}] under ${parentId}`,
      affectedId: newId,
    };
  }

  /**
   * Usuwa wpis wraz z całym poddrzewem (wszystkie dzieci, wnuki itd.
   * znikają razem z nim). W odróżnieniu od extract/absorb dzieci nie
   * są promowane.
   *
   * @param tree - Drzewo do modyfikacji
   * @param itemId - ID wpisu do usunięcia
   * @returns OperationResult z nowym drzewem lub błędem
   */
  public static deleteItem(tree: Tree, itemId: string): OperationResult {
    const item = tree.itemsById.get(itemId) as any;
    if (!item) {
      return {
        success: false,
        message: `Item ${itemId} not found`,
      };
    }

    if (itemId === tree.root.getId()) {
      return {
        success: false,
        message: `Cannot delete root item`,
      };
    }

    // Delete cascades over the whole subtree; block when the node, an ancestor,
    // or any descendant is anchored — otherwise a non-anchored parent could
    // destroy an anchored child.
    const deleteAnchor = this.findAnchorAtOrBelow(tree, itemId) ?? this.findAnchorAtOrAbove(tree, itemId);
    if (deleteAnchor) {
      return this.anchorBlocked(deleteAnchor, `delete ${itemId}`);
    }

    const newRoot = tree.root.clone();
    const finalRoot = this.removeItemFromTree(newRoot, itemId);
    if (!finalRoot) {
      return {
        success: false,
        message: `Failed to remove item ${itemId}`,
      };
    }

    const removedCount = 1 + this.countDescendants(item);
    const finalItemsById = this.rebuildItemsById(finalRoot);
    const finalTree: Tree = {
      root: finalRoot,
      itemsById: finalItemsById,
    };

    const parentId = this.findParentId(tree, itemId);
    return {
      success: true,
      message: `Deleted item ${itemId}`,
      newTree: finalTree,
      diff: `Delete: "${item.getTitle()}" (${removedCount} item${removedCount === 1 ? '' : 's'} removed)`,
      affectedId: parentId ?? tree.root.getId(),
    };
  }

  // ============ Helpery prywatne ============

  /**
   * Liczy potomków danego węzła rekurencyjnie (bez samego węzła).
   *
   * @param node - Węzeł, którego potomków liczymy
   * @returns Liczba wszystkich potomków
   */
  private static countDescendants(node: any): number {
    let count = 0;
    for (const child of node.getChildren()) {
      count += 1 + this.countDescendants(child);
    }
    return count;
  }

  /**
   * Znajduje Item po ID w drzewie.
   *
   * @param root - Korzeń drzewa
   * @param itemId - ID szukanego item'u
   * @returns Item lub null
   */
  private static findItemInTree(root: any, itemId: string): any {
    if (root.getId() === itemId) {
      return root;
    }

    const stack: ItemClass[] = [root];
    while (stack.length > 0) {
      const current = stack.pop()!;
      for (const child of current.getChildren()) {
        if (child.getId() === itemId) {
          return child as ItemClass;
        }
        stack.push(child as ItemClass);
      }
    }

    return null;
  }

  /**
   * Znajduje ID rodzica danego wpisu.
   *
   * @param tree - Drzewo
   * @param itemId - ID wpisu szukanego
   * @returns ID rodzica lub null jeśli item to root
   */
  private static findParentId(tree: Tree, itemId: string): string | null {
    if (itemId === tree.root.getId()) {
      return null;
    }

    const stack: { item: typeof tree.root; parentId: string | null }[] = [
      { item: tree.root, parentId: null },
    ];

    while (stack.length > 0) {
      const current = stack.pop()!;
      for (const child of current.item.getChildren()) {
        if (child.getId() === itemId) {
          return current.item.getId();
        }
        stack.push({ item: child, parentId: current.item.getId() });
      }
    }

    return null;
  }

  /**
   * Sprawdza, czy sourceId jest przodkiem targetId (zapobiega cyklom).
   *
   * @param tree - Drzewo
   * @param sourceId - ID potencjalnego przodka
   * @param targetId - ID szukanego węzła
   * @returns true jeśli sourceId jest przodkiem targetId
   */
  private static isAncestor(tree: Tree, sourceId: string, targetId: string): boolean {
    const target = tree.itemsById.get(targetId) as any;
    if (!target) return false;

    const stack: typeof tree.root[] = [tree.root];
    const visited = new Set<string>();

    while (stack.length > 0) {
      const current = stack.pop()!;
      if (visited.has(current.getId())) continue;
      visited.add(current.getId());

      if (current.getId() === sourceId) {
        // Znaleźliśmy sourceId, teraz sprawdzamy czy targetId jest w jego poddrzewie
        return this.isDescendant(current, targetId);
      }

      for (const child of current.getChildren()) {
        stack.push(child);
      }
    }

    return false;
  }

  /**
   * Sprawdza, czy itemId jest potomkiem danego węzła.
   *
   * @param node - Węzeł do sprawdzenia
   * @param itemId - ID szukanego wpisu
   * @returns true jeśli itemId jest w poddrzewie node
   */
  private static isDescendant(node: any, itemId: string): boolean {
    for (const child of node.getChildren()) {
      if (child.getId() === itemId) {
        return true;
      }
      if (this.isDescendant(child, itemId)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Odbudowuje mapę itemsById z drzewa root.
   *
   * @param root - Korzeń drzewa
   * @returns Nowa mapa itemsById
   */
  private static rebuildItemsById(root: any): Map<string, any> {
    const itemsById = new Map<string, any>();
    const stack: any[] = [root];

    while (stack.length > 0) {
      const current = stack.pop()!;
      itemsById.set(current.getId(), current);
      for (const child of current.getChildren()) {
        stack.push(child as ItemClass);
      }
    }

    return itemsById;
  }

  /**
   * Zastępuje wpis w drzewie nowym wpisem (deep replacement).
   *
   * @param root - Korzeń drzewa
   * @param itemId - ID wpisu do zastąpienia
   * @param newItem - Nowy wpis
   * @returns Zaktualizowany root lub null jeśli nie znaleziono
   */
  private static replaceItemInTree(
    root: any,
    itemId: string,
    newItem: any,
  ): any {
    if (root.getId() === itemId) {
      return newItem;
    }

    const updated = new ItemClass(
      root.getId(),
      root.getTitle(),
      root.getTodo(),
      root.getTags(),
      root.getNotes(),
      root.getProperties(),
    );

    for (const child of root.getChildren()) {
      const replaced = this.replaceItemInTree(child as ItemClass, itemId, newItem);
      if (replaced) {
        updated.addChild(replaced);
      } else {
        updated.addChild((child as ItemClass).clone());
      }
    }

    return updated;
  }

  /**
   * Usuwa wpis z drzewa (wraz z całym poddrzewem).
   *
   * @param root - Korzeń drzewa
   * @param itemId - ID wpisu do usunięcia
   * @returns Zaktualizowany root lub null
   */
  private static removeItemFromTree(root: any, itemId: string): any {
    if (root.getId() === itemId) {
      return null;
    }

    const updated = new ItemClass(
      root.getId(),
      root.getTitle(),
      root.getTodo(),
      root.getTags(),
      root.getNotes(),
      root.getProperties(),
    );

    for (const child of root.getChildren()) {
      if (child.getId() !== itemId) {
        const result = this.removeItemFromTree(child as ItemClass, itemId);
        if (result) {
          updated.addChild(result);
        } else {
          updated.addChild((child as ItemClass).clone());
        }
      }
    }

    return updated;
  }

  /**
   * Wewnętrzny counter dla generowanych ID. Format `n<N>` — krótki,
   * sekwencyjny. OrgReader reseed-uje go na max+1 przy każdym wczytaniu
   * pliku (przez `seedIdCounter`), żeby uniknąć kolizji z ID już
   * obecnymi w drzewie.
   */
  private static idCounter = 0;

  /**
   * Generuje krótki sekwencyjny ID nowego wpisu w formacie `n<N>`.
   *
   * @returns Nowy ID
   */
  public static generateId(): string {
    this.idCounter += 1;
    return `n${this.idCounter}`;
  }

  /**
   * Reseed countera ID na max numer spośród ID typu `n<N>` w drzewie.
   * Następne `generateId()` zwróci `n<max+1>`.
   * Wywoływane przez OrgReader po wczytaniu pliku. Ignoruje stare długie
   * ID typu `item_<ts>_<rand>` — koegzystują, nie wpływają na counter.
   *
   * @param tree - Wczytane drzewo
   */
  public static seedIdCounter(tree: Tree): void {
    let max = 0;
    for (const id of tree.itemsById.keys()) {
      const m = id.match(/^n(\d+)$/);
      if (m) {
        const n = parseInt(m[1], 10);
        if (n > max) max = n;
      }
    }
    this.idCounter = max;
  }

  /**
   * Bezpośrednie ustawienie countera. Używane przez OrgReader, który
   * skanuje raw headlines (przed buildTree) i chce przekazać max.
   *
   * @param max - Najwyższy zaobserwowany numer; następne generateId zwróci n<max+1>
   */
  public static setIdCounter(max: number): void {
    this.idCounter = max;
  }
}
