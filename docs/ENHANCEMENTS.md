# Enhancements & Improvements in EyeProlog.ts

`EyeProlog.ts` is a strict, production-grade TypeScript port of the original [EyeProlog](https://github.com/eyereasoner/eyeprolog) engine created by Jos De Roo.

While preserving full architectural respect and ISO Prolog compliance from the original implementation, `EyeProlog.ts` introduces significant architectural, type safety, performance, and correctness enhancements designed for modern TypeScript embedders.

---

## 1. Strict TypeScript Architecture & Type Safety

- **Strict Mode Conformance**: Built with ultra-strict `tsconfig.json` compiler flags enabled (`strict: true`, `noUncheckedIndexedAccess`, `noImplicitOverride`, `exactOptionalPropertyTypes`, `erasableSyntaxOnly`), ensuring `npx tsc --noEmit` passes with 0 compilation errors.
- **Typed Abstract Data Types (ADTs)**: Replaced dynamic untyped objects with explicit interfaces and discriminated union types for `Term`, `Env`, `Clause`, `Goal`, and `Solver`.
- **Public API Declarations**: Provides comprehensive, first-class TypeScript declarations (`index.d.ts`) enabling clean imports into ES modules and TypeScript projects without dynamic `any` boundaries.

---

## 2. Engine Correctness & Architecture

- **Single Unified Parser Path**: Completely eliminated dynamic fast-parse shortcuts (`parseClausesFastNoSource`, `CompactBinaryClause`) in favor of a single, highly robust, operator-aware parser pass. This ensures 100% AST parity and eliminates syntax edge-case bugs.
- **Deterministic Generator Solution Accounting**: Refactored solution counting (`solutionsSeen`) in `solver.ts` to operate strictly at the top-level yield point when a complete proof leaf is reached. This removed fragile in-loop decrements and guarantees exact `solutionLimit` enforcement under deep recursion, cuts, and all-solutions builtins (`findall/3`, `bagof/3`, `setof/3`).
- **Meta-Call Choice-Point Isolation**: Scoped choice-point markers for meta-predicates (`once/1`, `catch/3`, `findall/3`) to child solver instances (`cloneForInnerGoal()`), preventing internal cuts from leaking across choice-point stacks or improperly pruning parent goals.
- **Memory Leak Resolution**: Replaced the global process-wide `variableOrders` map with a localized string-name comparison for variable terms during standard order (`@<`, `sort/2`), preventing unbounded memory accumulation in long-running embedder processes.
- **Strict ISO Standard Ordering**: Preserves strict ISO standard term ordering (`VAR @< FLOAT @< INT @< ATOM @< STRING @< COMPOUND`), maintaining exact conformance where `1.0 @< 1`.

---

## 3. Ergonomic Developer APIs

- **High-Level DCG API (`dcg-api.ts`)**: Introduces a high-level `DCG` wrapper class that makes parsing and generating text/token streams in TypeScript straightforward:
  ```typescript
  import { DCG } from 'eyeprolog.ts';
  const dcg = DCG.load(`sentence --> noun, verb.`);
  const result = dcg.parse('sentence', ['the_cat', 'runs']);
  ```
- **Consolidated Error Formatting**: Standardized `PrologError` string formatting using `formatTermForWrite` and `termToString` to render ISO-compliant error envelopes (`error(formal, culprit)`).
- **Opt-In Fast Paths**: Gated non-standard internal optimizations (such as `pushFastPiFrames`) behind an explicit `fastPaths: true` option, ensuring that `isoStrict: true` remains 100% pure and uncompromised.

---

## 4. Test Infrastructure & Audit Hardening

- **Dedicated Audit Regression Suite**: Added `../test/run-audit-regressions.mjs` with 17 new regression tests to continuously verify:
  1. Exact solution-limit counting under deep recursion.
  2. Cut isolation within nested meta-calls.
  3. `PrologError` term string rendering.
  4. Fast-path opt-in flag behaviors.
- **783+ Conformance Cases**: Revalidated against the full ISO/IEC 13211-1 suite (including Technical Corrigenda 1–3), ISO/IEC 13211-2 modules, and ISO/IEC TS 13211-3:2025 grammar rules.
