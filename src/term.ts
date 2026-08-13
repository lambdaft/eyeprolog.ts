// Term model, environments, unification, readback, and ordering helpers.
// This file is intentionally dependency-free because nearly every other module imports it.
export const VAR = 'var';
export const ATOM = 'atom';
export const STRING = 'string';
export const NUMBER = 'number';
export const COMPOUND = 'compound';

export type EyePrologTerm = Term | { type: string; name: string; args?: EyePrologTerm[]; arity?: number; order?: number; module?: string };

const EMPTY_ARGS = Object.freeze([]) as readonly EyePrologTerm[];
let variableOrder = 0;

export class Term {
  type: string;
  name: string;
  args: EyePrologTerm[];
  order?: number;
  module?: string;

  constructor(type: string, name?: unknown, args: EyePrologTerm[] = []) {
    this.type = type;
    this.name = String(name ?? '');
    this.args = args;
  }
  get arity(): number {
    return this.args.length;
  }
}

export const variable = (name: string): Term => {
  const term = new Term(VAR, name, EMPTY_ARGS as EyePrologTerm[]);
  term.order = ++variableOrder;
  return term;
};
export const atom = (name: string): Term => new Term(ATOM, name, EMPTY_ARGS as EyePrologTerm[]);
export const stringTerm = (value: string): Term => new Term(STRING, value, EMPTY_ARGS as EyePrologTerm[]);
export const numberTerm = (value: string | number): Term => new Term(NUMBER, value, EMPTY_ARGS as EyePrologTerm[]);
export const compound = (name: string, args: EyePrologTerm[] = []): Term => args.length === 0 ? atom(name) : new Term(COMPOUND, name, args);
export const emptyList = (): Term => atom('[]');
export const cons = (head: EyePrologTerm, tail: EyePrologTerm): Term => compound('.', [head, tail]);

export interface EnvState {
  bindings: Map<string, EyePrologTerm> | null;
  bindingName: string | null;
  bindingValue: EyePrologTerm | undefined;
  parent: EnvState | null;
  depth: number;
  cacheName: string | null;
  cacheValue: EyePrologTerm | undefined;
  cache: Map<string, EyePrologTerm> | null;
}

export class Env {
  _state: EnvState;
  _delays: any;
  _clpz: any;
  _occursCheckHandler: ((left: EyePrologTerm, right: EyePrologTerm, env: Env) => void) | null;

  constructor(bindings?: Iterable<readonly [string, EyePrologTerm]> | null) {
    this._state = {
      bindings: bindings ? new Map(bindings) : null,
      bindingName: null,
      bindingValue: undefined,
      parent: null,
      depth: 0,
      cacheName: null,
      cacheValue: undefined,
      cache: null,
    };
    this._delays = null;
    this._clpz = null;
    this._occursCheckHandler = null;
  }
  clone(): Env {
    // Most speculative environments are either rejected without a binding or
    // only compare ground terms. Persistent layers make cloning constant-time
    // and keep later writes to either branch isolated. Hot-path layers store a
    // single binding directly; a Map is allocated only when a deep chain is
    // occasionally flattened.
    const clone = Object.create(Env.prototype) as Env;
    clone._state = this._state;
    clone._delays = this._delays;
    clone._clpz = this._clpz;
    clone._occursCheckHandler = this._occursCheckHandler;
    return clone;
  }
  setOccursCheckHandler(handler: ((left: EyePrologTerm, right: EyePrologTerm, env: Env) => void) | null): this {
    this._occursCheckHandler = typeof handler === 'function' ? handler : null;
    return this;
  }
  has(name: string): boolean {
    return this.get(name) !== undefined;
  }
  get(name: string): EyePrologTerm | undefined {
    const root = this._state;
    if (root.cacheName === name) return root.cacheValue;
    const cached = root.cache?.get(name);
    if (cached !== undefined) return cached;
    for (let state: EnvState | null = root; state != null; state = state.parent) {
      let value;
      let found = false;
      if (state.bindingName === name) {
        value = state.bindingValue;
        found = true;
      } else if (state.bindings?.has(name)) {
        value = state.bindings.get(name);
        found = true;
      }
      if (found) {
        if (root.depth >= 4) {
          if (root.cacheName == null) {
            root.cacheName = name;
            root.cacheValue = value;
          } else if (root.cacheName != null && root.cacheValue !== undefined && value !== undefined) {
            (root.cache ??= new Map([[root.cacheName, root.cacheValue]])).set(name, value);
          }
        }
        return value;
      }
    }
    return undefined;
  }
  bind(name: any, term: any): any {
    if (this._state.depth >= 32) {
      const flattened = new Map();
      // @ts-expect-error TS2322: auto-suppressed
      for (let state = this._state; state != null; state = state.parent) {
        if (state.bindingName != null && !flattened.has(state.bindingName)) {
          flattened.set(state.bindingName, state.bindingValue);
        }
        if (state.bindings) {
          for (const [key, value] of state.bindings) {
            if (!flattened.has(key)) flattened.set(key, value);
          }
        }
      }
      flattened.set(name, term);
      this._state = {
        bindings: flattened,
        bindingName: null,
        bindingValue: undefined,
        parent: null,
        depth: 0,
        cacheName: null,
        cacheValue: undefined,
        cache: null,
      };
      return;
    }
    this._state = {
      bindings: null,
      bindingName: name,
      bindingValue: term,
      parent: this._state,
      depth: this._state.depth + 1,
      cacheName: null,
      cacheValue: undefined,
      cache: null,
    };
  }
  delay(name: any, goal: any, module: any = 'user'): any {
    const delays = new Map(this._delays ?? []);
    const existing = delays.get(name);
    // @ts-expect-error TS2488: auto-suppressed
    delays.set(name, [...(existing && (typeof existing[Symbol.iterator] === 'function') ? existing : []), { goal, module }]);
    this._delays = delays;
    return this;
  }
  takeReadyDelays(): any {
    if (this._delays == null || this._delays.size === 0) return [];
    const ready = [];
    let remaining = this._delays;
    for (const [name, delays] of this._delays) {
      if (deref(variable(name), this).type === VAR) continue;
      if (remaining === this._delays) remaining = new Map(this._delays);
      remaining.delete(name);
      ready.push(...delays);
    }
    if (ready.length > 0) this._delays = remaining;
    return ready;
  }
}

