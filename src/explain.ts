// EyeProlog proof output helpers.
// The explanation printer replays a successful goal against the program and emits
// ordinary EyeProlog facts with nested proof terms.  Explanations are therefore both
// human-readable and machine-readable.
import { ATOM, COMPOUND, Env, Term, VAR, deref, flattenConjunction, freshTerm, properListItems, termToString, unify, variantTerms } from './term.js';
import { selectClauseCandidates } from './program.js';
import { parseGoalText, parseProgramText } from './parser.js';
import { getEyePrologRegistry } from './standard-library.js';
import { Solver, nextFreshId } from './solver.js';

let verifyFreshCounter = 0;

export function proofCertificate(program: any, goal: any, options: any = {}): any {
  const maxDepth = options.maxDepth ?? 256;
  const registry = options.registry ?? getEyePrologRegistry();
  const env = options.env ?? new Env();
  const detail = normalizeProofDetail(options.proofDetail ?? 'abstract');
  for (const proof of proveGoalAll(program, goal, env, 0, maxDepth, registry, [], detail)) {
    const answer = resolveForProof(goal, proof.env);
    const certificate = {
      version: 1,
      detail,
      answer: termToString(answer, new Env(), true),
      proof: certificateNode(proof.node),
    };
    return { ok: true, certificate, text: renderWhyFacts(goal, proof.node, proof.env) };
  }
  return { ok: false, certificate: null, text: '' };
}

export function whyProof(program: any, goal: any, options: any = {}): any {
  return proofCertificate(program, goal, options);
}

export function whyNoProof(goal: any): any {
  return renderWhyNoProof(goal);
}

// Kept for embedders that already import explainProof.  The CLI exposes machine-readable output through whyProof.
export function explainProof(program: any, goal: any, options: any = {}): any {
  return whyProof(program, goal, options);
}

function* proveGoalAll(program: any, goal: any, env: any, depth: any, maxDepth: any, registry: any, active: any, detail: any = null): Generator<any, void, unknown> {
  if (depth > maxDepth) return;

  if (goal.type === COMPOUND && goal.name === ',' && goal.arity === 2) {
    for (const proved of proveGoalsAll(program, flattenConjunction(goal), env, depth + 1, maxDepth, registry, active, detail)) {
      yield {
        env: proved.env,
        node: {
          goal: resolveForProof(goal, proved.env),
          method: 'conjunction',
          sourceHead: null,
          sourceBody: flattenConjunction(goal),
          bindings: [],
          children: proved.children,
        },
      };
    }
    return;
  }

  const builtin = builtinDefinition(program, goal, env, registry);
  if (builtin.handled) {
    for (const next of builtinEnvs(builtin.def, builtin.solver, goal, env)) {
      const proofEnv = next.clone ? next.clone() : next;
      yield {
        env: proofEnv,
        node: {
          goal: resolveForProof(goal, proofEnv),
          method: goalMethod('builtin', goal),
          sourceHead: resolveForProof(goal, proofEnv),
          sourceBody: [],
          bindings: [],
          children: builtinChildren(program, goal, proofEnv, depth + 1, maxDepth, registry, active, detail),
        },
      };
    }
    return;
  }

  if (goal.type !== ATOM && goal.type !== COMPOUND) return;

  const group = program.findGroup(goal.name, goal.arity, goal.module ?? 'user');
  if (!group) return;

  // Keep proof output useful when a public library predicate is implemented by
  // a standard Prolog module. The implementation remains
  // ordinary clauses, but explanations collapse its private helper expansion
  // behind an explicit library(Name, Arity) boundary.
  if (detail !== 'expanded' && group.module !== 'user' && program.modules.get(group.module)?.filename?.startsWith('src/lib/')) {
    const solver = new Solver(program, { registry });
    for (const next of solver.solve([goal], env.clone(), 0)) {
      const proofEnv = next.clone ? next.clone() : next;
      yield {
        env: proofEnv,
        node: {
          goal: resolveForProof(goal, proofEnv),
          method: goalMethod('library', goal),
          sourceHead: resolveForProof(goal, proofEnv),
          sourceBody: [],
          bindings: [],
          children: [],
        },
      };
    }
    return;
  }
  // Explanation replay does not use the solver's answer tables, so its cycle
  // guard applies even when normal execution tables this predicate.
  if (activeVariant(goal, env, active)) return;

  const candidates = selectClauseCandidates(group, goal, env);
  for (const pass of [candidates.primary, candidates.fallback]) {
    for (let candidateIndex = 0; candidateIndex < clauseCandidateLength(pass); candidateIndex++) {
      const clause = clauseCandidateAt(pass, candidateIndex);
      const id = nextFreshId();
      const freshVariables: Map<any, any> = new Map();
      const freshHead = freshTerm(clause.head, id, freshVariables);
      const freshBody = clause.body.map((term: any) => freshTerm(term, id, freshVariables));
      const next = env.clone();
      if (!unify(goal, freshHead, next)) continue;

      const substitutions = collectClauseSubstitutions(clause, freshHead, freshBody);
      const bindings = resolvedSubstitutions(substitutions, next);

      if (freshBody.length === 0) {
        yield {
          env: next,
          node: {
            goal: resolveForProof(goal, next),
            method: sourceMethod(clause, 'fact'),
            sourceHead: clause.head,
            sourceBody: [],
            bindings,
            children: [],
          },
        };
        continue;
      }

      let activePushed = true;
      active.push({ goal, env });
      try {
        for (const proved of proveGoalsAll(program, freshBody, next, depth + 1, maxDepth, registry, active, detail)) {
          active.pop() as any;
          activePushed = false;
          yield {
            env: proved.env,
            node: {
              goal: resolveForProof(goal, proved.env),
              method: sourceMethod(clause, 'rule'),
              sourceHead: clause.head,
              sourceBody: clause.body,
              bindings: resolvedSubstitutions(substitutions, proved.env),
              children: proved.children,
            },
          };
          active.push({ goal, env });
          activePushed = true;
        }
      } finally {
        if (activePushed) active.pop() as any;
      }
    }
  }
}

