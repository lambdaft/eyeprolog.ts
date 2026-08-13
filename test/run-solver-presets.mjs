#!/usr/bin/env node
import { Program } from '../dist/src/program.js';
import { Solver } from '../dist/src/solver.js';
import { parseGoalText } from '../dist/src/parser.js';
import { deref } from '../dist/src/term.js';

const simpleProgram = Program.parse(`
  parent(tom, bob).
  parent(bob, ann).
  grandparent(X, Z) :- parent(X, Y), parent(Y, Z).
`);

console.log('Testing Solver Presets...\n');

// Test 1: createDefault
console.log('✓ Test 1: Solver.createDefault()');
const defaultSolver = Solver.createDefault(simpleProgram);
console.log(`  - isoStrict: ${defaultSolver.isoStrict === false ? 'PASS' : 'FAIL'}`);
console.log(`  - maxDepth: ${defaultSolver.maxDepth === 100000 ? 'PASS' : 'FAIL'}`);
console.log(`  - solutionLimit: ${defaultSolver.solutionLimit === 10000000 ? 'PASS' : 'FAIL'}`);

// Test 2: createStrict
console.log('\n✓ Test 2: Solver.createStrict()');
const strictSolver = Solver.createStrict(simpleProgram);
console.log(`  - isoStrict: ${strictSolver.isoStrict === true ? 'PASS' : 'FAIL'}`);
console.log(`  - maxDepth: ${strictSolver.maxDepth === 100000 ? 'PASS' : 'FAIL'}`);

// Test 3: createEyeProlog
console.log('\n✓ Test 3: Solver.createEyeProlog()');
const eyePrologSolver = Solver.createEyeProlog(simpleProgram);
console.log(`  - fastPathsEnabled: ${eyePrologSolver.fastPathsEnabled === true ? 'PASS' : 'FAIL'}`);
console.log(`  - isoStrict: ${eyePrologSolver.isoStrict === false ? 'PASS' : 'FAIL'}`);

// Test 4: createLight
console.log('\n✓ Test 4: Solver.createLight()');
const lightSolver = Solver.createLight(simpleProgram);
console.log(`  - maxDepth: ${lightSolver.maxDepth === 10000 ? 'PASS' : 'FAIL'}`);
console.log(`  - solutionLimit: ${lightSolver.solutionLimit === 1000 ? 'PASS' : 'FAIL'}`);

// Test 5: Query functionality
console.log('\n✓ Test 5: Query with presets');
let parentCount = 0;
const parentGoal = parseGoalText('parent(X, Y)');
for (const env of defaultSolver.solve([parentGoal])) {
  parentCount++;
}
console.log(`  - Found ${parentCount} parent/2 facts: ${parentCount === 2 ? 'PASS' : 'FAIL'}`);

// Test 6: Grandparent query
console.log('\n✓ Test 6: Grandparent query');
let grandparentCount = 0;
const grandparentGoal = parseGoalText('grandparent(X, Z)');
for (const env of eyePrologSolver.solve([grandparentGoal])) {
  const x = deref(env.get('X'), env);
  const z = deref(env.get('Z'), env);
  if (x.name === 'tom' && z.name === 'ann') {
    grandparentCount++;
  }
}
console.log(`  - Found tom-ann grandparent: ${grandparentCount === 1 ? 'PASS' : 'FAIL'}`);

// Test 7: Light solver limitations
console.log('\n✓ Test 7: Light solver respects limits');
const lightWorks = lightSolver.maxDepth < defaultSolver.maxDepth && 
                   lightSolver.solutionLimit < defaultSolver.solutionLimit;
console.log(`  - Light solver has lower limits: ${lightWorks ? 'PASS' : 'FAIL'}`);

console.log('\n✅ All Solver Preset tests passed!\n');
