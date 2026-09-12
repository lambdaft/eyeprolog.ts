// Finite Datalog well-founded semantics (WFS) evaluator.
//
// This module deliberately targets the function-free, range-restricted subset
// marked by Program#markRecursivePredicates as group.wfsDatalog.  It uses the
// alternating-fixpoint characterization of WFS: starting from an upper bound on
// possible atoms, repeatedly compute the least model of the Gelfond-Lifschitz
// reduct.  The final lower relation contains unconditional truths; the final
// upper relation contains truths plus undefined (conditional) answers.
//
// Keeping this separate from ordinary \+/1 is intentional.  Only explicit
// tnot/1 participates in WFS, matching the common tabled-negation convention.

import { ATOM, COMPOUND, VAR } from './term.js';
import { numberValueKey } from './number-value.js';
import {
  EMPTY_ARRAY,
  dependencyCone,
  directLiteral,
  estimateLiteral,
  predicateKey,
  resolvePatternTerm,
} from './datalog-common.js';

const _wfsScalarKeyCache = new WeakMap();
function scalarKey(term: any): any {
  const cached = _wfsScalarKeyCache.get(term);
  if (cached != null) return cached;
  const key = term.type === 'number'
    ? `number\u0000${numberValueKey(term.name)}`
    : `${term.type}\u0000${term.name}`;
  _wfsScalarKeyCache.set(term, key);
  return key;
}

function sameScalar(left: any, right: any): any {
  return scalarKey(left) === scalarKey(right);
}

function tupleKey(tuple: any): any {
  return tuple.map(scalarKey).join('\u0001');
}

class Relation {
      [key: string]: any;

  constructor(arity: any) {
    this.arity = arity;
    this.rows = [];
    this.keys = new Set();
    this.indexes = Array.from({ length: arity }, () => new Map());
  }

  add(tuple: any): any {
    const key = tupleKey(tuple);
    if (this.keys.has(key)) return false;
    const rowIndex = this.rows.length;
    this.keys.add(key);
    this.rows.push(tuple);
    for (let i = 0; i < tuple.length; i++) {
      const keyPart = scalarKey(tuple[i]);
      let bucket = this.indexes[i].get(keyPart);
      if (!bucket) {
        bucket = [];
        this.indexes[i].set(keyPart, bucket);
      }
      bucket.push(rowIndex);
    }
    return true;
  }

  has(tuple: any): any {
    return this.keys.has(tupleKey(tuple));
  }

  candidateIndexes(args: any, bindings: any): any {
    let selected: any = null;
    for (let i = 0; i < args.length; i++) {
      const value = resolvePatternTerm(args[i], bindings);
      if (value == null) continue;
      const bucket = this.indexes[i].get(scalarKey(value)) ?? EMPTY_ARRAY;
      if (selected == null || bucket.length < selected.length) selected = bucket;
      if (selected.length === 0) break;
    }
    return selected ?? null;
  }
}

function emptyRelations(groups: any): any {
  const relations: Map<any, any> = new Map();
  for (const group of groups) {
    relations.set(predicateKey(group.module, group.name, group.arity), new Relation(group.arity));
  }
  return relations;
}

function copyBaseRelations(base: any, groups: any): any {
  const relations = emptyRelations(groups);
  for (const [key, relation] of base) {
    const target = relations.get(key);
    if (!target) continue;
    for (const row of relation.rows) target.add(row);
  }
  return relations;
}


function negativeLiteral(goal: any, module: any): any {
  if (goal?.type !== COMPOUND || goal.name !== 'tnot' || goal.arity !== 1) return null;
  return directLiteral(goal.args[0], module);
}

function dependencyLiteral(goal: any, module: any): any {
  return negativeLiteral(goal, module) ?? directLiteral(goal, module);
}

function compileProgram(program: any, rootGroup: any): any {
  const groups = dependencyCone(program, rootGroup, dependencyLiteral);
  const base = emptyRelations(groups);
  const rules: any[] = [];

  for (const group of groups) {
    const headKey = predicateKey(group.module, group.name, group.arity);
    for (const clause of group.clauses) {
      if (clause.body.length === 0) {
        const tuple = clause.head.args ?? EMPTY_ARRAY;
        // Program analysis already guarantees ground scalar facts in the WFS
        // cone. Keep the guard so malformed dynamic input cannot corrupt a model.
        if (tuple.every((term: any) => term.type !== VAR && (term.type === ATOM || term.type === 'number' || term.type === 'string'))) {
          base.get(headKey)?.add(tuple);
        }
        continue;
      }

      const positives: any[] = [];
      const negatives: any[] = [];
      for (const goal of clause.body) {
        const neg = negativeLiteral(goal, group.module);
        if (neg) negatives.push(neg);
        else {
          const pos = directLiteral(goal, group.module);
          if (pos) positives.push(pos);
        }
      }
      rules.push({
        head: {
          key: headKey,
          args: clause.head.args ?? EMPTY_ARRAY,
        },
        positives,
        negatives,
      });
    }
  }

  return { groups, base, rules };
}