function clauseCandidateLength(candidate: any): any {
  return candidate == null ? 0 : Array.isArray(candidate) ? candidate.length : 1;
}

function clauseCandidateAt(candidate: any, index: any): any {
  return Array.isArray(candidate) ? candidate[index] : index === 0 ? candidate : undefined;
}

function* proveGoalsAll(program: any, goals: any, env: any, depth: any, maxDepth: any, registry: any, active: any, detail: any = null): Generator<any, void, unknown> {
  if (goals.length === 0) {
    yield { env: env.clone(), children: [] };
    return;
  }

  const selectedIndex = selectReadyDeterministicBuiltin(goals, env, registry);
  const goal = goals[selectedIndex];
  const rest = selectedIndex === 0 ? goals.slice(1) : [...goals.slice(0, selectedIndex), ...goals.slice(selectedIndex + 1)];

  for (const proved of proveGoalAll(program, goal, env, depth, maxDepth, registry, active, detail)) {
    for (const tail of proveGoalsAll(program, rest, proved.env, depth, maxDepth, registry, active, detail)) {
      const children = tail.children.slice();
      children.splice(selectedIndex, 0, proved.node);
      yield { env: tail.env, children };
    }
  }
}

function builtinDefinition(program: any, goal: any, env: any, registry: any): any {
  if (goal.type !== ATOM && goal.type !== COMPOUND) return { handled: false, def: null, solver: null };
  const def = registry.get(goal.name, goal.arity);
  if (!def) return { handled: false, def: null, solver: null };

  const solver = new Solver(program, { registry });
  if (!builtinIsUsedForGoal(def, solver, goal, env)) return { handled: false, def: null, solver: null };
  return { handled: true, def, solver };
}

function* builtinEnvs(def: any, solver: any, goal: any, env: any) {
  for (const next of def.handler({ solver, goal, env })) yield next;
}

function builtinIsUsedForGoal(def: any, solver: any, goal: any, env: any): any {
  if (typeof def.shouldUse === 'function' && !def.shouldUse({ solver, goal, env })) return false;
  if (typeof def.ready !== 'function') return true;
  if (def.ready(goal, env)) return true;
  return !def.fallbackWhenNotReady;
}

