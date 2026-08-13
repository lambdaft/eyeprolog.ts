// Program representation and clause indexing.
// Indexes are deliberately conservative: they speed up common scalar arguments but never replace unification as the final check.
// @ts-expect-error TS6133: auto-suppressed
import { ATOM, COMPOUND, VAR, Env, atom, compound, deref, flattenConjunction, isScalar, numberTerm, properListItems, termToString, variable } from './term.js';
import { formatTermForWrite } from './write.js';
import {
  ISO_OPERATOR_DEFINITIONS,
  QUAD_OPERATOR_DEFINITIONS,
  createParserOperatorState,
  parseClauses,
  parseClausesInto,
  tryParseClausesFastInto,
} from './parser.js';
import { PrologError, getStrictIsoRegistry } from './iso.js';
// @ts-expect-error TS7034: auto-suppressed
import { currentWorkingDirectory, fs, path } from './platform.js';
import { standardLibrarySources } from './standard-library.js';
import { expandDcgRuleClause } from './dcg.js';

const DEFER_PROGRAM_BUILD = Symbol('deferProgramBuild');
const FAST_PARSE_ABORT = Symbol('fastParseAbort');
const PROGRAM_BUILD_BATCH_SIZE = 16384;
const EMPTY_CLAUSE_BODY = Object.freeze([]);

function modulePredicateKey(module: any, name: any, arity: any): any {
  return module === 'user' ? `${name}/${arity}` : `${module}:${name}/${arity}`;
}

class CompactBinaryClause {
  constructor(headName: any, head0Type: any, head0Name: any, head1Type: any, head1Name: any,
      bodyName: any, body0Type: any, body0Name: any, body1Type: any, body1Name: any) {
    this.compactBinary = true;
    this.headName = headName;
    this.head0Type = head0Type;
    this.head0Name = head0Name;
    this.head1Type = head1Type;
    this.head1Name = head1Name;
    this.bodyName = bodyName;
    this.body0Type = body0Type;
    this.body0Name = body0Name;
    this.body1Type = body1Type;
    this.body1Name = body1Name;
  }

  get head() {
    // @ts-expect-error TS2551: auto-suppressed
    if (!this._head) {
      // @ts-expect-error TS2551: auto-suppressed
      this._head = compound(this.headName, [
        compactTerm(this.head0Type, this.head0Name),
        compactTerm(this.head1Type, this.head1Name),
      ]);
    }
    // @ts-expect-error TS2551: auto-suppressed
    return this._head;
  }

  get body() {
    if (this.bodyName == null) return EMPTY_CLAUSE_BODY;
    // @ts-expect-error TS2551: auto-suppressed
    if (!this._body) {
      // @ts-expect-error TS2551: auto-suppressed
      this._body = [compound(this.bodyName, [
        compactTerm(this.body0Type, this.body0Name),
        compactTerm(this.body1Type, this.body1Name),
      ])];
    }
    // @ts-expect-error TS2551: auto-suppressed
    return this._body;
  }

    compactBinary: any;
    headName: any;
    head0Type: any;
    head0Name: any;
    head1Type: any;
    head1Name: any;
    bodyName: any;
    body0Type: any;
    body0Name: any;
    body1Type: any;
    body1Name: any;
}

function compactTerm(type: any, name: any): any {
  if (type === VAR) return variable(name);
  if (type === 'number') return numberTerm(name);
  return atom(name);
}

function isCompactBinaryClause(clause: any): any {
  return clause?.compactBinary === true;
}

function compactHeadArgType(clause: any, index: any): any {
  return index === 0 ? clause.head0Type : clause.head1Type;
}

function compactHeadArgName(clause: any, index: any): any {
  return index === 0 ? clause.head0Name : clause.head1Name;
}



function clauseBodyLength(clause: any): any {
  return isCompactBinaryClause(clause) ? (clause.bodyName == null ? 0 : 1) : clause.body.length;
}


