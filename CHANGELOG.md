# Changelog

All notable changes to plan-tree TUI are documented here. Format loosely
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.9.0] — 2026-05-25

### Added — TUI

- **Klawisz `O` — sibling przed focusowanym (n5).** Komplementuje `o` (sibling po).
  Tworzy nowy węzeł, przesuwa go `moveBefore` względem focusowanego, focus
  przeskakuje do DetailsPanel z aktywną edycją tytułu. Na rootcie no-op
  (statusbar: "Cannot add sibling to root"). `addSiblingAndEdit` w `main.mts`
  sparametryzowany przez `position: 'after' | 'before'` — wspólna ścieżka dla obu.
- **Licznik `(+N frozen)` w StatusBarze (n97).** Sygnał że coś jest poza widokiem
  z powodu filtru FROZEN. Widoczny tylko w trybie NORMAL i gdy N>0. Wyłączony
  po toggle `F` (hideFrozen=false → 0 → sufiks znika). Aktualizowany przy każdym
  rebuild listy widocznych węzłów (mutacja drzewa / toggle F/H).
  Liczy wszystkie węzły z `:FROZEN: t` w całym drzewie — agregat, nie tylko
  korzenie podpoddrzew. Nowy callback `TreePanelOptions.onVisibilityChanged`
  emituje `{ frozenHidden }` po każdym rebuild; `StatusBar.setFrozenHidden(n)`
  konsumuje. Wired w `main.mts` przez `screen.render()` po update.

### Plan (nie implementowane)

Zapisane jako PROPOSAL pod n30/n1 (do triażu w kolejnych iteracjach):
- **n98** — licznik otwartych QUESTION/PROPOSAL w StatusBarze (rekomendacja PRIO A).
- **n99** — jump-to-id (`g <id>` prompt + skok do węzła).
- **n100** — breadcrumb path w nagłówku DetailsPanel.

## [0.8.6] — 2026-05-25

### Fixed — mutacja MCP przesuwa selekcję TUI (bezpieczeństwo)

Dotąd po wywołaniu MCP toola przez agenta selekcja w TUI pozostawała tam,
gdzie była — user mógł nie zauważyć zmiany i wcisnąć `d`, usuwając nie to,
co myślał. Teraz każda mutacja MCP przesuwa selekcję na "dotknięty" węzeł:

- `add` → nowo utworzony item
- `delete` → parent usuniętego (oryginał nie istnieje)
- pozostałe (rename/setTodo/setNotes/move/moveBefore/moveAfter/addTag/
  removeTag/setProperty/removeProperty/freeze/unfreeze/setPriority/split/
  merge/extract) → `args.itemId` z requestu

`OperationResult` dostał opcjonalne pole `affectedId` — wykorzystywane
przez `add`/`delete` które same wyliczają (nowy ID / parent), reszta operacji
fallbackuje do `args.itemId` w `MCPServer.runTool`. `handleTreeChangedFromMCP`
po `applyTree` woła `treePanel.selectById(affectedId)` i odświeża DetailsPanel.

## [0.8.5] — 2026-05-25

### Fixed — MCP zwracał HTTP 500 po pierwszym requeście (0.8.4)

W 0.8.4 stateless transport był współdzielony globalnie. SDK wprost zabrania
reuse stateless transportu (`Stateless transport cannot be reused across
requests. Create a new transport per request.`) — drugi request leciał
w 500. Teraz `handleHttpRequest` tworzy świeżą parę `Server+transport`
per request, podpina handlery, woła `connect` + `handleRequest`, w `finally`
zamyka oba. Restart TUI nadal przezroczysty dla agenta.

## [0.8.4] — 2026-05-25

### Changed — MCP serwer stateless + last-call w StatusBar

`MCPServer` przeszedł na **tryb stateless** SDK (`sessionIdGenerator: undefined`):
jeden globalny `Server` + `StreamableHTTPServerTransport` utworzony przy
`startServer()`, brak `Mcp-Session-Id` w odpowiedziach, brak walidacji sesji.
Powód: po restarcie TUI agent (Claude Code) wcześniej trzymał nieaktualny
session-id i musiał ręcznie reconnectować MCP — teraz każdy request jest
niezależny i restart TUI staje się dla agenta przezroczysty.

Konsekwencja w UI: licznik aktywnych sesji w StatusBar (` N`) zastąpiony
znacznikiem **ostatniego wywołania**: ` HH:MM:SS <tool>` (np. ` 14:23:05 add`).
Aktualizowany jednorazowo po każdym wywołaniu narzędzia — bez timera/polling.
Nowe API: `MCPServer.setOnLastCallChanged((ts, tool) => …)`,
`StatusBar.setMcpLastCall(ts, tool)`. Test `StatusBar` zaktualizowany.

## [0.8.3] — 2026-05-25

### Added — log wywołań MCP toolów w DebugPanel