function selectReadyDeterministicBuiltin(goals: any, env: any, registry: any): any {
  for (let i = 0; i < goals.length; i++) {
    const goal = goals[i];
    // Match solver.js's goal-type check: a 0-arity builtin (ATOM) is just as
    // eligible for this fast path as a COMPOUND one. No bundled builtin
    // currently pairs arity 0 with a custom ready() gate, so this has no
    // observable effect today, but it keeps the proof-explanation path from
    // silently diverging from actual execution if one is added later.
    if (goal.type !== COMPOUND && goal.type !== ATOM) continue;
    const def = registry.get(goal.name, goal.arity);
    if (!def?.deterministic || typeof def.ready !== 'function') continue;
    if (typeof def.shouldUse === 'function') continue;
    if (def.ready(goal, env)) return i;
  }
  return 0;
}

function builtinChildren(program: any, goal: any, env: any, depth: any, maxDepth: any, registry: any, active: any, detail: any): any {
  if (goal.type !== COMPOUND) return [];
  if (goal.name === 'once' && goal.arity === 1) {
    for (const proved of proveGoalAll(program, goal.args[0], env.clone(), depth, maxDepth, registry, active, detail)) return [proved.node];
  }
  return [];
}

function activeVariant(goal: any, env: any, active: any): any {
  return active.some((entry: any) => variantTerms(goal, env, entry.goal, entry.env));
}

function sourceMethod(clause: any, kind: any): any {
  const source = clause.source ?? {};
  return {
    type: 'source',
    kind,
    filename: source.filename ?? '<input>',
    clause: source.clause ?? ((clause.index ?? 0) + 1),
  };
}

function goalMethod(type: any, goal: any): any {
  return {
    type,
    name: goal.type === COMPOUND ? goal.name : 'goal',
    arity: goal.type === COMPOUND ? goal.arity : 0,
  };
}

function normalizeProofDetail(value: any): any {
  if (value === 'abstract' || value === 'expanded') return value;
  throw new Error(`unknown proof detail: ${value}`);
}

function certificateNode(node: any): any {
  return {
    goal: termToString(node.goal, new Env(), true),
    method: certificateMethod(node.method),
    bindings: node.bindings.map((binding: any) => ({
      name: String(binding.name),
      value: termToString(binding.value, new Env(), true),
    })),
    children: node.children.map(certificateNode),
  };
}

function certificateMethod(method: any): any {
  if (typeof method === 'string') return { type: method };
  if (!method || typeof method !== 'object') return { type: String(method) };
  return { ...method };
}

export function proofCertificatesFromText(text: any, program: any): any {
  const clauses = parseProgramText(String(text), {
    doubleQuotes: program.doubleQuotes ?? 'chars',
    sourceMetadata: false,
  });
  const certificates: any[] = [];
  for (const clause of clauses) {
    if (!clause?.head || clause.body?.length !== 0 || clause.head.type !== COMPOUND ||
        clause.head.name !== 'why' || clause.head.arity !== 2) continue;
    const proof = certificateNodeFromTerm(clause.head.args[1]);
    if (!proof) continue;
    certificates.push({
      version: 1,
      detail: containsExpandedLibrarySource(proof) ? 'expanded' : 'abstract',
      answer: termToString(clause.head.args[0], new Env(), true),
      proof,
    });
  }
  return certificates;
}

function certificateNodeFromTerm(term: any): any {
  if (term.type !== COMPOUND || term.name !== 'proof') return null;
  const fields = term.args;
  if (fields.length < 2) return null;
  const goalField = fields[0];
  const byField = fields[1];
  if (goalField.type !== COMPOUND || goalField.name !== 'goal' || goalField.arity !== 1) return null;
  if (byField.type !== COMPOUND || byField.name !== 'by' || byField.arity !== 1) return null;
  const node = {
    goal: termToString(goalField.args[0], new Env(), true),
    method: certificateMethodFromTerm(byField.args[0]),
    bindings: [],
    children: [],
  };
  if (!node.method) return null;
  for (let i = 2; i < fields.length; i++) {
    const field = fields[i];
    if (field.type !== COMPOUND) return null;
    if (field.name === 'bindings' && field.arity === 1) {
      const items = properListItems(field.args[0], new Env());
      if (items == null) return null;
      node.bindings = items.map((item: any) => {
        if (item.type !== COMPOUND || item.name !== 'binding' || item.arity !== 2) throw new Error('malformed certificate binding');
        return { name: certificateText(item.args[0]), value: termToString(item.args[1], new Env(), true) };
      });
    } else if (field.name === 'uses' && field.arity === 1) {
      const items = properListItems(field.args[0], new Env());
      if (items == null) return null;
      node.children = items.map(certificateNodeFromTerm);
      if (node.children.some((child: any) => child == null)) return null;
    } else {
      return null;
    }
  }
  return node;
}

