# EyeProlog.ts

**EyeProlog.ts** is a TypeScript port of the [EyeProlog](https://github.com/eyereasoner/eyeprolog) engine by **Jos De Roo**. All credit for the original architecture, design, and ISO Prolog compliance belongs to the original authors.

The port brings EyeProlog's inference engine into modern TypeScript/JavaScript runtimes so you can embed logic programming — facts, rules, constraint solving, and grammars — directly in your projects, both from the command line and as a library.

The public API is typed, but the internal engine model currently uses **gradual typing** (some `any` annotations carried over from the JavaScript original). This is an honest limitation of the port, not a claim of compile-time type safety for every internal call.

<p>
  <a href="https://eyereasoner.github.io/eyeprolog/the-art-of-eyeprolog">
    <img src="docs/book-assets/title-page.svg" alt="Read The Art of EyeProlog" title="Click to read The Art of EyeProlog" width="320">
  </a><br>
  <strong>Click the cover to read <em>The Art of EyeProlog</em> (the original comprehensive manual).</strong>
</p>

- **[Web Playground](https://eyereasoner.github.io/eyeprolog/playground)**
- **[Why EyeProlog?](https://eyereasoner.github.io/eyeprolog/why-eyeprolog)**
- **[Enhancements Guide](docs/ENHANCEMENTS.md)** — TypeScript-specific improvements over the original engine

The book is the reference for the language, command line, API, examples, proofs, and conformance for both `eyeprolog` and `eyeprolog.ts`.

---

## Contents

- [Features](#features)
- [Quick start](#quick-start)
- [Using EyeProlog.ts as a library](#using-eyeprologts-as-a-library)
- [Command-line reference](#command-line-reference)
- [Strict ISO mode](#strict-iso-mode)
- [Modules and definite clause grammars](#modules-and-definite-clause-grammars)
- [Proofs and visual proof trees](#proofs-and-visual-proof-trees)
- [Development](#development)
- [Documentation and resources](#documentation-and-resources)
- [License](#license)

---

## Features

- **ISO/IEC 13211-1 core** with Technical Corrigenda 1–3, including standard term ordering, unification, and the ISO `setup_call_cleanup`/error model.
- **ISO modules** (ISO/IEC 13211-2) — `use_module/1-2`, `module/2`, and qualified goals.
- **Definite Clause Grammars** — grammar rules and `phrase/2-3` from ISO/IEC TS 13211-3:2025.
- **Quads** — embed portable unit tests as a query plus its expected top-level answers.
- **CLP(Z) integer constraints** — sound constraint logic programming over integers.
- **Tabling** — memoized evaluation for recursive and stratified predicates.
- **Stratified negation** — negation dependency analysis and stratification checks.
- **Proofs** — textual explanations plus inspectable proof trees, including **Mermaid** flowchart rendering.
- **Programmatic API** — parse, solve, inspect, and render from TypeScript with a typed surface.

---

## Quick start

EyeProlog.ts requires **Node.js 18 or newer**. Check your runtime:

```sh
node --version
```

### Run without installing

Launch the REPL or run a goal directly via `npx`:

```sh
npx --yes eyeprolog.ts
?- use_module(library(lists)).
   true.
?- member(X, [prolog, logic]).
   X = prolog
;  X = logic.
?- halt.
```

### Install a persistent command

For a global `eyeprolog` command without administrator access, install into a user-owned prefix:

```sh
npm install --global --prefix "$HOME/.local" eyeprolog.ts
export PATH="$HOME/.local/bin:$PATH"
eyeprolog
```

Do not use `sudo npm install`; npm's [EACCES guidance](https://docs.npmjs.com/resolving-eacces-permissions-errors-when-installing-packages-globally/) recommends a user-owned prefix.

### Non-interactive runs

Pipe a program in and pass a goal with `--goal`:

```sh
printf 'human(socrates).\nmortal(X) :- human(X).\n' |
  npx --yes eyeprolog.ts --proof --goal 'mortal(socrates)' -
```

### Embedded tests with quads

A *quad* is a query followed by its expected top-level answers. Run a suite with `--quads`:

```prolog
member_test ?- member(X, [prolog, logic]).
   X = prolog
;  X = logic.
```

```sh
eyeprolog --quads program.pl
```

Programs may also declare their default queries with `%% goal:` comments.

---

## Using EyeProlog.ts as a library

Install the package and import from the typed entry point:

```sh
npm install eyeprolog.ts
```

```ts
import { Program, renderProofToMermaid } from 'eyeprolog.ts';

const program = Program.parse('human(socrates).\nmortal(X) :- human(X).\n');

// Render the derivation tree for a goal as a Mermaid flowchart:
const mermaidGraph = renderProofToMermaid(program, 'mortal(socrates)');
console.log(mermaidGraph);
```

### Key API surfaces

| Export | Purpose |
| --- | --- |
| `Term`, `Env`, `Program`, `Solver`, `DCG` | Core engine objects (parse, solve, inspect). |
| `variable`, `atom`, `stringTerm`, `numberTerm`, `compound`, `cons`, `emptyList` | Term constructors. |
| `unify`, `deref`, `copyResolved`, `termToString`, `compareTerms`, `variantTerms` | Term operations and standard order. |
| `run(source, options)` | Parse and solve, returning `{ stdout, stats, haltCode, mermaidProof }`. |
| `runQuads(source, options)` | Execute embedded quad tests and report pass/fail. |
| `whyProof`, `explainProof`, `renderProofToMermaid` | Produce textual/visual proofs. |
| `BuiltinRegistry`, `createDefaultRegistry`, `getEyePrologRegistry`, `getStrictIsoRegistry` | Extend or restrict the builtin set. |

Common `run` / `Program` options include `goal`, `goals`, `proof`, `isoStrict`, `maxDepth`, `maxInferences`, `solutionLimit`, `doubleQuotes`, and `fastPaths`. See `index.d.ts` for the full typed surface.

---

## Command-line reference

```
eyeprolog [options] [files]
```

`files` defaults to `-` (standard input). Options:

| Option | Description |
| --- | --- |
| `--goal GOAL` | Run `GOAL` (repeatable). If omitted, queries are read from `%% goal:` comments or the REPL. |
| `--proof` | Print a textual proof explanation for the answer(s). |
| `--quads` | Run embedded quad tests instead of (or in addition to) normal execution. |
| `--stats` | Print inference/resource statistics after execution. |
| `--iso-strict` | Restrict to ISO/IEC 13211-1 + Corrigenda 1–3 (see below). |
| `--warnings` | Emit portability/feature warnings. |
| `--version` | Print the version and exit. |
| `--help` | Print usage and exit. |

`--iso-strict` cannot be combined with `--quads`.

---

## Strict ISO mode

For conformance work, run the Part 1 core with the corrigenda in strict mode:

```sh
eyeprolog --iso-strict
eyeprolog --iso-strict --goal 'p(X)' program.pl
```

The equivalent library option is `isoStrict: true`. Strict mode:

- rejects language extensions, Part 2 module directives, and Part 3 grammar-rule expansion / `phrase/2-3`;
- removes the `occurs_check` flag;
- disables automatic tabling.

Normal mode supports modules, DCGs, quads, libraries, proofs, and other documented extensions natively.

---

## Modules and definite clause grammars

EyeProlog.ts natively implements ISO/IEC 13211-2 modules and the grammar rules and `phrase/2-3` predicates of ISO/IEC TS 13211-3:2025.

```prolog
sentence --> [hello], noun.
noun --> [world] | [prolog].

%% goal: phrase(sentence, Words)
```

The `dcg.ts` layer provides ergonomic helpers for embedding these grammars and parsing/ generating with them from TypeScript.

---

## Proofs and visual proof trees

Beyond textual proof explanations, derivation trees can be rendered as styled **Mermaid** flowcharts (`graph TD`):

```ts
import { Program, renderProofToMermaid } from 'eyeprolog.ts';

const program = Program.parse('human(socrates).\nmortal(X) :- human(X).\n');
const graph = renderProofToMermaid(program, 'mortal(socrates)');
console.log(graph); // color-coded nodes for facts, rules, and built-ins
```

Try it interactively in the **[Web Playground](https://eyereasoner.github.io/eyeprolog/playground)** by enabling *"Show proof explanations"* and opening the **Visual Proof Tree (Graph)** tab.

---

## Development

```sh
git clone https://github.com/lambdaft/eyeprolog.ts.git
cd eyeprolog.ts
npm install
npm test
```

Test scripts (see `package.json`):

| Script | What it runs |
| --- | --- |
| `npm test` | Full suite: conformance, strict-ISO, examples, regression, playground. |
| `npm run test:conformance` | ISO/IEC 13211-1 conformance cases. |
| `npm run test:iso-strict` | Strict ISO subset. |
| `npm run test:regression` | Regression and CLI behavior. |
| `npm run build` | Compile TypeScript (`tsc -p tsconfig.json`). |

---

## Documentation and resources

- **[The Art of EyeProlog](https://eyereasoner.github.io/eyeprolog/the-art-of-eyeprolog)** — the original comprehensive manual (language, CLI, API, proofs, conformance).
- **[Why EyeProlog?](https://eyereasoner.github.io/eyeprolog/why-eyeprolog)** — design rationale.
- **[Web Playground](https://eyereasoner.github.io/eyeprolog/playground)** — try it in the browser.
- **[Enhancements Guide](docs/ENHANCEMENTS.md)** — TypeScript-specific improvements and API additions.
- **[Conformance report](docs/conformance-report.md)** — current test status.

---

## License

EyeProlog.ts (like the original EyeProlog) is released under the [MIT License](docs/LICENSE.md).
