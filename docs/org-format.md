# Format pliku `.org` w plan-tree

Ten dokument opisuje **podzbiór składni org-mode**, który plan-tree
faktycznie parsuje (`src/OrgReader.mts`) i zapisuje (`src/OrgWriter.mts`).
To nie jest pełna specyfikacja org-mode — to dokładnie tyle, ile rozumie
to narzędzie. Wszystko, czego tu nie ma, jest przy odczycie ignorowane,
a przy zapisie nie zostanie odtworzone.

> **Round-trip:** plik jest wczytywany do drzewa w pamięci, a przy każdej
> mutacji (z TUI lub MCP) zapisywany z powrotem przez `OrgWriter`. Oznacza
> to, że plik jest **przepisywany od zera** z modelu — elementy spoza
> obsługiwanego podzbioru (np. komentarze `#`, bloki `#+BEGIN`, znaczniki
> `SCHEDULED:`, linki org) **nie przetrwają zapisu**. Trzymaj w pliku tylko
> to, co opisano poniżej.

## Struktura ogólna

Plik to płaski strumień **headline'ów** (nagłówków) tworzących hierarchię
przez liczbę gwiazdek. Nie ma nagłówka pliku ani globalnych właściwości —
pierwszy headline poziomu 1 zaczyna treść.

```org
* PROPOSAL Tytuł pierwszego węzła :tag1:tag2:
:PROPERTIES:
:ID: n1
:END:
Notatki tego węzła — dowolna liczba linii
do następnego nagłówka.
** WORK-UNIT [#A] Dziecko poziomu 2
:PROPERTIES:
:ID: n2
:END:
* DONE Drugi węzeł poziomu 1
:PROPERTIES:
:ID: n3
:END:
```

Korzeń drzewa (`Plan Root`) jest **czysto logiczny** — nie pojawia się
w pliku. Dzieci korzenia to headline'y poziomu 1.

## Headline (nagłówek)

Pełny format linii nagłówka:

```
<gwiazdki> [TODO-STATE] [#PRIORITY] tytuł [:tag:tag:]
```

Regex parsera (`OrgReader.mts`):

```
^(\*+)\s+(?:(TODO|PROPOSAL|QUESTION|WORK-UNIT|DROPPED|DONE)\s+)?(?:\[#([ABC])\]\s+)?(.+?)(?:\s+(:(?:[^:\s]+:)+))?$
```

Składniki, w kolejności:

| Część        | Wymagana | Opis |
|--------------|----------|------|
| Gwiazdki `*` | tak      | Poziom zagnieżdżenia = liczba gwiazdek. `*` = poziom 1, `**` = poziom 2 itd. Po gwiazdkach musi być spacja. |
| TODO-state   | nie      | Jedno z słów kluczowych (patrz niżej). Brak = węzeł dostaje domyślnie `TODO`. |
| Priority     | nie      | Cookie `[#A]`, `[#B]` lub `[#C]`. |
| Tytuł        | tak      | Jednowierszowy tekst. Parsowany „non-greedy", więc końcowe tagi są odcinane. |
| Tagi         | nie      | `:tag1:tag2:` na końcu linii, bez spacji wewnątrz. |

### Poziomy i hierarchia

Hierarchia wynika wyłącznie z liczby gwiazdek. Węzeł o poziomie *N* staje
się dzieckiem najbliższego poprzedzającego węzła o poziomie *< N*. Przeskoki
poziomów (np. `*` → `***`) są tolerowane — `***` po prostu trafia pod
ostatni płytszy węzeł.

## TODO states

plan-tree zna **dokładnie sześć** słów kluczowych (`src/types.mts`,
typ `TodoState`):

| State       | Znaczenie w modelu plan-tree |
|-------------|------------------------------|
| `TODO`      | Domyślny, neutralny stan. Węzeł bez słowa kluczowego również jest `TODO`. |
| `PROPOSAL`  | Propozycja agenta czekająca na decyzję użytkownika. |
| `QUESTION`  | Pytanie agenta — nie ginie w czacie, czeka na odpowiedź. |
| `WORK-UNIT` | Konkretna, wykonywalna jednostka pracy (liść planu). |
| `DROPPED`   | Odrzucone / porzucone. |
| `DONE`      | Zrealizowane / zdecydowane. |

> **Uwaga o niespójności:** instrukcje serwera MCP oraz opis skilla
> wspominają stany `DECISION` i `RISK`. **Kod ich nie obsługuje** — parser
> ich nie rozpozna (trafią do tytułu jako zwykły tekst). Kanoniczna lista to
> sześć stanów powyżej. Decyzje wyrażaj jako `DONE`, a ryzyka — np. tagiem.

W TUI klawisz cyklu TODO przechodzi `TODO → WORK-UNIT → DONE → TODO`;
pozostałe stany ustawia się celowo (`PROPOSAL`/`QUESTION`/`DROPPED`).

## Priority cookie

`[#A]`, `[#B]`, `[#C]` — zgodnie z org-mode `A` jest najwyższy, `C`
najniższy. Brak cookie = brak priorytetu (`null`), co dotyczy większości
węzłów. Cookie stoi **po** stanie TODO, a **przed** tytułem:

```org
** WORK-UNIT [#A] Zadanie o wysokim priorytecie
```

## Tagi

Tagi zapisywane są na końcu linii nagłówka w formie `:tag1:tag2:tag3:`.
Reguły:

- Bez białych znaków i bez `:` w nazwie tagu.
- Przy zapisie tagi są zawsze doklejane na końcu tytułu z separatorem `:`.

Tag o specjalnym znaczeniu w plan-tree:

- **`:assumed:`** — „poszedłem dalej tym tropem, potwierdź zanim wbiję
  głębiej". Jest **ortogonalny** do stanu TODO (węzeł może być
  `PROPOSAL :assumed:`, `WORK-UNIT :assumed:` itd.). Renderowany
  bursztynowo w TUI. Agent zdejmuje go po potwierdzeniu użytkownika.

## Properties drawer

Bezpośrednio pod nagłówkiem może wystąpić blok właściwości:

```org
:PROPERTIES:
:ID: n42
:ANCHOR: t
:FROZEN: t
:END:
```

Reguły parsowania:

- Otwarcie: linia pasująca do `^\s*:PROPERTIES:\s*$`.
- Zamknięcie: linia pasująca do `^\s*:END:\s*$`.
- Każda linia wewnątrz: `:KLUCZ: wartość` (wartość może być pusta).
- Drawer jest opcjonalny; jeśli węzeł nie ma żadnych właściwości, blok
  nie jest zapisywany.

### Znane właściwości

| Klucz     | Wartość | Znaczenie |
|-----------|---------|-----------|
| `ID`      | `n<N>`  | **Stabilny identyfikator** węzła, np. `n42`. Agent i użytkownik odwołują się do węzłów po tym ID. Patrz niżej. |
| `ANCHOR`  | `t`     | Węzeł zakotwiczony — kontrakt, że agent **nie** modyfikuje go ani jego poddrzewa. Kotwica kaskaduje na całe poddrzewo. Brak narzędzia „unanchor" po stronie MCP. |
| `FROZEN`  | `t`     | Gałąź zamrożona — pominięta w `tree://summary` i `find` (razem z całym poddrzewem). „Pauza" na tej gałęzi. |

Dowolne inne klucze są zachowywane przy round-trip (parser zapisuje
do mapy, writer je odtwarza), ale nie mają specjalnego znaczenia.

### Identyfikatory `ID`

- Format: `n` + liczba (`n1`, `n2`, … `n42`). Generowane sekwencyjnie.
- Przy wczytywaniu pliku parser skanuje wszystkie `:ID:` typu `n<N>`,
  znajduje maksimum i **reseeduje licznik na max+1** — nowe węzły nie
  kolidują z już zapisanymi.
- Węzeł **bez** `:ID:` w pliku dostaje świeżo wygenerowane ID, które jest
  **wstrzykiwane do modelu i zapisywane** przy najbliższym zapisie
  (stabilność round-trip). Praktycznie: po pierwszym otwarciu i zapisaniu
  każdy węzeł ma już swoje ID w pliku.

## Notatki (body)

Cały tekst między nagłówkiem (lub jego properties drawer) a następnym
nagłówkiem to **notatki** węzła:

- Puste linie na początku/końcu są obcinane (`trim`).
- Linie czysto-puste wewnątrz są pomijane przy zbieraniu (parser
  dokleja tylko linie z treścią) — wielowierszowe notatki zachowują
  podziały między liniami z treścią.
- Notatki są dowolnym tekstem; org-mode markup wewnątrz nie jest
  interpretowany.

Konwencja plan-tree: rekomendacje agenta zapisywane są w notatkach
z prefiksem `Rekomendacja: …`.

## Czego plan-tree NIE obsługuje

Dla jasności — te konstrukcje org-mode są **ignorowane przy odczycie
i nie powstają przy zapisie**:

- Nagłówki/properties pliku (`#+TITLE:`, `#+STARTUP:` itd.)
- Komentarze `# …`
- Bloki `#+BEGIN_… / #+END_…`
- Znaczniki czasu i planowania (`SCHEDULED:`, `DEADLINE:`, `<2026-…>`)
- Listy zwykłe (`- `, `1. `) — przetrwają tylko jako tekst notatki
- Linki org (`[[…][…]]`) — jako zwykły tekst
- Stany TODO inne niż sześć wymienionych

## Minimalny poprawny plik

```org
* PROPOSAL Zaprojektować eksport CSV :assumed:
:PROPERTIES:
:ID: n1
:END:
Rekomendacja: użyć standardowego RFC 4180.
** QUESTION Czy nagłówek kolumn ma być lokalizowany?
:PROPERTIES:
:ID: n2
:END:
** WORK-UNIT [#A] Napisać serializer
:PROPERTIES:
:ID: n3
:END:
* DONE Wybrać bibliotekę parsującą
:PROPERTIES:
:ID: n4
:ANCHOR: t
:END:
```
