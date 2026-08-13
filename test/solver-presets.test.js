import { describe, it, expect } from 'vitest';
import { Program } from '../dist/src/program.js';
import { Solver } from '../dist/src/solver.js';
describe('Solver Presets', () => {
    const simpleProgram = Program.parse(`
    parent(tom, bob).
    parent(bob, ann).
    grandparent(X, Z) :- parent(X, Y), parent(Y, Z).
  `);
    describe('createDefault()', () => {
        it('should create a Solver with default EyeProlog settings', () => {
            const solver = Solver.createDefault(simpleProgram);
            expect(solver).toBeInstanceOf(Solver);
            expect(solver.program).toBe(simpleProgram);
            expect(solver.maxDepth).toBe(100000);
            expect(solver.solutionLimit).toBe(10000000);
            expect(solver.isoStrict).toBe(false);
        });
        it('should be able to solve queries', () => {
            const solver = Solver.createDefault(simpleProgram);
            const results = [];
            for (const env of solver.solve([
                { type: 'compound', name: 'parent', args: [
                        { type: 'var', name: 'X' },
                        { type: 'var', name: 'Y' }
                    ] }
            ])) {
                results.push({
                    x: env.get('X'),
                    y: env.get('Y'),
                });
            }
            expect(results.length).toBe(2);
        });
    });
    describe('createStrict()', () => {
        it('should create a Solver in strict ISO mode', () => {
            const solver = Solver.createStrict(simpleProgram);
            expect(solver).toBeInstanceOf(Solver);
            expect(solver.program).toBe(simpleProgram);
            expect(solver.maxDepth).toBe(100000);
            expect(solver.isoStrict).toBe(true);
        });
        it('should reject non-ISO predicates', () => {
            const strictProgram = Program.parse(`
        test :- atom_length(hello, X), X = 5.
      `);
            const solver = Solver.createStrict(strictProgram);
            // In strict mode, non-standard predicates should not be available
            expect(solver.isoStrict).toBe(true);
        });
    });
    describe('createEyeProlog()', () => {
        it('should create a Solver with EyeProlog optimizations', () => {
            const solver = Solver.createEyeProlog(simpleProgram);
            expect(solver).toBeInstanceOf(Solver);
            expect(solver.program).toBe(simpleProgram);
            expect(solver.maxDepth).toBe(100000);
            expect(solver.solutionLimit).toBe(10000000);
            expect(solver.fastPathsEnabled).toBe(true);
            expect(solver.isoStrict).toBe(false);
        });
        it('should be able to solve queries with optimizations', () => {
            const solver = Solver.createEyeProlog(simpleProgram);
            const results = [];
            for (const env of solver.solve([
                { type: 'compound', name: 'grandparent', args: [
                        { type: 'var', name: 'X' },
                        { type: 'var', name: 'Z' }
                    ] }
            ])) {
                results.push({
                    x: env.get('X'),
                    z: env.get('Z'),
                });
            }
            expect(results.length).toBe(1);
            expect(results[0].x.name).toBe('tom');
            expect(results[0].z.name).toBe('ann');
        });
    });
    describe('createLight()', () => {
        it('should create a lightweight Solver with conservative limits', () => {
            const solver = Solver.createLight(simpleProgram);
            expect(solver).toBeInstanceOf(Solver);
            expect(solver.program).toBe(simpleProgram);
            expect(solver.maxDepth).toBe(10000);
            expect(solver.solutionLimit).toBe(1000);
            expect(solver.isoStrict).toBe(false);
        });
        it('should still solve simple queries', () => {
            const solver = Solver.createLight(simpleProgram);
            const results = [];
            for (const env of solver.solve([
                { type: 'compound', name: 'parent', args: [
                        { type: 'var', name: 'X' },
                        { type: 'atom', name: 'bob' }
                    ] }
            ])) {
                results.push({
                    x: env.get('X'),
                });
            }
            expect(results.length).toBe(1);
            expect(results[0].x.name).toBe('tom');
        });
        it('should be suitable for resource-constrained environments', () => {
            // Verify that createLight has lower limits than default
            const lightSolver = Solver.createLight(simpleProgram);
            const defaultSolver = Solver.createDefault(simpleProgram);
            expect(lightSolver.maxDepth).toBeLessThan(defaultSolver.maxDepth);
            expect(lightSolver.solutionLimit).toBeLessThan(defaultSolver.solutionLimit);
        });
    });
    describe('Preset Comparison', () => {
        it('should provide different configurations for different use cases', () => {
            const defaultSolver = Solver.createDefault(simpleProgram);
            const strictSolver = Solver.createStrict(simpleProgram);
            const eyePrologSolver = Solver.createEyeProlog(simpleProgram);
            const lightSolver = Solver.createLight(simpleProgram);
            // Default should use EyeProlog registry
            expect(defaultSolver.isoStrict).toBe(false);
            // Strict should be ISO-only
            expect(strictSolver.isoStrict).toBe(true);
            // EyeProlog should have fast paths
            expect(eyePrologSolver.fastPathsEnabled).toBe(true);
            // Light should have lower limits
            expect(lightSolver.maxDepth).toBe(10000);
            expect(lightSolver.solutionLimit).toBe(1000);
        });
    });
});
