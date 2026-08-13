// Tokenizer and recursive-descent parser for the EyeProlog source language.
// It preserves the compact Prolog-like syntax while producing Term objects for the solver.
import { ATOM, COMPOUND, atom, compound, cons, emptyList, numberTerm, variable } from './term.js';
const TOK = {
    EOF: 'eof', ATOM: 'atom', VAR: 'var', STRING: 'string', NUMBER: 'number',
    LPAREN: '(', RPAREN: ')', LBRACKET: '[', RBRACKET: ']', LBRACE: '{', RBRACE: '}',
    COMMA: ',', BAR: '|', DOT: '.', IF: ':-'
};
function isWhitespaceCode(code) {
    return code === 32 || code === 9 || code === 10 || code === 13 || code === 12 || code === 11;
}
function isDigitCode(code) {
    return code >= 48 && code <= 57;
}
function isAsciiLetterCode(code) {
    return (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}
function isNameContinueCode(code) {
    return code === 95 || isAsciiLetterCode(code) || isDigitCode(code);
}
function isVariableStartCode(code) {
    return code === 95 || (code >= 65 && code <= 90);
}
function isPlainAtomStartCode(code) {
    return code >= 97 && code <= 122;
}
const graphicAtomChars = '#$&*+-./<=>@^~\\:';
// ISO operator syntax is lowered to the same ordinary compound terms used by
// canonical notation. Commas remain separators except inside parentheses.
const INFIX_OPERATORS = new Map([
    [':-', { precedence: 1, associativity: 'none' }],
    ['?-', { precedence: 1, associativity: 'none' }], // quad label extension
    ['-->', { precedence: 1, associativity: 'none' }],
    ['|', { precedence: 96, associativity: 'right' }],
    [';', { precedence: 101, associativity: 'right' }],
    ['->', { precedence: 151, associativity: 'right' }],
    [',', { precedence: 201, associativity: 'right' }],
    ['=', { precedence: 501, associativity: 'none' }],
    ['=..', { precedence: 501, associativity: 'none' }],
    ['\\=', { precedence: 501, associativity: 'none' }],
    ['==', { precedence: 501, associativity: 'none' }],
    ['\\==', { precedence: 501, associativity: 'none' }],
    ['@<', { precedence: 501, associativity: 'none' }],
    ['@=<', { precedence: 501, associativity: 'none' }],
    ['@>', { precedence: 501, associativity: 'none' }],
    ['@>=', { precedence: 501, associativity: 'none' }],
    ['is', { precedence: 501, associativity: 'none' }],
    ['=:=', { precedence: 501, associativity: 'none' }],
    ['=\\=', { precedence: 501, associativity: 'none' }],
    ['<', { precedence: 501, associativity: 'none' }],
    ['=<', { precedence: 501, associativity: 'none' }],
    ['>', { precedence: 501, associativity: 'none' }],
    ['>=', { precedence: 501, associativity: 'none' }],
    [':', { precedence: 601, associativity: 'right' }],
    ['+', { precedence: 701, associativity: 'left' }],
    ['-', { precedence: 701, associativity: 'left' }],
    ['/\\', { precedence: 701, associativity: 'left' }],
    ['\\/', { precedence: 701, associativity: 'left' }],
    ['*', { precedence: 801, associativity: 'left' }],
    ['/', { precedence: 801, associativity: 'left' }],
    ['//', { precedence: 801, associativity: 'left' }],
    ['div', { precedence: 801, associativity: 'left' }],
    ['mod', { precedence: 801, associativity: 'left' }],
    ['rem', { precedence: 801, associativity: 'left' }],
    ['<<', { precedence: 801, associativity: 'left' }],
    ['>>', { precedence: 801, associativity: 'left' }],
    ['**', { precedence: 1001, associativity: 'none' }],
    ['^', { precedence: 1001, associativity: 'right' }],
]);
const PREFIX_OPERATORS = new Map([
    ['?-', { precedence: 1, strict: true }],
    ['\\+', { precedence: 301, strict: false }],
    ['+', { precedence: 1001, strict: false }],
    ['-', { precedence: 1001, strict: false }],
    ['\\', { precedence: 1001, strict: false }],
]);
export const ISO_OPERATOR_DEFINITIONS = [
    [1200, 'xfx', ':-'], [1200, 'fx', ':-'], [1200, 'fx', '?-'], [1200, 'xfx', '-->'],
    [1105, 'xfy', '|'],
    [1100, 'xfy', ';'], [1050, 'xfy', '->'], [1000, 'xfy', ','],
    [900, 'fy', '\\+'],
    ...['=', '=..', '\\=', '==', '\\==', '@<', '@=<', '@>', '@>=', 'is',
        '=:=', '=\\=', '<', '=<', '>', '>='].map((name) => [700, 'xfx', name]),
    [600, 'xfy', ':'],
    ...['+', '-', '/\\', '\\/'].map((name) => [500, 'yfx', name]),
    ...['*', '/', '//', 'div', 'mod', 'rem', '<<', '>>'].map((name) => [400, 'yfx', name]),
    [200, 'xfx', '**'], [200, 'xfy', '^'],
    [200, 'fy', '+'], [200, 'fy', '-'], [200, 'fy', '\\'],
];
// EyeProlog's embedded quad syntax permits an optional label before `?-`.
// That makes `?-` an implementation-specific xfx operator in addition to its
// ISO 1200 fx definition.
export const QUAD_OPERATOR_DEFINITIONS = [
    [1200, 'xfx', '?-'],
];
const CLPZ_OPERATOR_DEFINITIONS = [
    [760, 'yfx', '#<==>'], [750, 'xfy', '#==>'], [750, 'yfx', '#<=='],
    [740, 'yfx', '#\\/'], [730, 'yfx', '#\\'], [720, 'yfx', '#/\\'],
    [710, 'fy', '#\\'],
    ...['#>', '#<', '#>=', '#=<', '#=', '#\\=', 'in', 'ins'].map((name) => [700, 'xfx', name]),
    [450, 'xfx', '..'],
];
function operatorStrength(priority) {
    return 1201 - priority;
}
function isGraphicAtomCode(code) {
    return graphicAtomChars.includes(String.fromCharCode(code));
}
function defineParserOperator(state, priority, specifier, name) {
    const strength = operatorStrength(priority);
    if (['xfx', 'xfy', 'yfx'].includes(specifier)) {
        if (priority === 0)
            state.infixOperators.delete(name);
        else
            state.infixOperators.set(name, {
                precedence: strength,
                associativity: specifier === 'xfy' ? 'right' : specifier === 'yfx' ? 'left' : 'none',
            });
    }
    else if (specifier === 'fx' || specifier === 'fy') {
        if (priority === 0)
            state.prefixOperators.delete(name);
        else
            state.prefixOperators.set(name, { precedence: strength, strict: specifier === 'fx' });
    }
    else if (specifier === 'xf' || specifier === 'yf') {
        if (priority === 0)
            state.postfixOperators.delete(name);
        else
            state.postfixOperators.set(name, { precedence: strength, strict: specifier === 'xf' });
    }
}
export function createParserOperatorState(definitions = [], includeDefaults = true, options = {}) {
    const state = {
        infixOperators: includeDefaults ? new Map(INFIX_OPERATORS) : new Map(),
        prefixOperators: includeDefaults ? new Map(PREFIX_OPERATORS) : new Map(),
        postfixOperators: new Map(),
    };
    // The infix ?-/2 form is an EyeProlog quad extension.  ISO 13211-1
    // predefines only the 1200 fx ?- operator; strict core mode starts from that
    // table and still permits an explicit op/3 directive to add an infix form.
    if (options.isoStrict === true)
        state.infixOperators.delete('?-');
    for (const definition of definitions) {
        const [priority, specifier, name] = Array.isArray(definition)
            ? definition
            : [definition.priority, definition.specifier, definition.name];
        defineParserOperator(state, Number(priority), specifier, name);
    }
    return state;
}
class Parser {
    constructor(source, options = {}) {
        this.source = String(source ?? '');
        this.filename = options.filename ?? '<input>';
        this.pos = 0;
        this.line = 1;
        this.anonymous = 0;
        this.sourceMetadata = options.sourceMetadata !== false;
        this.strictIso = options.isoStrict === true;
        this.maxParseDepth = options.maxParseDepth ?? 10000;
        this.parserFlagState = options.parserFlagState ?? {
            doubleQuotes: options.doubleQuotes ?? 'chars',
        };
        if (!['chars', 'codes', 'atom'].includes(this.parserFlagState.doubleQuotes)) {
            throw new Error(`invalid double_quotes parser flag: ${this.parserFlagState.doubleQuotes}`);
        }
        const operatorState = options.operatorState ?? createParserOperatorState(options.operatorDefinitions ?? [], options.includeDefaultOperators !== false, { isoStrict: this.strictIso });
        this.infixOperators = operatorState.infixOperators;
        this.prefixOperators = operatorState.prefixOperators;
        this.postfixOperators = operatorState.postfixOperators;
        this.previousToken = null;
        this.token = this.nextToken();
    }
    defineOperator(priority, specifier, name) {
        defineParserOperator(this, priority, specifier, name);
    }
    applyOperatorDirective(directive, line) {
        if (directive.type !== 'compound' || directive.name !== 'op' || directive.arity !== 3)
            return false;
        const [priorityTerm, specifierTerm, nameTerm] = directive.args;
        if (priorityTerm.type !== 'number' || !/^\d+$/.test(priorityTerm.name)) {
            throw new Error(`parse line ${line}: op priority must be an integer`);
        }
        const priority = Number(priorityTerm.name);
        if (priority < 0 || priority > 1200)
            throw new Error(`parse line ${line}: op priority out of range`);
        if (specifierTerm.type !== 'atom' || !['fx', 'fy', 'xf', 'yf', 'xfx', 'xfy', 'yfx'].includes(specifierTerm.name)) {
            throw new Error(`parse line ${line}: invalid operator specifier`);
        }
        const names = nameTerm.type === 'atom'
            ? [nameTerm.name]
            : listAtomNames(nameTerm);
        if (names == null)
            throw new Error(`parse line ${line}: operator name must be an atom or list of atoms`);
        for (const name of names) {
            if (name === ',' || name === '[]' || name === '{}') {
                throw new Error(`parse line ${line}: operator ${name} cannot be modified`);
            }
            if (name === '|' && priority !== 0 &&
                (!(specifierTerm.name === 'xfx' || specifierTerm.name === 'xfy' || specifierTerm.name === 'yfx') || priority < 1001)) {
                throw new Error(`parse line ${line}: invalid bar operator`);
            }
            const infix = ['xfx', 'xfy', 'yfx'].includes(specifierTerm.name);
            const postfix = ['xf', 'yf'].includes(specifierTerm.name);
            if (priority !== 0 && ((infix && this.postfixOperators.has(name)) || (postfix && this.infixOperators.has(name)))) {
                throw new Error(`parse line ${line}: invalid operator class combination for ${name}`);
            }
        }
        for (const name of names)
            this.defineOperator(priority, specifierTerm.name, name);
        return true;
    }
    applyParserFlagDirective(directive) {
        if (directive.type !== 'compound' || directive.name !== 'set_prolog_flag' || directive.arity !== 2)
            return;
        const [flag, value] = directive.args;
        if (flag.type === 'atom' && flag.name === 'double_quotes' &&
            value.type === 'atom' && ['chars', 'codes', 'atom'].includes(value.name)) {
            this.parserFlagState.doubleQuotes = value.name;
        }
    }
    applyImportedLibraryOperators(directive) {
        if (directive.type !== COMPOUND || directive.name !== 'use_module' || ![1, 2].includes(directive.arity))
            return;
        const designation = directive.args[0];
        if (designation?.type !== COMPOUND || designation.name !== 'library' || designation.arity !== 1 ||
            designation.args[0]?.type !== ATOM || designation.args[0].name !== 'clpz')
            return;
        for (const [priority, specifier, name] of CLPZ_OPERATOR_DEFINITIONS) {
            this.defineOperator(priority, specifier, name);
        }
    }
    operatorTokenName(token = this.token) {
        if (token.type === TOK.ATOM)
            return token.text;
        // `:-` has its own token because it also introduces clauses/directives,
        // but ISO 6.3.3.1 still permits an operator atom as an argument. Treat the
        // token as the ordinary operator name while parsing terms; the surrounding
        // grammar decides whether it is operator notation or atom data.
        if (token.type === TOK.IF)
            return ':-';
        if (token.type === TOK.STRING && this.parserFlagState.doubleQuotes === 'atom')
            return token.text;
        return null;
    }
    peek(offset = 0) {
        return this.source[this.pos + offset] ?? '';
    }
    take() {
        const ch = this.peek();
        if (ch) {
            this.pos++;
            if (ch === '\n')
                this.line++;
        }
        return ch;
    }
    skipWhitespaceAndComments() {
        const source = this.source;
        const len = source.length;
        while (true) {
            while (this.pos < len) {
                const code = source.charCodeAt(this.pos);
                if (!isWhitespaceCode(code))
                    break;
                if (code === 10)
                    this.line++;
                this.pos++;
            }
            if (source.charCodeAt(this.pos) === 37) { // % line comment
                while (this.pos < len && source.charCodeAt(this.pos) !== 10)
                    this.pos++;
                continue;
            }
            if (source[this.pos] === '/' && source[this.pos + 1] === '*') {
                const line = this.line;
                this.pos += 2;
                while (this.pos < len && !(source[this.pos] === '*' && source[this.pos + 1] === '/')) {
                    if (source.charCodeAt(this.pos) === 10)
                        this.line++;
                    this.pos++;
                }
                if (this.pos >= len)
                    throw new Error(`parse line ${line}: unterminated block comment`);
                this.pos += 2;
                continue;
            }
            break;
        }
    }
    readEscape(line) {
        const escaped = this.take();
        if (!escaped)
            throw new Error(`parse line ${line}: unterminated escape sequence`);
        if (escaped === '\n')
            return '';
        const controls = { a: '\x07', b: '\b', r: '\r', f: '\f', t: '\t', n: '\n', v: '\v' };
        // @ts-expect-error TS7053: auto-suppressed
        if (controls[escaped] != null)
            return controls[escaped];
        if (escaped === 'x') {
            let digits = '';
            while (/^[0-9A-Fa-f]$/.test(this.peek()))
                digits += this.take();
            if (!digits || this.take() !== '\\')
                throw new Error(`parse line ${line}: bad hexadecimal escape`);
            return String.fromCodePoint(Number.parseInt(digits, 16));
        }
        if (/^[0-7]$/.test(escaped)) {
            let digits = escaped;
            while (/^[0-7]$/.test(this.peek()))
                digits += this.take();
            if (this.take() !== '\\')
                throw new Error(`parse line ${line}: bad octal escape`);
            return String.fromCodePoint(Number.parseInt(digits, 8));
        }
        // A backslash followed by a decimal digit is numeric-escape syntax, but
        // ISO octal digits are limited to 0..7.  Do not reinterpret \8 or \9 as
        // implementation-specific one-character escapes.
        if (/^[0-9]$/.test(escaped))
            throw new Error(`parse line ${line}: bad octal escape`);
        return escaped;
    }
    nextToken() {
        // The tokenizer keeps just enough state for useful parse-line errors and
        // treats quoted atoms and quoted strings differently, as Prolog syntax does.
        this.skipWhitespaceAndComments();
        const line = this.line;
        const ch = this.peek();
        if (!ch)
            return { type: TOK.EOF, text: '', line };
        if (this.source.startsWith('...', this.pos) && this.peek(3) !== '.') {
            this.pos += 3;
            return { type: TOK.ATOM, text: '...', line };
        }
        if (ch === '?' && this.peek(1) === '-') {
            this.pos += 2;
            return { type: TOK.ATOM, text: '?-', line };
        }
        if (ch === '.' && this.peek(1) &&
            !isWhitespaceCode(this.peek(1).charCodeAt(0)) &&
            this.peek(1) !== '%' && !(this.peek(1) === '/' && this.peek(2) === '*')) {
            const start = this.pos;
            this.take();
            while (isGraphicAtomCode(this.peek().charCodeAt(0)))
                this.take();
            return { type: TOK.ATOM, text: this.source.slice(start, this.pos), line };
        }
        if (ch === '!') {
            this.take();
            return { type: TOK.ATOM, text: '!', line };
        }
        if (ch === ';') {
            this.take();
            return { type: TOK.ATOM, text: ';', line };
        }
        const punct = {
            '(': TOK.LPAREN, ')': TOK.RPAREN, '[': TOK.LBRACKET, ']': TOK.RBRACKET,
            '{': TOK.LBRACE, '}': TOK.RBRACE, ',': TOK.COMMA, '|': TOK.BAR, '.': TOK.DOT,
        };
        // @ts-expect-error TS7053: auto-suppressed
        if (punct[ch]) {
            this.take();
            // @ts-expect-error TS7053: auto-suppressed
            return { type: punct[ch], text: ch, line };
        }
        if (ch === ':' && this.peek(1) === '-') {
            this.pos += 2;
            return { type: TOK.IF, text: ':-', line };
        }
        if (ch === ':') {
            this.take();
            return { type: TOK.ATOM, text: ':', line };
        }
        if (ch === '"' || ch === "'") {
            const quote = this.take();
            let text = '';
            while (true) {
                if (!this.peek())
                    throw new Error(`parse line ${line}: unterminated quoted term`);
                let value = this.take();
                if (value === quote) {
                    if (this.peek() === quote) {
                        this.take();
                        value = quote;
                    }
                    else {
                        break;
                    }
                }
                else if (value === '\\' && this.peek()) {
                    value = this.readEscape(line);
                }
                text += value;
            }
            return { type: quote === '"' ? TOK.STRING : TOK.ATOM, text, line, quoted: true };
        }
        // A signed numeric literal is only recognized where a term may start.
        // Otherwise the minus is the standard infix operator, so compact ISO
        // syntax such as `X-1` must not be read as `X` followed by `-1`.
        const previousEndsTerm = this.previousToken && ([TOK.VAR, TOK.NUMBER, TOK.STRING, TOK.RPAREN, TOK.RBRACKET, TOK.RBRACE].includes(this.previousToken.type) ||
            (this.previousToken.type === TOK.ATOM &&
                !this.infixOperators.has(this.previousToken.text) &&
                !this.prefixOperators.has(this.previousToken.text) &&
                !this.postfixOperators.has(this.previousToken.text)));
        if (isDigitCode(ch.charCodeAt(0)) ||
            (ch === '-' && isDigitCode(this.peek(1).charCodeAt(0)) && !previousEndsTerm)) {
            const start = this.pos;
            const negative = this.peek() === '-';
            if (negative)
                this.take();
            if (this.peek() === '0' && this.peek(1) === "'") {
                this.take();
                this.take();
                let value = this.take();
                if (!value || value === '\n')
                    throw new Error(`parse line ${line}: bad character code constant`);
                if (value === '\\')
                    value = this.readEscape(line);
                const code = value.codePointAt(0);
                return { type: TOK.NUMBER, text: String(negative ? -code : code), line };
            }
            if (this.peek() === '0' && ['b', 'o', 'x'].includes(this.peek(1))) {
                this.take();
                const kind = this.take();
                const radix = kind === 'b' ? 2 : kind === 'o' ? 8 : 16;
                const digitPattern = radix === 2 ? /^[01]$/ : radix === 8 ? /^[0-7]$/ : /^[0-9A-Fa-f]$/;
                let digits = '';
                while (digitPattern.test(this.peek()))
                    digits += this.take();
                if (!digits)
                    throw new Error(`parse line ${line}: bad radix integer`);
                let integer = 0n;
                for (const digit of digits)
                    integer = integer * BigInt(radix) + BigInt(Number.parseInt(digit, radix));
                if (negative)
                    integer = -integer;
                return { type: TOK.NUMBER, text: integer.toString(), line };
            }
            while (isDigitCode(this.peek().charCodeAt(0)))
                this.take();
            if (this.peek() === '.' && isDigitCode(this.peek(1).charCodeAt(0))) {
                this.take();
                while (isDigitCode(this.peek().charCodeAt(0)))
                    this.take();
            }
            if ((this.peek() === 'e' || this.peek() === 'E')) {
                let idx = this.pos + 1;
                if (this.source[idx] === '+' || this.source[idx] === '-')
                    idx++;
                if (isDigitCode((this.source[idx] ?? '').charCodeAt(0))) {
                    this.take();
                    if (this.peek() === '+' || this.peek() === '-')
                        this.take();
                    while (isDigitCode(this.peek().charCodeAt(0)))
                        this.take();
                }
            }
            return { type: TOK.NUMBER, text: this.source.slice(start, this.pos), line };
        }
        if (isVariableStartCode(ch.charCodeAt(0))) {
            const start = this.pos;
            this.take();
            while (isNameContinueCode(this.peek().charCodeAt(0)))
                this.take();
            const text = this.source.slice(start, this.pos);
            return { type: TOK.VAR, text, line };
        }
        if (isPlainAtomStartCode(ch.charCodeAt(0))) {
            const start = this.pos;
            this.take();
            while (isNameContinueCode(this.peek().charCodeAt(0)))
                this.take();
            return { type: TOK.ATOM, text: this.source.slice(start, this.pos), line };
        }
        if (isGraphicAtomCode(ch.charCodeAt(0))) {
            const start = this.pos;
            this.take();
            while (isGraphicAtomCode(this.peek().charCodeAt(0)))
                this.take();
            return { type: TOK.ATOM, text: this.source.slice(start, this.pos), line };
        }
        throw new Error(`parse line ${line}: bad character ${JSON.stringify(ch)}`);
    }
    advance() {
        this.previousToken = this.token;
        this.token = this.nextToken();
    }
    expect(type, desc = type) {
        if (this.token.type !== type)
            throw new Error(`parse line ${this.token.line}: expected ${desc}, got ${this.token.text}`);
    }
    parseParenthesizedTerm() {
        this.expect(TOK.LPAREN, '(');
        this.advance();
        const term = this.parseTerm(0, true, undefined, 1);
        this.expect(TOK.RPAREN, ')');
        this.advance();
        return term;
    }
    parseList() {
        // Lists are lowered to './2' cons cells and [] so list predicates can work
        // on a single canonical representation.
        this.expect(TOK.LBRACKET, '[');
        this.advance();
        if (this.token.type === TOK.RBRACKET) {
            this.advance();
            return emptyList();
        }
        const items = [];
        let tail = null;
        while (true) {
            items.push(this.parseTerm(0, false, false, 1));
            if (this.token.type === TOK.COMMA) {
                this.advance();
                continue;
            }
            if (this.token.type === TOK.BAR) {
                this.advance();
                tail = this.parseTerm(0, false, false, 1);
                this.expect(TOK.RBRACKET, ']');
                this.advance();
                break;
            }
            this.expect(TOK.RBRACKET, ']');
            this.advance();
            tail = emptyList();
            break;
        }
        for (let i = items.length - 1; i >= 0; i--)
            tail = cons(items[i], tail);
        return tail;
    }
    parseCurly() {
        this.expect(TOK.LBRACE, '{');
        this.advance();
        if (this.token.type === TOK.RBRACE) {
            this.advance();
            return atom('{}');
        }
        const term = this.parseTerm(0, true, undefined, 1);
        this.expect(TOK.RBRACE, '}');
        this.advance();
        return compound('{}', [term]);
    }
    parseTerm(minPrecedence = 0, allowComma = false, allowBar = true, depth = 0) {
        if (depth > this.maxParseDepth)
            throw new Error(`parse line ${this.token.line}: maximum nesting depth exceeded`);
        let left = this.parsePrefixTerm(minPrecedence, allowBar, depth + 1);
        let strictPostfixPrecedence = null;
        while (true) {
            const op = this.token.type === TOK.COMMA && allowComma
                ? ','
                : this.token.type === TOK.BAR && allowBar ? '|'
                    : this.token.type === TOK.IF ? ':-'
                        : this.operatorTokenName();
            const info = op == null ? null : this.infixOperators.get(op);
            if (!info || info.precedence < minPrecedence) {
                const postfixName = this.operatorTokenName();
                const postfix = postfixName == null ? null : this.postfixOperators.get(postfixName);
                if (!postfix || postfix.precedence < minPrecedence ||
                    (strictPostfixPrecedence === postfix.precedence))
                    break;
                const name = postfixName;
                this.advance();
                left = compound(name, [left]);
                strictPostfixPrecedence = postfix.strict ? postfix.precedence : null;
                continue;
            }
            strictPostfixPrecedence = null;
            this.advance();
            const right = this.parseTerm(info.associativity === 'right' ? info.precedence : info.precedence + 1, allowComma, allowBar, depth + 1);
            left = compound(op, [left, right]);
            if (info.associativity === 'none') {
                const nextOp = this.token.type === TOK.COMMA && allowComma
                    ? ','
                    : this.token.type === TOK.BAR && allowBar ? '|'
                        : this.token.type === TOK.IF ? ':-'
                            : this.operatorTokenName();
                if (this.infixOperators.get(nextOp)?.precedence === info.precedence) {
                    throw new Error(`parse line ${this.token.line}: non-associative operator ${op} requires parentheses`);
                }
            }
        }
        return left;
    }
    parsePrefixTerm(minPrecedence = 0, allowBar = true, depth = 0) {
        // `:-` is tokenized specially so the program grammar can recognize clause
        // and directive markers. In term argument position, however, ISO 6.3.3.1
        // permits an operator atom directly as an `arg`; a leading `:-` cannot be
        // prefix operator notation at argument priority, so it denotes the atom.
        if (this.token.type === TOK.IF) {
            this.advance();
            return atom(':-');
        }
        const operatorName = this.operatorTokenName();
        if (operatorName != null && this.prefixOperators.get(operatorName)?.precedence >= minPrecedence) {
            const op = operatorName;
            const info = this.prefixOperators.get(op);
            this.advance();
            // Graphic operators can also be ordinary atom data in a term, as in
            // `op(+, Left, Right)`.  When the operator is immediately followed by
            // an argument delimiter there is no operand for prefix syntax, so keep
            // the operator as an atom instead of reporting a misleading bad-term
            // error.
            if ([TOK.COMMA, TOK.RPAREN, TOK.RBRACKET, TOK.BAR].includes(this.token.type)) {
                return atom(op);
            }
            if (this.token.type === TOK.LPAREN) {
                this.advance();
                const args = [];
                while (true) {
                    args.push(this.parseTerm(0, false, false, depth + 1));
                    if (this.token.type !== TOK.COMMA)
                        break;
                    this.advance();
                }
                this.expect(TOK.RPAREN, ')');
                this.advance();
                return compound(op, args);
            }
            return compound(op, [this.parseTerm(info.precedence + (info.strict ? 1 : 0), false, allowBar, depth + 1)]);
        }
        if (this.token.type === TOK.LPAREN)
            return this.parseParenthesizedTerm();
        if (this.token.type === TOK.LBRACKET)
            return this.parseList();
        if (this.token.type === TOK.LBRACE)
            return this.parseCurly();
        if (this.token.type === TOK.VAR) {
            const name = this.token.text;
            this.advance();
            if (name === '_')
                return variable(`__anon${this.anonymous++}`);
            return variable(name);
        }
        if (this.token.type === TOK.STRING) {
            const value = this.token.text;
            this.advance();
            if (this.parserFlagState.doubleQuotes === 'atom') {
                if (this.token.type === TOK.LPAREN) {
                    this.advance();
                    const args = [];
                    if (this.token.type === TOK.RPAREN) {
                        throw new Error(`parse line ${this.token.line}: zero-arity compound syntax is not supported; use atom ${JSON.stringify(value)} for arity zero data`);
                    }
                    while (true) {
                        args.push(this.parseTerm(0, false, false, depth + 1));
                        if (this.token.type !== TOK.COMMA)
                            break;
                        this.advance();
                    }
                    this.expect(TOK.RPAREN, ')');
                    this.advance();
                    return compound(value, args);
                }
                return atom(value);
            }
            const items = Array.from(value, (character) => this.parserFlagState.doubleQuotes === 'chars'
                ? atom(character)
                : numberTerm(character.codePointAt(0)));
            let list = emptyList();
            // @ts-expect-error TS2345: auto-suppressed
            for (let i = items.length - 1; i >= 0; i--)
                list = cons(items[i], list);
            return list;
        }
        if (this.token.type === TOK.NUMBER) {
            const value = this.token.text;
            this.advance();
            return numberTerm(value);
        }
        if (this.token.type === TOK.ATOM) {
            const name = this.token.text;
            this.advance();
            if (this.token.type === TOK.LPAREN) {
                this.advance();
                const args = [];
                if (this.token.type === TOK.RPAREN) {
                    throw new Error(`parse line ${this.token.line}: zero-arity compound syntax is not supported; use atom ${JSON.stringify(name)} for arity zero data`);
                }
                while (true) {
                    args.push(this.parseTerm(0, false, false, depth + 1));
                    if (this.token.type === TOK.COMMA) {
                        this.advance();
                        continue;
                    }
                    break;
                }
                this.expect(TOK.RPAREN, ')');
                this.advance();
                return compound(name, args);
            }
            return atom(name);
        }
        throw new Error(`parse line ${this.token.line}: bad term`);
    }
    sourceLineIsIndented(line) {
        let start = 0;
        for (let current = 1; current < line; current++) {
            const newline = this.source.indexOf('\n', start);
            if (newline < 0)
                return false;
            start = newline + 1;
        }
        return this.source[start] === ' ' || this.source[start] === '\t';
    }
    parseQuadAnswers(id, query, line, accept) {
        this.expect(TOK.DOT, '.');
        this.advance();
        const answers = [];
        while (this.token.type !== TOK.EOF && this.sourceLineIsIndented(this.token.line)) {
            answers.push(this.parseTerm(0, true, undefined, 0));
            this.expect(TOK.DOT, '.');
            this.advance();
        }
        if (answers.length === 0)
            throw new Error(`parse line ${line}: quad requires an indented answer description`);
        accept({
            kind: 'quad',
            id,
            query,
            answers,
            source: { filename: this.filename, line },
        });
    }
    parseQuad(id, line, accept) {
        const query = this.parseTerm(0, true, undefined, 0);
        this.parseQuadAnswers(id, query, line, accept);
    }
    parseQuadTerm(term, line, accept) {
        if (term.type !== COMPOUND || term.name !== '?-' || ![1, 2].includes(term.arity))
            return false;
        const id = term.arity === 2 ? term.args[0] : null;
        const query = term.args[term.arity - 1];
        this.parseQuadAnswers(id, query, line, accept);
        return true;
    }
    parseProgram(emit = null) {
        const clauses = emit ? null : [];
        let clauseNumber = 0;
        // @ts-expect-error TS18047: auto-suppressed
        const accept = emit ?? ((clause) => clauses.push(clause));
        while (this.token.type !== TOK.EOF) {
            const line = this.token.line;
            // In the normal EyeProlog profile, canonical functional ?-/1 and
            // ?-/2 notation denotes the same quad marker as the corresponding
            // operator notation.  Keep the existing operator-form query parsing so
            // a query containing comma remains wholly to the right of `?-`, while
            // functional notation is parsed as a term and then decomposed by arity.
            if (this.operatorTokenName() === '?-' && !this.strictIso) {
                if (this.peek() === '(') {
                    const quadTerm = this.parseTerm(0, true);
                    if (!this.parseQuadTerm(quadTerm, line, accept)) {
                        throw new Error(`parse line ${line}: bad quad term`);
                    }
                }
                else {
                    this.advance();
                    this.parseQuad(null, line, accept);
                }
                continue;
            }
            if (this.token.type === TOK.IF) {
                this.advance();
                const directive = this.parseTerm();
                const coreDirective = directive.type === 'compound' && ((['dynamic', 'multifile', 'discontiguous', 'initialization', 'include', 'ensure_loaded'].includes(directive.name) && directive.arity === 1) ||
                    (['char_conversion', 'set_prolog_flag'].includes(directive.name) && directive.arity === 2));
                const extensionDirective = directive.type === 'compound' && ((['use_module', 'meta_predicate'].includes(directive.name) && directive.arity === 1) ||
                    (['module', 'use_module'].includes(directive.name) && directive.arity === 2));
                if (this.strictIso && extensionDirective) {
                    throw new Error(`parse line ${line}: implementation-specific directive ${directive.name}/${directive.arity} is not available in strict ISO core mode`);
                }
                const operator = this.applyOperatorDirective(directive, line);
                if (!coreDirective && !extensionDirective && !operator) {
                    throw new Error(`parse line ${line}: bad term`);
                }
                this.expect(TOK.DOT, '.');
                this.applyParserFlagDirective(directive);
                this.applyImportedLibraryOperators(directive);
                this.advance();
                const clause = { head: compound(':-', [directive]), body: [] };
                // Module loading declarations describe the compilation unit rather
                // than an executable source clause, so they do not shift proof clause
                // numbers in the importing file.
                if (!['module', 'use_module', 'meta_predicate'].includes(directive.name))
                    clauseNumber++;
                // @ts-expect-error TS2339: auto-suppressed
                if (this.sourceMetadata)
                    clause.source = { filename: this.filename, line, clause: clauseNumber };
                accept(clause);
                continue;
            }
            let head = this.parseTerm(3);
            // Both a quad label and a TS 13211-3 semicontext may contain an
            // unparenthesized comma before their priority-1200 operator.  Assemble
            // that left operand before deciding whether the marker is ?- or -->.
            if (this.token.type === TOK.COMMA) {
                this.advance();
                head = compound(',', [head, this.parseTerm(3)]);
            }
            if (this.operatorTokenName() === '?-') {
                if (this.strictIso) {
                    // There is no predefined infix ?-/2 in strict core mode.  If a
                    // conforming source explicitly introduced one with op/3, read it as
                    // an ordinary operator term rather than as a quad label.
                    const info = this.infixOperators.get('?-');
                    if (!info)
                        throw new Error(`parse line ${line}: expected ., got ?-`);
                    this.advance();
                    const right = this.parseTerm(info.associativity === 'right' ? info.precedence : info.precedence + 1, true);
                    const clause = { head: compound('?-', [head, right]), body: [] };
                    this.expect(TOK.DOT, '.');
                    this.advance();
                    clauseNumber++;
                    // @ts-expect-error TS2339: auto-suppressed
                    if (this.sourceMetadata)
                        clause.source = { filename: this.filename, line, clause: clauseNumber };
                    accept(clause);
                    continue;
                }
                this.advance();
                this.parseQuad(head, line, accept);
                continue;
            }
            if (this.operatorTokenName() === '-->') {
                this.advance();
                const grammarBody = this.parseTerm(0, true);
                this.expect(TOK.DOT, '.');
                this.advance();
                const clause = { head: compound('-->', [head, grammarBody]), body: [] };
                clauseNumber++;
                // @ts-expect-error TS2339: auto-suppressed
                if (this.sourceMetadata)
                    clause.source = { filename: this.filename, line, clause: clauseNumber };
                accept(clause);
                continue;
            }
            const body = [];
            if (this.token.type === TOK.IF) {
                this.advance();
                while (true) {
                    body.push(this.parseTerm());
                    if (this.token.type === TOK.COMMA) {
                        this.advance();
                        continue;
                    }
                    break;
                }
            }
            this.expect(TOK.DOT, '.');
            this.advance();
            const clause = { head, body };
            clauseNumber++;
            // @ts-expect-error TS2339: auto-suppressed
            if (this.sourceMetadata)
                clause.source = { filename: this.filename, line, clause: clauseNumber };
            accept(clause);
        }
        return clauses;
    }
    postfixOperators;
    infixOperators;
    parserFlagState;
    token;
    source;
    pos;
    line;
    previousToken;
    prefixOperators;
    anonymous;
    filename;
    strictIso;
    sourceMetadata;
    maxParseDepth;
}
function listAtomNames(term) {
    const names = [];
    let cursor = term;
    while (cursor.type === 'compound' && cursor.name === '.' && cursor.arity === 2) {
        if (cursor.args[0].type !== 'atom')
            return null;
        names.push(cursor.args[0].name);
        cursor = cursor.args[1];
    }
    return cursor.type === 'atom' && cursor.name === '[]' ? names : null;
}
export function parseClauses(source, options = {}) {
    const ownsParserFlagState = options.parserFlagState == null;
    const initialDoubleQuotes = options.doubleQuotes ?? 'chars';
    const parserOptions = ownsParserFlagState
        ? { ...options, parserFlagState: { doubleQuotes: initialDoubleQuotes } }
        : options;
    return new Parser(source, parserOptions).parseProgram();
}
// Streaming parser entry points used by ProgramBuilder.  The ordinary public
// parseClauses API still returns an array; these avoid a second, temporary
// clause array when a Program is being built directly from source text.
export function parseClausesInto(source, options = {}, emit) {
    new Parser(source, options).parseProgram(emit);
}
export function parseProgramText(source, options = {}) {
    return parseClauses(source, options);
}
export function parseGoalText(text, options = {}) {
    const clauses = parseClauses(`zz_goal((${text})).`, options);
    const head = clauses[0]?.head;
    if (clauses.length !== 1 || head?.type !== 'compound' ||
        head.name !== 'zz_goal' || head.arity !== 1 || clauses[0].body.length !== 0) {
        throw new Error('bad goal');
    }
    return head.args[0];
}
