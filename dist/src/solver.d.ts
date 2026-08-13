export declare function nextFreshId(): any;
export declare class Solver {
    constructor(program: any, options?: any);
    cloneForInnerGoal(solutionLimit?: any): any;
    syncProgramRevision(): any;
    absorbStatsFrom(child: any): any;
    runInitializations(): any;
    solve(goals: any, env?: any, depth?: any): any;
    _solveInner(goals: any, env?: any, depth?: any): any;
    activeVariant(goal: any, env: any): any;
    solveUserGoal(goal: any, rest: any, env: any, depth: any): any;
    solveMemoizedGoal(_group: any, goal: any, rest: any, env: any, depth: any): any;
    solveUserGoalUncached(group: any, goal: any, rest: any, env: any, depth: any): any;
    solveRuleBodyThenRest(goal: any, goalEnv: any, body: any, rest: any, env: any, depth: any): any;
    /**
     * Create a Solver with default EyeProlog configuration
     * @param program The Prolog program to solve
     * @returns A new Solver instance with default settings
     * @example
     * const solver = Solver.createDefault(program);
     * const results = solver.query('person(X, Y)');
     */
    static createDefault(program: any): Solver;
    /**
     * Create a Solver in strict ISO 13211-1 mode
     * @param program The Prolog program to solve
     * @returns A new Solver instance in strict ISO mode
     * @example
     * const solver = Solver.createStrict(program);
     * // Only uses ISO standard predicates, no EyeProlog extensions
     */
    static createStrict(program: any): Solver;
    /**
     * Create a Solver with EyeProlog optimizations enabled
     * @param program The Prolog program to solve
     * @returns A new Solver instance with fast paths enabled
     * @example
     * const solver = Solver.createEyeProlog(program);
     * // Uses EyeProlog extensions and optimizations
     */
    static createEyeProlog(program: any): Solver;
    /**
     * Create a lightweight Solver for resource-constrained environments
     * @param program The Prolog program to solve
     * @returns A new Solver instance with conservative limits
     * @example
     * const solver = Solver.createLight(program);
     * // For embedded use, IoT, or minimal resources
     */
    static createLight(program: any): Solver;
    solutionLimit: any;
    program: any;
    registry: any;
    maxDepth: any;
    maxInferences: any;
    isoStrict: any;
    prologFlags: any;
    charConversions: any;
    io: any;
    memo: any;
    groundChainSuccess: any;
    mutableProgram: any;
    programRevision: any;
    tableCoordinator: any;
    depthLimitExceeded: any;
    inferenceLimitExceeded: any;
    stats: any;
    occursCheckHandler: any;
    active: any;
    solveStacks: any;
    inferences: any;
    solutionsSeen: any;
    fastPathsEnabled: boolean;
    cutEpoch: any;
}
