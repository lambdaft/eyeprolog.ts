import { Program } from './program.js';
import { Solver } from './solver.js';
import { Env, atom, compound, variable, Term, deref, ATOM, COMPOUND, VAR, numberTerm } from './term.js';
import { getEyePrologRegistry } from './standard-library.js';
import * as fs from 'fs';
import { parseGoalText } from './parser.js';

/**
 * Ergonomic wrapper for running Definite Clause Grammars (DCG) natively in TypeScript.
 */
export class DCG {
  program: any;
  solver: any;

  constructor() {
    this.program = new Program();
  }

  /**
   * Load Prolog/DCG source code from a string.
   */
  load(sourceCode: string): void {
    const parsed = Program.parse(sourceCode);
    this.program = new Program([...this.program.clauses, ...parsed.clauses], {
      registry: getEyePrologRegistry(),
    });
    this.initSolver();
  }

  /**
   * Load Prolog/DCG source code from a file path.
   */
  loadFile(filePath: string): void {
    const sourceCode = fs.readFileSync(filePath, 'utf8');
    this.load(sourceCode);
  }

  private initSolver() {
    this.solver = new Solver(this.program, {
      registry: getEyePrologRegistry(),
    });
    this.solver.runInitializations();
  }

  /**
   * Helper to convert JS Arrays/Primitives to Prolog Terms.
   */
  private toPrologTerm(val: any): Term {
    if (val === null || val === undefined) return atom('null');
    if (typeof val === 'string') return atom(val);
    if (typeof val === 'number') return numberTerm(val);
    if (Array.isArray(val)) {
      let list = atom('[]');
      for (let i = val.length - 1; i >= 0; i--) {
        list = compound('.', [this.toPrologTerm(val[i]), list]);
      }
      return list;
    }
    return atom(String(val));
  }

  /**
   * Helper to convert Prolog Terms back to JS Objects/Arrays.
   */
  private fromPrologTerm(term: any, env: Env): any {
    const t = deref(term, env);
    if (t.type === VAR) return `_var_${t.name}`;
    if (t.type === ATOM && t.name === '[]') return [];
    if (t.type === ATOM) return t.name;
    if (t.type === 'number') return t.name;
    if (t.type === COMPOUND && t.name === '.' && t.arity === 2) {
      const arr = [];
      let cursor = t;
      while (cursor.type === COMPOUND && cursor.name === '.' && cursor.arity === 2) {
        arr.push(this.fromPrologTerm(cursor.args[0], env));
        cursor = deref(cursor.args[1], env);
      }
      if (cursor.type === ATOM && cursor.name === '[]') return arr;
      // Improper list
      return arr.concat(this.fromPrologTerm(cursor, env));
    }
    
    // Generic compound term
    if (t.type === COMPOUND) {
      return { functor: t.name, args: t.args.map((a: any) => this.fromPrologTerm(a, env)) };
    }
    return String(t);
  }

  /**
   * Parses the given tokens against the startRule.
   * Equivalent to `phrase(startRule, Tokens)`.
   * @param startRule The grammar rule name to begin parsing from.
   * @param tokens Array of tokens (strings, numbers, etc).
   * @returns true if it fully parses, false otherwise.
   */
  parse(startRule: string, tokens: any[]): boolean {
    if (!this.solver) throw new Error("No DCG rules loaded. Call load() or loadFile() first.");
    
    const tokensTerm = this.toPrologTerm(tokens);
    const ruleTerm = parseGoalText(startRule, { doubleQuotes: 'chars', operatorDefinitions: [] });
    const goal = compound('phrase', [ruleTerm, tokensTerm]);

    for (const _env of this.solver.solve([goal], new Env(), 0)) {
      return true; // Return true on the first successful proof
    }
    return false;
  }
  
  /**
   * Parses the given tokens and extracts any requested bindings.
   * Usage:
   * grammar.parseWithBindings('sentence(Subject, Verb)', ['the', 'cat', 'runs'])
   */
  parseWithBindings(startRuleSyntax: string, tokens: any[]): any[] {
     if (!this.solver) throw new Error("No DCG rules loaded. Call load() or loadFile() first.");
     
     // Use internal text parser to parse the rule syntax cleanly
     const goal = parseGoalText(`phrase(${startRuleSyntax}, Tokens)`, { doubleQuotes: 'chars', operatorDefinitions: [] });
     goal.args[1] = this.toPrologTerm(tokens); // Override Tokens variable with the actual list
     
     const extractVariables = (term: any): string[] => {
         if (term.type === VAR) return [term.name];
         if (term.type === COMPOUND) return term.args.flatMap(extractVariables);
         return [];
     };
     
     const varNames = new Set(extractVariables(goal));
     
     const results = [];
     for (const env of this.solver.solve([goal], new Env(), 0)) {
         const bindings: any = {};
         for (const name of varNames) {
             if (name.startsWith('_') || name === 'Tokens') continue; // skip internal or Tokens
             const val = env.get(name);
             if (val !== undefined) {
                 bindings[name] = this.fromPrologTerm(val, env);
             }
         }
         results.push(bindings);
     }
     return results;
  }

  /**
   * Generates possible sequences of tokens that satisfy the grammar rule.
   * Equivalent to `phrase(startRule, Tokens)`.
   * @param startRule The grammar rule name to generate from.
   * @param maxResults Maximum number of results to yield (prevents infinite recursion). Default 100.
   * @returns An array of generated token sequences.
   */
  generate(startRule: string, maxResults: number = 100): any[][] {
    if (!this.solver) throw new Error("No DCG rules loaded. Call load() or loadFile() first.");

    const TokensVar = variable('Tokens');
    const ruleTerm = parseGoalText(startRule, { doubleQuotes: 'chars', operatorDefinitions: [] });
    const goal = compound('phrase', [ruleTerm, TokensVar]);

    const results = [];
    for (const env of this.solver.solve([goal], new Env(), 0)) {
      const resultTokens = this.fromPrologTerm(TokensVar, env);
      results.push(resultTokens);
      if (results.length >= maxResults) break;
    }
    return results;
  }
}