function certificateMethodFromTerm(term: any): any {
  if (term.type === ATOM && term.name === 'conjunction') return { type: 'conjunction' };
  if (term.type !== COMPOUND) return null;
  if ((term.name === 'fact' || term.name === 'rule') && term.arity === 2) {
    const clause = term.args[1];
    if (clause.type !== COMPOUND || clause.name !== 'clause' || clause.arity !== 1) return null;
    return { type: 'source', kind: term.name, filename: certificateText(term.args[0]), clause: Number(clause.args[0].name) };
  }
  if ((term.name === 'builtin' || term.name === 'library') && term.arity === 2) {
    return { type: term.name, name: String(term.args[0].name), arity: Number(term.args[1].name) };
  }
  return null;
}

function certificateText(term: any): any {
  if (term.type === ATOM || term.type === 'string') return String(term.name);
  const items = properListItems(term, new Env());
  if (items != null && items.every((item: any) => item.type === ATOM && String(item.name).length === 1)) {
    return items.map((item: any) => String(item.name)).join('');
  }
  if (items != null && items.every((item: any) => item.type === 'number' && /^\d+$/.test(String(item.name)))) {
    const codes = items.map((item: any) => Number(item.name));
    if (codes.every((code: any) => Number.isInteger(code) && code >= 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff))) {
      return String.fromCodePoint(...codes);
    }
  }
  throw new Error('expected certificate text');
}

function proofTreeContains(node: any, predicate: any): any {
  return predicate(node) || node.children.some((child: any) => proofTreeContains(child, predicate));
}

const containsLibraryBoundary = (node: any) => proofTreeContains(node, (n: any) => n.method?.type === 'library');

const containsExpandedLibrarySource = (node: any) => proofTreeContains(
  node, (n: any) => n.method?.type === 'source' && String(n.method.filename ?? '').startsWith('src/lib/'),
);

export function verifyProof(program: any, input: any, options: any = {}): any {
  const certificate = input?.certificate ?? input;
  try {
    if (!certificate || certificate.version !== 1 || typeof certificate.answer !== 'string' || !certificate.proof ||
        (certificate.detail !== 'abstract' && certificate.detail !== 'expanded')) {
      throw new Error('invalid proof certificate');
    }
    if (certificate.detail === 'abstract' && containsExpandedLibrarySource(certificate.proof)) {
      throw new Error('abstract proof certificate contains expanded library source');
    }
    if (certificate.detail === 'expanded' && containsLibraryBoundary(certificate.proof)) {
      throw new Error('expanded proof certificate contains an abstract library boundary');
    }
    const registry = options.registry ?? getEyePrologRegistry();
    const answer = parseCertificateTerm(certificate.answer, program);
    const rootGoal = parseCertificateTerm(certificate.proof.goal, program);
    const answerEnv = new Env();
    if (!unify(answer, rootGoal, answerEnv)) throw new Error('certificate answer does not match root goal');
    verifyCertificateNode(program, certificate.proof, rootGoal, registry, options, new Env());
    return { ok: true, error: null, trusted: collectTrustedBoundaries(certificate.proof) };
  } catch (error: any) {
    return { ok: false, error: error instanceof Error ? error.message : String(error), trusted: [] };
  }
}

function collectTrustedBoundaries(node: any, out: any = []): any {
  if (node.method?.type === 'builtin' || node.method?.type === 'library') {
    out.push({
      type: node.method.type,
      name: String(node.method.name),
      arity: Number(node.method.arity),
      goal: String(node.goal),
    });
  }
  for (const child of node.children) collectTrustedBoundaries(child, out);
  return out;
}

function parseCertificateTerm(text: any, program: any): any {
  return parseGoalText(String(text), { doubleQuotes: program.doubleQuotes ?? 'chars' });
}

