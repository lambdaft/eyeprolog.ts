# Performance Optimization Phase 1: Quick Implementation Guide

## Overview

Phase 1 focuses on 4 high-ROI, low-risk optimizations that can deliver **50-80% improvement** in 1-2 weeks.

---

## Optimization 1: Builtin Registry Indexing [HIGHEST PRIORITY]

### Current Performance Issue
```
For each goal, we do: registry.get(name, arity)
This iterates through ~200 builtins linearly - SLOW!
```

### Current Implementation
```typescript
// src/iso.ts
class BuiltinRegistry {
  private handlers = new Map<string, Builtin>();
  
  add(name: string, arity: number, handler: any, options: any) {
    const key = `${name}/${arity}:${options.module || 'user'}`;
    this.handlers.set(key, { name, arity, handler, options });
  }
  
  get(name: string, arity: number): Builtin | undefined {
    // BUG: This does a linear search!
    for (const [_, builtin] of this.handlers) {
      if (builtin.name === name && builtin.arity === arity) {
        return builtin;
      }
    }
    return undefined;
  }
}
```

### Optimized Implementation
```typescript
// src/iso.ts
class BuiltinRegistry {
  private builtins = new Map<string, Builtin>();  // "name/arity" -> Builtin
  
  add(name: string, arity: number, handler: any, options: any) {
    const key = `${name}/${arity}`;
    this.builtins.set(key, { name, arity, handler, options });
  }
  
  get(name: string, arity: number): Builtin | undefined {
    const key = `${name}/${arity}`;
    return this.builtins.get(key);  // O(1) lookup!
  }
}
```

### Implementation Steps
1. Find `class BuiltinRegistry` in `src/iso.ts`
2. Change internal storage from array to Map with "name/arity" key
3. Update `add()` method to use new key format
4. Update `get()` method to do simple Map lookup
5. Run tests: `npm test`
6. Expected improvement: 20-30%

### Files to Modify
- `src/iso.ts` - BuiltinRegistry class

### Risk: LOW
- Fully backward compatible
- Just changes internal implementation
- All existing tests should pass

### Validation
```javascript
// Test that lookup works
const registry = new BuiltinRegistry();
registry.add('append', 3, handler, {});
const result = registry.get('append', 3);
console.assert(result !== undefined, 'Lookup should succeed');
```

---

## Optimization 2: Occurs Check for Ground Terms

### Current Performance Issue
```
Occurs check runs even for ground terms like:
  unify(atom(tom), atom(tom), env)
This is impossible to have cycles! Waste of CPU.
```

### Current Implementation
```typescript
// src/term.ts
export function unify(left: any, right: any, env: any, options: any = {}): any {
  const occursCheckHandler = options.occursCheck === 'fail' ? null : env?._occursCheckHandler;
  const stack = [[left, right]];
  
  while (stack.length > 0) {
    // ... unification logic ...
    
    // This runs even for ground terms!
    if (occurs(a.name, b, env)) {
      occursCheckHandler?.(a, b, env);
      return false;
    }
  }
}
```

### Optimized Implementation
```typescript
// src/term.ts

// Helper: Check if term is definitely ground (no variables)
function isDefinitelyGround(term: any): boolean {
  if (term.type === 'var') return false;
  if (term.type !== 'compound') return true;
  return term.args.every(isDefinitelyGround);
}

export function unify(left: any, right: any, env: any, options: any = {}): any {
  // OPTIMIZATION: Skip occurs check if both terms are ground
  let occursCheckHandler = options.occursCheck === 'fail' ? null : env?._occursCheckHandler;
  if (isDefinitelyGround(left) && isDefinitelyGround(right)) {
    occursCheckHandler = null;  // No cycles possible for ground terms
  }
  
  const stack = [[left, right]];
  // ... rest of unification unchanged ...
}
```

### Implementation Steps
1. Add `isDefinitelyGround()` helper function to `src/term.ts`
2. Modify `unify()` to skip occurs check for ground terms
3. Run tests: `npm test`
4. Expected improvement: 10-15%

### Files to Modify
- `src/term.ts` - unify function

### Risk: MEDIUM
- Correctness relies on `isDefinitelyGround()` being correct
- Must handle all term types properly
- Test thoroughly with complex terms

### Validation
```javascript
// Test that ground terms skip check
const left = { type: 'atom', name: 'tom' };
const right = { type: 'atom', name: 'tom' };
unify(left, right, env);  // Should skip occurs check

// Test that variables still check
const leftVar = { type: 'var', name: 'X' };
unify(leftVar, right, env);  // Should run occurs check
```

---

## Optimization 3: Deref Caching