export function deref(term: any, env: any): any {
  // Follow variable bindings until a non-variable term is reached. The seen set
  // protects readback from accidental cycles in partially constructed terms.
  let current = term;
  let seen = null;
  while (current?.type === VAR) {
    const next = env?.get(current.name);
    if (next === undefined) break;
    if (seen?.has(current.name)) break;
    (seen ??= new Set()).add(current.name);
    current = next;
  }
  return current;
}

export function isScalar(term: any): any {
  return term && (term.type === ATOM || term.type === STRING || term.type === NUMBER);
}

export function isEmptyList(term: any): any {
  return term?.type === ATOM && term.name === '[]';
}

export function isCons(term: any): any {
  return term?.type === COMPOUND && term.name === '.' && term.arity === 2;
}

export function isConjunction(term: any): any {
  return term?.type === COMPOUND && term.name === ',' && term.arity === 2;
}

function occurs(variableName: any, term: any, env: any): any {
  // Walk bindings and compound arguments iteratively so the occurs check also
  // remains safe for very deep terms. The visited sets make this defensive
  // against cycles introduced through the public Env API.
  if (isScalar(term)) return false;
  const stack = [term];
  const seenVariables = new Set();
  const seenTerms = new Set();

  while (stack.length) {
    const current = stack.pop();
    if (current?.type === VAR) {
      if (current.name === variableName) return true;
      if (seenVariables.has(current.name)) continue;
      seenVariables.add(current.name);
      const binding = env?.get(current.name);
      if (binding !== undefined) stack.push(binding);
      continue;
    }
    if (current?.type !== COMPOUND || seenTerms.has(current)) continue;
    seenTerms.add(current);
    for (let i = 0; i < current.arity; i++) stack.push(current.args[i]);
  }

  return false;
}

