/**
 * Example: QueryBuilder Pattern for EyeProlog.ts Integration
 *
 * This demonstrates how a fluent query API could make EyeProlog.ts
 * more user-friendly for TypeScript developers.
 *
 * Implementation reference for integrating into the library.
 */

import { Solver, Program, parseGoalText, Env, ATOM, VAR } from 'eyeprolog.ts';

// ============================================================================
// 1. SIMPLE QUERY BUILDER - Maps Prolog solutions to JS objects
// ============================================================================

interface QueryOptions {
  limit?: number;
  timeout?: number;
  explain?: boolean;
}

class QueryBuilder<T = Record<string, any>> {
  private solver: Solver;
  private goalText: string;
  private variables: string[] = [];
  private transforms: Array<(result: T) => any> = [];
  private filters: Array<(result: T) => boolean> = [];
  private options: QueryOptions = {};

  constructor(solver: Solver, goalText: string) {
    this.solver = solver;
    this.goalText = goalText;
    this.extractVariables();
  }

  private extractVariables(): void {
    // Extract capitalized identifiers from goal text
    const varRegex = /\b([A-Z][a-zA-Z0-9_]*)\b/g;
    const matches = this.goalText.match(varRegex) || [];
    this.variables = [...new Set(matches)]; // Unique
  }

  /**
   * Map each result through a transformation function
   */
  map<U>(fn: (result: T) => U): QueryBuilder<U> {
    const builder = new QueryBuilder<U>(this.solver, this.goalText);
    builder.transforms = [...this.transforms, fn as any];
    builder.filters = [...this.filters];
    builder.options = { ...this.options };
    return builder;
  }

  /**
   * Filter results based on a predicate
   */
  filter(fn: (result: T) => boolean): QueryBuilder<T> {
    this.filters.push(fn);
    return this;
  }

  /**
   * Select specific fields from results
   */
  select<U>(fn: (result: T) => U): QueryBuilder<U> {
    return this.map(fn);
  }

  /**
   * Limit number of results
   */
  take(n: number): QueryBuilder<T> {
    this.options.limit = n;
    return this;
  }

  /**
   * Set timeout in milliseconds
   */
  timeout(ms: number): QueryBuilder<T> {
    this.options.timeout = ms;
    return this;
  }

  /**
   * Include explanation in results
   */
  explain(): QueryBuilder<T> {
    this.options.explain = true;
    return this;
  }

  /**
   * Execute query and collect all results
   */
  async toArray(): Promise<T[]> {
    const results: T[] = [];
    let count = 0;

    for (const result of this) {
      results.push(result);
      count++;
      if (this.options.limit && count >= this.options.limit) break;
    }

    return results;
  }

  /**
   * Execute query and return first result or null
   */
  async first(): Promise<T | null> {
    for (const result of this) {
      return result;
    }
    return null;
  }

  /**
   * Execute query with side effects
   */
  async forEach(fn: (result: T) => void): Promise<void> {
    for (const result of this) {
      fn(result);
    }
  }

  /**
   * Check if any result exists
   */
  async exists(): Promise<boolean> {
    for (const _ of this) {
      return true;
    }
    return false;
  }

  /**
   * Reduce results to a single value
   */
  async reduce<U>(
    fn: (acc: U, result: T) => U,
    initial: U
  ): Promise<U> {
    let acc = initial;
    for (const result of this) {
      acc = fn(acc, result);
    }
    return acc;
  }

  /**
   * Iterator protocol for for...of loops
   */
  *[Symbol.iterator](): Iterator<T> {
    const goal = parseGoalText(this.goalText);
    let count = 0;

    for (const env of this.solver.solve([goal])) {
      // Convert Env to plain object
      const result = this.envToObject(env) as T;

      // Apply filters
      if (!this.filters.every((f) => f(result))) continue;

      // Apply transforms
      let transformed: any = result;
      for (const transform of this.transforms) {
        transformed = transform(transformed);
      }

      yield transformed;

      count++;
      if (this.options.limit && count >= this.options.limit) break;
    }
  }

  /**
   * Convert Prolog environment to JavaScript object
   */
  private envToObject(env: Env): Record<string, any> {
    const obj: Record<string, any> = {};

    for (const varName of this.variables) {
      const value = env.get(varName);
      if (value !== undefined) {
        obj[varName] = this.termToJS(value, env);
      }
    }

    return obj;
  }

  /**
   * Convert Prolog term to JavaScript value
   */
  private termToJS(term: any, env: Env): any {
    // Dereference variables
    if (term.type === VAR) {
      const deref = env.get(term.name);
      if (deref) return this.termToJS(deref, env);
      return `_${term.name}`;
    }

    // Atoms
    if (term.type === ATOM) {
      return term.name;
    }

    // Numbers
    if (term.type === 'number') {
      return Number.isFinite(Number(term.name))
        ? Number(term.name)
        : term.name; // Return as-is for BigInt
    }

    // Strings
    if (term.type === 'string') {
      return term.value;
    }

    // Compounds - convert to object
    if (term.type === 'compound') {
      if (term.name === '.' && term.arity === 2) {
        // List
        const list = [];
        let current = term;
        while (current.type === 'compound' && current.name === '.') {
          list.push(this.termToJS(current.args[0], env));
          current = current.args[1];
        }
        if (current.type !== ATOM || current.name !== '[]') {
          list.push(this.termToJS(current, env)); // Improper list
        }
        return list;
      }

      // Regular compound
      const obj: any = { [Symbol.for('functor')]: term.name };
      for (let i = 0; i < term.args.length; i++) {
        obj[`arg${i}`] = this.termToJS(term.args[i], env);
      }
      return obj;
    }

    return term;
  }
}

