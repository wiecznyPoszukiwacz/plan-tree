# Changelog

All notable changes to plan-tree TUI are documented here. Format loosely
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.5.1] — 2026-05-24

### Fixed

- **Priority gubione przy każdej mutacji Item.** Konstruktor `Item` przyjmuje
  `priority` jako 7. parametr z domyślnym `null`, a 8 metod immutable update
  (`setTodo`, `addTag`, `removeTag`, `withTitle`, `withNotes`, `setProperty`,
  `removeProperty`, `clone`) wołało `new Item(...)` tylko z 6 argumentami —
  cicho czyściło priority. Skutek: `TreeOperations.add` (przez `tree.root.clone()`)
  resetował priority całego drzewa, tytuły traciły kolor w TreePanel. Dodany
  test regresyjny w `Item.test.mts`.
- **Ctrl+S nie zapisywał edytowanego pola w DetailsPanel.** Globalny binding
  `\x13` przejmował klawisz zanim DetailsPanel zdążył zareagować. Teraz w
  trybie edycji (title lub notes) Ctrl+S zapisuje pole; poza edycją zachowuje
  globalny zapis drzewa. DetailsPanel akceptuje Ctrl+S również dla title
  (wcześniej tylko Enter).

## [0.5.0] — 2026-05-24

Wielka fala — kompletny warsztat TUI (edytor z klawiatury) + system priorytetów
+ koncepcja freeze + ambient selection awareness dla agenta MCP.

### Added — MCP

- **Ambient `selection` w każdej odpowiedzi tool/resource.**
  Pole `{id, title, todo, path}` (lub `null`) doklejone do payloadu
  `runTool` i resources, opisujące aktualnie focusowany węzeł w TUI.
  Agent nie musi pytać "co masz zaznaczone?" — wie z każdej odpowiedzi.
  `SERVER_INSTRUCTIONS` zaktualizowane o opis tego pola.
- **Tool `getSelection()`** — celowe zapytanie zwracające ten sam payload
  (bez wykonywania mutacji).