`MCPServer.runTool` po każdym wywołaniu dopisuje do `Logger` jedną linię
postaci `add parentId=n42 title="Foo" → ok` lub `delete itemId=n7 → fail: <msg>`.
Dzięki temu DebugPanel (toggle: backtick) pokazuje na bieżąco co robi agent —
jednolinijkowo, bez konieczności otwierania logu po stronie klienta MCP.
Długie wartości stringów skracane są do 40 znaków, tablice renderowane jako
`[N]`. Wyjątki z toolów lecą jako `error` z prefiksem `→ throw: …`.

## [0.8.2] — 2026-05-25

### Added — bezpośrednie klawisze priorytetu + hint w StatusBar

W TreePanel pojawiły się klawisze `1`/`2`/`3` ustawiające priorytet `[#A]`/`[#B]`/`[#C]`
na zaznaczonym węźle oraz `0` czyszczący priorytet. Dotychczasowy `p` (cykl
`none → A → B → C → none`) zostaje bez zmian — przydatny gdy nie zna się
docelowej wartości, ale dla ustawienia konkretnego priorytetu z dowolnego stanu
wymaga do 3 wciśnięć.

StatusBar w trybie NORMAL pokazuje teraz hint `1-3/0:prio  p:cycle` obok
wskaźnika trybu — feature przestaje być niewidoczny dla użytkownika nieczytającego
źródła. W trybie EDIT hint nie jest wyświetlany (klawisze trafiają do pola).

## [0.8.1] — 2026-05-25

### Changed — semantyka freeze: KASKADA

Zamrożenie węzła ukrywa teraz CAŁE poddrzewo, nie tylko sam węzeł. Wcześniej
descendant-y frozen rodzica byli widoczni jeśli nie mieli własnego `:FROZEN: t`
— skutek: agent widział i mógł zaproponować pracę nad subtaskiem zamrożonej
gałęzi, łamiąc intencję "ta cała gałąź jest na pauzie". Decyzja użytkownika:
freeze = pauza całej gałęzi, kropka.

Zmiana spójna w trzech miejscach:

- **MCP `find`** (`TreeOperations.find`): `includeFrozen=false` (default)
  pomija frozen węzeł i nie schodzi rekurencyjnie w jego dzieci.
- **MCP `tree://summary`**: tak samo. `tree://summary/all` wciąż pokazuje
  wszystko (bez kaskady).
- **TUI** (`TreePanel.rebuildFlattenedNodes`): gdy `hideFrozen=true` (default),
  frozen rodzic i całe jego poddrzewo są wycięte z renderu. Logika
  `hasNonHiddenDescendant` (która pokazywała DONE-rodzica z aktywnymi dziećmi)
  pozostała dla DONE — frozen jest twardszy semantycznie.

Opisy MCP tools (`freeze`, `find`) i resource'ów zaktualizowane o słowo "cascade".

## [0.8.0] — 2026-05-25

Domknięcie luki n15 (FROZEN) — `tree://summary` realnie respektuje decyzję
z n17, a TUI dostaje afordancję zamrażania, której wcześniej brakowało.

### Changed — MCP

- **`tree://summary` domyślnie ukrywa węzły z `:FROZEN: t`** (zgodne z `find`).
  Dotychczas resource zwracał frozen-y z flagą `frozen: true`; agent miał je
  na oczach i mógł niechcący zaproponować pracę nad zamrożonym taskiem.
  Teraz są pomijane jak w `find` — descendant-y zamrożonego węzła nadal się
  pokazują, jeśli same nie są frozen (mirror logiki `TreeOperations.find`).

### Added — MCP

- **Resource `tree://summary/all`** — taki sam kształt jak `tree://summary`,
  ale zawiera też frozen (z `frozen: true`). Do użycia gdy użytkownik
  jawnie chce inspekcjonować/odmrozić/pracować nad zamrożonym taskiem.
  Opisy obu resource'ów i instrukcje serwera sterują agentem, żeby
  default-em była wersja bez frozen.

### Added — TUI

- **Pozycja "Zamroź" / "Odmroź" w menu kontekstowym (Space)** —
  toggle property `:FROZEN: t` na zaznaczonym węźle. Etykieta zmienia się
  dynamicznie zależnie od aktualnego stanu. Dotychczas zamrażanie było
  dostępne tylko przez MCP tools `freeze`/`unfreeze`; teraz da się to
  zrobić jednym chwytem w TUI.

## [0.7.0] — 2026-05-25

### Added — TUI

- **Menu kontekstowe pod spacją (PopupMenu).** Wciśnięcie `Space` na zaznaczonym
  węźle w TreePanel otwiera popup obok wiersza. Nawigacja: `j`/`k` oraz strzałki
  góra/dół. `h`/`Esc` zamyka bez akcji. `Space`/`Enter` zatwierdza wybór.
  Pierwsza i jedyna obecna pozycja: **Usuń** — kasuje węzeł bez potwierdzenia
  (równolegle z istniejącym `d`+`d`, które zostaje na razie nietknięte).
  Gdy menu otwarte, wszystkie klawisze są pochłonięte i nie przechodzą do
  globalnych skrótów drzewa. Komponent `PopupMenu` zaprojektowany jako
  reużywalny helper — kolejne operacje (zmiana TODO, dodanie dziecka itd.)
  trafią tu w następnych iteracjach.