export class Program {
  constructor(clauses: any = [], options: any = {}) {
    this.clauses = [];
    this.groups = new Map();
    this.modules = new Map([['user', { name: 'user', exports: new Map(), filename: '<input>' }]]);
    this.moduleImports = new Map();
    this.moduleMetaPredicates = new Map();
    this.dynamicPredicates = new Set();
    this.strictIso = options.isoStrict === true;
    this.operators = new Map();
    const predefinedOperatorSets = this.strictIso
      ? [ISO_OPERATOR_DEFINITIONS]
      : [ISO_OPERATOR_DEFINITIONS, QUAD_OPERATOR_DEFINITIONS];
    for (const definitions of predefinedOperatorSets) {
      for (const [priority, specifier, name] of definitions) {
        this.defineOperator(priority, specifier, name);
      }
    }
    this.initializations = [];
    this.quads = [];
    this.prologFlagDirectives = [];
    this.charConversionDirectives = [];
    this.doubleQuotes = options.doubleQuotes ?? 'chars';
    this._revisionState = { value: 0 };
    this.mutable = false;
    this._negationAnalysis = null;
    if (options[DEFER_PROGRAM_BUILD] === true) return;
    const builder = new ProgramBuilder(options, this);
    builder.addClauses(clauses);
    builder.finish();
  }
  defineOperator(priority: any, specifier: any, name: any): any {
    const operatorClass = ['fx', 'fy'].includes(specifier) ? ['fx', 'fy']
      : ['xf', 'yf'].includes(specifier) ? ['xf', 'yf']
        : ['xfx', 'xfy', 'yfx'];
    for (const existing of operatorClass) this.operators.delete(`${existing}\u0000${name}`);
    const key = `${specifier}\u0000${name}`;
    if (priority !== 0) this.operators.set(key, { priority, specifier, name });
  }
  static parse(source: any, options: any = {}): any {
    return buildProgramFromSources([source], options);
  }
  static parseSources(sources: any = [], options: any = {}): any {
    return buildProgramFromSources(sources, options);
  }
  makeGroup(name: any, arity: any, module: any = 'user'): any {
    // A group corresponds to one predicate indicator, for example edge/3.
    // Compact single-argument indexes are built eagerly. Wider combinations
    // are constructed on first use, avoiding eager O(arity^2) pair tables while
    // still allowing call-driven combinations of any width.
    const group = {
      name,
      arity,
      module,
      metaArgumentPositions: this.moduleMetaPredicates.get(module)?.get(`${name}/${arity}`) ?? [],
      clauses: [],
      argIndexes: Array.from({ length: arity }, makeArgumentIndex),
      demandIndexes: new Map(),
      rejectedDemandIndexes: new Set(),
      tabled: false,
      recursive: false,
      tableInputPositions: [],
      scalarFactsOnly: true,
      dynamic: this.dynamicPredicates.has(modulePredicateKey(module, name, arity)),
      negationStratum: null,
    };
    return group;
  }
  indexClause(clause: any): any {
    this._indexClause(clause, false);
  }
  _indexClause(clause: any, initialBuild: any): any {
    const head = clause.head;
    if (!initialBuild) assertHeadIsDefinable(head, this.strictIso);
    if (head.type !== ATOM && head.type !== COMPOUND) return;
    const module = clause.module ?? 'user';
    const key = modulePredicateKey(module, head.name, head.arity);
    let group = this.groups.get(key);
    if (!group) {
      group = this.makeGroup(head.name, head.arity, module);
      this.groups.set(key, group);
    }
    clause.groundHead = termHasNoVariables(head);
    clause.scalarHead = head.type === COMPOUND && head.args.every(isScalar);
    if (clause.body.length !== 0 || !clause.scalarHead) group.scalarFactsOnly = false;
    // Keep already-used groups correct when embedders append clauses through
    // the public indexClause method.
    if (!initialBuild) {
      group.demandIndexes.clear();
      group.rejectedDemandIndexes.clear();
    }
    group.clauses.push(clause);
    const clausePosition = group.clauses.length - 1;
    for (let i = 0; i < head.arity; i++) indexOne(group.argIndexes[i], head.args[i], clause, group.clauses, clausePosition);
  }
  findGroup(name: any, arity: any, module: any = 'user'): any {
    const direct = this.groups.get(modulePredicateKey(module, name, arity));
    if (direct) return direct;
    const importedModule = this.moduleImports.get(module)?.get(`${name}/${arity}`);
    return importedModule == null
      ? null
      : this.groups.get(modulePredicateKey(importedModule, name, arity)) ?? null;
  }
  defineModule(name: any, exports: any, filename: any = '<input>'): any {
    const indicators = new Map(exports.map((indicator: any) => [`${indicator.name}/${indicator.arity}`, indicator]));
    this.modules.set(name, { name, exports: indicators, filename });
  }
  importModule(target: any, source: any, requested: any = null): any {
    const definition = this.modules.get(source);
    if (!definition) throw new PrologError('existence_error(module)', atom(source));
    const imports = this.moduleImports.get(target) ?? new Map();
    const selected = requested ?? [...definition.exports.values()];
    for (const indicator of selected) {
      const key = `${indicator.name}/${indicator.arity}`;
      if (!definition.exports.has(key)) {
        throw new PrologError('existence_error(procedure)', compound('/', [atom(indicator.name), numberTerm(indicator.arity)]));
      }
      const previous = imports.get(key);
      if (previous != null && previous !== source) {
        throw new PrologError('permission_error(import, procedure)', compound('/', [atom(indicator.name), numberTerm(indicator.arity)]));
      }
      imports.set(key, source);
    }
    this.moduleImports.set(target, imports);
  }
  defineMetaPredicate(module: any, template: any): any {
    if (template.type !== COMPOUND) return;
    const positions = [];
    for (let index = 0; index < template.args.length; index++) {
      const spec = template.args[index];
      if ((spec.type === 'number' && /^\d+$/.test(spec.name)) ||
          (spec.type === ATOM && spec.name === ':')) positions.push(index);
    }
    const definitions = this.moduleMetaPredicates.get(module) ?? new Map();
    definitions.set(`${template.name}/${template.arity}`, positions);
    this.moduleMetaPredicates.set(module, definitions);
    const group = this.groups.get(modulePredicateKey(module, template.name, template.arity));
    if (group) group.metaArgumentPositions = positions;
  }
  ensureDynamicGroup(name: any, arity: any, module: any = 'user'): any {
    assertPredicateIsDefinable(name, arity, this.strictIso);
    const key = modulePredicateKey(module, name, arity);
    let group = this.groups.get(key);
    if (!group) {
      this.dynamicPredicates.add(key);
      this.mutable = true;
      group = this.makeGroup(name, arity, module);
      group.dynamic = true;
      this.groups.set(key, group);
    }
    return group;
  }
  insertDynamicClause(clause: any, atStart: any = false): any {
    clause.module ??= clause.head.module ?? 'user';
    const group = this.ensureDynamicGroup(clause.head.name, clause.head.arity, clause.module);
    clause.index = this.clauses.length;
    clause.groundHead = termHasNoVariables(clause.head);
    clause.scalarHead = clause.head.type === COMPOUND && clause.head.args.every(isScalar);
    this.clauses.push(clause);
    if (atStart) group.clauses.unshift(clause);
    else group.clauses.push(clause);
    rebuildGroupIndexes(group);
    this.noteMutation(clause.body.length > 0);
  }
  removeDynamicClause(group: any, clause: any): any {
    const index = group.clauses.indexOf(clause);
    if (index < 0) return false;
    group.clauses.splice(index, 1);
    const allIndex = this.clauses.indexOf(clause);
    if (allIndex >= 0) this.clauses.splice(allIndex, 1);
    rebuildGroupIndexes(group);
    this.noteMutation(clause.body.length > 0);
    return true;
  }
  abolishDynamicGroup(name: any, arity: any, module: any = 'user'): any {
    const key = modulePredicateKey(module, name, arity);
    const group = this.groups.get(key);
    if (!group) return;
    const removed = new Set(group.clauses);
    const reanalyze = group.clauses.some((clause: any) => clause.body.length > 0);
    this.clauses = this.clauses.filter((clause: any) => !removed.has(clause));
    this.groups.delete(key);
    this.dynamicPredicates.delete(key);
    this.noteMutation(reanalyze);
  }
  get revision() {
    return this._revisionState.value;
  }
  noteMutation(reanalyze: any = false): any {
    this._revisionState.value++;
    this._negationAnalysis = null;
    if (reanalyze && !this.strictIso) this.markRecursivePredicates();
  }
  markRecursivePredicates(): any {
    // Recursion analysis drives automatic tabling and is always part of program setup.
    const groups = [...this.groups.values()];
    const indexByGroup = new Map(groups.map((group: any, i: any) => [group, i]));
    const deps = groups.map(() => new Set());
    const negativeEdges = [];
    for (const group of groups) {
      const groupIndex = indexByGroup.get(group);
      for (const clause of group.clauses) {
        if (isCompactBinaryClause(clause)) {
          if (clause.bodyName != null) {
            const dep = this.findGroup(clause.bodyName, 2, group.module);
            // @ts-expect-error TS2532: auto-suppressed
            if (dep) deps[groupIndex].add(indexByGroup.get(dep));
          }
          continue;
        }
        for (const goal of clause.body) {
          const directKey = directGoalDependencyKey(goal);
          if (directKey) {
            const dep = this.findGroup(goal.name, goal.arity, goal.module ?? group.module);
            // @ts-expect-error TS2532: auto-suppressed
            if (dep) deps[groupIndex].add(indexByGroup.get(dep));
            continue;
          }
          for (const dependency of collectGoalDependencies(goal, false)) {
            const dep = this.findGroup(dependency.name, dependency.arity, dependency.module ?? group.module);
            if (dep) {
              const dependencyIndex = indexByGroup.get(dep);
              // @ts-expect-error TS2532: auto-suppressed
              deps[groupIndex].add(dependencyIndex);
              if (dependency.negative) negativeEdges.push([groupIndex, dependencyIndex]);
            }
          }
        }
      }
    }
    for (const group of groups) {
      const start = indexByGroup.get(group);
      const standardLibraryModule = group.module !== 'user' &&
        this.modules.get(group.module)?.filename?.startsWith('src/lib/');
      const seen = new Set();
      const stack = [start];
      let recursive = false;
      while (stack.length && !recursive) {
        const current = stack.pop();
        if (seen.has(current)) continue;
        seen.add(current);
        // @ts-expect-error TS2532: auto-suppressed
        for (const next of deps[current]) {
          if (next === start) { recursive = true; break; }
          if (!seen.has(next)) stack.push(next);
        }
      }
      // Bundled libraries use their written ISO control directly. User modules
      // still receive EyeProlog's automatic cycle analysis and tabling.
      const plannedRecursive = recursive && !standardLibraryModule;
      group.recursive = plannedRecursive;
      group.tableInputPositions = plannedRecursive
        ? inferStructuralInputPositions(group)
        : [];
      // Recursive predicates are proved with tabling automatically, keeping
      // search control inside the engine. Cycles through negation retain
      // guarded resolution because positive least-fixed-point tabling is not
      // sound for an unstratified negative component.
      group.cutRecursive = plannedRecursive && componentHasCut(start, deps, groups);
      const linearNumeric = plannedRecursive && hasLinearNumericRecursion(group) &&
        (isPiAccumulator(group) || isPortableBetweenGenerator(group));
      group.linearNumeric = linearNumeric;
      group.fastPi = linearNumeric && isPiAccumulator(group);
      group.tabled = plannedRecursive &&
        !componentHasNegativeEdge(start, deps, negativeEdges) &&
        !group.cutRecursive &&
        !linearNumeric;
    }
  }

