# plan-tree — cel projektu

## Po co to istnieje

plan-tree (TUI + MCP server) jest narzędziem które **pozwala użytkownikowi
nadążyć za tempem agenta Claude'a**. Nie odwrotnie. Nie jest ograniczeniem
dla mnie — jest przyspieszaczem dla niego.

Jako agent jestem szybki: rozszerzam scope, dorzucam detali, generuję
pytania, proponuję warianty. To wszystko w tempie którego użytkownik
nie ogarnia mentalnie ani manualnie. Wynik bez plan-tree: ściana tekstu,
zapomniane decyzje, narastający scope creep, frustracja po obu stronach.

Wynik z plan-tree:

- Każda moja propozycja → węzeł w drzewie z jednym ID
- Każde pytanie → QUESTION który nie ginie w czacie
- Każda decyzja → DONE/DECISION z notatką dlaczego
- Każda kotwica użytkownika → ANCHOR którego nie ruszam
- Stan zawsze widoczny w TUI, autosave do pliku, niemożliwe do "zgubienia"

Użytkownik decyduje w swoim tempie, nie w moim. Plan jest zewnętrzną
pamięcią, którą oboje współdzielimy.

Inaczej mówiąc: plan-tree to **siodło, nie uprząż**. Uprząż ciągnie wstecz
i ogranicza ruch. Siodło robi z agenta narzędzie do jazdy — daje userowi
kontrolę nad kierunkiem i tempem, nie kastrując prędkości konia.

## Jak myśleć projektując nowe funkcje

Każda nowa funkcja przechodzi pierwszy filtr: **czy ona skraca czas od
mojej propozycji do decyzji użytkownika?**

- ✅ ASSUMED vs PROPOSAL — różnicuje "działam dalej" vs "czekam"
- ✅ Klawisz R akceptujący moją rekomendację — 1 keystroke zamiast 3
- ✅ Dashboard QUESTIONów — batch decyzji
- ✅ ANCHOR — kontrakt że agent nie ruszy tych punktów
- ❌ Markery efortu — wymagają ode mnie zgadywania, niewielka wartość
- ❌ Plan dependency graph — fajne, ale nie skraca decyzji

Funkcje, które wyglądają na "porządek w UI" ale w istocie służą szybkości
poznawczej użytkownika — priorytet wysoki. Funkcje "fajne dodatki" —
niski albo żaden.

## Konkretne zachowania ode mnie

- Czytaj `tree://summary` zanim cokolwiek modyfikujesz. Selekcja w
  ambient `selection` polu — używaj jej do disambiguacji "tego",
  "current", "tu" — nigdy nie pytaj "który masz na myśli" jeśli
  selection mówi jednoznacznie.
- Twoje pytania → `QUESTION` w planie (przez `add` z notami zawierającymi
  rekomendację). Nie zostawiaj pytań tylko w czacie.
- Twoje założenia ("zakładam X bo Y") → tag `:assumed:` (przez
  `addTag`). Jest ortogonalny do stanu TODO — węzeł może być
  `PROPOSAL :assumed:`, `WORK-UNIT :assumed:` itd. Znaczy "poszedłem
  dalej tym tropem, potwierdź zanim wbiję głębiej". Renderuje się
  bursztynowo. Zdejmij tag (`removeTag`) gdy user potwierdzi. Nigdy nie
  kontynuuj cicho po założeniu, które użytkownik może chcieć cofnąć.
- ANCHOR — nigdy nie modyfikuj. Jeśli musisz, eskaluj do użytkownika
  jawnie ("n42 jest anchorem — czy mogę go zmienić, czy projektuję
  alternatywę?"). Nie próbuj unanchor "po cichu".
- Rekomendacje pisz w notes z prefiksem `Rekomendacja: ...` — wtedy
  użytkownik wciśnie R i jednym ruchem zaakceptuje (gdy n32 zostanie
  zaimplementowane).

## Skille i protokoły

- **Skill `plan-tree`** (`~/trove/claude-code-setup/skills/plan-tree/`)
  — kanoniczna instrukcja jak rozkładać zadania. Aktualizowany razem
  z tym repo gdy zmienia się model.
- **MCP server** — zawsze preferowany nad bezpośrednią edycją pliku.
  Fallback do pliku tylko po explicit consent użytkownika.

## CHANGELOG i wersje

Historia rozwoju w `CHANGELOG.md` — semantic versioning. Bumpuj wersję
przy każdej istotnej zmianie (zgodnie z globalnym CLAUDE.md użytkownika).
