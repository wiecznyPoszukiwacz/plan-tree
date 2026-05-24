import { readFileSync } from 'node:fs';
import type { Tree, Headline, TodoState } from './types.mjs';
import Item from './Item.mjs';
import TreeOperations from './TreeOperations.mjs';

/**
 * OrgReader — parser plików org-mode do struktury Tree
 * Obsługuje hierarchę headlines, TODO state, tagi, properties drawers i notatki.
 */
export default class OrgReader {
  /**
   * Czyta plik .org i konwertuje go do struktury Tree.
   *
   * @param filePath - Ścieżka do pliku .org
   * @returns Tree z korzeniem i mapą itemsById
   * @throws Error jeśli plik nie istnieje lub parsowanie zawiedzie
   */
  public read(filePath: string): Tree {
    const content = readFileSync(filePath, 'utf-8');
    const headlines = this.parseHeadlines(content);
    // Reseed countera ID na max+1 spośród istniejących :ID: typu n<N>
    // PRZED buildTree — żeby generowane ID dla węzłów bez :ID: nie
    // kolidowały z tymi już zapisanymi w pliku.
    this.seedCounterFromHeadlines(headlines);
    return this.buildTree(headlines);
  }

  /**
   * Skanuje rekurencyjnie wszystkie headlines, znajduje max numer w ID
   * typu `n<N>` zapisanych w properties i seeduje counter w TreeOperations.
   *
   * @param headlines - Drzewo headlines z parseHeadlines
   */
  private seedCounterFromHeadlines(headlines: Headline[]): void {
    let max = 0;
    const walk = (list: Headline[]): void => {
      for (const h of list) {
        const id = h.properties.get('ID');
        if (id) {
          const m = id.match(/^n(\d+)$/);
          if (m) {
            const n = parseInt(m[1], 10);
            if (n > max) max = n;
          }
        }
        walk(h.children);
      }
    };
    walk(headlines);
    TreeOperations.setIdCounter(max);
  }

