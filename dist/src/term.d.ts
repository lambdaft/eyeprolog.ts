export declare const VAR = "var";
export declare const ATOM = "atom";
export declare const STRING = "string";
export declare const NUMBER = "number";
export declare const COMPOUND = "compound";
export type EyePrologTerm = Term | {
    type: string;
    name: string;
    args?: EyePrologTerm[];
    arity?: number;
    order?: number;
    module?: string;
};
export declare class Term {
    type: string;
    name: string;
    args: EyePrologTerm[];
    order?: number;
    module?: string;
    constructor(type: string, name?: unknown, args?: EyePrologTerm[]);
    get arity(): number;
}
export declare const variable: (name: string) => Term;
export declare const atom: (name: string) => Term;
export declare const stringTerm: (value: string) => Term;
export declare const numberTerm: (value: string | number) => Term;
export declare const compound: (name: string, args?: EyePrologTerm[]) => Term;
export declare const emptyList: () => Term;
export declare const cons: (head: EyePrologTerm, tail: EyePrologTerm) => Term;
export interface EnvState {
    bindings: Map<string, EyePrologTerm> | null;
    bindingName: string | null;
    bindingValue: EyePrologTerm | undefined;
    parent: EnvState | null;
    depth: number;
    cacheName: string | null;
    cacheValue: EyePrologTerm | undefined;
    cache: Map<string, EyePrologTerm> | null;
}
export declare class Env {
    _state: EnvState;
    _delays: any;
    _clpz: any;
    _occursCheckHandler: ((left: EyePrologTerm, right: EyePrologTerm, env: Env) => void) | null;
    constructor(bindings?: Iterable<readonly [string, EyePrologTerm]> | null);
    clone(): Env;
    setOccursCheckHandler(handler: ((left: EyePrologTerm, right: EyePrologTerm, env: Env) => void) | null): this;
    has(name: string): boolean;
    get(name: string): EyePrologTerm | undefined;
    bind(name: any, term: any): any;
    delay(name: any, goal: any, module?: any): any;
    takeReadyDelays(): any;
}
export declare function deref(term: any, env: any): any;
export declare function isScalar(term: any): any;
export declare function isEmptyList(term: any): any;
export declare function isCons(term: any): any;
export declare function isConjunction(term: any): any;
export declare function unify(left: any, right: any, env: any, options?: any): any;
export declare function cloneTerm(term: any): any;
export declare function freshTerm(term: any, suffix: any): any;
export declare function copyResolved(term: any, env: any): any;
export declare function termIsGround(term: any, env?: any): any;
export declare function termToString(term: any, env?: any, quoteStrings?: any, options?: any): any;
export declare function lexicalValue(term: any, env: any): any;
export declare function properListItems(list: any, env: any): any;
export declare function listFromItems(items: any, start?: any, end?: any, tail?: any): any;
export declare function flattenConjunction(goal: any): any;
export declare function termSignature(term: any): any;
export declare function variantTerms(left: any, leftEnv: any, right: any, rightEnv: any, pairs?: any, reverse?: any): any;
export declare function compareTerms(left: any, right: any): any;
export declare function isDecimalInteger(text: any): any;
export declare function compareIntegerText(left: any, right: any): any;
export declare function parseFiniteNumber(text: any): any;
export declare function numberTextFromDouble(value: any): any;
export declare function compareNumberText(left: any, right: any): any;
