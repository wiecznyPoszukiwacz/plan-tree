# plan-tree

**Strukturalny edytor terminalowy (TUI) plików `.org` + serwer MCP — narzędzie,
które pozwala użytkownikowi nadążyć za tempem agenta AI.**

---

## Po co to jest

Agent (np. Claude) jest szybki: rozszerza zakres, dorzuca detali, generuje
pytania, proponuje warianty — w tempie, którego człowiek nie ogarnia
mentalnie ani manualnie. Bez wspólnej, trwałej struktury kończy się to
ścianą tekstu w czacie, zapomnianymi decyzjami i narastającym scope creepem.

plan-tree daje obu stronom **zewnętrzną, współdzieloną pamięć** w postaci
drzewa planu:

- Każda propozycja agenta → węzeł z jednym stabilnym **ID** (`n42`)
- Każde pytanie → węzeł **QUESTION**, który nie ginie w czacie
- Każda decyzja → **DONE** z notatką *dlaczego*
- Każda kotwica użytkownika → **ANCHOR**, którego agent nie rusza
- Stan zawsze widoczny w TUI, **autozapis** do pliku po każdej zmianie

Użytkownik decyduje w swoim tempie, nie w tempie agenta. Metafora projektu:
plan-tree to **siodło, nie uprząż** — nie hamuje agenta, daje człowiekowi
kontrolę nad kierunkiem i tempem.

### Dwa interfejsy, jeden plik

```
            ┌──────────────────────────────┐
   agent ──►│   serwer MCP (HTTP :3000)    │
  (Claude)  │  add / move / split / ...    │
            └──────────────┬───────────────┘
                           │  mutacje tego samego
                           ▼  drzewa w pamięci
            ┌──────────────────────────────┐
   user ───►│   TUI (klawiatura)           │──► autozapis ──► plan.org
            │  nawigacja, edycja, kotwice  │
            └──────────────────────────────┘
```

Agent i użytkownik pracują na **tym samym drzewie**: agent przez narzędzia
MCP, użytkownik z klawiatury w TUI. Każda zmiana z dowolnej strony jest
natychmiast renderowana i zapisywana do pliku `.org`.

---

## Wymagania

- **Node.js ≥ 18**
- Terminal z obsługą NerdFonts (ikony stanów: ☐ ◇ ? ○ ✓ ✗)

## Instalacja i uruchomienie

```bash
# 1. Zależności
npm install

# 2. Build (TypeScript → dist/)
npm run build

# 3. Uruchomienie na konkretnym pliku planu
npm start -- plan.org
#   lub bezpośrednio:
node dist/main.mjs plan.org
```

- Argument to ścieżka do pliku `.org`. **Bez argumentu** używany jest
  `plan.org` w bieżącym katalogu.
- Plik **musi istnieć** — przy braku program kończy się błędem
  (`File not found`). Utwórz pusty plik lub plik z jednym nagłówkiem,
  np. `* TODO Mój plan` + drawer z `:ID:` (albo dowolny nagłówek —
  ID zostanie dogenerowane przy pierwszym zapisie).

Po starcie podnosi się jednocześnie TUI oraz serwer MCP na
`http://localhost:3000/mcp`.

### Tryb deweloperski

```bash
npm run dev     # tsc --watch — przebudowuje przy zmianach źródeł
npm test        # kompiluje testy i uruchamia node --test
npm run clean   # usuwa dist/ i dist-test/
```

---

## Podłączenie agenta (MCP)

Repo zawiera `.mcp.json`, który rejestruje serwer dla Claude Code:

```json
{
  "mcpServers": {
    "plan-tree": { "type": "http", "url": "http://localhost:3000/mcp" }
  }
}
```

