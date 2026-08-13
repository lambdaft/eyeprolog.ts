# EyeProlog.ts Integration Patterns

A collection of best practices and patterns for integrating EyeProlog.ts into larger TypeScript/JavaScript projects.

---

## Pattern 1: Knowledge Base Service

**Use case:** Centralized knowledge base for business logic

```typescript
// knowledge-base.ts
import { Program, Solver } from 'eyeprolog.ts';

export class KnowledgeBase {
  private program: Program;
  private solver: Solver;
  private static instance: KnowledgeBase;

  private constructor(programText: string) {
    this.program = Program.parse(programText);
    this.solver = new Solver(this.program);
  }

  static getInstance(): KnowledgeBase {
    if (!KnowledgeBase.instance) {
      const kb = require('./rules.pl', 'utf-8'); // Load rules file
      KnowledgeBase.instance = new KnowledgeBase(kb);
    }
    return KnowledgeBase.instance;
  }

  query(goal: string): Promise<any[]> {
    const results = [];
    for (const env of this.solver.solve([parseGoalText(goal)])) {
      results.push(env);
    }
    return Promise.resolve(results);
  }

  assert(fact: string): void {
    // Dynamically add fact
    this.program.mutable && this.program.assert(parseClauses(fact));
  }

  retract(fact: string): void {
    // Dynamically remove fact
    this.program.mutable && this.program.retract(parseClauses(fact));
  }
}

// Usage in Express middleware
app.get('/api/recommendations/:userId', async (req, res) => {
  const kb = KnowledgeBase.getInstance();
  const results = await kb.query(
    `recommend_product(${req.params.userId}, Product)`
  );
  res.json(results);
});
```

**Benefits:**
- Singleton pattern for shared KB
- Type-safe query results
- Easy to test in isolation
- Separation of concerns

---

## Pattern 2: Rule Engine for Domain Logic

**Use case:** Complex business rules that change frequently

```typescript
// discount-engine.ts
import { Solver, Program } from 'eyeprolog.ts';

export class DiscountEngine {
  private rules = `
    % VIP customers get 20% discount
    discount(Customer, 20) :- 
      customer(Customer, vip).
    
    % Large orders get 10% discount
    discount(Customer, 10) :- 
      order(Customer, Amount),
      Amount > 1000.
    
    % Repeat customers get 5% discount
    discount(Customer, 5) :- 
      customer(Customer, repeat).
    
    % Seasonal promotions
    discount(Product, 15) :-
      season(summer),
      category(Product, seasonal).
  `;

  private program: Program;
  private solver: Solver;

  constructor(factDatabase: string) {
    this.program = Program.parse(this.rules + '\n' + factDatabase);
    this.solver = new Solver(this.program);
  }

  calculateDiscount(customer: string, product: string): number {
    let maxDiscount = 0;

    // Query all applicable discounts
    for (const env of this.solver.solve([
      parseGoalText(`discount('${customer}', Discount)`),
    ])) {
      const discount = parseInt(env.get('Discount').name);
      maxDiscount = Math.max(maxDiscount, discount);
    }

    return maxDiscount;
  }

  addCustomer(name: string, type: 'vip' | 'repeat' | 'normal'): void {
    this.program.assert(`customer('${name}', ${type}).`);
  }

  updateFacts(newFacts: string): void {
    // Reload rules dynamically
    this.program = Program.parse(this.rules + '\n' + newFacts);
    this.solver = new Solver(this.program);
  }
}

// Usage
const engine = new DiscountEngine(customerDatabase);
const discount = engine.calculateDiscount('alice', 'laptop');
console.log(`Discount: ${discount}%`);
```

**Benefits:**
- Rules live in Prolog (not scattered in code)
- Easy to update without redeploying
- Audit trail of decisions
- Non-developers can modify rules

---

## Pattern 3: Type-Safe Configuration Resolution

**Use case:** Configuration with dependency resolution and validation

