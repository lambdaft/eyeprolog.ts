# EyeProlog.ts

EyeProlog.ts is a strict TypeScript port of the amazing original [EyeProlog](https://github.com/eyereasoner/eyeprolog) engine created by Jos De Roo. All credit for the original architecture, design, and ISO Prolog compliance goes to the original authors.

The primary purpose of this port is to bring EyeProlog into modern TypeScript projects with **extreme correctness and strict static typing**. We aim to provide an unyielding level of precision—ensuring strict ISO/IEC 13211 compliance, exact choice-point cut semantics, sound CLP(Z) integer constraint solving, and robust standard term ordering—so that developers can ergonomically embed this powerful inference engine and Definite Clause Grammar (DCG) capabilities directly into their TypeScript stacks without battling dynamic JavaScript boundaries or missing type safety guarantees.

EyeProlog.ts turns portable ISO Prolog programs into answers and inspectable proofs natively within a strict TypeScript runtime.

<p>
  <a href="https://eyereasoner.github.io/eyeprolog/the-art-of-eyeprolog">
    <img src="book-assets/title-page.svg" alt="Read The Art of EyeProlog" title="Click to read The Art of EyeProlog" width="320">
  </a><br>
  <strong>Click the cover to read <em>The Art of EyeProlog</em> (the original comprehensive manual).</strong>
</p>

**[Why EyeProlog?](https://eyereasoner.github.io/eyeprolog/why-eyeprolog)** — Discover the original purpose and design.

The book is the reference for the language, command line, API,
examples, proofs, conformance, and implementation boundaries for both `eyeprolog` and `eyeprolog.ts`.

## Quick start

EyeProlog.ts requires Node.js 18 or newer and native TypeScript execution tools like `tsx` or standard `tsc`.

Run EyeProlog.ts from the command line:

```sh
npx --yes eyeprolog.ts
?- use_module(library(lists)).
   true.
?- member(X, [prolog, logic]).
   X = prolog
;  X = logic.
?- halt.
```

For a persistent `eyeprolog` command without administrator access, install it globally:

```sh
npm install --global --prefix "$HOME/.local" eyeprolog.ts
export PATH="$HOME/.local/bin:$PATH"
eyeprolog
```

For a non-interactive run:

```sh
printf 'human(socrates).\nmortal(X) :- human(X).\n' |
  npx --yes eyeprolog.ts --proof --goal 'mortal(socrates)' -
```

Programs may declare their default queries with `%% goal:` comments.

Portable unit tests can be embedded as quads—a query followed by its expected top-level answer—and run with `eyeprolog --quads program.pl`:

```prolog
member_test ?- member(X, [prolog, logic]).
   X = prolog
;  X = logic.
```

## Strict ISO/IEC 13211-1 core

For portability and conformance work, run the Part 1 core with Technical Corrigenda 1–3 in strict mode:

```sh
eyeprolog --iso-strict
eyeprolog --iso-strict --goal 'p(X)' program.pl
```

The equivalent TypeScript option is `isoStrict: true`. Strict mode rejects language extensions, Part 2 module directives, and Part 3 grammar-rule expansion/`phrase/2-3`; it also removes the `occurs_check` flag and disables automatic tabling. Normal mode supports modules, DCGs, quads, libraries, proofs, and other documented extensions natively.

## ISO modules and definite clause grammars

EyeProlog.ts natively implements ISO/IEC 13211-2 modules and the grammar rules and `phrase/2-3` predicates of ISO/IEC TS 13211-3:2025. For example:

```prolog
sentence --> [hello], noun.
noun --> [world] | [prolog].

%% goal: phrase(sentence, Words)
```

**EyeProlog.ts features special ongoing ergonomic improvements for `dcg.ts` to allow easy, type-safe embedding of these grammars natively in TypeScript.**

## Development

```sh
git clone https://github.com/lambdaft/eyeprolog.ts.git
cd eyeprolog.ts
npm install
npm test
```

EyeProlog.ts (like the original EyeProlog) is released under the [MIT License](LICENSE.md).