export function unify(left: any, right: any, env: any, options: any = {}): any {
  // Iterative unification avoids deep JavaScript recursion on long lists or
  // deeply nested compounds. The occurs check gives EyeProlog finite-tree
  // unification: a variable cannot be bound to a term containing itself.
  // Bindings are written into the supplied Env.
  const occursCheckHandler = options.occursCheck === 'fail' ? null : env?._occursCheckHandler;
  const stack = [[left, right]];
  while (stack.length > 0) {
    const pop = stack.pop();
    if (!pop) continue;
    let [a, b] = pop as [any, any];
    a = deref(a, env);
    b = deref(b, env);

    if (a.type === VAR && b.type === VAR && a.name === b.name) continue;
    if (a.type === VAR && b.type === VAR) {
      // Both variables are already dereferenced and unbound, so linking them
      // cannot create a cycle and needs no occurs-check traversal.
      env.bind(a.name, b);
      continue;
    }
    if (a.type === VAR) {
      if (occurs(a.name, b, env)) {
        occursCheckHandler?.(a, b, env);
        return false;
      }
      env.bind(a.name, b);
      continue;
    }
    if (b.type === VAR) {
      if (occurs(b.name, a, env)) {
        occursCheckHandler?.(b, a, env);
        return false;
      }
      env.bind(b.name, a);
      continue;
    }

    if (a.type !== b.type) {
      return false;
    }

    if (isScalar(a)) {
      if (a.name !== b.name) return false;
      continue;
    }

    if (a.type === COMPOUND) {
      if (a.name !== b.name || a.arity !== b.arity) return false;
      for (let i = a.arity - 1; i >= 0; i--) stack.push([a.args[i], b.args[i]]);
      continue;
    }

    return false;
  }
  return true;
}

export function cloneTerm(term: any): any {
  const cloned = term.type === COMPOUND && term.arity === 0
    ? atom(term.name)
    : new Term(term.type, term.name, term.args.map(cloneTerm));
  if (term.module != null) cloned.module = term.module;
  return cloned;
}

export function freshTerm(term: any, suffix: any): any {
  if (term.type === VAR) return variable(`${term.name}#${suffix}`);
  const fresh = term.type === COMPOUND && term.arity === 0
    ? atom(term.name)
    : new Term(term.type, term.name, term.args.map((arg: any) => freshTerm(arg, suffix)));
  if (term.module != null) fresh.module = term.module;
  return fresh;
}

export function copyResolved(term: any, env: any): any {
  const resolved = deref(term, env);
  if (resolved.type === VAR) return variable(resolved.name);
  const copied = resolved.type === COMPOUND && resolved.arity === 0
    ? atom(resolved.name)
    : new Term(resolved.type, resolved.name, resolved.args.map((arg: any) => copyResolved(arg, env)));
  if (resolved.module != null) copied.module = resolved.module;
  return copied;
}

export function termIsGround(term: any, env: any = new Env()): any {
  const pending = [term];
  const seen = new Set();
  while (pending.length > 0) {
    const resolved = deref(pending.pop(), env);
    if (resolved.type === VAR) return false;
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    for (const arg of resolved.args) pending.push(arg);
  }
  return true;
}

const graphicAtomChars = new Set('!#$&*+-/<=>@^~\\'.split(''));

function atomNeedsQuotes(name: any): any {
  if (!name) return true;
  if (name === '[]' || name === '{}') return false;
  if (name === '\\+' || name === '+' || name === '-' || name === '\\') return true;
  if (/^[a-z][A-Za-z0-9_]*$/.test(name)) return false;
  for (const ch of name) if (!graphicAtomChars.has(ch)) return true;
  return false;
}

function quoteAtom(name: any): any {
  let out = "'";
  for (const ch of name) {
    if (ch === "'") out += "''";
    else if (ch === '\\') out += '\\\\';
    else if (ch === '\n') out += '\\n';
    else if (ch === '\t') out += '\\t';
    else out += ch;
  }
  return out + "'";
}

function writeAtom(name: any): any {
  return atomNeedsQuotes(name) ? quoteAtom(name) : name;
}

function legacyVariableToIso(name: any): any {
  if (name === '?') return '_';
  const tail = name.slice(1);
  if (!tail) return '_';
  if (tail[0] === '_') return tail;
  return tail[0].toUpperCase() + tail.slice(1);
}

function writeVariable(name: any): any {
  name = String(name ?? '');
  if (/^\?(?:[A-Za-z_][A-Za-z0-9_]*)?$/.test(name)) return legacyVariableToIso(name);
  if (/^(?:_|[A-Z_][A-Za-z0-9_]*)$/.test(name)) return name;
  const sanitized = name.replace(/[^A-Za-z0-9_]/g, '_');
  if (!sanitized) return '_';
  return /^[A-Z_]/.test(sanitized) ? sanitized : `_${sanitized}`;
}

function writeString(value: any, quoteStrings: any): any {
  if (!quoteStrings) return value;
  let out = '"';
  for (const ch of value) {
    if (ch === '"' || ch === '\\') out += `\\${ch}`;
    else if (ch === '\x07') out += '\\a';
    else if (ch === '\b') out += '\\b';
    else if (ch === '\r') out += '\\r';
    else if (ch === '\f') out += '\\f';
    else if (ch === '\t') out += '\\t';
    else if (ch === '\n') out += '\\n';
    else if (ch === '\v') out += '\\v';
    else out += ch;
  }
  return out + '"';
}

