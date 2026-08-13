/**
 * Ergonomic wrapper for running Definite Clause Grammars (DCG) natively in TypeScript.
 */
export declare class DCG {
    program: any;
    solver: any;
    constructor();
    /**
     * Load Prolog/DCG source code from a string.
     */
    load(sourceCode: string): void;
    /**
     * Load Prolog/DCG source code from a file path.
     */
    loadFile(filePath: string): void;
    private initSolver;
    /**
     * Helper to convert JS Arrays/Primitives to Prolog Terms.
     */
    private toPrologTerm;
    /**
     * Helper to convert Prolog Terms back to JS Objects/Arrays.
     */
    private fromPrologTerm;
    /**
     * Parses the given tokens against the startRule.
     * Equivalent to `phrase(startRule, Tokens)`.
     * @param startRule The grammar rule name to begin parsing from.
     * @param tokens Array of tokens (strings, numbers, etc).
     * @returns true if it fully parses, false otherwise.
     */
    parse(startRule: string, tokens: any[]): boolean;
    /**
     * Parses the given tokens and extracts any requested bindings.
     * Usage:
     * grammar.parseWithBindings('sentence(Subject, Verb)', ['the', 'cat', 'runs'])
     */
    parseWithBindings(startRuleSyntax: string, tokens: any[]): any[];
    /**
     * Generates possible sequences of tokens that satisfy the grammar rule.
     * Equivalent to `phrase(startRule, Tokens)`.
     * @param startRule The grammar rule name to generate from.
     * @param maxResults Maximum number of results to yield (prevents infinite recursion). Default 100.
     * @returns An array of generated token sequences.
     */
    generate(startRule: string, maxResults?: number): any[][];
}