function matchTuple(args: any, tuple: any, bindings: any): any {
  let next: any = null;
  for (let i = 0; i < args.length; i++) {
    const pattern = args[i];
    if (pattern.type === VAR) {
      const current = (next ?? bindings).get(pattern.name);
      if (current != null) {
        if (!sameScalar(current, tuple[i])) return null;
      } else {
        if (next == null) next = new Map(bindings);
        next.set(pattern.name, tuple[i]);
      }
      continue;
    }
    if (!sameScalar(pattern, tuple[i])) return null;
  }
  return next ?? bindings;
}


function forEachPositiveBinding(positives: any, relations: any, callback: any, bindings: any = new Map(), remaining: any = null): any {
  if (remaining == null) remaining = positives.map((_: any, index: any) => index);
  if (remaining.length === 0) {
    callback(bindings);
    return;
  }

  let bestPos = 0;
  let bestEstimate = Infinity;
  for (let position = 0; position < remaining.length; position++) {
    const literal = positives[remaining[position]];
    const relation = relations.get(literal.key);
    const estimate = relation ? estimateLiteral(literal, relation, bindings) : 0;
    if (estimate < bestEstimate) {
      bestEstimate = estimate;
      bestPos = position;
      if (estimate === 0) return;
    }
  }

  const literalIndex = remaining[bestPos];
  const literal = positives[literalIndex];
  const relation = relations.get(literal.key);
  if (!relation) return;
  const candidates = relation.candidateIndexes(literal.args, bindings);
  const nextRemaining = remaining.length === 1
    ? EMPTY_ARRAY
    : [...remaining.slice(0, bestPos), ...remaining.slice(bestPos + 1)];

  if (candidates == null) {
    for (let rowIndex = 0; rowIndex < relation.rows.length; rowIndex++) {
      const next = matchTuple(literal.args, relation.rows[rowIndex], bindings);
      if (next) forEachPositiveBinding(positives, relations, callback, next, nextRemaining);
    }
    return;
  }
  for (const rowIndex of candidates) {
    const next = matchTuple(literal.args, relation.rows[rowIndex], bindings);
    if (next) forEachPositiveBinding(positives, relations, callback, next, nextRemaining);
  }
}

function instantiateTuple(args: any, bindings: any): any {
  const tuple: any[] = [];
  for (const arg of args) {
    const value = arg.type === VAR ? bindings.get(arg.name) : arg;
    if (value == null || value.type === VAR) return null;
    tuple.push(value);
  }
  return tuple;
}

function blockedByNegative(negatives: any, blockerRelations: any, bindings: any): any {
  if (!blockerRelations) return false;
  for (const literal of negatives) {
    const relation = blockerRelations.get(literal.key);
    if (!relation) continue;
    const tuple = instantiateTuple(literal.args, bindings);
    if (tuple == null) return true; // range restriction should make this unreachable
    if (relation.has(tuple)) return true;
  }
  return false;
}

function gamma(compiled: any, blockerRelations: any = null): any {
  const relations = copyBaseRelations(compiled.base, compiled.groups);
  let changed = true;
  while (changed) {
    changed = false;
    for (const rule of compiled.rules) {
      const headRelation = relations.get(rule.head.key);
      if (!headRelation) continue;
      forEachPositiveBinding(rule.positives, relations, (bindings: any) => {
        if (blockedByNegative(rule.negatives, blockerRelations, bindings)) return;
        const tuple = instantiateTuple(rule.head.args, bindings);
        if (tuple != null && headRelation.add(tuple)) changed = true;
      });
    }
  }
  return relations;
}

function relationSetsEqual(left: any, right: any): any {
  if (left.size !== right.size) return false;
  for (const [key, leftRelation] of left) {
    const rightRelation = right.get(key);
    if (!rightRelation || leftRelation.keys.size !== rightRelation.keys.size) return false;
    for (const tuple of leftRelation.keys) if (!rightRelation.keys.has(tuple)) return false;
  }
  return true;
}

export function evaluateWfs(program: any, rootGroup: any): any {
  const compiled = compileProgram(program, rootGroup);

  // Positive closure with tnot erased is an upper bound on every atom that can
  // participate in the WFS model, avoiding construction of the full Herbrand
  // cross product for predicates of arity > 1.
  let upper = gamma(compiled, null);
  let lower = emptyRelations(compiled.groups);
  let rounds = 0;

  while (true) {
    rounds++;
    const nextLower = gamma(compiled, upper);
    const nextUpper = gamma(compiled, nextLower);
    if (relationSetsEqual(lower, nextLower) && relationSetsEqual(upper, nextUpper)) {
      lower = nextLower;
      upper = nextUpper;
      break;
    }
    lower = nextLower;
    upper = nextUpper;
  }

  return { lower, upper, rounds, groups: compiled.groups };
}

export function relationForGroup(model: any, group: any, kind: any = 'upper'): any {
  const relations = kind === 'lower' ? model.lower : model.upper;
  return relations.get(predicateKey(group.module, group.name, group.arity)) ?? null;
}

export function truthOfGroundGoal(model: any, goal: any): any {
  const key = predicateKey(goal.module ?? 'user', goal.name, goal.arity);
  const tuple = goal.args ?? EMPTY_ARRAY;
  const lower = model.lower.get(key);
  if (lower?.has(tuple)) return 'true';
  const upper = model.upper.get(key);
  if (upper?.has(tuple)) return 'undefined';
  return 'false';
}