- **Tool `setPriority(itemId, priority)`** — priority cookie [#A]/[#B]/[#C]
  (org-mode native) lub pusty string żeby wyczyścić.
- **Tool `freeze(itemId)` / `unfreeze(itemId)`** — alias dla `setProperty`
  /`removeProperty` z kluczem `FROZEN`. Semantyka: pauza (nie porzucenie).
- **`find` rozszerzony** o filtr `priority` i `includeFrozen` (domyślnie
  false → frozen węzły niewidoczne dla agenta).
- **`tree://summary` zawiera `frozen: true`** dla FROZEN węzłów oraz
  `priority` gdy ustawiony. Resource też niesie ambient `selection`.

### Added — OrgReader/Writer

- **Priority cookie [#A]/[#B]/[#C]** parsowane z headline'a (regex
  rozszerzony o opcjonalną grupę po TODO state) i serializowane z powrotem.
  Round-trip stabilny. `Headline` i `Item` zyskały pole `priority: 'A'|'B'|'C'|null`.

### Added — TUI

- **Edycja tytułu**: `e` w DetailsPanel wchodzi w edit, Enter zapisuje
  (wcześniej `saveEditedValue` było stubem). Wywołuje `TreeOperations.rename`.
- **Edycja notes**: `n` w DetailsPanel wchodzi w multi-line edit.
  Enter = nowa linia, Ctrl+S = save, Esc = cancel.
- **Cykl TODO state**: `t` przełącza `TODO → WORK-UNIT → DONE → TODO`
  (pozostałe stany niedostępne z TUI — zostawione MCP).
- **Add child**: `a` tworzy nowy węzeł "(new)" jako ostatnie dziecko
  focusowanego, przeskakuje focus do DetailsPanel i od razu wchodzi w
  edycję tytułu.
- **Add sibling**: `o` analogicznie, jako rodzeństwo po focusowanym.
- **Delete z potwierdzeniem**: pierwsze `d` uzbraja (StatusBar może
  pokazać), drugie `d` wykonuje (`TreeOperations.deleteItem`). Każdy
  inny klawisz rozbraja.
- **Reorder rodzeństwa**: `J`/`K` (duże) przenoszą węzeł w dół/górę
  wśród rodzeństwa (`moveAfter`/`moveBefore`). Alt+↑/↓ jako aliasy.
- **Indent/outdent**: Tab przenosi pod poprzedniego siblinga (staje się
  jego dzieckiem), Shift+Tab wyciąga do dziadka.
- **Priorytet**: `p` cykluje priorytet `none → A → B → C → none` przez
  `TreeOperations.setPriority`.
- **Hide DONE**: `H` togglu­je ukrywanie węzłów `DONE`. Domyślnie ukryte.
  Decyzja n14: rodzic DONE z dziećmi nie-DONE jest **widoczny** (żeby nie
  ucinać aktywnych dzieci spod widoku).
- **Hide FROZEN**: `F` togglu­je ukrywanie węzłów z `:FROZEN: t`.
  Domyślnie ukryte. Ta sama zasada co dla DONE.
- **Render**:
  - Priorytet [#A] → bright red (foreground 9), [#B] → bright yellow
    (foreground 11), [#C] / brak → neutral. Plus tekstowy marker `! `
    (A) lub `· ` (B) w prefiksie.
  - QUESTION → cyan (foreground 6).
  - DONE i FROZEN → dim.
  - FROZEN dodatkowo z markerem `❄ ` w prefiksie.
  - Wszystko spójne z decyzjami n27 (akcent + neutral).
- **Undo**: Ctrl+Z cofa ostatnią mutację (z TUI lub MCP). Stos do 100.
  Redo jeszcze nie zaimplementowane.

### Architektura

- `TreePanel` i `DetailsPanel` zyskały bundle `actions` (callbacki
  emitowane do ApplicationState). Panel nie wie o `TreeOperations` ani
  o autosave — to ApplicationState tłumaczy intent na mutację i broadcastuje.
- Wspólny `applyMutation(result)` w ApplicationState: push undo + apply +
  autosave + statusbar message przy błędzie. Single source of truth dla
  *każdej* zmiany drzewa (TUI i MCP wpadają w tę samą ścieżkę).

### Pozostawione jako TODO w planie (★ priorytet, do zrobienia później)

- **Tag editor w TUI (n7)** — brak modal-input dla tagów (można dodawać
  przez MCP).
- **Search prompt w TUI (n11)** — backend (`find`) jest, brak UI.
- **Redo** — undo jest, redo wymaga drugiego stosu (n12 częściowo).

## [0.4.0] — 2026-05-24

### Added

**Komplet narzędzi MCP do komfortowej pracy z planem.** Wcześniej brakowało
wszystkiego, co dotyczyło modyfikacji *zawartości* istniejących węzłów —
agent musiał kasować i tworzyć od nowa, tracąc ID i dzieci.

- **`setTodo(itemId, todo)`** — zmiana stanu TODO bez ruszania reszty.
- **`rename(itemId, title)`** — zmiana tytułu z zachowaniem ID, dzieci, notes.
- **`setNotes(itemId, notes)`** — zastąpienie notatek (pusta = wyczyść).
- **`addTag(itemId, tag)`** / **`removeTag(itemId, tag)`** — zarządzanie
  tagami. Walidacja: bez spacji i bez `:`.
- **`setProperty(itemId, key, value)`** / **`removeProperty(itemId, key)`** —
  custom properties w drawerze. Klucz `ID` jest chroniony.
- **`moveBefore(itemId, siblingId)`** / **`moveAfter`** — precyzyjne
  reorderowanie rodzeństwa (wcześniej `move` zawsze przyklejał na koniec).
- **`find({titleContains?, todo?, tag?})`** — wyszukiwanie, zwraca w polu
  `diff` JSON `[{id, title, todo, tags, depth}]`. Filtry łączone AND;
  pominięty filtr nie ogranicza. Lekka alternatywa dla czytania całego
  `tree://root` przy dużym planie.
- **Rozszerzenie `add`** o opcjonalne `notes` i `tags` — w jednym wywołaniu
  utworzenie węzła wraz z treścią.
- **Resource `tree://summary`** — kompaktowy overview `[{id, title, todo,
  tags, depth}]` w kolejności DFS, bez notes/properties/zagnieżdżenia JSON.
  Tańszy niż `tree://root`.

### Changed

- **Krótsze generowane ID: `n<N>` zamiast `item_<ts>_<rand>`.** Sekwencyjny
  counter w `TreeOperations`. `OrgReader` przy każdym wczytaniu pliku
  seeduje counter na max+1 spośród istniejących ID typu `n<N>`, ignorując
  stare długie ID (które koegzystują — znikną naturalnie wraz z
  usuwaniem/przepisywaniem węzłów). Nowe ID: `n1`, `n2`, `n42`…
- **DetailsPanel zawija tekst** do szerokości panelu. Tytuły, statusy,
  tagi, notatki i properties — kolejne linie wcięte do prefixu (np.
  `"Title: "` → continuation cofnięta o 7 znaków). Łamanie na granicy
  słowa gdy się da, hard-break dla pojedynczych długich tokenów.

### Fixed
- **Rekurencja `handleExit ↔ WindowManager.stop ↔ onExit` w `main.mts`**
  powodowała stack overflow przy wyjściu z TUI. Naprawione przez flagę
  `this.exiting` z early-return przy re-entry. (Bug odkryty mid-task
  przy próbie restartu TUI dla weryfikacji 0.3.5.)

## [0.3.5] — 2026-05-24

### Fixed
- **Stack overflow przy wyjściu z TUI.** `handleExit` wywoływał
  `windowManager.stop()`, a `WindowManager.stop()` wywoływał własny
  `onExit` callback, który u nas wraca do `handleExit` — nieskończona
  rekurencja kończyła się `RangeError: Maximum call stack size exceeded`
  z `Socket._write` (autosave próbował pisać do stderr na wyczerpanym
  stosie). Naprawione: flaga `this.exiting = true` na wejściu do
  `handleExit`, early-return przy re-entry.

- **`TreeOperations.merge` doklejał spację do tytułu i `\n` do notes nawet
  gdy któraś strona była pusta.** Docstring i opis tool MCP mówiły
  `itemId1.title + itemId2.title` (bez separatora), a kod robił
  `+ ' ' +`. Notes natomiast były zawsze łączone newline-em, więc dwa
  puste notes dawały samotny `\n`. Naprawione: tytuły bez separatora,
  notes łączone newline-em **tylko gdy obie strony niepuste** (filtr
  na długość > 0 przed `.join('\n')`).
- **`OrgReader` parsowanie tagów działało tylko dla jednego taga.**
  Regex `(:[^:]+:)` matchował dokładnie `:tag:` (jeden człon bez `:`
  w środku), więc `:tag1:tag2:` nie pasował w ogóle — cała sekcja
  tagów wjeżdżała do tytułu. Naprawione na `(:(?:[^:\s]+:)+)` — jeden
  lub więcej członów `:tag1:tag2:...:tagN:`. Trzy failing testy
  (parses tags, parses TODO with tags and properties, handles empty
  headlines) przeszły. Test "handles empty headlines" zaktualizowany
  na nowe zachowanie `properties` (zawiera teraz auto-generowane `:ID:`).
- **`MCPServer` singleton transport — wielu klientów MCP wzajemnie się
  wykluczało.** Wcześniej był jeden globalny `StreamableHTTPServerTransport`
  i jeden `Server`, więc drugi klient (np. Claude Code + curl) dostawał
  "Server already initialized", a po rozłączeniu pierwszego klienta cały
  serwer wpadał w "Server not initialized" dla wszystkich. Naprawione:
  sesje są tworzone leniwie per request — każdy klient dostaje własną
  parę `Server + transport` zapisaną w `Map<sessionId, ...>`. Routing
  po nagłówku `mcp-session-id`. Sesja zapisuje się do mapy w callbacku
  `onsessioninitialized` i znika z mapy w callbacku `onclose`.
  `stopServer` iteruje po wszystkich sesjach. Wzorzec zgodny z
  oficjalnym przykładem SDK (`examples/server/jsonResponseStreamableHttp`).

## [0.3.4] — 2026-05-24

### Fixed
- Usunięte dwie nieużywane zmienne lokalne wykrywane przez `noUnusedLocals`:
  `newItemsById` w `TreeOperations.merge` i `currentContent` w
  `OrgReader.parseHeadlines`. Czysto martwy kod, bez wpływu na zachowanie.

### Notes
- Diagnostyka 6385 dla `Server` z `@modelcontextprotocol/sdk` pozostaje:
  klasa jest oznaczona deprecated z preferencją dla `McpServer`, ale sam
  SDK przyznaje, że `Server` jest właściwy dla advanced use cases — a
  nasze raw `setRequestHandler(...)` z dynamiczną listą resources do
  takich należy. Komentarz w `MCPServer.mts` udokumentowuje świadomy wybór.

## [0.3.3] — 2026-05-24

### Fixed
- **`TreeOperations.extract(root)` nie odrzucał roota.** Warunek
  `if (!parentId && itemId !== tree.root.getId())` był odwrócony logicznie:
  `findParentId` zwraca `null` tylko dla roota, więc lewy człon obejmował
  tylko ten przypadek, a prawy go natychmiast wykluczał — warunek nie
  uruchamiał się nigdy. W rezultacie `extract` na rootcie przechodził do
  dalszej logiki i rebuilodował drzewo bez korzenia. Naprawione na
  `if (itemId === tree.root.getId())` przed `findParentId`. Test
  `extract() - root cannot be extracted` przeszedł z fail na pass.

## [0.3.2] — 2026-05-24

### Added
- **Nowy tool MCP: `add`.** Tworzy nowy węzeł jako ostatnie dziecko wskazanego
  rodzica (`parentId="root"` dla top-level). Parametry: `parentId`, `title`,
  opcjonalny `todo` (TODO/PROPOSAL/QUESTION/WORK-UNIT/DROPPED/DONE).
  Auto-generowany stabilny ID trafia do `:ID:` w properties drawer, więc
  przeżyje round-trip. Wcześniej MCP nie miał żadnego sposobu na utworzenie
  węzła z nuli — można było tylko `split`-ować istniejące.

## [0.3.1] — 2026-05-24

### Fixed
- **Inflacja warstwy `* Header` przy każdym round-tripie zapis→odczyt.**
  `OrgWriter.serializeTree` zawsze emitował wrapper `* Header` (i opcjonalnie
  `* Inbox`, `* Rejected`), pod który wpychał wszystkie dzieci roota jako
  headlines poziomu 2. Reader nie rozpoznawał wrapperów jako sekcji —
  traktował je jak zwykłe Itemy. Każdy restart TUI dodawał więc kolejną
  warstwę zagnieżdżenia. Po N restartach treść siedziała N poziomów głębiej
  niż powinna. Naprawione: writer pisze dzieci roota wprost na poziomie 1,
  bez ghost-wrapperów. Kategoryzacja (Inbox/Rejected/Header) to sprawa
  warstwy prezentacji (TUI), nie formatu pliku.
- **Niestabilne ID itemów między restartami.** `OrgReader.buildTree`
  ignorował `:ID:` z properties drawera (mimo że był poprawnie parsowany)
  i nadawał sekwencyjne `item-N` w kolejności DFS odczytu. Po dowolnej
  restrukturyzacji drzewa (split, merge, delete) ID się przetasowywały,
  bo zmieniała się kolejność czytania. Naprawione: reader bierze ID z
  `:ID:` w properties; gdy brak — generuje stabilny ID i wstrzykuje do
  properties tak, że pierwszy zapis go zapersystuje. `TreeOperations.split`
  ustawia `:ID:` na nowotworzonym węźle, żeby też przeżył round-trip.

## [0.3.0] — 2026-05-24

### Added
- **Nowy tool MCP: `delete`.** Usuwa wpis wraz z całym poddrzewem
  (w przeciwieństwie do `extract`/`absorb`, które promują dzieci do rodzica).
  Odrzuca usunięcie roota. `TreeOperations.deleteItem()` korzysta z istniejącego
  helpera `removeItemFromTree` i raportuje w polu `diff` liczbę usuniętych węzłów.
- Instrukcje serwera MCP zaktualizowane: sześć tools zamiast pięciu.

## [0.2.0] — 2026-05-24

### Changed
- **Transport MCP: TCP+NDJSON → Streamable HTTP (spec 2025-03-26).**
  - `MCPServer.mts` przepisany na `Server` + `StreamableHTTPServerTransport`
    z `@modelcontextprotocol/sdk`. Ręczny parser JSON-RPC i framing NDJSON
    usunięte — handshake (`initialize`, capability negotiation,
    `notifications/initialized`), walidacja schematów i framing są w SDK.
  - Serwer bind na `127.0.0.1` (localhost-only zamiast `0.0.0.0`), port
    domyślnie 3000 — konfigurowalny przez argumenty konstruktora
    `MCPServer(tree, onChange, port?, host?)`.
  - Endpoint: `POST /mcp` (z opcjonalnym GET-upgrade do SSE). Sesje
    stateful, `mcp-session-id` w nagłówkach (generowane przez `randomUUID`).
  - Tools (split/merge/extract/absorb/move) i resources (`tree://root`,
    `tree://item/<id>`) zachowane bez zmian semantycznych. Wynik
    tools/call zwracany w formacie MCP `content: [{type:'text', text:...}]`
    z `isError` przy porażce zamiast ad-hoc `success/message/diff`.
  - `stopServer()` zamyka transport, SDK Server i HTTP w tej kolejności;
    `closeAllConnections()` na HTTP serwerze zapobiega zawieszeniu się
    `handleExit` na otwartych strumieniach SSE.

### Migration notes — podłączenie z Claude Code

W repo, w którym uruchamiasz Claude Code, dodaj plik `.mcp.json`:

```json
{
  "mcpServers": {
    "plan-tree": {
      "type": "http",
      "url": "http://localhost:3000/mcp"
    }
  }
}
```

Workflow: najpierw uruchom TUI (`npm start path/to/plan.org`) w jednym
oknie, potem `claude` w drugim — CC podłączy się do działającej
instancji TUI. CC nie spawnuje serwera (stdio odpada), bo MCPServer
żyje w procesie TUI.

### Dependencies
- Dodane: `@modelcontextprotocol/sdk ^1.29.0`.

## [0.1.0] — 2026-05-24

### Changed
- **Pełna migracja warstwy TUI na bibliotekę `take4-console`.**
  - `TreePanel`, `DetailsPanel`, `StatusBar` dziedziczą po `Window` z
    `take4-console` i implementują interfejs `Focusable`. Stylizacja idzie
    przez `StyleRegistry` i `writeText` z segmentami, zamiast surowych
    sekwencji ANSI.
  - Layout głównego okna złożony z `Screen` → kolumna (panele jako wiersz,
    pasek statusu na dole) z wykorzystaniem `Pos.flex` / `Size.flex` —
    auto-resize na `SIGWINCH` przez wbudowany handler `Screen`.
  - Pętla wejścia i routing klawiszy obsługiwane przez `WindowManager`:
    Tab/Shift-Tab cyklują fokus, `bindKey` obsługuje globalne `1`/`2`/`q`/
    `Ctrl+S`. Kontrolki same parsują własne klawisze w `handleKey`
    (j/k/h/l, e/Esc/Enter).
  - Usunięta klasa `KeyboardRouter` (zastąpiona przez `WindowManager`)
    i moduł `KeyBindings.mts` (skróty zdefiniowane w `main.mts`).

### Fixed
- Wcięcia w drzewie nie rozjeżdżają już prawej krawędzi panelu Tree
  — szerokość komórki liczona przez `getTextWidth` z biblioteki, nie
  przez `String.length` z bajtami ANSI w środku.
- UI nie scrolluje już terminala — kompletne kompozycje renderowane
  jednym `process.stdout.write` po policzeniu damage rects.
- Skróty klawiszowe nie potrzebują własnego parsera escape sequences
  (`\x1b[A` i podobne) — `WindowManager` parsuje stdin sam.

### Migration notes
- Konstruktory komponentów TUI mają teraz dwuargumentową sygnaturę
  `(wp: WindowProperties, opts?: ComponentOptions)` zamiast pozycyjnych
  `(rootItem, width, height)`. Testy zaktualizowane.
- Wymagany `Screen` przed utworzeniem dowolnego `Window`/kontrolki —
  globalny `StyleRegistry` jest rejestrowany w konstruktorze `Screen`.

### Build
- Nowy `tsconfig.test.json` kompiluje testy do `dist-test/`, aby nie
  zaśmiecać `dist/` dystrybucji.
- Mechaniczna naprawa zepsutych importów w pre-istniejących testach
  (`node:test.mjs` → `node:test`, `Item.mjs.mjs` → `Item.mjs`) tak, aby
  suite był w ogóle uruchamialny.

### Known issues
- 7 testów w `OrgReader`/`OrgWriter`/`TreeOperations` nadal failuje —
  prawdziwe bugi domenowe odkryte przez naprawiony suite (parsowanie
  tagów, serializacja TODO states, walidacja `extract()` na korzeniu).
  Poza zakresem tej migracji; przeniesione na listę odkryć
  scope-guard.
