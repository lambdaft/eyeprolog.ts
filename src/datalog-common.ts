export type Literal = any;
export const Literal = Object;
// Shared plumbing for the finite positive-Datalog and WFS evaluators.
//
// Keep evaluator-specific relation storage and fixpoint algorithms in their
// own modules; this file only contains representation/traversal helpers whose
// semantics are common to both execution paths.

import { ATOM, COMPOUND, VAR } from './term.js';

export const EMPTY_ARRAY = Object.freeze([]);

export function predicateKey(module: any, name: any, arity: any): any {
  return `${module ?? 'user'}:${name}/${arity}`;
}

export function directLiteral(goal: any, module: any): any {
  if (goal?.type !== COMPOUND && goal?.type !== ATOM) return null;
  return {
    key: predicateKey(goal.module ?? module, goal.name, goal.arity),
    name: goal.name,
    arity: goal.arity,
    module: goal.module ?? module,
    args: goal.args ?? EMPTY_ARRAY,
  };
}

export function dependencyCone(program: any, rootGroup: any, literalForGoal: any = directLiteral): any {
  const groups: any[] = [];
  const seen: Set<any> = new Set();
  const stack: any[] = [rootGroup];
  while (stack.length > 0) {
    const group = stack.pop() as any;
    const key = predicateKey(group.module, group.name, group.arity);
    if (seen.has(key)) continue;
    seen.add(key);
    groups.push(group);
    for (const clause of group.clauses) {
      for (const goal of clause.body) {
        const literal = literalForGoal(goal, group.module);
        if (!literal) continue;
        const target = program.findGroup(literal.name, literal.arity, literal.module);
        if (target) stack.push(target);
      }
    }
  }
  return groups;
}

export function resolvePatternTerm(term: any, bindings: any): any {
  if (term.type === VAR) return bindings.get(term.name) ?? null;
  return term;
}

export function estimateLiteral(literal: any, relation: any, bindings: any): any {
  const candidates = relation.candidateIndexes(literal.args, bindings);
  return candidates == null ? relation.rows.length : candidates.length;
}
