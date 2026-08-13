# Implementation Roadmap: Code Changes for UX Improvements

This document shows the exact code changes needed to implement the highest-ROI recommendations.

---

## 1. QueryBuilder Integration (2-3 hours)

### Current API (verbose):
```typescript
const results = [];
for (const env of solver.solve([parseGoalText('person(Name, Age)')])) {
  const name = env.get('Name');
  const age = env.get('Age');
  results.push({ name, age });
}
```

### Proposed API (fluent):
```typescript
const results = await solver
  .query('person(Name, Age)')
  .map(({ Name, Age }) => ({ name: Name, age: Age }))
  .toArray();
```

### Changes needed in `src/solver.ts`:

```typescript
// Add to Solver class
query<T = Record<string, any>>(goalText: string): QueryBuilder<T> {
  return new QueryBuilder(this, goalText);
}

// Add method for streaming results
*queryAsync<T>(goalText: string): AsyncIterable<T> {
  const goal = parseGoalText(goalText);
  for (const env of this.solve([goal])) {
    yield this.envToObject(env);
  }
}
```

### New file: `src/query-builder.ts`

Copy from INTEGRATION_EXAMPLES.ts (complete implementation provided)

**Estimated effort:** 2-3 hours (copy + integrate)
**Test effort:** 1 hour (write 10-15 test cases)

---

## 2. Solver Configuration Presets (30 minutes)

### Current API:
```typescript
const solver = new Solver(program, {
  isoStrict: true,
  registry: getStrictIsoRegistry(),
  // ... more options
});
```

### Proposed API:
```typescript
const solver = Solver.createStrict(program);
const solver = Solver.createDefault(program);
const solver = Solver.createEyeProlog(program);
```

### Changes needed in `src/solver.ts`:

Add static factory methods after class definition:

```typescript
export class Solver {
  // ... existing code ...

  // Add these static methods at end of class
  static createDefault(program: Program): Solver {
    return new Solver(program, {
      registry: getEyePrologRegistry(),
      maxDepth: 100000,
      solutionLimit: 10000000,
    });
  }

  static createStrict(program: Program): Solver {
    return new Solver(program, {
      isoStrict: true,
      registry: getStrictIsoRegistry(),
      maxDepth: 100000,
    });
  }

  static createEyeProlog(program: Program): Solver {
    return new Solver(program, {
      registry: getEyePrologRegistry(),
      fastPaths: true,
    });
  }

  static createLight(program: Program): Solver {
    return new Solver(program, {
      registry: getEyePrologRegistry(),
      maxDepth: 10000,
      solutionLimit: 1000,
    });
  }
}
```

### Export from `src/index.ts`:

```typescript
export { Solver, createDefaultRegistry, createStrictIsoRegistry, ... } from './solver.js';
```

**Estimated effort:** 30 minutes
**Test effort:** 15 minutes

---

## 3. ProgramBuilder DSL (1-2 hours)

### Current API:
```typescript
const source = `
  parent(tom, bob).
  parent(bob, ann).
  grandparent(X, Z) :- parent(X, Y), parent(Y, Z).
`;
const program = Program.parse(source);
```

### Proposed API:
```typescript
const program = new ProgramBuilder()
  .fact('parent', ['tom', 'bob'])
  .fact('parent', ['bob', 'ann'])
  .rule('grandparent', ['X', 'Z'], 
    (q) => q.goal('parent', ['X', 'Y'])
            .goal('parent', ['Y', 'Z']))
  .build();
```

### New file: `src/program-builder.ts`

