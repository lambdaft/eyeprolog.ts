import { Program, Solver, parseGoalText, PrologError, atom, renderProofToMermaid, deref, variable } from '../dist/src/index.js';
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
  assert.strictEqual(defaultSolver.fastPathsEnabled, true, 'Default fastPathsEnabled should be true');

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

function testNegationOverDisjunction() {
  const prog = Program.parse('');
  const solver = new Solver(prog);

  const negDisjGoals = [parseGoalText('\\+ (true ; true)')];
  const negSols = [...solver.solve(negDisjGoals)];
  assert.strictEqual(negSols.length, 0, `\\+ (true ; true) should produce 0 solutions, got ${negSols.length}`);

  const onceDisjGoals = [parseGoalText('once((true ; true))')];
  const onceSols = [...solver.solve(onceDisjGoals)];
  assert.strictEqual(onceSols.length, 1, `once((true ; true)) should produce 1 solution, got ${onceSols.length}`);
  console.log('✓ testNegationOverDisjunction passed');
}

function testCharacterCodeConstants() {
  const prog = Program.parse('p(0\'\'\', 0\' ).');
  const solver = new Solver(prog);
  const goals = [parseGoalText('p(Apostrophe, Space)')];
  const sols = [...solver.solve(goals)];
  assert.strictEqual(sols.length, 1, 'Should find 1 solution for character code constants');
  const ap = deref(variable('Apostrophe'), sols[0]);
  const sp = deref(variable('Space'), sols[0]);
  assert.strictEqual(ap.name, '39', '0\'\'\' should evaluate to char code 39');
  assert.strictEqual(sp.name, '32', '0\'  should evaluate to char code 32');
  console.log('✓ testCharacterCodeConstants passed');
}

function runAllAuditRegressionTests() {
  console.log('== Running Audit Regression Tests');
  testSolutionLimitRecursion();
  testCutInNestedMetaCalls();
  testPrologErrorFormat();
  testFastPathsOptIn();
  testVisualMermaidProof();
  testNegationOverDisjunction();
  testCharacterCodeConstants();
  console.log('== All Audit Regression Tests Passed!');
}

runAllAuditRegressionTests();