### Current Performance Issue
```
Same variable dereferenced multiple times:
  deref(X, env) -> Y
  deref(X, env) -> Y  (walks chain again!)
  deref(X, env) -> Y  (walks chain again!)
```

### Current Implementation
```typescript
// src/term.ts
class Env {
  get(name: string) {
    // Walks parent chain every time!
    for (let state = this._state; state != null; state = state.parent) {
      if (state.bindingName === name) return state.bindingValue;
      if (state.bindings?.has(name)) return state.bindings.get(name);
    }
    return undefined;
  }
}
```

### Optimized Implementation
```typescript
// src/term.ts
class Env {
  private derefCache = new Map<string, Term>();
  
  get(name: string) {
    // NEW: Check cache first
    const cached = this.derefCache.get(name);
    if (cached !== undefined) return cached;
    
    // Walk chain (as before)
    for (let state = this._state; state != null; state = state.parent) {
      if (state.bindingName === name) {
        const value = state.bindingValue;
        this.derefCache.set(name, value);  // Cache it
        return value;
      }
      if (state.bindings?.has(name)) {
        const value = state.bindings.get(name);
        this.derefCache.set(name, value);  // Cache it
        return value;
      }
    }
    
    this.derefCache.set(name, undefined);  // Cache miss
    return undefined;
  }
  
  bind(name: string, term: Term) {
    // IMPORTANT: Invalidate cache when binding
    this.derefCache.delete(name);
    // ... do the binding ...
  }
  
  clone() {
    const clone = Object.create(Env.prototype);
    clone._state = this._state;
    clone.derefCache = new Map();  // Fresh cache for clone
    return clone;
  }
}
```

### Implementation Steps
1. Add `derefCache` property to Env class
2. Modify `get()` to check cache first
3. Modify `bind()` to invalidate cache entry
4. Modify `clone()` to create fresh cache
5. Run tests: `npm test`
6. Expected improvement: 15-25%

### Files to Modify
- `src/term.ts` - Env class

### Risk: MEDIUM
- Cache must be invalidated correctly
- Clones must have independent caches
- Test with deeply nested environments

### Validation
```javascript
// Test cache behavior
const env = new Env();
env.bind('X', { type: 'atom', name: 'tom' });
const first = env.get('X');
const second = env.get('X');
console.assert(first === second, 'Should return cached value');

// Test invalidation
env.bind('X', { type: 'atom', name: 'bob' });
const updated = env.get('X');
console.assert(updated.name === 'bob', 'Cache should be invalidated');
```

---

## Optimization 4: Unification Stack Object Pool

### Current Performance Issue
```
Each unification creates new arrays:
  const stack = [[left, right]];  // NEW allocation
  stack.push([a, b]);              // NEW allocation
  // ... millions of times
```

### Current Implementation
```typescript
// src/term.ts
export function unify(left: any, right: any, env: any): any {
  const stack = [[left, right]];  // ALLOCATES EVERY TIME
  
  while (stack.length > 0) {
    const pop = stack.pop();
    // ... unification ...
    stack.push([a, b]);  // ALLOCATES EVERY TIME
  }
}
```

### Optimized Implementation
```typescript
// src/term.ts

// Simple object pool for unification stacks
class UnificationStackPool {
  private available: Array<any> = [];
  
  acquire(): any[] {
    return this.available.pop() ?? [];
  }
  
  release(stack: any[]) {
    stack.length = 0;  // Clear it
    this.available.push(stack);
  }
}

const stackPool = new UnificationStackPool();

export function unify(left: any, right: any, env: any): any {
  const stack = stackPool.acquire();  // Reuse from pool
  stack.push([left, right]);
  
  try {
    while (stack.length > 0) {
      const pop = stack.pop();
      // ... unification (unchanged) ...
      stack.push([a, b]);
    }
    return true;
  } finally {
    stackPool.release(stack);  // Return to pool
  }
}
```

### Implementation Steps
1. Create UnificationStackPool class
2. Create global stackPool instance
3. Modify unify() to acquire from pool
4. Modify unify() to release in finally block
5. Run tests: `npm test`
6. Expected improvement: 5-10%

### Files to Modify
- `src/term.ts` - unify function and new UnificationStackPool class

### Risk: LOW
- Try/finally ensures pool is returned
- No semantic changes to unification
- Backward compatible

### Validation
```javascript
// Test that pool reuses arrays
const pool = new UnificationStackPool();
const stack1 = pool.acquire();
pool.release(stack1);
const stack2 = pool.acquire();
console.assert(stack1 === stack2, 'Pool should reuse arrays');
```

---