```typescript
import { atom, compound, parseClauses } from './term.js';
import { Program } from './program.js';

export class ProgramBuilder {
  private clauses: string[] = [];

  /**
   * Add a fact to the program
   * @example .fact('parent', ['tom', 'bob'])
   */
  fact(name: string, args: any[]): this {
    const termArgs = args
      .map((arg) => {
        if (typeof arg === 'string') {
          return /^[A-Z_]/.test(arg) ? arg : `'${arg}'`;
        }
        return String(arg);
      })
      .join(', ');
    
    this.clauses.push(`${name}(${termArgs}).`);
    return this;
  }

  /**
   * Add multiple facts at once
   * @example .facts([['parent', ['tom', 'bob']], ['parent', ['bob', 'ann']]])
   */
  facts(items: Array<[string, any[]]>): this {
    for (const [name, args] of items) {
      this.fact(name, args);
    }
    return this;
  }

  /**
   * Add a rule to the program
   * @example .rule('grandparent', ['X', 'Z'], (q) => q.goal('parent', ['X', 'Y']).goal('parent', ['Y', 'Z']))
   */
  rule(
    head: string,
    args: string[],
    bodyBuilder: (q: GoalBuilder) => GoalBuilder
  ): this {
    const gb = new GoalBuilder();
    bodyBuilder(gb);
    const body = gb.build();
    const headStr = `${head}(${args.join(', ')})`;
    this.clauses.push(`${headStr} :- ${body}.`);
    return this;
  }

  /**
   * Add a raw clause string (for advanced usage)
   */
  clause(clauseText: string): this {
    this.clauses.push(clauseText);
    return this;
  }

  /**
   * Build and return the Program
   */
  build(): Program {
    const source = this.clauses.join('\n');
    return Program.parse(source);
  }

  /**
   * Get source as string (useful for debugging)
   */
  source(): string {
    return this.clauses.join('\n');
  }
}

export class GoalBuilder {
  private goals: string[] = [];

  goal(name: string, args: any[]): this {
    const termArgs = args
      .map((arg) => {
        if (typeof arg === 'string') {
          return /^[A-Z_]/.test(arg) ? arg : `'${arg}'`;
        }
        return String(arg);
      })
      .join(', ');
    
    this.goals.push(`${name}(${termArgs})`);
    return this;
  }

  build(): string {
    return this.goals.join(', ');
  }
}
```

### Update `src/index.ts`:

```typescript
export { ProgramBuilder } from './program-builder.js';
```

**Estimated effort:** 1-2 hours
**Test effort:** 1 hour

---

## 4. Enhanced Error Messages (2-3 hours)

### Current error:
```
Error: type_error(integer)
```

### Proposed error:
```
Error [type_error]: Expected integer but got string
  in predicate: is/2
  at: program.pl:42
  code: X is Y + 1
  
  Hint: Use number(X) to convert
  Learn more: https://eyereasoner.github.io/errors/type_error
```

### Changes needed in `src/iso.ts`:

Enhance `PrologError` class:

```typescript
export class PrologError extends Error {
  type: string;
  culprit: any;
  context?: {
    file?: string;
    line?: number;
    predicate?: string;
    code?: string;
  };
  hint?: string;
  docLink?: string;

  constructor(
    type: string,
    culprit?: any,
    message?: string,
    context?: PrologError['context']
  ) {
    const msg = message || this.formatMessage(type, culprit);
    super(msg);
    this.name = 'PrologError';
    this.type = type;
    this.culprit = culprit;
    this.context = context;
    this.docLink = `https://eyereasoner.github.io/errors/${type.split('(')[0]}`;
  }

  private formatMessage(type: string, culprit: any): string {
    const errorType = type.split('(')[0];
    const hints: Record<string, string> = {
      type_error: `Type error: expected specific type`,
      instantiation_error: `Variable must be bound`,
      existence_error: `Resource not found`,
      domain_error: `Value outside allowed domain`,
    };
    return hints[errorType] || type;
  }

  toString(): string {
    let msg = `Error [${this.type}]: ${this.message}`;
    
    if (this.context?.file) {
      msg += `\n  at: ${this.context.file}:${this.context.line}`;
    }
    if (this.context?.predicate) {
      msg += `\n  in: ${this.context.predicate}`;
    }
    if (this.context?.code) {
      msg += `\n  code: ${this.context.code}`;
    }
    if (this.hint) {
      msg += `\n  💡 Hint: ${this.hint}`;
    }
    if (this.docLink) {
      msg += `\n  📚 Learn more: ${this.docLink}`;
    }

    return msg;
  }
}
```

### Add helper to throw with context:

```typescript
export function throwWithContext(
  type: string,
  culprit: any,
  context: { file?: string; line?: number; predicate?: string; code?: string }
): never {
  throw new PrologError(type, culprit, undefined, context);
}
```

**Estimated effort:** 2-3 hours
**Test effort:** 1 hour

---

## 5. Update README with Examples (1 hour)

Add to README.md after "Quick start":

```markdown
## TypeScript Integration

### Fluent Query API

Instead of manual environment handling:

```typescript
// ❌ Old way
const results = [];
for (const env of solver.solve([parseGoalText('parent(X, Y)')])) {
  results.push({
    x: env.get('X'),
    y: env.get('Y'),
  });
}

// ✅ New way
const results = await solver
  .query('parent(X, Y)')
  .map(({ X, Y }) => ({ x: X, y: Y }))
  .toArray();
```

### Simplified Configuration

```typescript
// Use presets
const solver = Solver.createDefault(program);
const strictSolver = Solver.createStrict(program);
```

### Programmatic Program Building

