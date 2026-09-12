// Runtime table-cache lifecycle adapters for library(tabling).

import { ATOM, NUMBER, deref } from './term.js';

function* abolishAllTablesBuiltin({ solver, env }: any) {
  solver.memo.clear();
  solver.subsumptiveMemo.clear();
  solver.wfsModels.clear();
  solver.datalogModels.clear();
  solver.tableCoordinator = null;
  solver.groundChainSuccess.clear();
  solver.compactChainSuccess.clear();
  for (const scope of solver.innerTableScopes.values()) {
    scope.memo.clear();
    scope.subsumptiveMemo.clear();
  }
  yield env;
}

function clearPredicateFromMemo(memo: any, prefix: any): any {
  for (const key of [...memo.keys()]) {
    if (key.startsWith(prefix)) memo.delete(key);
  }
}

function clearPredicateTables(solver: any, module: any, name: any, arity: any): any {
  const broadKey = `${module}:${name}/${arity}`;
  clearPredicateFromMemo(solver.memo, `${broadKey}:`);
  solver.subsumptiveMemo.delete(broadKey);
  for (const scope of solver.innerTableScopes.values()) {
    clearPredicateFromMemo(scope.memo, `${broadKey}:`);
    scope.subsumptiveMemo.delete(broadKey);
  }
}

function* abolishTableBuiltin({ solver, goal, env }: any) {
  const name = deref(goal.args[0], env);
  const arity = deref(goal.args[1], env);
  if (name.type !== ATOM || arity.type !== NUMBER || !/^\d+$/.test(arity.name)) return;
  const arityValue = Number(arity.name);
  const matches = [...solver.program.groups.values()].filter((group: any) =>
    group.name === name.name && group.arity === arityValue && group.tabled === true);
  if (matches.length === 0) return;
  for (const group of matches) clearPredicateTables(solver, group.module, group.name, group.arity);
  // A completed WFS/Datalog model can depend on a tabled predicate; these
  // caches do not expose per-predicate dependency keys, so invalidate them
  // conservatively while preserving unrelated explicit memo tables.
  solver.wfsModels.clear();
  solver.datalogModels.clear();
  solver.tableCoordinator = null;
  yield env;
}

export const tablingHostBuiltins = {
  register(registry: any): any {
    registry.add('eyeprolog__abolish_all_tables', 0, abolishAllTablesBuiltin, { deterministic: true, eyePrologLibrary: true });
    registry.add('eyeprolog__abolish_table', 2, abolishTableBuiltin, { deterministic: true, eyePrologLibrary: true });
  },
};