function verifyCertificateNode(program: any, node: any, expectedGoal: any, registry: any, options: any, inheritedEnv: any): any {
  if (!node || typeof node.goal !== 'string' || !node.method || !Array.isArray(node.children) || !Array.isArray(node.bindings)) {
    throw new Error('malformed proof node');
  }
  const nodeGoal = parseCertificateTerm(node.goal, program);
  if (!unify(expectedGoal, nodeGoal, inheritedEnv)) throw new Error(`proof goal mismatch: ${node.goal}`);
  const method = node.method;

  if (method.type === 'conjunction') {
    if (nodeGoal.type !== COMPOUND || nodeGoal.name !== ',' || nodeGoal.arity !== 2) throw new Error('invalid conjunction proof');
    const goals = flattenConjunction(nodeGoal);
    if (goals.length !== node.children.length) throw new Error('conjunction child count mismatch');
    for (let i = 0; i < goals.length; i++) {
      const childGoal = parseCertificateTerm(node.children[i].goal, program);
      if (!unify(goals[i], childGoal, inheritedEnv)) throw new Error(`conjunction child ${i + 1} does not match`);
      verifyCertificateNode(program, node.children[i], childGoal, registry, options, new Env());
    }
    if (node.bindings.length !== 0) throw new Error('conjunction proof must not carry clause bindings');
    return;
  }

  if (method.type === 'builtin') {
    const name = nodeGoal.type === COMPOUND || nodeGoal.type === ATOM ? nodeGoal.name : null;
    const arity = nodeGoal.type === COMPOUND ? nodeGoal.arity : 0;
    if (method.name !== name || method.arity !== arity || registry.get(name, arity) == null) {
      throw new Error(`untrusted builtin boundary: ${method.name}/${method.arity}`);
    }
    if (node.bindings.length !== 0) throw new Error('builtin proof must not carry clause bindings');
    if (name === 'once' && arity === 1) {
      if (node.children.length !== 1) throw new Error('once/1 proof requires exactly one child');
      const childGoal = parseCertificateTerm(node.children[0].goal, program);
      const innerEnv = new Env();
      if (!unify(nodeGoal.args[0], childGoal, innerEnv)) throw new Error('once/1 child does not match called goal');
      verifyCertificateNode(program, node.children[0], childGoal, registry, options, new Env());
    } else if (node.children.length !== 0) {
      throw new Error(`unexpected children for builtin ${name}/${arity}`);
    }
    return;
  }

  if (method.type === 'library') {
    const name = nodeGoal.type === COMPOUND || nodeGoal.type === ATOM ? nodeGoal.name : null;
    const arity = nodeGoal.type === COMPOUND ? nodeGoal.arity : 0;
    if (method.name !== name || method.arity !== arity) throw new Error('library boundary does not match goal');
    const group = findLibraryGroup(program, name, arity);
    if (!group) throw new Error(`untrusted library boundary: ${name}/${arity}`);
    if (node.children.length !== 0 || node.bindings.length !== 0) throw new Error('abstract library proof must be a leaf');
    return;
  }

  if (method.type === 'source') {
    verifySourceNode(program, node, nodeGoal, registry, options);
    return;
  }

  throw new Error(`unknown proof method: ${method.type}`);
}

function findLibraryGroup(program: any, name: any, arity: any): any {
  for (const group of program.groups.values()) {
    if (group.name !== name || group.arity !== arity || group.module === 'user') continue;
    if (program.modules.get(group.module)?.filename?.startsWith('src/lib/')) return group;
  }
  return null;
}

function verifySourceNode(program: any, node: any, nodeGoal: any, registry: any, options: any): any {
  const method = node.method;
  const candidates = program.clauses.filter((clause: any) => {
    const source = clause.source ?? {};
    const filename = source.filename ?? '<input>';
    const clauseNumber = source.clause ?? ((clause.index ?? 0) + 1);
    return filename === method.filename && clauseNumber === method.clause;
  });
  if (candidates.length === 0) throw new Error(`source clause not found: ${method.filename}:${method.clause}`);

  for (const clause of candidates) {
    const kind = clause.body.length === 0 ? 'fact' : 'rule';
    if (method.kind !== kind) continue;
    const id = `verify${++verifyFreshCounter}`;
    const variables: Map<any, any> = new Map();
    const head = freshTerm(clause.head, id, variables);
    const body = clause.body.map((term: any) => freshTerm(term, id, variables));
    const env = new Env();
    if (!unify(head, nodeGoal, env)) continue;
    if (body.length !== node.children.length) continue;

    let valid = true;
    for (let i = 0; i < body.length; i++) {
      try {
        const childGoal = parseCertificateTerm(node.children[i].goal, program);
        if (!unify(body[i], childGoal, env)) { valid = false; break; }
        verifyCertificateNode(program, node.children[i], childGoal, registry, options, new Env());
      } catch {
        valid = false;
        break;
      }
    }
    if (!valid) continue;
    if (!verifyBindings(node.bindings, variables, env, program)) continue;
    return;
  }
  throw new Error(`source proof does not validate: ${node.goal}`);
}