```typescript
// config-resolver.ts
export interface AppConfig {
  database: string;
  cache: string;
  features: string[];
  limits: Record<string, number>;
}

export class ConfigResolver {
  private kb: string = `
    % Environment determines defaults
    env(development) :- true.
    env(staging) :- false.
    env(production) :- false.
    
    % Database selection based on env
    config(database, mongodb) :- env(production).
    config(database, sqlite) :- env(development).
    
    % Cache strategy
    config(cache, redis) :- 
      env(production).
    config(cache, in_memory) :- 
      \\+ env(production).
    
    % Feature flags
    feature_enabled(new_ui) :- env(staging) ; env(production).
    feature_enabled(analytics) :- true.
    
    % Rate limits
    limit(requests_per_minute, 100) :- env(production).
    limit(requests_per_minute, 1000) :- env(development).
  `;

  private solver: Solver;

  constructor(overrides?: Record<string, string>) {
    let program = this.kb;
    if (overrides) {
      for (const [key, value] of Object.entries(overrides)) {
        program += `\\n${key}(${value}).`;
      }
    }
    this.solver = new Solver(Program.parse(program));
  }

  resolve(): AppConfig {
    const config: AppConfig = {
      database: this.queryOne('config(database, X)'),
      cache: this.queryOne('config(cache, X)'),
      features: this.queryAll('feature_enabled(X)'),
      limits: this.queryMap('limit(Name, Value)'),
    };
    return config;
  }

  private queryOne(goal: string): string {
    for (const env of this.solver.solve([parseGoalText(goal)])) {
      return env.get('X').name;
    }
    throw new Error(`Config not found: ${goal}`);
  }

  private queryAll(goal: string): string[] {
    const results = [];
    for (const env of this.solver.solve([parseGoalText(goal)])) {
      results.push(env.get('X').name);
    }
    return results;
  }

  private queryMap(goal: string): Record<string, number> {
    const map: Record<string, number> = {};
    for (const env of this.solver.solve([parseGoalText(goal)])) {
      const name = env.get('Name').name;
      const value = parseInt(env.get('Value').name);
      map[name] = value;
    }
    return map;
  }
}

// Usage
const config = new ConfigResolver({
  env: 'production',
}).resolve();

const connectString = config.database === 'mongodb'
  ? 'mongodb://...'
  : 'sqlite://app.db';
```

**Benefits:**
- Configuration as logic, not data files
- Cross-cutting concerns declaratively
- Easy to version and test
- Self-documenting through Prolog rules

---

## Pattern 4: API Request Validation & Authorization

**Use case:** Complex authorization logic

```typescript
// auth-engine.ts
export class AuthEngine {
  private rules = `
    % Resource access rules
    can_access(User, Resource, read) :-
      role(User, Role),
      permission(Role, read, Resource).
    
    can_access(User, Resource, write) :-
      role(User, admin) ; 
      (role(User, owner) && owns(User, Resource)).
    
    can_access(User, Resource, delete) :-
      role(User, admin).
    
    % Special cases
    can_access(User, public_resource, read) :- true.
    can_access(User, own_profile, write) :- 
      owns(User, own_profile).
  `;

  private solver: Solver;

  constructor(userData: string) {
    this.solver = new Solver(
      Program.parse(this.rules + '\n' + userData)
    );
  }

  authorize(
    userId: string,
    resource: string,
    action: 'read' | 'write' | 'delete'
  ): boolean {
    const goal = `can_access('${userId}', '${resource}', ${action})`;
    for (const _ of this.solver.solve([parseGoalText(goal)])) {
      return true;
    }
    return false;
  }
}

// Express middleware
const authEngine = new AuthEngine(userDatabase);

app.use((req, res, next) => {
  const userId = req.user?.id;
  const resource = req.path.split('/')[2];
  const action = req.method === 'GET' ? 'read' : 'write';

  if (!authEngine.authorize(userId, resource, action)) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  next();
});
```

**Benefits:**
- Declarative authorization rules
- Easy to audit decisions
- Update permissions without code changes
- Complex role hierarchies handled naturally

---

## Pattern 5: Data Transformation Pipeline

**Use case:** Complex ETL with conditional logic

