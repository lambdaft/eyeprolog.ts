// Public JavaScript API surface for embedders and the browser playground.
// The CLI imports the same parser, program, solver, and term primitives from here.
export { Program, makeProgram } from './program.js';
export { parseClauses, parseGoalText, parseProgramText } from './parser.js';
export { DCG } from './dcg-api.js';
export { Solver } from './solver.js';
export * from './term.js';
export {
  BuiltinRegistry,
  createDefaultRegistry,
  createStrictIsoRegistry,
  getDefaultRegistry,
  getStrictIsoRegistry,
  HaltSignal,
  PrologError,
} from './iso.js';
export {
  createEyePrologRegistry,
  getEyePrologRegistry,
  standardLibrarySources,
  eyePrologLibraryIndicators,
  eyePrologNativeLibraryIndicators,
  eyePrologPortableLibraryIndicators,
} from './standard-library.js';
export { StreamManager } from './io.js';
export { runQuads } from './quads.js';
export { whyProof, whyNoProof, explainProof, whyProofNode, renderProofToMermaid } from './explain.js';

import { ATOM, COMPOUND, VAR, Env, copyResolved, termIsGround } from './term.js';
import { Program } from './program.js';
import { Solver } from './solver.js';
import { whyNoProof, whyProof, renderProofToMermaid } from './explain.js';
import { HaltSignal, PrologError, getStrictIsoRegistry } from './iso.js';
import { getEyePrologRegistry } from './standard-library.js';
import { parseGoalText } from './parser.js';
import { formatTermForWrite } from './write.js';

export function run(source: any, options: any = {}): any {
  const includeWhy = options.proof === true || options.why === true || options.explain === true;
  const requestedStrictIso = options.isoStrict === true;
  if (source instanceof Program && requestedStrictIso && source.strictIso !== true) {
    throw new Error('strict ISO mode requires a Program parsed with isoStrict: true');
  }
  const parseOptions = { ...options, sourceMetadata: includeWhy || requestedStrictIso };
  let program = source instanceof Program ? source : Program.parse(source, parseOptions);
  const strictIso = requestedStrictIso || program.strictIso === true;
  const runOptions = strictIso
    ? { ...options, isoStrict: true, registry: getStrictIsoRegistry() }
    : options.registry ? options : { ...options, registry: getEyePrologRegistry() };
  const output = [];
  const solver = new Solver(program, {
    ...runOptions,
    ioOptions: {
      ...(options.ioOptions ?? {}),
      write: (text: any) => {
        const rendered = String(text);
        output.push(rendered);
        options.ioOptions?.write?.(rendered);
      },
    },
  });
  program = solver.program;
  const goals = normalizeGoals(options, solver);
  const writeOptions = {
    doubleQuotes: solver.prologFlags.get('double_quotes')?.value?.name ?? 'chars',
    operators: [...program.operators.values()],
    quoted: true,
  };
  const queriedKeys = new Set(goals.map((goal: any) => `${goal.name}/${goal.arity}`));
  const facts = program.sourceFactLines(queriedKeys, writeOptions);
  const seen = new Set();
  let haltCode = null;
  const mermaidProofs: string[] = [];
  try {
    solver.runInitializations();
    for (const goal of goals) {
      solver.solutionsSeen = 0;
      for (const env of solver.solve([goal], new Env(), 0)) {
        const resolved = copyResolved(goal, env);
        if (!termIsGround(resolved)) continue;
        const currentWriteOptions = {
          doubleQuotes: solver.prologFlags.get('double_quotes')?.value?.name ?? 'chars',
          operators: [...program.operators.values()],
          quoted: true,
        };
        const line = `${formatTermForWrite(resolved, new Env(), currentWriteOptions)}.\n`;
        if (facts.has(line) || seen.has(line)) continue;
        seen.add(line);
        output.push(line);
        if (includeWhy) {
          appendExplanation(output, program, resolved, runOptions.registry);
          mermaidProofs.push(renderProofToMermaid(program, resolved, { registry: runOptions.registry }));
        }
      }
    }
  } catch (error) {
    if (!(error instanceof HaltSignal)) throw error;
    haltCode = error.code;
  }
  const mermaidProof = mermaidProofs.length > 0 ? mermaidProofs.join('\n\n') : null;
  return { stdout: output.join(''), stats: solver.stats, haltCode, mermaidProof, mermaidProofs };
}

function normalizeGoals(options: any, solver: any): any {
  const requested = options.goals ?? (options.goal == null ? [] : [options.goal]);
  return requested.map((requestedGoal: any) => {
    const goal = typeof requestedGoal === 'string'
      ? parseGoalText(requestedGoal, {
          doubleQuotes: solver.prologFlags.get('double_quotes')?.value?.name ?? 'chars',
          operatorDefinitions: [...solver.program.operators.values()],
          isoStrict: solver.isoStrict,
        })
      : requestedGoal;
    if (goal.type === VAR) throw new PrologError('instantiation_error');
    if (goal.type !== ATOM && goal.type !== COMPOUND) throw new PrologError('type_error(callable)', goal);
    return goal;
  });
}

function appendExplanation(output: any, program: any, resolved: any, registry: any): any {
  const proof = whyProof(program, resolved, { registry });
  output.push(proof.text);
  if (!proof.ok) output.push(whyNoProof(resolved));
}

export * from './explain.js';