```typescript
const program = new ProgramBuilder()
  .fact('parent', ['tom', 'bob'])
  .rule('grandparent', ['X', 'Z'], 
    (q) => q.goal('parent', ['X', 'Y'])
            .goal('parent', ['Y', 'Z']))
  .build();
```

## Production Patterns

See [INTEGRATION_PATTERNS.md](./INTEGRATION_PATTERNS.md) for:
- Knowledge Base Service
- Business Rule Engine  
- Authorization Engine
- Data Transformation Pipeline
- Reactive Updates
- Unit Testing
- Caching Strategies
```

**Estimated effort:** 1 hour

---

## 6. Create API.md Documentation (2-3 hours)

### Structure:

```markdown
# EyeProlog.ts API Reference

## Core Classes

### Solver
- `new Solver(program, options?)`
- `solve(goals, env?, depth?): Iterator<Env>`
- `query(goalText): QueryBuilder`
- `*queryAsync(goalText): AsyncIterable`
- Static methods:
  - `createDefault(program): Solver`
  - `createStrict(program): Solver`
  - `createEyeProlog(program): Solver`

### Program
- `static parse(source, options?): Program`
- `assert(clauses)`
- `retract(clauses)`
- `getDelta(): string`

### QueryBuilder<T>
- `map<U>(fn: (r: T) => U): QueryBuilder<U>`
- `filter(fn: (r: T) => boolean): QueryBuilder<T>`
- `select<U>(fn: (r: T) => U): QueryBuilder<U>`
- `take(n: number): QueryBuilder<T>`
- `toArray(): Promise<T[]>`
- `first(): Promise<T | null>`
- `forEach(fn: (r: T) => void): Promise<void>`
- `exists(): Promise<boolean>`
- `reduce<U>(fn: (a: U, r: T) => U, init: U): Promise<U>`

### ProgramBuilder
- `fact(name, args): this`
- `facts(items): this`
- `rule(head, args, bodyFn): this`
- `clause(text): this`
- `build(): Program`
- `source(): string`

## Exceptions

### PrologError
- Properties: `type`, `culprit`, `context`, `hint`, `docLink`
- Common types: `type_error`, `instantiation_error`, `domain_error`

## Examples

[Include 5-10 practical examples]
```

**Estimated effort:** 2-3 hours
**Note:** Generate TypeDoc HTML automatically

---

## Timeline for Implementation

```
Week 1:
  - Mon-Tue: QueryBuilder integration & testing
  - Wed: Solver presets & ProgramBuilder
  - Thu: Error message improvements
  - Fri: Documentation updates

Week 2:
  - Mon-Tue: API.md creation (or TypeDoc)
  - Wed: Integration examples & patterns
  - Thu: Review & polish
  - Fri: Release v1.3.0
```

---

## Testing Checklist

For each feature:

- [ ] Unit tests (10-20 test cases)
- [ ] Integration tests (3-5 real-world examples)
- [ ] TypeScript compilation (`tsc --noEmit`)
- [ ] Existing test suite still passes (`npm test`)
- [ ] Documentation examples runnable

---

## Breaking Changes

✅ **NONE** - All recommendations are additive

- Existing API remains unchanged
- New methods added to classes
- New builder classes don't affect existing code
- Can deprecate old patterns gradually

---

## Migration Path for Users

### From current version:
```typescript
// Still works
const solver = new Solver(program);
for (const env of solver.solve([goal])) { ... }
```

### To new fluent API (optional):
```typescript
// New pattern available alongside old
const results = await solver.query('...').toArray();
```

No breaking changes - users adopt at their own pace.

---

## Success Metrics

After implementation, measure:

1. **Developer productivity:**
   - Lines of code per query (target: 3-5 vs current 10-15)
   - Time to first query (target: 2 min vs current 10 min)

2. **API discoverability:**
   - IDE autocomplete suggestions (should show all methods)
   - Documentation site traffic

3. **Integration adoption:**
   - GitHub stars (target: +20-30%)
   - NPM downloads (target: +50%)

4. **Community sentiment:**
   - Issue quality (fewer "how do I..." issues)
   - Positive feedback in discussions

---

## Rollout Strategy

1. **Beta release (v1.3.0-beta.1)**
   - All new features behind opt-in APIs
   - 2-week feedback period

2. **Full release (v1.3.0)**
   - After incorporating beta feedback
   - Update documentation

3. **Blog post & announcement**
   - Highlight improvements
   - Direct users to patterns guide

---

## Questions?

Each recommendation in INTEGRATION_GUIDE.md includes:
- Problem statement
- Proposed solution
- Implementation approach
- Benefits
- Example code

Review that document for deeper context.