  /**
   * Parsuje zawartość pliku .org na tablicę Headlines.
   * Tokenizuje linie na podstawie poziomów asterisków (* = level 1, ** = level 2, itd).
   *
   * @param content - Zawartość pliku .org
   * @returns Tablica Headlines z hierarchią
   */
  private parseHeadlines(content: string): Headline[] {
    const lines = content.split('\n');
    const headlines: Headline[] = [];
    const stack: Headline[] = []; // Stos dla zachowania hierarchii

    let currentLineIndex = 0;

    while (currentLineIndex < lines.length) {
      const line = lines[currentLineIndex];

      // Sprawdzamy, czy linia to headline (zaczyna się od *)
      // Format nagłówka: * [TODO] [[#A]] title [:tag1:tag2:]
      // Grupa 1: gwiazdki (poziom)
      // Grupa 2: opcjonalny TODO state
      // Grupa 3: opcjonalne priority cookie [#A]/[#B]/[#C]
      // Grupa 4: tytuł (non-greedy)
      // Grupa 5: opcjonalne tagi :tag:tag:
      const headlineMatch = line.match(/^(\*+)\s+(?:(TODO|PROPOSAL|QUESTION|WORK-UNIT|DROPPED|DONE)\s+)?(?:\[#([ABC])\]\s+)?(.+?)(?:\s+(:(?:[^:\s]+:)+))?$/);

      if (headlineMatch) {
        const level = headlineMatch[1].length;
        const todo = (headlineMatch[2] as TodoState | undefined) || null;
        const priority = (headlineMatch[3] as 'A' | 'B' | 'C' | undefined) ?? null;
        const title = headlineMatch[4];
        const tagsStr = headlineMatch[5] || '';

        // Parsuj tagi
        const tags = tagsStr
          .slice(1, -1) // Usuń otaczające ':'
          .split(':')
          .filter((tag) => tag.length > 0);

        // Pobierz properties drawer i notatki
        const { properties, notes, nextLineIndex } = this.parseContentBlock(lines, currentLineIndex + 1);

        const headline: Headline = {
          level,
          title,
          todo,
          tags,
          content: notes,
          properties,
          priority,
          children: [],
        };

        // Umieść headline w odpowiedniej pozycji hierarchii
        // Usuwamy ze stosu wszystkie headliny o poziomie >= level
        while (stack.length > 0 && stack[stack.length - 1].level >= level) {
          stack.pop();
        }

        if (stack.length === 0) {
          // Root level
          headlines.push(headline);
        } else {
          // Dodaj jako dziecko poprzedniej headliny na wyższym poziomie
          stack[stack.length - 1].children.push(headline);
        }

        stack.push(headline);
        currentLineIndex = nextLineIndex;
      } else {
        currentLineIndex++;
      }
    }

    return headlines;
  }

  /**
   * Parsuje zawartość bloku pomiędzy headlines:
   * - Properties drawer (: PROPERTIES : ... : END :)
   * - Notatki (pozostały tekst)
   *
   * @param lines - Tablice linii pliku
   * @param startIndex - Indeks linii od której zacząć parsowanie
   * @returns Obiekt z properties, notes i nextLineIndex
   */
  private parseContentBlock(lines: string[], startIndex: number): { properties: Map<string, string>; notes: string; nextLineIndex: number } {
    const properties = new Map<string, string>();
    const noteLines: string[] = [];
    let inProperties = false;
    let i = startIndex;

    while (i < lines.length) {
      const line = lines[i];

      // Sprawdzamy start properties drawera
      if (line.match(/^\s*:PROPERTIES:\s*$/)) {
        inProperties = true;
        i++;
        continue;
      }

      // Sprawdzamy koniec properties drawera
      if (inProperties && line.match(/^\s*:END:\s*$/)) {
        inProperties = false;
        i++;
        continue;
      }

      // Jeśli jesteśmy w properties, parsuj property
      if (inProperties) {
        const propMatch = line.match(/^\s*:([^:]+):\s*(.*)$/);
        if (propMatch) {
          properties.set(propMatch[1], propMatch[2]);
        }
        i++;
        continue;
      }

      // Jeśli linia to nowy headline, stop
      if (line.match(/^\*+ /)) {
        break;
      }

      // Zbierz notatki
      if (line.trim().length > 0) {
        noteLines.push(line);
      }

      i++;
    }

    const notes = noteLines.join('\n').trim();
    return { properties, notes, nextLineIndex: i };
  }

  /**
   * Buduje strukturę Tree z tablicy Headlines.
   * Tworzy hierarchię Item nodes i globalną mapę itemsById.
   *
   * @param headlines - Tablica Headlines
   * @returns Tree z korzeniem i mapą itemsById
   */
  private buildTree(headlines: Headline[]): Tree {
    const itemsById = new Map<string, Item>();

    // Funkcja do rekurencyjnego budowania Items z Headlines
    const buildItemsFromHeadlines = (headlineList: Headline[]): Item[] => {
      return headlineList.map((headline) => {
        // Stabilny ID: bierzemy z :ID: w properties drawer, jeśli istnieje.
        // Gdy brak — generujemy nowy i wstrzykujemy do properties tak, by
        // następny zapis go zapersystował (round-trip stability).
        const properties = headline.properties;
        let id = properties.get('ID');
        if (!id) {
          id = OrgReader.generateId();
          properties.set('ID', id);
        }
        const item = new Item(
          id,
          headline.title,
          headline.todo || 'TODO',
          headline.tags,
          headline.content,
          properties,
          headline.priority,
        );

        itemsById.set(id, item);

        // Rekurencyjnie przetwórz dzieci
        const childItems = buildItemsFromHeadlines(headline.children);
        for (const childItem of childItems) {
          item.addChild(childItem);
        }

        return item;
      });
    };

    // Buduj root item
    const rootId = `root`;
    const root = new Item(
      rootId,
      'Plan Root',
      'TODO',
      [],
      '',
      new Map(),
    );
    itemsById.set(rootId, root);

    // Dodaj wszystkie headlines na top level jako dzieci roota
    const topLevelItems = buildItemsFromHeadlines(headlines);
    for (const item of topLevelItems) {
      root.addChild(item);
    }

    return { root, itemsById };
  }

  /**
   * Generuje stabilny ID dla wpisu, który nie ma jeszcze własnego :ID:
   * w properties drawer. Deleguje do TreeOperations.generateId — format
   * `n<N>` (krótki, sekwencyjny, reseedowany na max+1 przy starcie).
   *
   * @returns Nowy ID
   */
  private static generateId(): string {
    return TreeOperations.generateId();
  }
}
