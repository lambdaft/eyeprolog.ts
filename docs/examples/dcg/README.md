# DCG Examples

This directory contains 10 extensive examples of using Definite Clause Grammars (DCG) natively in TypeScript using the `eyeprolog.ts` library's `DCG` API wrapper.

Each directory contains a `grammar.dcg` file (the raw prolog grammar) and an `index.ts` file demonstrating parsing and sequence generation natively from TypeScript strings and arrays.

## Examples
1. **nlp**: Natural Language Processing for subject-verb-object parsing with singular/plural agreement.
2. **markdown**: Basic Markdown syntax to AST tree parsing.
3. **json**: Full JSON syntax validation parsing.
4. **regex**: Regular expression matching (`(a|b)*c+`).
5. **math**: Arithmetic expression evaluator (`2 + 3 * 5`).
6. **dna**: Bio-informatics motif and sequence finder.
7. **html**: Basic HTML tag structure parsing.
8. **date**: Natural text date parser.
9. **sql**: SQL query statement parser (`SELECT ... FROM ... WHERE`).
10. **lisp**: Lisp s-expression tokenizer.