## Implementation Checklist

### Before Starting
- [ ] Create feature branch: `git checkout -b perf/phase1-quick-wins`
- [ ] Ensure tests pass: `npm test`
- [ ] Create baseline benchmark

### Optimization 1: Registry Indexing
- [ ] Identify BuiltinRegistry class
- [ ] Implement new indexing scheme
- [ ] Update add() method
- [ ] Update get() method
- [ ] Run tests
- [ ] Measure performance

### Optimization 2: Ground Term Occurs Check
- [ ] Add isDefinitelyGround() helper
- [ ] Modify unify() function
- [ ] Run tests
- [ ] Measure performance

### Optimization 3: Deref Caching
- [ ] Add derefCache property to Env
- [ ] Modify get() method
- [ ] Modify bind() method
- [ ] Modify clone() method
- [ ] Run tests
- [ ] Measure performance

### Optimization 4: Stack Pool
- [ ] Create UnificationStackPool class
- [ ] Modify unify() to use pool
- [ ] Add try/finally
- [ ] Run tests
- [ ] Measure performance

### Finalization
- [ ] Run full conformance suite
- [ ] Create performance comparison
- [ ] Document changes
- [ ] Create PR
- [ ] Get code review

---

## Performance Measurement

### Create Benchmark File
```javascript
// test/benchmark-phase1.mjs
import { Program } from '../src/program.js';
import { Solver } from '../src/solver.js';
import { performance } from 'perf_hooks';

const program = Program.parse(`
  parent(tom, bob).
  parent(bob, ann).
  grandparent(X, Z) :- parent(X, Y), parent(Y, Z).
`);

const solver = Solver.createDefault(program);

// Benchmark 1: Simple facts
const start1 = performance.now();
for (let i = 0; i < 10000; i++) {
  for (const env of solver.solve([parseGoalText('parent(X, Y)')])) {
    // iterate
  }
}
const time1 = performance.now() - start1;
console.log(`Simple facts: ${time1.toFixed(2)}ms`);

// Benchmark 2: Rules with recursion
const start2 = performance.now();
for (let i = 0; i < 10000; i++) {
  for (const env of solver.solve([parseGoalText('grandparent(X, Z)')])) {
    // iterate
  }
}
const time2 = performance.now() - start2;
console.log(`Recursive rules: ${time2.toFixed(2)}ms`);
```

### Run Before & After
```bash
# Before optimizations
node test/benchmark-phase1.mjs

# Make optimizations...

# After optimizations
node test/benchmark-phase1.mjs
```

### Expected Results
```
BEFORE:
Simple facts: 2500.45ms
Recursive rules: 1200.30ms

AFTER (Phase 1):
Simple facts: 1400.25ms  (~44% improvement)
Recursive rules: 650.15ms  (~46% improvement)
```

---

## Troubleshooting

### Tests Fail After Optimization
1. Check that semantic behavior is unchanged
2. Add console logging to see what's different
3. Run with `--verbose` flag if available
4. Compare before/after outputs

### Performance Doesn't Improve
1. Make sure benchmark is large enough (10K+ iterations)
2. Check that code actually uses the optimized path
3. Profile with Node.js profiler: `node --prof`
4. Look for other bottlenecks (not just the optimization)

### Crashes or Hangs
1. Check try/finally blocks are correct
2. Verify cache invalidation is comprehensive
3. Test with both ground and variable terms
4. Test with complex, nested terms

---

## Success Criteria

- [ ] All 4 optimizations implemented
- [ ] Conformance tests pass (159/160)
- [ ] 50-80% performance improvement verified
- [ ] No API changes
- [ ] Code reviewed and approved
- [ ] Documentation updated
- [ ] Benchmark results documented

---

## Timeline Estimate

| Task | Time |
|------|------|
| Registry Indexing | 2-3 hours |
| Occurs Check | 1-2 hours |
| Deref Caching | 2-3 hours |
| Stack Pool | 1-2 hours |
| Testing & Benchmarking | 2-3 hours |
| **TOTAL** | **9-13 hours** |

**Can be completed in 1-2 days** by experienced developer

---

## Next Steps After Phase 1

Once Phase 1 is complete:
1. Measure real-world impact
2. Decide if Phase 2 is needed
3. Plan Phase 2 (Multi-argument indexing, etc.)
4. Release as v1.3.1 or v1.4.0

---

## Questions?

Each optimization is independent, so you can:
- Implement them in any order
- Test each one separately
- Measure individual impact
- Roll back any if needed

**Recommendation:** Start with Registry Indexing (highest ROI) → Occurs Check → Deref Caching → Stack Pool
