/**
 * Logger — singleton z ring-buforem dla TUI.
 *
 * Powód: serwer MCP i aplikacja generują eventy (sesja podłączona, błąd
 * handle request, autosave error), które wcześniej szły na stderr i
 * rozjeżdżały render Ink/take4-console. Tutaj przechwytujemy je w
 * pamięci i pokazujemy w dedykowanym DebugPanel (toggleable).
 *
 * Buffor jest stały (RING_CAPACITY) — najstarsze wpisy są wyrzucane gdy
 * pojawia się nowy. Subskrybenci (DebugPanel) są wołani po każdym log,
 * żeby panel mógł się odświeżyć bez polling'u.
 */

/**
 * Poziom logowania — sterowanie kolorem w DebugPanel.
 */
export type LogLevel = 'info' | 'warn' | 'error';

/**
 * Pojedynczy wpis w ring-buforze.
 */
export interface LogEntry {
  timestamp: Date;
  level: LogLevel;
  source: string;
  message: string;
}

/**
 * Singleton globalny — bo logger musi być dostępny z każdego modułu
 * (Logger.log(...)), a alternatywne podejścia (DI, kontekst) zaszumiłyby
 * sygnatury. Stan jest mały, izolowany, a użycie testowe wyczyści go
 * przez Logger.reset() (do dodania gdy potrzebne).
 */
export default class Logger {
  private static readonly RING_CAPACITY = 500;
  private static entries: LogEntry[] = [];
  private static subscribers: Set<() => void> = new Set();

  /**
   * Dopisuje wpis do bufora i woła subskrybentów.
   *
   * @param level - Poziom (info/warn/error)
   * @param source - Krótka etykieta źródła ("MCP", "APP", "TUI")
   * @param message - Treść (jedna linia preferowana, ale \n dozwolony)
   */
  public static log(level: LogLevel, source: string, message: string): void {
    const entry: LogEntry = { timestamp: new Date(), level, source, message };
    Logger.entries.push(entry);
    if (Logger.entries.length > Logger.RING_CAPACITY) {
      Logger.entries.shift();
    }
    for (const sub of Logger.subscribers) {
      try {
        sub();
      } catch {
        // Subskrybent się wywalił — nie pozwól zatruć całego loggera.
      }
    }
  }

  /**
   * Skrót na info.
   *
   * @param source - Źródło
   * @param message - Treść
   */
  public static info(source: string, message: string): void {
    Logger.log('info', source, message);
  }

  /**
   * Skrót na warn.
   *
   * @param source - Źródło
   * @param message - Treść
   */
  public static warn(source: string, message: string): void {
    Logger.log('warn', source, message);
  }

  /**
   * Skrót na error.
   *
   * @param source - Źródło
   * @param message - Treść
   */
  public static error(source: string, message: string): void {
    Logger.log('error', source, message);
  }

  /**
   * Zwraca read-only widok ring-bufora (najstarsze na początku).
   *
   * @returns Tablica wpisów
   */
  public static getEntries(): readonly LogEntry[] {
    return Logger.entries;
  }

  /**
   * Rejestruje subskrybenta wołanego przy każdym nowym wpisie. Zwraca
   * funkcję anulującą subskrypcję.
   *
   * @param cb - Callback bez argumentów
   * @returns Funkcja anulująca
   */
  public static subscribe(cb: () => void): () => void {
    Logger.subscribers.add(cb);
    return () => Logger.subscribers.delete(cb);
  }
}