```typescript
// transformer.ts
export class DataTransformer {
  private rules = `
    % Transform raw data to domain model
    normalize(Input, Output) :-
      get_field(Input, name, Name),
      get_field(Input, email, Email),
      validate_email(Email),
      Output = {name: Name, email: Email}.
    
    % Enrichment
    enrich(User, Enriched) :-
      normalize(User, N),
      find_preferences(N.email, Prefs),
      Enriched = N, Enriched.prefs = Prefs.
    
    % Validation
    valid_user(User) :-
      User.name \\= '',
      User.email \\= '',
      \\+ User.banned.
  `;

  private solver: Solver;

  constructor() {
    this.solver = new Solver(Program.parse(this.rules));
  }

  transform(input: Record<string, any>[]): any[] {
    return input
      .map((item) => this.normalizeItem(item))
      .filter((item) => this.isValid(item))
      .map((item) => this.enrichItem(item));
  }

  private normalizeItem(item: Record<string, any>): any {
    // Implementation using Prolog rules
    const prologTerm = this.objectToTerm(item);
    for (const env of this.solver.solve([
      parseGoalText(`normalize(${prologTerm}, Output)`),
    ])) {
      return this.termToObject(env.get('Output'));
    }
    return null;
  }

  private enrichItem(item: any): any {
    const term = this.objectToTerm(item);
    for (const env of this.solver.solve([
      parseGoalText(`enrich(${term}, Enriched)`),
    ])) {
      return this.termToObject(env.get('Enriched'));
    }
    return item;
  }

  private isValid(item: any): boolean {
    const term = this.objectToTerm(item);
    for (const _ of this.solver.solve([
      parseGoalText(`valid_user(${term})`),
    ])) {
      return true;
    }
    return false;
  }

  private objectToTerm(obj: any): string {
    // Convert JS object to Prolog term
    if (typeof obj === 'string') return `'${obj}'`;
    if (typeof obj === 'number') return obj.toString();
    if (Array.isArray(obj))
      return `[${obj.map((o) => this.objectToTerm(o)).join(', ')}]`;
    if (typeof obj === 'object') {
      const pairs = Object.entries(obj)
        .map(([k, v]) => `${k}: ${this.objectToTerm(v)}`)
        .join(', ');
      return `{${pairs}}`;
    }
    return obj.toString();
  }

  private termToObject(term: any): any {
    // Convert Prolog term back to JS object
    if (term.type === 'atom') return term.name;
    if (term.type === 'number') return Number(term.name);
    if (term.type === 'string') return term.value;
    // ... handle compound terms
    return term;
  }
}
```

**Benefits:**
- Transformation logic visible and auditable
- Complex conditional logic expressed naturally
- Easy to test individual rules
- Reusable across different data sources

---

## Pattern 6: Reactive Fact Updates with Listeners

**Use case:** Real-time systems with derived facts

```typescript
// reactive-kb.ts
export type FactChangeListener = (
  type: 'added' | 'removed',
  fact: string
) => void;

export class ReactiveKnowledgeBase {
  private program: Program;
  private solver: Solver;
  private listeners: Set<FactChangeListener> = new Set();
  private derived: Map<string, string> = new Map();

  constructor(source: string) {
    this.program = Program.parse(source);
    this.solver = new Solver(this.program);
  }

  on(listener: FactChangeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  addFact(fact: string): void {
    this.program.assert(parseClauses(fact));
    this.notifyListeners('added', fact);
    this.updateDerivedFacts();
  }

  removeFact(fact: string): void {
    this.program.retract(parseClauses(fact));
    this.notifyListeners('removed', fact);
    this.updateDerivedFacts();
  }

  private updateDerivedFacts(): void {
    // Re-evaluate all derived facts
    for (const [name, rule] of this.derived) {
      // Query and update cached results
      for (const env of this.solver.solve([parseGoalText(rule)])) {
        // Process derived fact
      }
    }
  }

  private notifyListeners(type: 'added' | 'removed', fact: string): void {
    for (const listener of this.listeners) {
      listener(type, fact);
    }
  }

  // Define a derived fact that gets recomputed
  derived(name: string, rule: string): void {
    this.derived.set(name, rule);
  }
}

// Usage with WebSocket
const kb = new ReactiveKnowledgeBase(rules);

kb.derived('all_admins', 'admin(X)');

kb.on((type, fact) => {
  // Send updates to connected clients
  io.emit('kb-update', { type, fact });
});

// Add new admin - triggers update to all clients
kb.addFact('role(alice, admin)');
```

