import { Program, Solver, parseGoalText, PrologError, atom, renderProofToMermaid } from '../src/index.js';
import assert from 'node:assert';

function testSolutionLimitRecursion() {
  const code = `
    num(1).
    num(2).
    num(3).
    num(4).
    num(5).
    pair(X, Y) :- num(X), num(Y).
  `;
  const prog = Program.parse(code);
  const solver = new Solver(prog, { solutionLimit: 3 });
  const goals = [parseGoalText('pair(X, Y)')];
  const solutions = [...solver.solve(goals)];
  assert.strictEqual(solutions.length, 3, `Expected 3 solutions, got ${solutions.length}`);
  console.log('✓ testSolutionLimitRecursion passed');
}

function testCutInNestedMetaCalls() {
  const code = `
    sub_goal(1).
    sub_goal(2) :- !.
    sub_goal(3).
    
    test_once(X) :- once(sub_goal(X)).
    test_catch(X) :- catch(sub_goal(X), _, true).
  `;
  const prog = Program.parse(code);
  const solver = new Solver(prog);

  // once/1 cut scoping
  const onceGoals = [parseGoalText('test_once(X)')];
  const onceSols = [...solver.solve(onceGoals)];
  assert.strictEqual(onceSols.length, 1, `once/1 should produce 1 solution, got ${onceSols.length}`);

  // catch/3 cut scoping inside sub_goal
  const catchGoals = [parseGoalText('test_catch(X)')];
  const catchSols = [...solver.solve(catchGoals)];
  assert.strictEqual(catchSols.length, 2, `catch/3 with inner cut should yield 2 solutions (1 and 2), got ${catchSols.length}`);
  console.log('✓ testCutInNestedMetaCalls passed');
}

function testPrologErrorFormat() {
  const err = new PrologError(atom('type_error'), atom('invalid_term'));
  assert.strictEqual(err.message, 'error(type_error, invalid_term)');
  console.log('✓ testPrologErrorFormat passed');
}

function testFastPathsOptIn() {
  const prog = Program.parse('pi(1, 4, 42, 1, 1) :- C is 42.');
  const defaultSolver = new Solver(prog, { isoStrict: true });
  assert.strictEqual(defaultSolver.fastPathsEnabled, false, 'Default fastPathsEnabled should be false');

  const fastSolver = new Solver(prog, { fastPaths: true });
  assert.strictEqual(fastSolver.fastPathsEnabled, true, 'fastPathsEnabled should be true when set');
  console.log('✓ testFastPathsOptIn passed');
}

function testVisualMermaidProof() {
  const code = `
    human(socrates).
    mortal(X) :- human(X).
  `;
  const prog = Program.parse(code);
  const goal = parseGoalText('mortal(socrates)');
  const mermaid = renderProofToMermaid(prog, goal);
  assert(mermaid.includes('graph TD'), 'Mermaid output should contain graph TD header');
  assert(mermaid.includes('mortal(socrates)'), 'Mermaid output should contain goal');
  assert(mermaid.includes('human(socrates)'), 'Mermaid output should contain premise fact');
  console.log('✓ testVisualMermaidProof passed');
}

function runAllAuditRegressionTests() {
  console.log('== Running Audit Regression Tests');
  testSolutionLimitRecursion();
  testCutInNestedMetaCalls();
  testPrologErrorFormat();
  testFastPathsOptIn();
  testVisualMermaidProof();
  console.log('== All Audit Regression Tests Passed!');
}

runAllAuditRegressionTests();