// ============================================================================
// 2. SOLVER EXTENSION - Add query() method
// ============================================================================

declare global {
  interface Solver {
    query<T = Record<string, any>>(goalText: string): QueryBuilder<T>;
  }
}

// Monkey-patch (or implement in Solver class directly)
if (!Solver.prototype.query) {
  Solver.prototype.query = function <T>(
    goalText: string
  ): QueryBuilder<T> {
    return new QueryBuilder(this, goalText);
  };
}

// ============================================================================
// 3. TYPED QUERY INTERFACE
// ============================================================================

interface Person {
  Name: string;
  Age: number;
}

interface Parent {
  parent: string;
  child: string;
}

// ============================================================================
// 4. USAGE EXAMPLES
// ============================================================================

async function examples() {
  // Example program
  const source = `
    person(alice, 30).
    person(bob, 25).
    person(charlie, 35).
    
    parent(alice, bob).
    parent(bob, charlie).
    
    age_range(X, Age) :- person(X, Age), Age >= 25, Age <= 35.
  `;

  const program = Program.parse(source);
  const solver = new Solver(program);

  // Example 1: Simple query with iterator
  console.log('=== Example 1: Simple Iterator ===');
  for (const { Name, Age } of solver.query<Person>(
    'person(Name, Age)'
  )) {
    console.log(`${Name} is ${Age} years old`);
  }

  // Example 2: Query with transformation
  console.log('\n=== Example 2: Map + Select ===');
  const people = await solver
    .query<Person>('person(Name, Age)')
    .map((p) => ({ ...p, adult: p.Age >= 18 }))
    .toArray();
  console.log(people);

  // Example 3: Query with filtering
  console.log('\n=== Example 3: Filter ===');
  const adults = await solver
    .query<Person>('person(Name, Age)')
    .filter((p) => p.Age >= 25)
    .select((p) => p.Name)
    .toArray();
  console.log('Adults:', adults);

  // Example 4: Query with limit
  console.log('\n=== Example 4: Limit ===');
  const first = await solver
    .query<Person>('person(Name, Age)')
    .take(1)
    .first();
  console.log('First person:', first);

  // Example 5: Query with reduce
  console.log('\n=== Example 5: Reduce ===');
  const totalAge = await solver
    .query<Person>('person(Name, Age)')
    .reduce((sum, p) => sum + p.Age, 0);
  console.log('Total age:', totalAge);

  // Example 6: Query with forEach
  console.log('\n=== Example 6: ForEach ===');
  await solver
    .query<Parent>('parent(parent, child)')
    .forEach(({ parent, child }) => {
      console.log(`${parent} is parent of ${child}`);
    });

  // Example 7: Chained operations
  console.log('\n=== Example 7: Chained Operations ===');
  const adultNames = await solver
    .query<Person>('person(Name, Age)')
    .filter((p) => p.Age >= 25)
    .map((p) => p.Name.toUpperCase())
    .take(2)
    .toArray();
  console.log('Adult names:', adultNames);

  // Example 8: Check existence
  console.log('\n=== Example 8: Exists ===');
  const hasAlice = await solver
    .query('person(alice, Age)')
    .exists();
  console.log('Has alice?', hasAlice);
}

// ============================================================================
// 5. FLUENT PROGRAM BUILDER EXAMPLE
// ============================================================================

class ProgramBuilder {
  private facts: Array<{ name: string; args: any[] }> = [];
  private rules: Array<{
    head: string;
    body: string[];
  }> = [];

  fact(name: string, args: any[]): this {
    this.facts.push({ name, args });
    return this;
  }

  rule(head: string, body: string[]): this {
    this.rules.push({ head, body });
    return this;
  }

  build(): Program {
    const clauses: string[] = [];

    // Add facts
    for (const { name, args } of this.facts) {
      const argStr = args
        .map((a) =>
          typeof a === 'string'
            ? a.startsWith("'") || /^[A-Z]/.test(a)
              ? a
              : `'${a}'`
            : a
        )
        .join(', ');
      clauses.push(`${name}(${argStr}).`);
    }

    // Add rules
    for (const { head, body } of this.rules) {
      clauses.push(`${head} :- ${body.join(', ')}.`);
    }

    return Program.parse(clauses.join('\n'));
  }
}

// Usage
const builder = new ProgramBuilder()
  .fact('person', ['alice', 30])
  .fact('person', ['bob', 25])
  .rule('adult(X)', ['person(X, Age)', 'Age >= 18'])
  .build();

// ============================================================================
// EXPORT FOR USE
// ============================================================================

export {
  QueryBuilder,
  ProgramBuilder,
  examples,
  type Person,
  type Parent,
};