Kolejność: **najpierw uruchom TUI** (podnosi serwer na :3000), potem
agent łączy się po HTTP. Agent dysponuje operacjami strukturalnymi:
`add`, `delete`, `move` / `moveBefore` / `moveAfter`, `split`, `merge`,
`extract`, `absorb`, `rename`, `setTodo`, `setNotes`, `addTag` / `removeTag`,
`setProperty` / `removeProperty`, `setPriority`, `anchor`, `freeze` /
`unfreeze`, `find`, oraz zasoby do czytania: `tree://summary`,
`tree://root`, `tree://item/<id>`.

> Dla eksploracji agent powinien czytać lekki `tree://summary`
> (id + tytuł + todo + głębokość) zamiast pełnego `tree://root`.

---

## Obsługa z klawiatury (TUI)

Układ: po lewej **drzewo** (TreePanel), po prawej **szczegóły** węzła
(DetailsPanel), na dole **status bar**.

### Globalne

| Klawisz   | Akcja |
|-----------|-------|
| `1` / `2` | Fokus na panel drzewa / szczegółów |
| `Ctrl+S`  | Zapis do pliku (poza autozapisem) |
| `Ctrl+Z`  | Undo (historia do 100 stanów) |
| `f`       | Tryb follow ON/OFF — czy mutacje MCP przenoszą selekcję na zmieniony węzeł |
| `` ` `` / `~` / `?` | Toggle panelu debug (log MCP/błędów) |
| `<` / `,` , `>` / `.` | Zmiana proporcji podziału paneli (20–80%) |
| `q`       | Wyjście (poza trybem edycji) |
| `Ctrl+C`  | Wyjście |

### Drzewo (TreePanel)

| Klawisz | Akcja |
|---------|-------|
| `j` / `k` lub ↓ / ↑ | Ruch w dół / w górę |
| `h` / `l` lub ← / → | Zwiń / rozwiń węzeł |
| `t`     | Cykl stanu TODO: `TODO → WORK-UNIT → DONE → TODO` |
| `a`     | Dodaj dziecko i edytuj jego tytuł |
| `o` / `O` | Dodaj rodzeństwo po / przed bieżącym węzłem |
| `d` `d` | Usuń (podwójne `d` — z potwierdzeniem) |
| `J` / `K` | Przesuń węzeł w dół / w górę wśród rodzeństwa |
| `Tab` / `Shift+Tab` | Wcięcie / wycięcie (zmiana poziomu) |
| `p`     | Cykl priorytetu: brak → A → B → C → brak |
| `A`     | Toggle ANCHOR (zakotwiczenie) |
| `H`     | Ukryj / pokaż węzły DONE |
| `F`     | Ukryj / pokaż węzły FROZEN |
| `I`     | Pokaż / ukryj identyfikatory ID |

### Szczegóły (DetailsPanel)

| Klawisz  | Akcja |
|----------|-------|
| `e`      | Edytuj tytuł |
| `n`      | Edytuj notatki |
| `Ctrl+S` | Zapisz edytowane pole |
| `Esc`    | Anuluj edycję |

---

## Format pliku

plan-tree czyta i zapisuje podzbiór składni org-mode. Pełna specyfikacja
tego, co narzędzie rozumie (i czego **nie** zachowa przy zapisie):
**[docs/org-format.md](docs/org-format.md)**.

W skrócie: nagłówki z gwiazdkami budują hierarchię, słowo kluczowe TODO
i cookie `[#A]` po nim, tagi `:tag:` na końcu, `:PROPERTIES:` drawer
z `:ID:` / `:ANCHOR:` / `:FROZEN:`, a tekst pod nagłówkiem to notatki.

---

## Filozofia projektowa

Każda nowa funkcja przechodzi jeden filtr: **czy skraca czas od propozycji
agenta do decyzji użytkownika?** Funkcje wspierające szybkość poznawczą
użytkownika (ANCHOR, rozróżnienie PROPOSAL vs. założenie, dashboard pytań,
akceptacja rekomendacji jednym klawiszem) mają priorytet. „Ładne dodatki",
które nie skracają decyzji — nie.

Szczegóły idei i konwencji współpracy z agentem: zobacz `CLAUDE.md`.
Historia rozwoju: `CHANGELOG.md` (semantic versioning).