function verifyBindings(bindings: any, variables: any, env: any, program: any): any {
  const expected: Map<any, any> = new Map();
  for (const [name, fresh] of variables.entries()) {
    const resolved = deref(fresh, env);
    if (resolved.type !== VAR) expected.set(name, resolved);
  }
  if (bindings.length !== expected.size) return false;
  for (const binding of bindings) {
    if (!binding || typeof binding.name !== 'string' || typeof binding.value !== 'string') return false;
    const resolved = expected.get(binding.name);
    if (!resolved) return false;
    const value = parseCertificateTerm(binding.value, program);
    const check = new Env();
    if (!unify(resolveForProof(resolved, env), value, check)) return false;
  }
  return true;
}

function renderMethodTerm(method: any): any {
  if (method && method.type === 'source') return `${method.kind}(${quoteString(method.filename)}, clause(${method.clause}))`;
  if (method && (method.type === 'builtin' || method.type === 'library')) {
    return `${method.type}(${quoteAtomText(method.name)}, ${method.arity})`;
  }
  return String(method);
}

function renderWhyFacts(answerGoal: any, rootNode: any, env: any): any {
  const answer = termToString(resolveForProof(answerGoal, env), new Env(), true);
  return renderWhyTerm(answer, renderAbstractProofTerm(rootNode, 1));
}

function renderWhyNoProof(goal: any): any {
  const answer = termToString(resolveForProof(goal, new Env()), new Env(), true);
  return renderWhyTerm(answer, `${indent(1)}no_proof`);
}

function renderWhyTerm(answer: any, proofTerm: any): any {
  return ['why(', `${indent(1)}${answer},`, proofTerm, ').', '', ''].join('\n');
}

function renderAbstractProofTerm(node: any, level: any): any {
  const goal = termToString(node.goal, new Env(), true);
  const hasTail = node.bindings.length || node.children.length;
  const lines = [
    `${indent(level)}proof(`,
    `${indent(level + 1)}goal(${goal}),`,
    `${indent(level + 1)}by(${renderMethodTerm(node.method)})${hasTail ? ',' : ''}`,
  ];

  if (node.bindings.length) lines.push(`${indent(level + 1)}${renderBindingsTerm(node.bindings)}${node.children.length ? ',' : ''}`);
  if (node.children.length) lines.push(renderUsesTerm(node.children, level + 1));

  lines.push(`${indent(level)})`);
  return lines.join('\n');
}

function renderUsesTerm(children: any, level: any): any {
  const lines = [`${indent(level)}uses([`];
  for (let i = 0; i < children.length; i++) {
    const item = renderAbstractProofTerm(children[i], level + 1);
    lines.push(i === children.length - 1 ? item : withTrailingComma(item));
  }
  lines.push(`${indent(level)}])`);
  return lines.join('\n');
}

function renderBindingsTerm(bindings: any): any {
  return `bindings(${renderProofListInline(bindings, (binding: any) => `binding(${quoteString(binding.name)}, ${termToString(binding.value, new Env(), true)})`)})`;
}

function renderProofListInline(items: any, renderItem: any): any {
  return `[${items.map((item: any) => renderItem(item)).join(', ')}]`;
}

function withTrailingComma(text: any): any {
  const lines = String(text).split('\n');
  lines[lines.length - 1] += ',';
  return lines.join('\n');
}

function indent(level: any): any {
  return '  '.repeat(level);
}

function quoteAtomText(text: any): any {
  return termToString({ type: 'atom', name: String(text), args: [] }, new Env(), true);
}

function quoteString(value: any): any {
  return JSON.stringify(String(value));
}