**Benefits:**
- Automatic cache invalidation
- Real-time derived facts
- Event-driven architecture
- Clean separation of concerns

---

## Pattern 7: Unit Testing Prolog Rules

**Use case:** Validate business logic without full integration

```typescript
// rules.test.ts
import { Solver, Program } from 'eyeprolog.ts';

describe('Discount Rules', () => {
  let solver: Solver;

  beforeEach(() => {
    const rules = `
      discount(vip_customer, 20).
      discount(loyal_customer, 10).
      discount(new_customer, 0).
    `;
    solver = new Solver(Program.parse(rules));
  });

  it('should give VIP customers 20% discount', () => {
    const results = [];
    for (const env of solver.solve([
      parseGoalText("discount(vip_customer, Discount)"),
    ])) {
      results.push(Number(env.get('Discount').name));
    }
    expect(results).toContain(20);
  });

  it('should give new customers no discount', () => {
    const results = [];
    for (const env of solver.solve([
      parseGoalText("discount(new_customer, Discount)"),
    ])) {
      results.push(Number(env.get('Discount').name));
    }
    expect(results).toContain(0);
  });

  it('should match multiple discount rules', () => {
    const moreRules = `
      customer(alice, vip).
      customer(bob, loyal).
      
      applicable_discount(Customer, Amount) :-
        customer(Customer, Type),
        discount(Type, Amount).
    `;
    solver = new Solver(Program.parse(moreRules));
    
    const alice = [];
    for (const env of solver.solve([
      parseGoalText("applicable_discount(alice, Discount)"),
    ])) {
      alice.push(Number(env.get('Discount').name));
    }
    expect(alice).toContain(20);
  });
});
```

**Benefits:**
- Rules can be tested independently
- Clear test cases for business logic
- Regression prevention
- Living documentation

---

## Pattern 8: Caching with TTL

**Use case:** Performance optimization with invalidation

```typescript
// cached-kb.ts
export class CachedKnowledgeBase {
  private kb: Solver;
  private cache = new Map<string, { result: any; expiry: number }>();
  private ttl = 60000; // 1 minute

  constructor(program: Program, ttlMs?: number) {
    this.kb = new Solver(program);
    if (ttlMs) this.ttl = ttlMs;
  }

  query(goal: string): any[] {
    const cacheKey = goal;
    const cached = this.cache.get(cacheKey);

    if (cached && cached.expiry > Date.now()) {
      return cached.result;
    }

    const results = [];
    for (const env of this.kb.solve([parseGoalText(goal)])) {
      results.push(env);
    }

    this.cache.set(cacheKey, {
      result: results,
      expiry: Date.now() + this.ttl,
    });

    return results;
  }

  invalidate(pattern?: string): void {
    if (!pattern) {
      this.cache.clear();
    } else {
      // Invalidate matching keys
      for (const key of this.cache.keys()) {
        if (key.includes(pattern)) {
          this.cache.delete(key);
        }
      }
    }
  }
}

// Usage
const kb = new CachedKnowledgeBase(program, 30000);

// First call: queries KB
const results1 = kb.query('person(Name, Age)');

// Second call (within 30s): from cache
const results2 = kb.query('person(Name, Age)');

// Add new person
kb.addFact('person(alice, 30)');
kb.invalidate('person'); // Clear related cache entries
```

**Benefits:**
- Automatic performance optimization
- Transparent caching
- Manual invalidation when needed
- Works with any query

---

## Summary

These patterns show how EyeProlog.ts can be integrated into enterprise TypeScript projects:

1. **Singleton KB Service** - Centralized knowledge management
2. **Rule Engine** - Business logic as data
3. **Config Resolution** - Environment & dependency management
4. **Auth Engine** - Complex permission rules
5. **Data Pipeline** - ETL with conditional logic
6. **Reactive KB** - Real-time derived facts
7. **Unit Testing** - Test rules independently
8. **Caching** - Performance optimization

Each pattern is production-ready and follows TypeScript best practices.
