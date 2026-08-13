# ISO/IEC 13211 Matrix

This matrix maps EyeProlog's ISO/IEC 13211 conformance evidence to representative
executable test files and case categories.

| Standard Area | Cases | Status | Representative Test Files |
|---|---|---|---|
| Clause 6 — tokens, terms, lists, operators, quoted text | audit | `lexical_and_curly_terms`, `scryer_lexical_terms`, operator suites, syntax-error cases, `wg17_syntax_high_risk`, writer/read-back regressions |
| 7.1-7.3 — term types, term order, unification | audit | Standard-order, identity, finite-tree and occurs-check suites, Corrigendum 2 term predicates |
| 7.4 — Prolog text and directives | audit | All Part 1 directive indicators are parsed; include/ensure-loaded/operator/flag/character-conversion behavior has executable coverage |
| 7.5-7.6 — database and term/clause conversion | audit | Dynamic database and logical-update-view suites |
| 7.7 — execution and backtracking | audit | Control/search suites |
| 7.8 — control constructs and exceptions | audit | call, cut, conjunction, disjunction, if-then, catch/throw, renamed-copy tests |
| 7.9 — expression evaluation | audit | Arithmetic/evaluation/error suites, including Corrigenda |
| 7.10 — input/output concepts | audit | Stream, character/byte I/O, read/write options, operator-sensitive write-back, Corrigendum 3 writer cases |
| 7.11 — flags | audit | Required Part 1 flags implemented |
| 7.12 — errors | audit | ISO `error(Error, Context)` envelope, type/domain/permission/representation/evaluation/syntax families |
| 8.2-8.17 — built-in predicates | audit | Predicate-family coverage mapped below |
| Clause 9 — evaluable functors | audit | Integer/float/rounding/transcendental/bitwise suites and corrigendum cases |
| ISO/IEC 13211-2 — modules | covered | `module/2`, `use_module/1-2`, `meta_predicate/1` |
| ISO/IEC TS 13211-3 — grammar rules | covered | `phrase/2-3`, DCG expansion, Part 3 quad corpus |
| Corrigendum 1 | covered | Double-quoted atom/operator-priority corrections |
| Corrigendum 2 | covered | Added predicates/functors, catch corrections, bar/operator and uninstantiation corrections |
| Corrigendum 3 | covered | Writer options, `variable_names/1`, canonical list output and negative-power corrections |

## Built-in predicate coverage

| Family | Predicates | Status |
|---|---|---|
| Type tests | `var/1`, `nonvar/1`, `integer/1`, `float/1`, `number/1`, `atom/1`, `string/1`, `compound/1`, `callable/1`, `ground/1` | audit |
| Term comparison | `compare/3`, `@</2`, `@=<2`, `@>/2`, `@>=/2`, `==/2`, `\==/2`, `=/2`, `\=/2` | audit |
| Term construction | `functor/3`, `arg/3`, `=../2`, `copy_term/2`, `term_variables/2`, `subsumes_term/2`, `numbervars/3` | audit |
| Control | `call/N`, `catch/3`, `throw/1`, `once/1`, `repeat/0`, `fail/0`, `true/0`, `false/0` | audit |
| Database | `asserta/1`, `assertz/1`, `retract/1`, `retractall/1`, `abolish/1`, `clause/2` | audit |
| All-solutions | `findall/3`, `bagof/3`, `setof/3` | audit |
| I/O | `read/1`, `read_term/3`, `write/1`, `write_term/3`, `nl/0`, `get_char/1`, `put_char/1`, `open/4`, `close/1`, `stream_property/2` | audit |
| Arithmetic | `is/2`, `=:=`, `=\=`, `<`, `=<`, `>`, `>=`, `+`, `-`, `*`, `/`, `//`, `div`, `mod`, `rem`, `**`, `^`, bitwise, trig | audit |

## Conformance corpus files

| Category | Directory | Count | Description |
|---|---|---|---|
| Positive cases | `test/conformance/cases/` | 18 | Standard behavior tests |
| Error cases | `test/conformance/errors/` | 8 | Expected error tests |
| Warning cases | `test/conformance/warnings/` | 1 | Expected warning tests |
| Proof cases | `test/conformance/proofs/` | 1 | Proof output tests |
| **Total** | | **28 files** | **783 test cases** |

## Third-party test provenance

| Source | License | Coverage |
|---|---|---|
| Logtalk Prolog conformance tests | Apache 2.0 | Term, atom, character, collection, control, conversion, Part 3 grammar |
| Scryer Prolog ISO conformity tests | BSD 3-Clause | Lexical, term, numeric, comment, operator |
| Trealla Prolog core tests | MIT | Standard-core cases |
| SWI-Prolog core tests | BSD 2-Clause | Operator and finite-tree unification |
