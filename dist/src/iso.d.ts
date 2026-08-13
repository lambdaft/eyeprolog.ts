export declare class PrologError extends Error {
    constructor(formal: any, culprit?: any);
    name: any;
    formal: any;
    culprit: any;
}
export declare class HaltSignal extends Error {
    constructor(code?: any);
    name: any;
    code: any;
}
export declare const isoBuiltins: {
    register(registry: any): void;
};
export declare const eyePrologLibraryBuiltins: {
    register(registry: any): void;
};
export declare function formalErrorTerm(error: any): any;
export declare function arithmeticValueTerm(value: any): any;
export declare function evaluateArithmetic(term: any, env: any): any;
export declare function compareArithmeticValues(left: any, right: any): any;
export declare class BuiltinRegistry {
    constructor();
    add(name: any, arity: any, handler: any, options?: any): any;
    get(name: any, arity: any): any;
    remove(name: any, arity: any): any;
    defs: any;
}
export declare function createDefaultRegistry(): any;
export declare function createStrictIsoRegistry(): any;
export declare function getDefaultRegistry(): any;
export declare function getStrictIsoRegistry(): any;
