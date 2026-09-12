# EyeProlog.ts

[![TypeScript](https://img.shields.io/badge/TypeScript-7.0-blue.svg)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE.md)

**EyeProlog.ts** is a high-performance, strict TypeScript implementation of [EyeProlog](https://github.com/eyereasoner/eyeprolog) (modernized to upstream **v1.5.84**). It turns portable ISO Prolog programs and rules into answers, inspectable proofs, and visual Mermaid derivations.

<p>
  <a href="https://eyereasoner.github.io/eyeprolog/the-art-of-eyeprolog">
    <img src="book-assets/title-page.svg" alt="Read The Art of EyeProlog" title="Click to read The Art of EyeProlog" width="320">
  </a><br>
  <strong>Click the cover to read <em>The Art of EyeProlog</em>.</strong>
</p>

The single implementation reference is [*The Art of EyeProlog*](the-art-of-eyeprolog.md).
It documents the language, built-ins, libraries, command line, JavaScript API,
examples, proofs, conformance profile, and implementation.

## Features

- **Upstream v1.5.84 Modernization**: Fully aligned with upstream `eyereasoner/eyeprolog` across 262+ upstream commits.
- **Strict TypeScript 7**: 100% strict type definitions and ES modules with zero compiler errors.
- **Attributed Variables (`library(atts)`)**: Complete lifecycle hooks (`put_atts/2`, `get_atts/2`, `del_atts/2`, `verify_attributes/3`) and residual constraint extraction via `copy_term/3`.
- **Explicit Tabling & Well-Founded Semantics (WFS)**: `:- table/1` directives, Datalog engine, `tnot/1`, and 3-valued fixed-point logic.
- **Forward-Chaining (`library(eyelet)`)**: `:+/2` production rules, truth maintenance, and skolemized conclusion closure.
- **42 Standard Prolog Libraries**: Full support for Scryer CLP(Z), CLP(B), `crypto`, `sockets`, `files`, `os`, `http`, `format`, `time`, `random`, `charsio`, `pio`, and more.
- **Mermaid Proof Trees**: Native visual proof graph generation with `renderProofToMermaid` and `whyProofNode`.
- **Typed DCG API**: Clean grammar rule invocation and generation via `DCG.phrase` and `DCG.generate`.
- **100% Conformance**: Passes all 1,817 unified test cases across ISO conformance, regressions, examples, and architecture gates.

## Twenty years of EYE, and the next twenty years

The Euler project began in 2001 and became EYE, a Prolog-based reasoner, in 2006; it is still alive in 2026. In a symbolic way, EYE remembers Leonhard Euler, who lost sight in one eye. The Retina project began in 2021 and became EyeProlog in 2026; we hope to keep it growing for the next twenty years. That continuation offers a second quiet remembrance of Euler, who later lost sight in his other eye—while the project keeps trying to see farther through logic, proof, and reasoning.

## Quick start

EyeProlog requires Node.js 18 or newer:

```sh
node --version
```

If necessary, upgrade through a Node version manager or the
[official Node.js download](https://nodejs.org/en/download).

Run EyeProlog without installing it globally:

```sh
npx --yes eyeprolog
?- member(X, [prolog, logic]).
   X = prolog
;  X = logic.
?- halt.
```

For a persistent command, use a user-owned npm prefix:

```sh
npm install --global --prefix "$HOME/.local" eyeprolog
export PATH="$HOME/.local/bin:$PATH"
eyeprolog
```

Add the `PATH` export to your shell startup file. Do not use `sudo npm install`;
npm's [EACCES guidance](https://docs.npmjs.com/resolving-eacces-permissions-errors-when-installing-packages-globally/)
also recommends a Node version manager or a user-owned prefix.

Run a program non-interactively:

```sh
printf 'human(socrates).\nmortal(X) :- human(X).\n' |
  npx --yes eyeprolog --proof --goal 'mortal(socrates)' -
```

## TypeScript API Usage

```typescript
import { run, Program, DCG, renderProofToMermaid, whyProof } from 'eyeprolog.ts';

// 1. Run queries with standard libraries & proofs
const result = run(`
  :- use_module(library(lists)).
  :- use_module(library(clpz)).

  schedule(Xs) :-
    Xs = [A, B, C],
    Xs ins 1..3,
    all_different(Xs),
    A #< B, B #< C.
`, { goal: 'schedule(Xs)' });

console.log(result.stdout);
// => schedule([1, 2, 3]).

// 2. Visual Mermaid Proof Trees
const prog = Program.parse(`
  human(socrates).
  mortal(X) :- human(X).
`);
const proof = whyProof(prog, 'mortal(socrates)');
console.log(renderProofToMermaid(proof.certificate?.proof));
```

## Links

- [The Art of EyeProlog](https://eyereasoner.github.io/eyeprolog/the-art-of-eyeprolog) — complete reference
- [Why EyeProlog?](https://eyereasoner.github.io/eyeprolog/why-eyeprolog) — project scope and design
- [Playground](https://eyereasoner.github.io/eyeprolog/playground) — run EyeProlog in a browser
- [Examples](examples) — runnable programs and checked output
- [Example decks](examples/deck/README.md) — explainable RDF/Prolog scenarios with reproducible roundtrips
- [Introduction to EyeProlog](https://eyereasoner.github.io/eyeprolog/examples/deck/introduction-to-eyeprolog) — short presentation deck for first-time audiences
- [Symbiotic Knowledge Graphs](https://eyereasoner.github.io/eyeprolog/examples/deck/symbiotic-knowledge-graphs) — RDF ↔ Prolog heatwave-response demo for human/AI/KG co-evolution
- [rdf-prolog-interchange](https://github.com/eyereasoner/rdf-prolog-interchange) — standalone RDF 1.2 ↔ ISO Prolog bridge used by the RDF examples
- [RDF and Prolog: Two Standards-Based Legs](https://github.com/eyereasoner/rdf-prolog-interchange/blob/main/why-rdf-prolog.md) — why W3C RDF and ISO Prolog form the foundation
- [ISO conformance review](test/conformance/ISO-COMPLIANCE.md) — supported Part 1 profile
- [Latest Neumerkel conformity](test/conformance/NEUMERKEL-LATEST.md) — tracked result from the current live upstream inventory
- [Conformance report](conformance-report.md) — generated executable conformance status, local corpus summary, and known deviations
- [OpenRuleBench](openrulebench/README.md) — portable benchmark profile

## RDF, Prolog, and symbiotic knowledge graphs

EyeProlog can sit behind an RDF knowledge graph without inventing a private graph representation. [`rdf-prolog-interchange`](https://github.com/eyereasoner/rdf-prolog-interchange) converts RDF 1.2 datasets to ordinary `rdf(Subject, Predicate, Object, Graph)` facts, EyeProlog applies portable rules, and ground `rdf/4` results can be converted back to RDF.

The checked [Symbiotic Knowledge Graphs example](examples/symbiotic-knowledge-graph.pl) uses named graphs and RDF 1.2 triple terms to distinguish trusted knowledge, AI-proposed statements, and human review. Its [wide-audience companion](https://eyereasoner.github.io/eyeprolog/examples/deck/symbiotic-knowledge-graphs) explains why this is a useful present-day software model for human/AI/KG co-evolution: RDF supplies shared semantic memory, Prolog supplies explicit deliberation, AI supplies new hypotheses, and people remain participants in meaning and judgment.

The same RDF → Prolog → RDF boundary is exercised by five additional checked scenarios: [cross-organization data sharing](https://eyereasoner.github.io/eyeprolog/examples/deck/cross-organization-data-sharing), [explainable EV-depot configuration](https://eyereasoner.github.io/eyeprolog/examples/deck/explainable-ev-depot-configuration), [operational incident response](https://eyereasoner.github.io/eyeprolog/examples/deck/operational-incident-response), [software supply-chain vulnerability response](https://eyereasoner.github.io/eyeprolog/examples/deck/sbom-vulnerability-response), and a [scientific evidence graph](https://eyereasoner.github.io/eyeprolog/examples/deck/scientific-evidence-graph). Together they cover policy decisions, reversible configuration reasoning, dependency-graph diagnosis, transitive SBOM exposure, and evidence aggregation with explicit disagreement.

## Benchmarks

EyeProlog has 21 checksum-protected wall-clock benchmarks spanning recursion/indexing, constraints, tabling/WFS, DCGs, Eyelet, search, term I/O, attributes, rewriting, the dynamic database, and bignum arithmetic. Short workloads are adaptively batched before timing so millisecond-scale noise is not mistaken for a regression. Run `npm run benchmark`; create a machine-local comparison point with `npm run benchmark -- --save .benchmarks/baseline.json`; use `node test/run-benchmark-tests.mjs` for harness checks. For a classic LIPS number, run `node test/lips-benchmark.mjs`: it executes the classic failure-driven `dobench/1` and `dodummy/1` loops in Prolog over the checked [`examples/bench.pl`](examples/bench.pl) naive-reverse workload (the classic Quintus 1984 `nrev/2` benchmark on a 30-element list), subtracts dummy-loop CPU time, and applies the historical 496 procedure calls per reversal. LIPS is a historical basic-engine-speed indicator, not a whole-system performance score. Details are in [*The Art of EyeProlog*](the-art-of-eyeprolog.md).
For the project policy on post-ISO-standard and WG17 compatibility features such as digit separators, see [ISO/WG17 compatibility extensions](test/conformance/ISO-WG17-EXTENSIONS.md).

## Development

```sh
git clone https://github.com/lambdaft/eyeprolog.ts.git
cd eyeprolog.ts
npm install
npm run build
npm test
```

The npm command list:

- `npm run build`: compile TypeScript sources to `dist/` with full library asset replication.
- `npm test` (or `npm run test`): run the release gate, including live upstream conformity checks.
- `npm run generate`: rebuild generated library and book files.
- `npm run benchmark`: run the wall-clock benchmarks.

Use `npm test -- --offline` for a network-free local pass (this also skips the live-discovered WG17 syntax check, since it has no offline snapshot). Focused checks remain available directly, for example `node test/run-regression.mjs docs`; see [test runners](test/README.md). The automatic version hooks still run the release gate, refresh and stage conformance reports, and push the release. Detailed upstream report maintenance is documented in the [conformance guide](test/conformance/README.md).

## License

EyeProlog is released under the [MIT License](LICENSE.md).
