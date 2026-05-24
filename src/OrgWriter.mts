import { writeFileSync } from 'node:fs';
import type { Tree, Item as ItemInterface } from './types.mjs';

/**
 * OrgWriter — serializuje strukturę Tree do formatu org-mode.
 * Zapisuje dzieci roota bezpośrednio jako headlines poziomu 1.
 * Bez ghost-wrapperów sekcji — root jest czysto logicznym kontenerem,
 * a kategoryzacja (Inbox/Rejected itd.) jest sprawą warstwy prezentacji
 * (TUI), nie formatu pliku.
 */
export default class OrgWriter {
  /**
   * Zapisuje Tree do pliku .org w formacie org-mode.
   *
   * @param tree - Struktura Tree do zapisania
   * @param filePath - Ścieżka do pliku .org
   */
  public write(tree: Tree, filePath: string): void {
    const content = this.serializeTree(tree);
    writeFileSync(filePath, content, 'utf-8');
  }

  /**
   * Serializuje całe Tree do stringa w formacie org-mode.
   * Każde dziecko roota staje się headline poziomu 1; rekurencyjnie
   * dzieci dostają kolejne poziomy.
   *
   * @param tree - Struktura Tree
   * @returns String zawierający treść pliku .org
   */
  private serializeTree(tree: Tree): string {
    const parts: string[] = [];
    for (const child of tree.root.getChildren()) {
      parts.push(this.serializeItem(child, 1));
    }
    if (parts.length === 0) {
      return '';
    }
    return parts.join('\n') + '\n';
  }

  /**
   * Serializuje pojedynczy Item i jego dzieci na format org-mode headlines.
   * Zapisuje: level, TODO state, title, tagi, properties drawer, notatki.
   *
   * @param item - Item do serializacji
   * @param level - Poziom headlines (liczba asterisków)
   * @returns String zawierający headlines tego itema i jego dzieci
   */
  private serializeItem(item: ItemInterface, level: number): string {
    const parts: string[] = [];
    const indent = '*'.repeat(level);

    // Nagłówek: nivel, TODO, title, tags
    const titleLine = this.buildHeadlineLine(indent, item);
    parts.push(titleLine);

    // Properties drawer (jeśli są properties)
    const propertiesStr = this.serializeProperties(item);
    if (propertiesStr.length > 0) {
      parts.push(propertiesStr);
    }

    // Notatki
    const notes = item.getNotes();
    if (notes.length > 0) {
      parts.push(notes);
    }

    // Dzieci
    const children = item.getChildren();
    for (const child of children) {
      parts.push(this.serializeItem(child, level + 1));
    }

    return parts.join('\n');
  }

  /**
   * Buduje linię headline (nagłówek) z poziomem, TODO state, title i tagami.
   *
   * @param indent - String z asteriskami (poziom)
   * @param item - Item do serializacji
   * @returns Sformatowana linia headline
   */
  private buildHeadlineLine(indent: string, item: ItemInterface): string {
    let line = indent + ' ';

    // Dodaj TODO state
    const todo = item.getTodo();
    if (todo !== 'TODO') {
      line += `${todo} `;
    }

    // Dodaj priority cookie [#A]/[#B]/[#C]
    const priority = item.getPriority();
    if (priority) {
      line += `[#${priority}] `;
    }

    // Dodaj title
    line += item.getTitle();

    // Dodaj tagi
    const tags = item.getTags();
    if (tags.length > 0) {
      line += ' :' + tags.join(':') + ':';
    }

    return line;
  }

  /**
   * Serializuje properties Item do properties drawer w formacie org-mode.
   * Format:
   *   :PROPERTIES:
   *   :KEY1: value1
   *   :KEY2: value2
   *   :END:
   *
   * @param item - Item do serializacji
   * @returns String z properties drawer, lub pusty string jeśli brak properties
   */
  private serializeProperties(item: ItemInterface): string {
    const properties = item.getProperties();
    if (properties.size === 0) {
      return '';
    }

    const lines: string[] = [];
    lines.push(':PROPERTIES:');

    for (const [key, value] of properties) {
      lines.push(`:${key}: ${value}`);
    }

    lines.push(':END:');
    return lines.join('\n');
  }
}