## [0.6.0] — 2026-05-25

Pakiet poprawek TUI z gałęzi n87 — refinementy ergonomiczne, sprzątanie
martwego kodu w statusbarze, krytyczny fix synchronizacji TUI↔MCP.

### Fixed

- **Edycje TUI nie propagowały do MCP (n93).** `MCPServer` trzymał własną
  referencję `this.tree`. Mutacja z MCP aktualizowała obie strony przez
  `onTreeChanged`, ale mutacja z TUI (np. rename z DetailsPanel) zmieniała
  tylko stan w `ApplicationState` — MCPServer dalej widział stary obiekt
  drzewa, więc `tree://summary` / `tree://root` zwracały stan sprzed edycji.
  Naprawione: `MCPServer.setTree(tree)` wołane z `ApplicationState.applyTree`.
- **Logi MCP rozjeżdżały render TUI (n90).** Sesje, błędy HTTP i autosave
  pisały na stderr równolegle z renderem take4-console. Zastąpione przez
  `Logger` (ring-buffer 500 wpisów) i toggleable `DebugPanel` (klawisz `` ` ``).
  Stderr pozostaje wyłącznie dla fatalnych błędów przed startem TUI.

### Added — TUI

- **Agent-inbox jako sztucznie pinowany ostatni węzeł roota (n71/n72, bare-minimum).**
  Top-level węzeł na pomysły agenta do triażu (mirror user-inboxa [[n49]]).
  Strukturalnie zwykłe dziecko roota; TreePanel wykrywa property `:AGENT-INBOX: t`
  i zawsze renderuje takie węzły na końcu listy dzieci roota niezależnie od
  realnej kolejności. Pinning działa tylko na poziomie roota. Threshold,
  add-lock i triage tools (n73-n78) odłożone — to celowo bare-minimum.
- **Logger + DebugPanel (n90).** Singleton z ring-buforem, kolorowanie per
  poziom (info=gray, warn=yellow, error=red), subskrypcja → auto-invalidate
  panelu. DebugPanel domyślnie ukryty, `` ` `` toggluje.
- **Licznik aktywnych sesji MCP w statusbarze (n91).** Po prawej stronie:
  ikona NerdFont nf-fa-plug + liczba. 0 sesji → niewidoczne. Daje natychmiastowy
  sygnał, czy agent jest podłączony.
- **Toggle wyświetlania ID w TreePanel (n94).** Klawisz `I` przełącza `[n42]`
  prefix dim/gray przy każdym węźle. Domyślnie OFF. Ułatwia cytowanie ID
  w rozmowie z agentem bez zaglądania do pliku/resources.
- **Runtime regulacja podziału TreePanel/DetailsPanel (n95).** Klawisze
  `<` / `>` (i `,` / `.`) zmieniają proporcję o 5 punktów flex-grow.
  Granice 20%/80%. Stan tylko w sesji, restart wraca do 50/50.
- **Domyślny podział TreePanel/DetailsPanel = 50/50 (n88).** Wcześniej 35/65
  — drzewo, główny widok nawigacyjny, było zbyt wąskie.
- **Ukrycie syntetycznego "Plan Root" (n89-impl).** `OrgReader.buildTree`
  zawsze dodaje syntetyczny root jako wrapper headlines z pliku. Wcześniej
  zajmował pierwszy wiersz TreePanel. Teraz: `TreePanelOptions.hideRoot = true`
  (w produkcji) — dzieci roota renderowane jako top-level. Test-suite używa
  default false (widzi prawdziwy root).

### Changed — Status bar (n92)

- **Martwy kod usunięty:** `[*]` dirty indicator (autosave resetował flagę
  natychmiast — nigdy widoczny), `Inbox: N` (setInboxCount nigdy nie wywoływane —
  zawsze 0), `[Tree]/[Details]` focus marker (redundantny — take4-console
  renderuje focus przez `BUILTIN_BORDER_FOCUSED` na borderze panelu).
- **`[NORMAL]/[EDIT]` podpięte do realnego stanu.** `setMode` było martwe,
  zawsze pokazywał `[NORMAL]`. Teraz `DetailsPanel` emituje `onEditModeChange`
  do `ApplicationState`, który aktualizuje statusbar.

### Investigations (n89, n93)

- **"Plan Root" to artefakt parsera, nie zawartość pliku** — udokumentowane
  w `OrgReader.mts:234-243`, hardcoded id="root"/title="Plan Root".
- **Synchronizacja TUI↔MCP była asymetryczna** — kierunek MCP→TUI działał
  (callback `onTreeChanged`), TUI→MCP nie istniał. Bug.

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