  analyzeNegationStratification(): any {
    // Stratified negation is a portability diagnostic. A program is stratified
    // when no predicate depends negatively on itself, directly or indirectly.
    const groups = [...this.groups.values()];
    const groupKeys = new Map(groups.map((group: any) => [group, modulePredicateKey(group.module, group.name, group.arity)]));
    // @ts-expect-error TS6133: auto-suppressed
    const groupByKey = new Map(groups.map((group: any) => [modulePredicateKey(group.module, group.name, group.arity), group]));
    const indexByKey = new Map(groups.map((group: any, i: any) => [modulePredicateKey(group.module, group.name, group.arity), i]));
    const edges = [];

    for (const group of groups) {
      const from = groupKeys.get(group);
      for (const clause of group.clauses) {
        for (const goal of clause.body) {
          for (const dep of collectGoalDependencies(goal, false)) {
            const target = this.findGroup(dep.name, dep.arity, dep.module ?? group.module);
            if (!target) continue;
            edges.push({ from, to: groupKeys.get(target), negative: dep.negative });
          }
        }
      }
    }

    const adjacency = groups.map(() => []);
    for (const edge of edges) {
      const from = indexByKey.get(edge.from);
      const to = indexByKey.get(edge.to);
      if (from == null || to == null) continue;
      // @ts-expect-error TS2532: auto-suppressed
      adjacency[from].push(to);
    }

    const sccs = stronglyConnectedComponents(adjacency);
    const componentByIndex = new Map();
    for (let component = 0; component < sccs.length; component++) {
      for (const index of sccs[component]) componentByIndex.set(index, component);
    }

    const violations = [];
    const seen = new Set();
    for (const edge of edges) {
      if (!edge.negative) continue;
      const from = indexByKey.get(edge.from);
      const to = indexByKey.get(edge.to);
      if (from == null || to == null) continue;
      if (componentByIndex.get(from) !== componentByIndex.get(to)) continue;
      const key = `${edge.from}->${edge.to}`;
      if (seen.has(key)) continue;
      seen.add(key);
      violations.push({ from: edge.from, to: edge.to });
    }

    const strata = computeNegationStrata(groups, edges, indexByKey);
    for (const group of groups) group.negationStratum = strata.get(groupKeys.get(group)) ?? null;

    this._negationAnalysis = {
      dependencies: edges,
      errors: violations,
      stratified: violations.length === 0,
    };
    return violations;
  }
  ensureNegationStratification(): any {
    if (!this._negationAnalysis) this.analyzeNegationStratification();
    return this._negationAnalysis;
  }
  get negationDependencies() {
    return this.ensureNegationStratification().dependencies;
  }
  get negationStratificationErrors() {
    return this.ensureNegationStratification().errors;
  }
  get stratifiedNegation() {
    return this.ensureNegationStratification().stratified;
  }
  assertStratifiedNegation(): any {
    const violations = this.ensureNegationStratification().errors;
    if (violations.length === 0) return true;
    const details = violations.map((edge: any) => `${edge.from} depends negatively on ${edge.to}`).join('; ');
    throw new Error(`unstratified negation: ${details}`);
  }
  isStratifiedNegation(): any {
    return this.ensureNegationStratification().stratified;
  }

  groupHasRule(group: any): any {
    return group.clauses.some((clause: any) => clauseBodyLength(clause) > 0);
  }
  sourceFactLines(predicateKeys: any = null, options: any = {}): any {
    const lines = new Set();
    const env = new Env();
    const writeOptions = {
      ...options,
      operators: options.operators ?? [...this.operators.values()],
      quoted: true,
    };
    for (const clause of this.clauses) {
      if (isCompactBinaryClause(clause)) {
        if (clause.bodyName != null) continue;
        if (predicateKeys && !predicateKeys.has(`${clause.headName}/2`)) continue;
        lines.add(`${formatTermForWrite(clause.head, env, writeOptions)}.\n`);
        continue;
      }
      if (clause.body.length !== 0 || (clause.head.type !== ATOM && clause.head.type !== COMPOUND)) continue;
      if (predicateKeys && !predicateKeys.has(`${clause.head.name}/${clause.head.arity}`)) continue;
      lines.add(`${formatTermForWrite(clause.head, env, writeOptions)}.\n`);
    }
    return lines;
  }

    operators: any;
    moduleMetaPredicates: any;
    dynamicPredicates: any;
    strictIso: any;
    groups: any;
    moduleImports: any;
    modules: any;
    mutable: any;
    clauses: any;
    _revisionState: any;
    _negationAnalysis: any;
    initializations: any;
    quads: any;
    prologFlagDirectives: any;
    charConversionDirectives: any;
    doubleQuotes: any;
}

class ProgramBuilder {
  constructor(options: any = {}, program: any = null) {
    this.options = options;
    this.program = program ?? new Program([], { ...options, [DEFER_PROGRAM_BUILD]: true });
    this.declaredDynamicIndicators = new Map();
    this.lastGroupKey = null;
    this.lastGroup = null;
    this.finished = false;
  }

  addClauses(clauses: any): any {
    if (this.finished) throw new Error('program builder is already finalized');
    const program = this.program;
    let lastGroupKey = this.lastGroupKey;
    let lastGroup = this.lastGroup;

    for (const clause of clauses) {
      if (clause?.kind === 'quad') {
        const module = clause.module ?? 'user';
        annotateGoalModule(clause.query, module);
        program.quads.push({ ...clause, module });
        continue;
      }
      clause.index = program.clauses.length;
      program.clauses.push(clause);

      if (isCompactBinaryClause(clause)) {
        assertPredicateIsDefinable(clause.headName, 2, program.strictIso);
        const module = clause.module ?? 'user';
        const key = modulePredicateKey(module, clause.headName, 2);
        let group = key === lastGroupKey ? lastGroup : program.groups.get(key);
        if (!group) {
          group = program.makeGroup(clause.headName, 2, module);
          program.groups.set(key, group);
        }
        lastGroupKey = key;
        lastGroup = group;
        const clausePosition = group.clauses.length;
        group.clauses.push(clause);
        clause.groundHead = clause.head0Type !== VAR && clause.head1Type !== VAR;
        clause.scalarHead = clause.groundHead;
        if (clause.bodyName != null || !clause.scalarHead) group.scalarFactsOnly = false;
        indexCompactOne(group.argIndexes[0], clause.head0Type, clause.head0Name, clause, group.clauses, clausePosition);
        indexCompactOne(group.argIndexes[1], clause.head1Type, clause.head1Name, clause, group.clauses, clausePosition);
        continue;
      }

      if (!isDirectiveClause(clause)) {
        assertHeadIsDefinable(clause.head, program.strictIso);
        const head = clause.head;
        if (head.type !== ATOM && head.type !== COMPOUND) continue;
        const module = clause.module ?? 'user';
        const key = modulePredicateKey(module, head.name, head.arity);
        let group = key === lastGroupKey ? lastGroup : program.groups.get(key);
        if (!group) {
          group = program.makeGroup(head.name, head.arity, module);
          program.groups.set(key, group);
        }
        lastGroupKey = key;
        lastGroup = group;
        const clausePosition = group.clauses.length;
        group.clauses.push(clause);
        clause.groundHead = termHasNoVariables(head);
        clause.scalarHead = head.type === COMPOUND && head.args.every(isScalar);
        if (clause.body.length !== 0 || !clause.scalarHead) group.scalarFactsOnly = false;
        for (let i = 0; i < head.arity; i++) {
          indexOne(group.argIndexes[i], head.args[i], clause, group.clauses, clausePosition);
        }
        continue;
      }

      this.addDirectiveClause(clause);
    }

    this.lastGroupKey = lastGroupKey;
    this.lastGroup = lastGroup;
  }