function quotedListText(term: any, env: any, doubleQuotes: any): any {
  if (doubleQuotes !== 'chars' && doubleQuotes !== 'codes') return null;
  const characters = [];
  let cursor = term;
  while (true) {
    cursor = deref(cursor, env);
    if (isEmptyList(cursor)) return characters.length === 0 ? null : characters.join('');
    if (!isCons(cursor)) return null;
    const item = deref(cursor.args[0], env);
    if (doubleQuotes === 'chars') {
      if (item.type !== ATOM || Array.from(item.name).length !== 1) return null;
      characters.push(item.name);
    } else {
      if (item.type !== NUMBER || !/^\d+$/.test(item.name)) return null;
      const code = BigInt(item.name);
      if (code < 0n || code > 0x10ffffn || (code >= 0xd800n && code <= 0xdfffn)) return null;
      characters.push(String.fromCodePoint(Number(code)));
    }
    cursor = cursor.args[1];
  }
}

function writeList(term: any, env: any, options: any): any {
  const quotedText = quotedListText(term, env, options.doubleQuotes);
  if (quotedText != null) return writeString(quotedText, true);
  const parts = [];
  let cursor = term;
  while (true) {
    cursor = deref(cursor, env);
    if (isEmptyList(cursor)) return `[${parts.join(', ')}]`;
    if (!isCons(cursor)) {
      if (parts.length) return `[${parts.join(', ')} | ${termToString(cursor, env, true, options)}]`;
      return `[${termToString(cursor, env, true, options)}]`;
    }
    parts.push(termToString(cursor.args[0], env, true, options));
    cursor = cursor.args[1];
  }
}

export function termToString(term: any, env: any = new Env(), quoteStrings: any = true, options: any = {}): any {
  options = { doubleQuotes: options.doubleQuotes ?? 'chars' };
  if (!term) return String(term);
  const resolved = deref(term, env);
  if (!resolved || typeof resolved !== 'object' || !('type' in resolved)) {
    return `<?${String(resolved)}?>`;
  }
  if (resolved.type === VAR) return writeVariable(resolved.name);
  if (isCons(resolved)) return writeList(resolved, env, options);
  if (resolved.type === STRING) return writeString(resolved.name, quoteStrings);
  if (resolved.type === ATOM) return writeAtom(resolved.name);
  if (resolved.type === NUMBER) return resolved.name;
  if (resolved.type === COMPOUND && resolved.arity === 0) return writeAtom(resolved.name);
  if (resolved.type === COMPOUND && resolved.name === '{}' && resolved.arity === 1) {
    return `{${termToString(resolved.args[0], env, true, options)}}`;
  }
  if (resolved.type === COMPOUND && resolved.name === ':' && resolved.arity === 2) {
    return `${termToString(resolved.args[0], env, true, options)}:${termToString(resolved.args[1], env, true, options)}`;
  }
  if (isConjunction(resolved)) {
    const parts = [];
    let cursor = resolved;
    while (true) {
      cursor = deref(cursor, env);
      if (isConjunction(cursor)) {
        parts.push(termToString(cursor.args[0], env, true, options));
        cursor = cursor.args[1];
      } else {
        parts.push(termToString(cursor, env, true, options));
        break;
      }
    }
    return `(${parts.join(', ')})`;
  }
  const args = Array.isArray(resolved.args) ? resolved.args : [];
  return `${writeAtom(resolved.name)}(${args.map((arg: any) => termToString(arg, env, true, options)).join(', ')})`;
}

export function lexicalValue(term: any, env: any): any {
  const resolved = deref(term, env);
  if (resolved.type === VAR) return null;
  if (resolved.type === ATOM || resolved.type === STRING || resolved.type === NUMBER) return resolved.name;
  return termToString(resolved, env, true);
}

export function properListItems(list: any, env: any): any {
  const items = [];
  let cursor = deref(list, env);
  while (isCons(cursor)) {
    items.push(cursor.args[0]);
    cursor = deref(cursor.args[1], env);
  }
  if (!isEmptyList(cursor)) return null;
  return items;
}

export function listFromItems(items: any, start: any = 0, end: any = items.length, tail: any = emptyList()): any {
  let result = tail;
  for (let i = end - 1; i >= start; i--) result = cons(items[i], result);
  return result;
}