function originalVariableName(name: any): any {
  return String(name).replace(/#\d+$/, '');
}

function resolveForProof(term: any, env: any): any {
  const resolved = deref(term, env);
  if (resolved.type === VAR) return new Term(VAR, originalVariableName(resolved.name), []);
  return new Term(resolved.type, resolved.name, resolved.args.map((arg: any) => resolveForProof(arg, env)));
}

function collectClauseSubstitutions(clause: any, freshHead: any, freshBody: any): any {
  const substitutions: any[] = [];
  const seen: Set<any> = new Set();
  collectSubstitutions(clause.head, freshHead, substitutions, seen);
  for (let i = 0; i < clause.body.length && i < freshBody.length; i++) {
    collectSubstitutions(clause.body[i], freshBody[i], substitutions, seen);
  }
  return substitutions;
}

function collectSubstitutions(original: any, fresh: any, substitutions: any, seen: any): any {
  if (!original || !fresh) return;
  if (original.type === VAR) {
    if (!seen.has(original.name)) {
      seen.add(original.name);
      substitutions.push({ name: original.name, fresh });
    }
    return;
  }
  if (original.type !== COMPOUND || fresh.type !== COMPOUND) return;
  const arity = Math.min(original.arity, fresh.arity);
  for (let i = 0; i < arity; i++) collectSubstitutions(original.args[i], fresh.args[i], substitutions, seen);
}

function resolvedSubstitutions(substitutions: any, env: any): any {
  const out: any[] = [];
  for (const substitution of substitutions) {
    const resolved = deref(substitution.fresh, env);
    if (resolved.type === VAR) continue;
    out.push({ name: substitution.name, value: resolveForProof(substitution.fresh, env) });
  }
  return out;
}


export function whyProofNode(program: any, goal: any, options: any = {}): any {
  const maxDepth = options.maxDepth ?? 256;
  const registry = options.registry ?? getEyePrologRegistry();
  const env = options.env ?? new Env();
  for (const proof of proveGoalAll(program, goal, env, 0, maxDepth, registry, [])) {
    return { ok: true, node: proof.node, env: proof.env };
  }
  return { ok: false, node: null, env: null };
}

export function renderProofToMermaid(program: any, goal: any, options: any = {}): string {
  const { ok, node } = whyProofNode(program, goal, options);
  if (!ok || !node) return 'graph TD\n  EmptyProof["No Proof Found"]';

  const lines = ['graph TD'];
  lines.push('  classDef fact fill:#d4edda,stroke:#28a745,stroke-width:2px,color:#155724;');
  lines.push('  classDef rule fill:#d1ecf1,stroke:#17a2b8,stroke-width:2px,color:#0c5460;');
  lines.push('  classDef builtin fill:#fff3cd,stroke:#ffc107,stroke-width:2px,color:#856404;');
  lines.push('  classDef library fill:#e2e3e5,stroke:#6c757d,stroke-width:2px,color:#383d41;');

  let nodeCounter = 0;

  function processNode(currNode: any): string {
    const id = `N${++nodeCounter}`;
    const goalText = termToString(currNode.goal, new Env(), true).replace(/"/g, "'");
    const methodText = renderMethodLabel(currNode.method).replace(/"/g, "'");
    const className = getMermaidClass(currNode.method);

    lines.push(`  ${id}["${goalText}<br/><i>(${methodText})</i>"]:::${className}`);

    for (const child of currNode.children ?? []) {
      const childId = processNode(child);
      lines.push(`  ${id} --> ${childId}`);
    }
    return id;
  }

  function renderMethodLabel(method: any): string {
    if (!method) return 'unknown';
    if (method.type === 'fact') return 'Fact';
    if (method.type === 'rule') return `Rule: ${method.name}/${method.arity}`;
    if (method.type === 'builtin') return `Builtin: ${method.name}/${method.arity}`;
    if (method.type === 'library') return `Library: ${method.name}/${method.arity}`;
    return String(method.type || 'step');
  }

  function getMermaidClass(method: any): string {
    if (!method) return 'fact';
    if (method.type === 'fact') return 'fact';
    if (method.type === 'rule') return 'rule';
    if (method.type === 'builtin') return 'builtin';
    if (method.type === 'library') return 'library';
    return 'fact';
  }

  processNode(node);
  return lines.join('\n');
}