  addDirectiveClause(clause: any): any {
    const program = this.program;
    const module = clause.module ?? 'user';
    for (const indicator of dynamicDirectiveIndicators(clause)) {
      assertDynamicIndicatorIsDefinable(indicator, program.strictIso);
      const key = modulePredicateKey(module, indicator.name, indicator.arity);
      program.dynamicPredicates.add(key);
      this.declaredDynamicIndicators.set(key, { ...indicator, key, module });
      const existing = program.groups.get(key);
      if (existing) existing.dynamic = true;
    }

    const operator = operatorDirective(clause);
    if (operator) {
      for (const name of operator.names) program.defineOperator(operator.priority, operator.specifier, name);
    }

    const directive = clause.head.args[0];
    if (directive?.type === COMPOUND && directive.name === 'module' && directive.arity === 2) {
      const name = directive.args[0];
      const exports = moduleExportIndicators(directive.args[1]);
      if (name.type !== ATOM) throw new PrologError('type_error(atom)', name);
      if (exports == null) throw new PrologError('type_error(list)', directive.args[1]);
      program.defineModule(name.name, exports, clause.source?.filename ?? clause.moduleFilename ?? '<input>');
    } else if (directive?.type === COMPOUND && directive.name === 'meta_predicate' && directive.arity === 1) {
      for (const template of flattenDirectiveSequence(directive.args[0])) {
        program.defineMetaPredicate(module, template);
      }
    } else if (directive?.type === COMPOUND && directive.name === 'initialization' && directive.arity === 1) {
      annotateGoalModule(directive.args[0], module);
      program.initializations.push(directive.args[0]);
    } else if (directive?.type === COMPOUND && directive.name === 'set_prolog_flag' && directive.arity === 2) {
      program.prologFlagDirectives.push(directive.args);
    } else if (directive?.type === COMPOUND && directive.name === 'char_conversion' && directive.arity === 2) {
      program.charConversionDirectives.push(directive.args);
    }
  }

  finish(): any {
    if (this.finished) return this.program;
    this.finished = true;
    const program = this.program;

    // A dynamic declaration creates a procedure even when it has no clauses.
    // Calls to that procedure fail normally instead of being treated as calls
    // to an unknown predicate.
    for (const indicator of this.declaredDynamicIndicators.values()) {
      if (!program.groups.has(indicator.key)) {
        program.groups.set(indicator.key, program.makeGroup(indicator.name, indicator.arity, indicator.module));
      }
    }
    program.mutable = program.dynamicPredicates.size > 0;

    // Static indexes are built while clauses stream into the builder. Dynamic
    // updates still rebuild only the affected predicate group.
    // Strict ISO core mode follows ordinary ISO clause selection rather than
    // EyeProlog's automatic recursion guards, numeric recursion shortcuts, or
    // tabled fixed points.  Leaving the recursion-planning fields at their
    // neutral defaults preserves the standard depth-first execution model.
    if (!program.strictIso) program.markRecursivePredicates();
    if (this.options.analyzeNegation === true || this.options.strictNegation === true) {
      program.analyzeNegationStratification();
    }
    if (this.options.strictNegation === true) program.assertStratifiedNegation();
    return program;
  }

    finished: any;
    program: any;
    lastGroupKey: any;
    lastGroup: any;
    declaredDynamicIndicators: any;
    options: any;
}