export function flattenConjunction(goal: any): any {
  const out = [];
  const stack = [goal];
  while (stack.length) {
    const current = stack.pop();
    if (isConjunction(current)) {
      stack.push(current.args[1], current.args[0]);
    } else {
      out.push(current);
    }
  }
  return out;
}

export function termSignature(term: any): any {
  return term?.type === COMPOUND ? `${term.name}/${term.arity}` : null;
}

export function variantTerms(left: any, leftEnv: any, right: any, rightEnv: any, pairs: any = new Map(), reverse: any = new Map()): any {
  left = deref(left, leftEnv);
  right = deref(right, rightEnv);
  if (left.type === VAR || right.type === VAR) {
    if (left.type !== VAR || right.type !== VAR) return false;
    if (pairs.has(left.name) || reverse.has(right.name)) {
      return pairs.get(left.name) === right.name && reverse.get(right.name) === left.name;
    }
    pairs.set(left.name, right.name);
    reverse.set(right.name, left.name);
    return true;
  }
  if (left.type !== right.type || left.name !== right.name || left.arity !== right.arity) return false;
  for (let i = 0; i < left.arity; i++) {
    if (!variantTerms(left.args[i], leftEnv, right.args[i], rightEnv, pairs, reverse)) return false;
  }
  return true;
}

export function compareTerms(left: any, right: any): any {
  const rank = (term: any) => ({ [VAR]: 0, [NUMBER]: 1, [ATOM]: 2, [STRING]: 3, [COMPOUND]: 4 })[term.type as string] ?? -1;
  left = deref(left, new Env());
  right = deref(right, new Env());
  const lr = rank(left);
  const rr = rank(right);
  if (lr !== rr) return lr < rr ? -1 : 1;
  if (left.type === NUMBER) {
    // ISO leaves the relative order of an integer and a float of equal value
    // implementation-defined. Treat them as the same value (so setof/sort merge
    // 1 and 1.0) to match SWI-Prolog and Trealla, while keeping exact BigInt
    // ordering for integers that exceed double precision.
    if (isDecimalInteger(left.name) && isDecimalInteger(right.name)) {
      return compareIntegerText(left.name, right.name);
    }
    const a = parseFiniteNumber(left.name);
    const b = parseFiniteNumber(right.name);
    if (a != null && b != null) {
      if (a === b) return 0;
      return a < b ? -1 : 1;
    }
    return left.name < right.name ? -1 : left.name > right.name ? 1 : 0;
  }
  if (left.type === VAR) {
    if (left.name === right.name) return 0;
    return left.name < right.name ? -1 : 1;
  }
  if (left.type === ATOM || left.type === STRING) return left.name < right.name ? -1 : left.name > right.name ? 1 : 0;
  if (left.arity !== right.arity) return left.arity < right.arity ? -1 : 1;
  if (left.name !== right.name) return left.name < right.name ? -1 : 1;
  for (let i = 0; i < left.arity; i++) {
    const cmp = compareTerms(left.args[i], right.args[i]);
    if (cmp) return cmp;
  }
  return 0;
}

export function isDecimalInteger(text: any): any {
  return /^-?\d+$/.test(text ?? '');
}

export function compareIntegerText(left: any, right: any): any {
  const a = BigInt(left);
  const b = BigInt(right);
  return a < b ? -1 : a > b ? 1 : 0;
}

export function parseFiniteNumber(text: any): any {
  if (text == null || text === '') return null;
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(text)) return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

export function numberTextFromDouble(value: any): any {
  if (!Number.isFinite(value)) return null;
  if (Object.is(value, -0)) value = 0;
  let text = Number(value).toPrecision(17);
  if (text.includes('e') || text.includes('E')) {
    text = text.replace(/(\.\d*?[1-9])0+(e[+-]?\d+)$/i, '$1$2').replace(/\.0+(e[+-]?\d+)$/i, '$1');
  } else if (text.includes('.')) {
    text = text.replace(/0+$/, '').replace(/\.$/, '');
  }
  if (!/[.eE]/.test(text)) text += '.0';
  return text;
}

export function compareNumberText(left: any, right: any): any {
  if (isDecimalInteger(left) && isDecimalInteger(right)) return compareIntegerText(left, right);
  const a = parseFiniteNumber(left);
  const b = parseFiniteNumber(right);
  if (a != null && b != null) return a < b ? -1 : a > b ? 1 : 0;
  return left < right ? -1 : left > right ? 1 : 0;
}