function buildProgramFromSources(sources: any, options: any): any {
  // The source-metadata-free path is common for CLI and conformance runs.  It
  // attempts the compact line parser directly into a fresh builder.  Should a
  // source require the full parser (for example because it defines custom
  // operators), the partial builder is simply discarded and the source set is
  // rebuilt once with the general streaming parser.
  const hasModuleDirectives = sources.some((source: any) => {
    const text = typeof source === 'string' ? source : source?.text ?? source?.source ?? '';
    return /:-\s*(?:module|use_module)\s*\(/.test(text);
  });
  if (options.sourceMetadata === false && !hasModuleDirectives) {
    const builder = new ProgramBuilder(options);
    if (loadSourcesIntoBuilder(builder, sources, options, true)) return builder.finish();
  }

  const builder = new ProgramBuilder(options);
  loadSourcesIntoBuilder(builder, sources, options, false);
  return builder.finish();
}

function loadSourcesIntoBuilder(builder: any, sources: any, options: any, fast: any): any {
  const ensured = new Set();
  const loadedModules = new Set();
  const operatorState = createParserOperatorState([], true, { isoStrict: options.isoStrict === true });
  const parserFlagState = { doubleQuotes: options.doubleQuotes ?? 'chars' };
  const prepared = sources.map((source: any) => ({
    source,
    options: { ...sourceOptionsFor(source, options), operatorState, parserFlagState },
  }));
  for (const item of prepared) {
    const filename = sourcePath(item.options);
    if (filename) ensured.add(filename);
  }
  try {
    for (const item of prepared) {
      const text = typeof item.source === 'string'
        ? item.source
        : item.source?.text ?? item.source?.source ?? '';
      const context = { module: 'user' };
      if (!loadSourceIntoBuilder(builder, text, item.options, ensured, loadedModules, fast, context)) return false;
    }
    builder.program.doubleQuotes = parserFlagState.doubleQuotes;
    return true;
  } catch (error) {
    if (error === FAST_PARSE_ABORT) return false;
    throw error;
  }
}

function sourceOptionsFor(source: any, options: any): any {
  if (typeof source === 'string') return options;
  return {
    ...options,
    filename: source?.filename ?? '<input>',
    baseDir: source?.baseDir ?? options.baseDir,
  };
}

function sourcePath(options: any): any {
  // @ts-expect-error TS7005: auto-suppressed
  if (!path) return null;
  const filename = String(options.filename ?? '');
  if (!filename || filename.startsWith('<') || /^https?:\/\//.test(filename)) return null;
  const base = options.baseDir ?? currentWorkingDirectory();
  return path.resolve(base, filename);
}

function loadSourceIntoBuilder(builder: any, source: any, options: any, ensured: any, loadedModules: any, fast: any, context: any): any {
  // @ts-expect-error TS7034: auto-suppressed
  const batch = [];
  const flush = () => {
    if (batch.length === 0) return;
    // @ts-expect-error TS7005: auto-suppressed
    builder.addClauses(batch);
    batch.length = 0;
  };
  const accept = (clause: any) => {
    if (clause?.kind === 'quad') {
      flush();
      clause.module = context.module;
      builder.addClauses([clause]);
      return;
    }
    // Grammar-rule expansion belongs to ISO/IEC TS 13211-3 rather than the
    // Part 1 strict-core language.  In strict core mode -->/2 remains the
    // ordinary predefined operator term from Table 7 and is not rewritten.
    const grammarClause = builder.program.strictIso ? null : expandDcgRuleClause(clause, context.module);
    if (grammarClause) clause = grammarClause;
    const moduleDeclaration = moduleDirective(clause);
    if (moduleDeclaration) {
      flush();
      clause.module = moduleDeclaration.name;
      clause.moduleFilename = options.filename ?? '<input>';
      builder.addClauses([clause]);
      context.module = moduleDeclaration.name;
      loadedModules.add(moduleDeclaration.name);
      return;
    }
    const use = useModuleDirective(clause);
    if (use) {
      flush();
      clause.module = context.module;
      builder.addClauses([clause]);
      const loaded = readModuleSource(use.designation, options);
      if (!loadedModules.has(loaded.name)) {
        const childContext = { module: loaded.name };
        if (!loadSourceIntoBuilder(builder, loaded.text, loaded.options, ensured, loadedModules, fast, childContext)) {
          throw FAST_PARSE_ABORT;
        }
      }
      builder.program.importModule(context.module, loaded.name, use.imports);
      return;
    }
    const include = includeDirective(clause);
    if (!include) {
      clause.module ??= context.module;
      if (!isDirectiveClause(clause)) {
        for (const goal of clause.body) annotateGoalModule(goal, clause.module);
      }
      batch.push(clause);
      if (batch.length >= PROGRAM_BUILD_BATCH_SIZE) flush();
      return;
    }
    flush();
    const child = readIncludedSource(include, options, ensured);
    if (!child) return;
    if (!loadSourceIntoBuilder(builder, child.text, child.options, ensured, loadedModules, fast, context)) {
      throw FAST_PARSE_ABORT;
    }
  };

  if (fast) {
    const acceptBinary = (headName: any, head0Type: any, head0Name: any, head1Type: any, head1Name: any,
        bodyName: any, body0Type: any, body0Name: any, body1Type: any, body1Name: any) => {
      batch.push(new CompactBinaryClause(
        headName, head0Type, head0Name, head1Type, head1Name,
        bodyName, body0Type, body0Name, body1Type, body1Name,
      ));
      // @ts-expect-error TS7005: auto-suppressed
      batch[batch.length - 1].module = context.module;
      if (batch.length >= PROGRAM_BUILD_BATCH_SIZE) flush();
    };
    const parsed = tryParseClausesFastInto(source, accept, acceptBinary, options);
    if (parsed) flush();
    return parsed;
  }
  parseClausesInto(source, options, accept);
  flush();
  return true;
}

function includeDirective(clause: any): any {
  if (isCompactBinaryClause(clause) || !isDirectiveClause(clause)) return null;
  const directive = clause.head.args[0];
  return directive?.type === COMPOUND && directive.arity === 1 &&
    (directive.name === 'include' || directive.name === 'ensure_loaded')
    ? directive
    : null;
}

function moduleDirective(clause: any): any {
  if (isCompactBinaryClause(clause) || !isDirectiveClause(clause)) return null;
  const directive = clause.head.args[0];
  if (directive?.type !== COMPOUND || directive.name !== 'module' || directive.arity !== 2) return null;
  if (directive.args[0].type !== ATOM) throw new PrologError('type_error(atom)', directive.args[0]);
  if (moduleExportIndicators(directive.args[1]) == null) {
    throw new PrologError('type_error(list)', directive.args[1]);
  }
  return { name: directive.args[0].name };
}

function useModuleDirective(clause: any): any {
  if (isCompactBinaryClause(clause) || !isDirectiveClause(clause)) return null;
  const directive = clause.head.args[0];
  if (directive?.type !== COMPOUND || directive.name !== 'use_module' || ![1, 2].includes(directive.arity)) return null;
  const imports = directive.arity === 2 ? moduleExportIndicators(directive.args[1]) : null;
  if (directive.arity === 2 && imports == null) throw new PrologError('type_error(list)', directive.args[1]);
  return { designation: directive.args[0], imports };
}

function moduleExportIndicators(term: any): any {
  const items = properListItems(term, new Env());
  if (items == null) return null;
  const indicators = [];
  for (const item of items) {
    if (item.type !== COMPOUND || !['/', '//'].includes(item.name) || item.arity !== 2) return null;
    const indicator = predicateIndicator(item.args[0], item.args[1]);
    if (!indicator) return null;
    if (item.name === '//') {
      indicator.arity += 2;
      indicator.key = `${indicator.name}/${indicator.arity}`;
      indicator.nonterminalArity = indicator.arity - 2;
    }
    indicators.push(indicator);
  }
  return indicators;
}

function readModuleSource(designation: any, options: any): any {
  if (designation.type === COMPOUND && designation.name === 'library' && designation.arity === 1 &&
      designation.args[0].type === ATOM) {
    const name = designation.args[0].name;
    const registered = standardLibrarySources.get(name);
    if (!registered) throw new PrologError('existence_error(source_sink)', designation);
    return {
      name,
      text: registered.source,
      options: { ...options, filename: registered.filename, baseDir: 'src/lib' },
    };
  }
  if (designation.type !== ATOM) throw new PrologError('type_error(source_sink)', designation);
  // @ts-expect-error TS7005: auto-suppressed
  if (!fs || !path) throw new PrologError('permission_error(access, source_sink)', designation);
  const base = options.baseDir ?? currentWorkingDirectory();
  const filename = path.resolve(base, designation.name);
  let text;
  try {
    text = fs.readFileSync(filename, 'utf8');
  } catch (_) {
    throw new PrologError('existence_error(source_sink)', designation);
  }
  const declaration = parseClauses(text, { filename, sourceMetadata: false }).map(moduleDirective).find(Boolean);
  if (!declaration) throw new PrologError('existence_error(module)', designation);
  return { name: declaration.name, text, options: { ...options, filename, baseDir: path.dirname(filename) } };
}

function annotateGoalModule(term: any, module: any): any {
  if (!term || (term.type !== ATOM && term.type !== COMPOUND)) return term;
  term.module = module;
  const callableArguments = (term.name === ',' || term.name === ';' || term.name === '->') ? term.args
    : (['call', 'once', '\\+', 'not', 'catch', 'forall', 'findall', 'bagof', 'setof',
      'countall', 'sumall', 'aggregate_min', 'aggregate_max', 'maplist'].includes(term.name)
      ? term.args
      : []);
  for (const arg of callableArguments) annotateGoalModule(arg, module);
  return term;
}

function readIncludedSource(directive: any, options: any, ensured: any): any {
  const designation = directive.args[0];
  if (designation.type !== ATOM) throw new PrologError('type_error(atom)', designation);
  // @ts-expect-error TS7005: auto-suppressed
  if (!fs || !path) {
    throw new PrologError('permission_error(access, source_sink)', atom(designation.name));
  }
  const base = options.baseDir ?? (
    options.filename && path.isAbsolute(String(options.filename))
      ? path.dirname(path.resolve(options.filename))
      : currentWorkingDirectory()
  );
  const filename = path.resolve(base, designation.name);
  if (directive.name === 'ensure_loaded' && ensured.has(filename)) return null;
  if (directive.name === 'ensure_loaded') ensured.add(filename);

  let text;
  try {
    text = fs.readFileSync(filename, 'utf8');
  } catch (_) {
    throw new PrologError('existence_error(source_sink)', atom(designation.name));
  }
  return {
    text,
    options: { ...options, filename, baseDir: path.dirname(filename) },
  };
}

function isDirectiveClause(clause: any): any {
  return clause.body.length === 0 && clause.head.type === COMPOUND &&
    clause.head.name === ':-' && clause.head.arity === 1;
}

function dynamicDirectiveIndicators(clause: any): any {
  if (!isDirectiveClause(clause)) return [];
  const directive = clause.head.args[0];
  if (directive.type !== COMPOUND || directive.name !== 'dynamic' || directive.arity !== 1) return [];
  const terms = properListItems(directive.args[0], new Env()) ?? flattenDirectiveSequence(directive.args[0]);
  return terms.map((indicator: any) =>
    indicator.type === COMPOUND && ['/', '//'].includes(indicator.name) && indicator.arity === 2
      ? nonterminalOrPredicateIndicator(indicator)
      : null
  ).filter(Boolean);
}

function nonterminalOrPredicateIndicator(term: any): any {
  const indicator = predicateIndicator(term.args[0], term.args[1]);
  if (!indicator || term.name !== '//') return indicator;
  indicator.arity += 2;
  indicator.key = `${indicator.name}/${indicator.arity}`;
  indicator.nonterminalArity = indicator.arity - 2;
  return indicator;
}

function flattenDirectiveSequence(term: any): any {
  if (term.type === COMPOUND && term.name === ',' && term.arity === 2) {
    return [...flattenDirectiveSequence(term.args[0]), ...flattenDirectiveSequence(term.args[1])];
  }
  return [term];
}

function operatorDirective(clause: any): any {
  if (!isDirectiveClause(clause)) return null;
  const directive = clause.head.args[0];
  if (directive.type !== COMPOUND || directive.name !== 'op' || directive.arity !== 3) return null;
  const [priority, specifier, names] = directive.args;
  if (priority.type !== 'number' || specifier.type !== ATOM) return null;
  const items = names.type === ATOM ? [names] : properListItems(names, new Env());
  if (!items || items.some((item: any) => item.type !== ATOM)) return null;
  return {
    priority: Number(priority.name),
    specifier: specifier.name,
    names: items.map((item: any) => item.name),
  };
}

function assertHeadIsDefinable(head: any, strictIso: any = false): any {
  if (head.type === ATOM || head.type === COMPOUND) {
    assertPredicateIsDefinable(head.name, head.arity, strictIso);
  }
}

function assertDynamicIndicatorIsDefinable(indicator: any, strictIso: any = false): any {
  assertPredicateIsDefinable(indicator.name, indicator.arity, strictIso);
}

function assertPredicateIsDefinable(name: any, arity: any, strictIso: any = false): any {
  // false/0 is standardized as a static built-in by Corrigendum 2 and cannot
  // be redefined in either profile.  Strict core mode extends the same ISO
  // rule to every Part-1 built-in/control construct; the normal EyeProlog
  // profile keeps its historical source-compatibility behavior.
  if ((name === 'false' && arity === 0) ||
      (strictIso && (getStrictIsoRegistry().get(name, arity) || (name === ',' && arity === 2)))) {
    throw staticProcedureModificationError(name, arity);
  }
}

function staticProcedureModificationError(name: any, arity: any): any {
  return new PrologError(
    'permission_error(modify, static_procedure)',
    compound('/', [atom(name), numberTerm(arity)]),
  );
}

function componentHasNegativeEdge(start: any, deps: any, negativeEdges: any): any {
  const forward = reachableIndexes(start, deps);
  const component = new Set([...forward].filter((index: any) => reachableIndexes(index, deps).has(start)));
  return negativeEdges.some(([from, to]: any) => component.has(from) && component.has(to));
}

function compactClauseIsDirectRecursive(clause: any, group: any): any {
  return isCompactBinaryClause(clause) && clause.bodyName === group.name && group.arity === 2;
}

function clauseHasCut(clause: any): any {
  return !isCompactBinaryClause(clause) && clause.body.some(termContainsCut);
}

function clauseIsDirectRecursive(clause: any, group: any): any {
  if (isCompactBinaryClause(clause)) return compactClauseIsDirectRecursive(clause, group);
  return clause.body.some((goal: any) =>
    goal.type === COMPOUND && goal.name === group.name && goal.arity === group.arity
  );
}

function componentHasCut(start: any, deps: any, groups: any): any {
  const forward = reachableIndexes(start, deps);
  const component = [...forward].filter((index: any) => reachableIndexes(index, deps).has(start));
  return component.some((index: any) => {
    const group = groups[index];
    const directRecursive = group.clauses.some((clause: any) => clauseIsDirectRecursive(clause, group));
    if (!directRecursive) return group.clauses.some(clauseHasCut);
    return group.clauses.some((clause: any) => clauseIsDirectRecursive(clause, group) && clauseHasCut(clause));
  });
}

function termContainsCut(term: any): any {
  if (term.type === ATOM) return term.name === '!';
  return term.type === COMPOUND && term.args.some(termContainsCut);
}

function reachableIndexes(start: any, deps: any): any {
  const seen = new Set();
  const stack = [start];
  while (stack.length) {
    const current = stack.pop();
    if (seen.has(current)) continue;
    seen.add(current);
    for (const next of deps[current]) if (!seen.has(next)) stack.push(next);
  }
  return seen;
}

function inferStructuralInputPositions(group: any): any {
  let firstPatternedPosition = -1;
  let firstLinkedInputPosition = -1;
  const changed = new Uint8Array(group.arity);

  for (const clause of group.clauses) {
    if (isCompactBinaryClause(clause)) {
      if (!compactClauseIsDirectRecursive(clause, group)) continue;
      for (let index = 0; index < 2; index++) {
        const headType = compactHeadArgType(clause, index);
        if (headType !== VAR && (firstPatternedPosition < 0 || index < firstPatternedPosition)) {
          firstPatternedPosition = index;
        }
      }
      continue;
    }

    changed.fill(0);
    let recursive = false;
    for (const goal of clause.body) {
      if (goal.type !== COMPOUND || goal.name !== group.name || goal.arity !== group.arity) continue;
      recursive = true;
      for (let index = 0; index < group.arity; index++) {
        if (!sameClauseTerm(clause.head.args[index], goal.args[index])) changed[index] = 1;
      }
    }
    if (!recursive) continue;

    for (let index = 0; index < group.arity; index++) {
      const headArg = clause.head.args[index];
      if (headArg.type !== 'var' && (firstPatternedPosition < 0 || index < firstPatternedPosition)) firstPatternedPosition = index;
      if (headArg.type !== 'var' || changed[index] === 0) continue;
      for (let patternIndex = 0; patternIndex < group.arity; patternIndex++) {
        if (patternIndex === index) continue;
        const pattern = clause.head.args[patternIndex];
        if (pattern.type !== 'var' && termContainsVariable(pattern, headArg.name)) {
          if (firstLinkedInputPosition < 0 || index < firstLinkedInputPosition) firstLinkedInputPosition = index;
          break;
        }
      }
    }
  }
  if (firstLinkedInputPosition >= 0) return [[firstLinkedInputPosition]];
  if (firstPatternedPosition >= 0) return [[firstPatternedPosition]];
  return Array.from({ length: group.arity }, (_: any, index: any) => index);
}

function hasLinearNumericRecursion(group: any): any {
  let recursiveClause = null;
  for (const clause of group.clauses) {
    if (isCompactBinaryClause(clause)) {
      if (clause.head0Type !== VAR || clause.head1Type !== VAR) return false;
      if (!compactClauseIsDirectRecursive(clause, group)) continue;
      if (recursiveClause) return false;
      recursiveClause = clause;
      continue;
    }
    for (const arg of clause.head.args) if (arg.type !== 'var') return false;
    let recursive = false;
    for (const goal of clause.body) {
      if (goal.type === COMPOUND && goal.name === group.name && goal.arity === group.arity) {
        recursive = true;
        break;
      }
    }
    if (!recursive) continue;
    if (recursiveClause) return false;
    recursiveClause = clause;
  }
  return recursiveClause != null && !isCompactBinaryClause(recursiveClause) && recursiveClause.body.some((goal: any) =>
    goal.type === COMPOUND && goal.name === 'is' && goal.arity === 2
  );
}

function isPiAccumulator(group: any): any {
  return group.name === 'pi' && group.arity === 5 && group.clauses.some((clause: any) =>
    !isCompactBinaryClause(clause) && clause.body.some((goal: any) => goal.type === COMPOUND && goal.name === 'is' && goal.arity === 2)
  );
}

function isPortableBetweenGenerator(group: any): any {
  return group.name === 'eyeprolog__between' && group.arity === 3 &&
    group.clauses.length > 0 &&
    group.clauses.every((clause: any) => clause.eyePrologLibraryPortable === true);
}

function termContainsVariable(term: any, name: any): any {
  if (term.type === 'var') return term.name === name;
  return term.args.some((arg: any) => termContainsVariable(arg, name));
}

function sameClauseTerm(left: any, right: any): any {
  if (left.type !== right.type || left.name !== right.name || left.args.length !== right.args.length) return false;
  return left.args.every((arg: any, index: any) => sameClauseTerm(arg, right.args[index]));
}

function termHasNoVariables(term: any): any {
  if (!term || term.type === 'var') return false;
  return !term.args?.some((arg: any) => !termHasNoVariables(arg));
}

function directGoalDependencyKey(goal: any): any {
  if (goal.type === ATOM) return `${goal.name}/0`;
  if (goal.type !== COMPOUND) return null;
  if (goal.name === ',' && goal.arity === 2) return null;
  if ((goal.name === '\\+' || goal.name === 'not') && goal.arity === 1) return null;
  if (goal.name === 'once' && goal.arity === 1) return null;
  if (goal.name === 'forall' && goal.arity === 2) return null;
  if ((goal.name === 'findall' || goal.name === 'sumall') && goal.arity === 3) return null;
  if (goal.name === 'countall' && goal.arity === 2) return null;
  if ((goal.name === 'aggregate_min' || goal.name === 'aggregate_max') && goal.arity === 5) return null;
  return `${goal.name}/${goal.arity}`;
}

function collectGoalDependencies(goal: any, negated: any): any {
  if (goal.type === ATOM) return [{ key: `${goal.name}/0`, name: goal.name, arity: 0, module: goal.module, negative: negated }];
  if (goal.type !== COMPOUND) return [];
  if (goal.name === ',' && goal.arity === 2) {
    return [
      ...collectGoalDependencies(goal.args[0], negated),
      ...collectGoalDependencies(goal.args[1], negated),
    ];
  }
  if ((goal.name === '\\+' || goal.name === 'not') && goal.arity === 1) {
    return collectGoalDependencies(goal.args[0], !negated);
  }
  if (goal.name === 'once' && goal.arity === 1) {
    return collectGoalDependencies(goal.args[0], negated);
  }
  if (goal.name === 'forall' && goal.arity === 2) {
    return [
      ...collectGoalDependencies(goal.args[0], negated),
      ...collectGoalDependencies(goal.args[1], negated),
    ];
  }
  if ((goal.name === 'findall' || goal.name === 'sumall') && goal.arity === 3) {
    return collectGoalDependencies(goal.args[1], negated);
  }
  if (goal.name === 'countall' && goal.arity === 2) return collectGoalDependencies(goal.args[0], negated);
  if ((goal.name === 'aggregate_min' || goal.name === 'aggregate_max') && goal.arity === 5) {
    return collectGoalDependencies(goal.args[2], negated);
  }
  return [{ key: `${goal.name}/${goal.arity}`, name: goal.name, arity: goal.arity, module: goal.module, negative: negated }];
}

function stronglyConnectedComponents(adjacency: any): any {
  let index = 0;
  // @ts-expect-error TS7034: auto-suppressed
  const stack = [];
  const onStack = new Set();
  const indexes = new Map();
  const lowlinks = new Map();
  // @ts-expect-error TS7034: auto-suppressed
  const components = [];

  function visit(v: any) {
    indexes.set(v, index);
    lowlinks.set(v, index);
    index++;
    stack.push(v);
    onStack.add(v);

    for (const w of adjacency[v]) {
      if (!indexes.has(w)) {
        visit(w);
        lowlinks.set(v, Math.min(lowlinks.get(v), lowlinks.get(w)));
      } else if (onStack.has(w)) {
        lowlinks.set(v, Math.min(lowlinks.get(v), indexes.get(w)));
      }
    }

    if (lowlinks.get(v) === indexes.get(v)) {
      const component = [];
      while (true) {
        // @ts-expect-error TS7005: auto-suppressed
        const w = stack.pop();
        onStack.delete(w);
        component.push(w);
        if (w === v) break;
      }
      components.push(component);
    }
  }

  for (let v = 0; v < adjacency.length; v++) {
    if (!indexes.has(v)) visit(v);
  }
  // @ts-expect-error TS7005: auto-suppressed
  return components;
}

function computeNegationStrata(groups: any, edges: any, indexByKey: any): any {
  const strata = new Map(groups.map((group: any) => [`${group.name}/${group.arity}`, 0]));
  if (groups.length === 0) return strata;

  for (let pass = 0; pass < groups.length; pass++) {
    let changed = false;
    for (const edge of edges) {
      if (!indexByKey.has(edge.from) || !indexByKey.has(edge.to)) continue;
      const fromStratum = strata.get(edge.from) ?? 0;
      // @ts-expect-error TS2365: auto-suppressed
      const required = (strata.get(edge.to) ?? 0) + (edge.negative ? 1 : 0);
      if (fromStratum < required) {
        strata.set(edge.from, required);
        changed = true;
      }
    }
    if (!changed) return strata;
  }
  return new Map(groups.map((group: any) => [`${group.name}/${group.arity}`, null]));
}

function predicateIndicator(name: any, arity: any): any {
  if (name?.type !== ATOM || arity?.type !== 'number') return null;
  if (!/^\d+$/.test(arity.name)) return null;
  const arityNumber = Number(arity.name);
  return { name: name.name, arity: arityNumber, key: `${name.name}/${arityNumber}` };
}

// These defaults mirror SWI-Prolog's JITI admission policy: small predicates
// stay linear, a hash must promise a useful speedup, variable-heavy positions
// are rejected, and a multi-argument hash must substantially beat singles.
const DEMAND_INDEX_MIN_CLAUSES = 10;
const INDEX_MIN_SPEEDUP = 1.5;
const INDEX_MAX_VAR_FRACTION = 0.1;
const MULTI_INDEX_MIN_SPEEDUP_RATIO = 3;

function makeArgumentIndex(): any {
  return {
    atomBuckets: new Map(),
    stringBuckets: new Map(),
    numberBuckets: new Map(),
    fallback: [],
    sawScalar: false,
  };
}

function scalarBuckets(index: any, term: any): any {
  if (term.type === ATOM) return index.atomBuckets;
  if (term.type === 'string') return index.stringBuckets;
  return index.numberBuckets;
}

function argumentBucket(index: any, term: any): any {
  return scalarBuckets(index, term).get(term.name) ?? null;
}

function addArgumentBucket(index: any, term: any, clause: any): any {
  addClauseBucket(scalarBuckets(index, term), term.name, clause);
}

function scalarIndexKey(term: any): any {
  return `${term.type}\u0000${term.name}`;
}

function addClauseBucket(buckets: any, key: any, clause: any): any {
  const existing = buckets.get(key);
  if (existing == null) buckets.set(key, clause);
  else if (Array.isArray(existing)) existing.push(clause);
  else buckets.set(key, [existing, clause]);
}

function clauseCollectionLength(clauses: any): any {
  return clauses == null ? 0 : Array.isArray(clauses) ? clauses.length : 1;
}

function clauseCollectionAt(clauses: any, index: any): any {
  return Array.isArray(clauses) ? clauses[index] : index === 0 ? clauses : undefined;
}

function compactScalarBuckets(index: any, type: any): any {
  if (type === ATOM) return index.atomBuckets;
  if (type === 'number') return index.numberBuckets;
  return index.stringBuckets;
}

function indexCompactOne(index: any, type: any, name: any, clause: any, clauses: any = null, clausePosition: any = -1): any {
  if (type !== VAR) {
    if (!index.sawScalar) {
      index.sawScalar = true;
      if (clauses && clausePosition > 0) index.fallback = clauses.slice(0, clausePosition);
    }
    addClauseBucket(compactScalarBuckets(index, type), name, clause);
  } else if (index.sawScalar) {
    index.fallback.push(clause);
  }
}

function indexOne(index: any, arg: any, clause: any, clauses: any = null, clausePosition: any = -1): any {
  if (isScalar(arg)) {
    if (!index.sawScalar) {
      index.sawScalar = true;
      if (clauses && clausePosition > 0) index.fallback = clauses.slice(0, clausePosition);
    }
    addArgumentBucket(index, arg, clause);
  } else if (index.sawScalar) {
    index.fallback.push(clause);
  }
}

function indexFallback(index: any, group: any): any {
  return index.sawScalar ? index.fallback : group.clauses;
}

function rebuildGroupIndexes(group: any): any {
  group.argIndexes = Array.from({ length: group.arity }, makeArgumentIndex);
  group.demandIndexes.clear();
  group.rejectedDemandIndexes.clear();
  group.scalarFactsOnly = true;
  for (let clausePosition = 0; clausePosition < group.clauses.length; clausePosition++) {
    const clause = group.clauses[clausePosition];
    if (isCompactBinaryClause(clause)) {
      clause.groundHead = clause.head0Type !== VAR && clause.head1Type !== VAR;
      clause.scalarHead = clause.groundHead;
      if (clause.bodyName != null || !clause.scalarHead) group.scalarFactsOnly = false;
      indexCompactOne(group.argIndexes[0], clause.head0Type, clause.head0Name, clause, group.clauses, clausePosition);
      indexCompactOne(group.argIndexes[1], clause.head1Type, clause.head1Name, clause, group.clauses, clausePosition);
      continue;
    }
    clause.groundHead = termHasNoVariables(clause.head);
    clause.scalarHead = clause.head.type === COMPOUND && clause.head.args.every(isScalar);
    if (clause.body.length !== 0 || !clause.scalarHead) group.scalarFactsOnly = false;
    for (let i = 0; i < group.arity; i++) indexOne(group.argIndexes[i], clause.head.args[i], clause, group.clauses, clausePosition);
  }
}

function demandIndexKey(positions: any): any {
  return positions.join(',');
}

function demandValueKey(values: any): any {
  // Unification distinguishes atoms, strings, and numbers even when their
  // lexical spellings are identical. Include the scalar type in every key so
  // indexes never merge semantically distinct candidates.
  if (values.length === 1) return scalarIndexKey(values[0]);
  return values.map((value: any) => {
    const key = scalarIndexKey(value);
    return `${key.length}:${key}`;
  }).join('');
}

function buildDemandIndex(group: any, positions: any): any {
  const index = { positions, buckets: new Map(), fallback: [] };
  for (const clause of group.clauses) {
    if (isCompactBinaryClause(clause)) {
      const values = positions.map((position: any) => compactTerm(
        compactHeadArgType(clause, position), compactHeadArgName(clause, position)));
      if (!values.every(isScalar)) {
        // @ts-expect-error TS2345: auto-suppressed
        index.fallback.push(clause);
        continue;
      }
      addClauseBucket(index.buckets, demandValueKey(values), clause);
      continue;
    }
    const values = positions.map((position: any) => clause.head.args[position]);
    if (!values.every(isScalar)) {
      // @ts-expect-error TS2345: auto-suppressed
      index.fallback.push(clause);
      continue;
    }
    const key = demandValueKey(values);
    addClauseBucket(index.buckets, key, clause);
  }
  return index;
}

function mergeClausesInSourceOrder(primary: any, fallback: any): any {
  const primaryLength = clauseCollectionLength(primary);
  if (fallback.length === 0) return primary;
  if (primaryLength === 0) return fallback;
  const merged = [];
  let left = 0;
  let right = 0;
  while (left < primaryLength && right < fallback.length) {
    const primaryClause = clauseCollectionAt(primary, left);
    if (primaryClause.index < fallback[right].index) {
      merged.push(primaryClause);
      left++;
    } else {
      merged.push(fallback[right++]);
    }
  }
  while (left < primaryLength) merged.push(clauseCollectionAt(primary, left++));
  while (right < fallback.length) merged.push(fallback[right++]);
  return merged;
}


export function selectGroundClauseCandidates(group: any, goal: any): any {
  if (goal.type !== COMPOUND || group.clauses.length < DEMAND_INDEX_MIN_CLAUSES) return group.clauses;
  let bestPrimary = null;
  let bestFallback = null;
  let bestLength = group.clauses.length;
  for (let i = 0; i < goal.arity; i++) {
    const value = goal.args[i];
    if (!isScalar(value)) continue;
    const index = group.argIndexes[i];
    const fallback = indexFallback(index, group);
    if (fallback.length / group.clauses.length > INDEX_MAX_VAR_FRACTION) continue;
    const primary = argumentBucket(index, value);
    const length = clauseCollectionLength(primary) + fallback.length;
    if (group.clauses.length / Math.max(1, length) < INDEX_MIN_SPEEDUP) continue;
    if (length < bestLength) {
      bestPrimary = primary;
      bestFallback = fallback;
      bestLength = length;
    }
  }
  if (bestFallback == null) return group.clauses;
  if (bestFallback.length === 0) return bestPrimary;
  if (clauseCollectionLength(bestPrimary) === 0) return bestFallback;
  return mergeClausesInSourceOrder(bestPrimary, bestFallback);
}

export function selectClauseCandidates(group: any, goal: any, env: any): any {
  if (goal.type !== COMPOUND || group.clauses.length < DEMAND_INDEX_MIN_CLAUSES) {
    return { primary: group.clauses, fallback: [] };
  }
  const positions = [];
  const values = [];
  for (let i = 0; i < goal.arity; i++) {
    const arg = deref(goal.args[i], env);
    if (!isScalar(arg)) continue;
    positions.push(i);
    values.push(arg);
  }
  if (positions.length === 0) return { primary: group.clauses, fallback: [] };

  return selectClauseCandidatesForValues(group, positions, values);
}

// The scalar-fact join already has dereferenced local values. Keeping this
// entry point separate avoids manufacturing an Env facade and dereferencing
// every argument again in its inner loop.
export function selectClauseCandidatesForValues(group: any, positions: any, values: any): any {
  if (group.clauses.length < DEMAND_INDEX_MIN_CLAUSES || positions.length === 0) {
    return { primary: group.clauses, fallback: [] };
  }

  let bestParts = null;
  let bestLength = group.clauses.length;
  // Any-argument indexes are the eagerly built stable base. A wide index is
  // constructed only when none of them reduces the choice set to a small scan.
  for (let i = 0; i < positions.length; i++) {
    const index = group.argIndexes[positions[i]];
    const fallback = indexFallback(index, group);
    const parts = { primary: argumentBucket(index, values[i]), fallback };
    const length = clauseCollectionLength(parts.primary) + parts.fallback.length;
    if (fallback.length / group.clauses.length > INDEX_MAX_VAR_FRACTION) continue;
    if (group.clauses.length / Math.max(1, length) < INDEX_MIN_SPEEDUP) continue;
    if (length < bestLength) {
      bestParts = parts;
      bestLength = length;
    }
  }
  const wideKey = demandIndexKey(positions);
  if (positions.length > 1 && bestLength > 1 && !group.rejectedDemandIndexes.has(wideKey)) {
    const hadWideIndex = group.demandIndexes.has(wideKey);
    const parts = demandCandidateParts(group, positions, values);
    const length = clauseCollectionLength(parts.primary) + parts.fallback.length;
    const variableFraction = parts.fallback.length / group.clauses.length;
    const speedup = group.clauses.length / Math.max(1, length);
    const improvement = bestLength / Math.max(1, length);
    if (variableFraction <= INDEX_MAX_VAR_FRACTION
        && speedup >= INDEX_MIN_SPEEDUP
        && improvement >= MULTI_INDEX_MIN_SPEEDUP_RATIO) {
      bestParts = parts;
      bestLength = length;
    } else {
      if (!hadWideIndex) {
        group.demandIndexes.delete(wideKey);
        group.rejectedDemandIndexes.add(wideKey);
      }
    }
  }
  // An exact scalar index normally has no variable-head fallback. Reuse its
  // bucket directly instead of allocating a one-element merged array on every
  // lookup (notably in long deterministic ground chains).
  const best = !bestParts ? group.clauses
    : bestParts.fallback.length === 0 ? bestParts.primary
      : clauseCollectionLength(bestParts.primary) === 0 ? bestParts.fallback
        : mergeClausesInSourceOrder(bestParts.primary, bestParts.fallback);
  return { primary: best, fallback: [] };
}

function demandCandidateParts(group: any, positions: any, values: any): any {
  const indexKey = demandIndexKey(positions);
  let index = group.demandIndexes.get(indexKey);
  if (!index) {
    index = buildDemandIndex(group, positions);
    group.demandIndexes.set(indexKey, index);
  }
  const bucket = index.buckets.get(demandValueKey(values)) ?? null;
  return { primary: bucket, fallback: index.fallback };
}

export function makeProgram(source: any, options: any = {}): any {
  return Program.parse(source, options);
}

export function parseSourceClauses(source: any, options: any = {}): any {
  return parseClauses(source, options);
}
