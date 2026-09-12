const charTypeNames = new Set([
  'alnum', 'alpha', 'alphabetic', 'alphanumeric', 'ascii', 'ascii_graphic', 'ascii_punctuation',
  'binary_digit', 'control', 'decimal_digit', 'exponent', 'graphic', 'graphic_token',
  'hexadecimal_digit', 'layout', 'lower', 'meta', 'numeric', 'octal_digit', 'octet',
  'prolog', 'sign', 'solo', 'symbolic_control', 'symbolic_hexadecimal', 'upper', 'whitespace',
]);
// Runtime character parsing/writing and character classification for
// library(charsio). Portable UTF-8 relations remain in src/lib/charsio.pl.

import { createParserOperatorState, parseTermText } from './parser.js';
import { BufferCtor } from './platform.js';
import {
  ATOM, COMPOUND, VAR, atom, compound, copyResolved, deref,
  listFromItems, numberTerm, properListItems, unify, variable,
} from './term.js';
import { PrologError } from './errors.js';
import { formatTermForWrite } from './write.js';
import { characterListText, chars } from './host-utils.js';

let readFresh = 0;
function activeCharConverter(solver: any): any {
  if (solver.prologFlags.get('char_conversion')?.value?.name !== 'on' || solver.charConversions.size === 0) {
    return null;
  }
  return (character: any) => solver.charConversions.get(character) ?? character;
}

function convertTextCharacters(text: any, solver: any): any {
  const convert = activeCharConverter(solver);
  if (convert == null) return text;
  let result = '', quote = null;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i], next = text[i + 1];
    if (quote != null) {
      result += ch;
      if (ch === '\\') {
        if (i + 1 < text.length) result += text[++i];
      } else if (ch === quote && next === quote) {
        result += text[++i];
      } else if (ch === quote) {
        quote = null;
      }
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      result += ch;
    } else {
      result += convert(ch);
    }
  }
  return result;
}

function scopeReadTerm(term: any): any {
  const scope = ++readFresh;
  const bySourceName: Map<any, any> = new Map();
  const variables: any[] = [];
  const copy = (item: any) => {
    if (item.type === VAR) {
      let record = bySourceName.get(item.name);
      if (record == null) {
        const scoped = variable(`\u0000chars:${scope}:${variables.length}`);
        scoped.displayName = item.name;
        record = {
          sourceName: item.name,
          term: scoped,
          count: 0,
          anonymous: item.name.startsWith('__anon'),
        };
        bySourceName.set(item.name, record);
        variables.push(record);
      }
      record.count++;
      return record.term;
    }
    if (item.type !== COMPOUND) return item;
    return compound(item.name, item.args.map(copy));
  };
  return { term: copy(term), variables };
}

function readTextTerm(text: any, solver: any): any {
  const converted = convertTextCharacters(text, solver);
  try {
    const operatorState = createParserOperatorState(solver.program.operators.values(), false);
    const parsed = parseTermText(converted, {
      operatorState,
      isoStrict: solver.isoStrict,
      doubleQuotes: solver.prologFlags.get('double_quotes')?.value?.name ?? 'chars',
      readTermEnd: converted.endsWith('.') ? converted.length - 1 : undefined,
    });
    return scopeReadTerm(parsed);
  } catch (error: any) {
    if (error instanceof PrologError) throw error;
    throw new PrologError('syntax_error(read_term)');
  }
}

function requireOptionList(term: any, env: any, ): any {
  const value = deref(term, env);
  if (value.type === VAR) throw new PrologError('instantiation_error');
  const options = properListItems(value, env);
  if (options == null) throw new PrologError('type_error(list)', copyResolved(value, env));
  for (const optionTerm of options) {
    if (deref(optionTerm, env).type === VAR) throw new PrologError('instantiation_error');
  }
  return options.map((option: any) => deref(option, env));
}

function* readFromCharsBuiltin({ solver, goal, env }: any) {
  const text = characterListText(goal.args[0], env);
  const { term } = readTextTerm(text, solver);
  const next = env.clone();
  if (unify(goal.args[1], term, next)) yield next;
}

function* readTermFromCharsBuiltin({ solver, goal, env }: any) {
  const text = characterListText(goal.args[0], env);
  const options = requireOptionList(goal.args[2], env);
  for (const option of options) {
    if (option.type !== COMPOUND || option.arity !== 1 ||
        !['variables', 'variable_names', 'singletons'].includes(option.name)) {
      throw new PrologError('domain_error(read_option)', copyResolved(option, env));
    }
  }
  const { term, variables } = readTextTerm(text, solver);
  const next = env.clone();
  if (!unify(goal.args[1], term, next)) return;
  for (const option of options) {
    const value = option.name === 'variables'
      ? listFromItems(variables.map((item: any) => item.term))
      : option.name === 'variable_names'
        ? listFromItems(variables
          .filter((item: any) => !item.anonymous)
          .map((item: any) => compound('=', [atom(item.sourceName), item.term])))
        : listFromItems(variables
          .filter((item: any) => !item.anonymous && item.count === 1)
          .map((item: any) => compound('=', [atom(item.sourceName), item.term])));
    if (!unify(option.args[0], value, next)) return;
  }
  yield next;
}

function optionBoolean(term: any, env: any, option: any): any {
  const value = deref(term, env);
  if (value.type === VAR) throw new PrologError('instantiation_error');
  if (value.type !== ATOM || !['true', 'false'].includes(value.name)) {
    throw new PrologError('domain_error(write_option)', copyResolved(option, env));
  }
  return value.name === 'true';
}

function variableNamesOption(term: any, env: any, option: any): any {
  const value = deref(term, env);
  if (value.type === VAR) throw new PrologError('instantiation_error');
  const items = properListItems(value, env);
  if (items == null) throw new PrologError('domain_error(write_option)', copyResolved(option, env));
  const names: Map<any, any> = new Map();
  for (const itemTerm of items) {
    const item = deref(itemTerm, env);
    if (item.type !== COMPOUND || item.name !== '=' || item.arity !== 2) {
      throw new PrologError('domain_error(write_option)', copyResolved(option, env));
    }
    const name = deref(item.args[0], env);
    const target = deref(item.args[1], env);
    if (name.type === VAR) throw new PrologError('instantiation_error');
    if (name.type !== ATOM) throw new PrologError('domain_error(write_option)', copyResolved(option, env));
    if (target.type === VAR && !names.has(target.name)) names.set(target.name, name.name);
  }
  return names;
}

function writeOptions(term: any, env: any, solver: any): any {
  const options = requireOptionList(term, env);
  const result = {
    quoted: false,
    ignoreOps: false,
    numbervars: false,
    variableNames: new Map(),
    compact: true,
    minimalOperatorSpacing: true,
    operatorAtomsAsArgs: true,
    doubleQuotes: null,
  };
  for (const option of options) {
    if (option.type !== COMPOUND || option.arity !== 1) {
      throw new PrologError('domain_error(write_option)', copyResolved(option, env));
    }
    if (option.name === 'quoted') result.quoted = optionBoolean(option.args[0], env, option);
    else if (option.name === 'ignore_ops') result.ignoreOps = optionBoolean(option.args[0], env, option);
    else if (option.name === 'numbervars') result.numbervars = optionBoolean(option.args[0], env, option);
    else if (option.name === 'variable_names') result.variableNames = variableNamesOption(option.args[0], env, option);
    else if (option.name === 'double_quotes' && !solver.isoStrict) result.doubleQuotes = optionBoolean(option.args[0], env, option);
    else throw new PrologError('domain_error(write_option)', copyResolved(option, env));
  }
  if (result.doubleQuotes === true) {
    result.doubleQuotes = solver.prologFlags.get('double_quotes')?.value?.name ?? 'chars';
  } else {
    result.doubleQuotes = null;
  }
  return result;
}

function* writeTermToCharsBuiltin({ solver, goal, env }: any) {
  if (deref(goal.args[2], env).type !== VAR) {
    throw new PrologError('uninstantiation_error', copyResolved(goal.args[2], env));
  }
  const options = writeOptions(goal.args[1], env, solver);
  const text = formatTermForWrite(goal.args[0], env, {
    ...options,
    generateVariableNames: true,
    variableNameState: solver.writeVariableState,
    operators: solver.program.operators.values(),
  });
  const next = env.clone();
  if (unify(goal.args[2], chars(text), next)) yield next;
}

function base64Options(term: any, env: any): any {
  const options = requireOptionList(term, env);
  let padding = true, charset = 'standard';
  for (const option of options) {
    if (option.type !== COMPOUND || option.arity !== 1) {
      throw new PrologError('domain_error(base64_option)', copyResolved(option, env));
    }
    const value = deref(option.args[0], env);
    if (value.type === VAR) throw new PrologError('instantiation_error');
    if (option.name === 'padding') {
      if (value.type !== ATOM || !['true', 'false'].includes(value.name)) {
        throw new PrologError('domain_error(boolean)', copyResolved(value, env));
      }
      padding = value.name === 'true';
    } else if (option.name === 'charset') {
      if (value.type !== ATOM || !['standard', 'url'].includes(value.name)) {
        throw new PrologError('domain_error(charset)', copyResolved(value, env));
      }
      charset = value.name;
    } else {
      throw new PrologError('domain_error(base64_option)', copyResolved(option, env));
    }
  }
  return { padding, charset };
}

function base64Encode(text: any, charset: any, padding: any): any {
  const bytes: any[] = [];
  for (const ch of Array.from(text) as string[]) {
    const code = ch.codePointAt(0) ?? 0;
    if (code > 255) throw new PrologError('domain_error(octet_character)', numberTerm(code));
    bytes.push(code);
  }
  let encoded;
  if (BufferCtor != null) encoded = BufferCtor.from(bytes).toString('base64');
  else if (typeof btoa === 'function') encoded = btoa(String.fromCharCode(...bytes));
  else throw new PrologError('resource_error(base64)');
  if (charset === 'url') encoded = encoded.replace(/\+/g, '-').replace(/\//g, '_');
  if (!padding) encoded = encoded.replace(/=+$/, '');
  return encoded;
}

function base64Decode(text: any, charset: any): any {
  let encoded = text;
  if (charset === 'url') encoded = encoded.replace(/-/g, '+').replace(/_/g, '/');
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded) || encoded.length % 4 === 1) {
    throw new PrologError('domain_error(base64)', chars(text));
  }
  encoded += '='.repeat((4 - encoded.length % 4) % 4);
  let bytes;
  if (BufferCtor != null) bytes = [...BufferCtor.from(encoded, 'base64')];
  else if (typeof atob === 'function') bytes = [...atob(encoded)].map((ch: string) => ch.charCodeAt(0));
  else throw new PrologError('resource_error(base64)');
  return String.fromCharCode(...bytes);
}

function* charsBase64Builtin({ goal, env }: any) {
  const source = deref(goal.args[0], env);
  const encoded = deref(goal.args[1], env);
  if (source.type === VAR && encoded.type === VAR) throw new PrologError('instantiation_error');
  const { padding, charset } = base64Options(goal.args[2], env);
  const next = env.clone();
  if (source.type !== VAR) {
    const text = characterListText(goal.args[0], env);
    if (unify(goal.args[1], chars(base64Encode(text, charset, padding)), next)) yield next;
    return;
  }
  const text = characterListText(goal.args[1], env);
  if (unify(goal.args[0], chars(base64Decode(text, charset)), next)) yield next;
}

function charTypeCandidates(ch: string): any {
  const code = ch.codePointAt(0) ?? 0;
  const letter = /\p{L}/u.test(ch);
  const decimal = /\p{Nd}/u.test(ch);
  const numeric = /\p{N}/u.test(ch);
  const whitespace = /\s/u.test(ch);
  const control = /\p{Cc}/u.test(ch);
  const lower = /\p{Ll}/u.test(ch);
  const upper = /\p{Lu}/u.test(ch);
  const asciiGraphic = code >= 0x21 && code <= 0x7e;
  const out: any[] = [];
  const add = (name: any, yes: any) => { if (yes) out.push(atom(name)); };
  add('alnum', letter || decimal);
  add('alpha', letter);
  add('alphabetic', letter);
  add('alphanumeric', letter || decimal);
  add('ascii', code <= 0x7f);
  add('ascii_graphic', asciiGraphic);
  add('ascii_punctuation', asciiGraphic && !letter && !decimal);
  add('binary_digit', ch === '0' || ch === '1');
  add('control', control);
  add('decimal_digit', decimal);
  add('exponent', ch === 'e' || ch === 'E');
  add('graphic', !whitespace && !control);
  add('graphic_token', '#$&*+-./:<=>?@\\^~'.includes(ch));
  add('hexadecimal_digit', /^[0-9A-Fa-f]$/.test(ch));
  add('layout', whitespace);
  add('lower', lower);
  add('meta', "\\'\"`".includes(ch));
  add('numeric', numeric);
  add('octal_digit', /^[0-7]$/.test(ch));
  add('octet', code <= 0xff);
  add('prolog', true);
  add('sign', ch === '+' || ch === '-');
  add('solo', '!,;[]{}()|'.includes(ch));
  add('symbolic_control', '#$&*+-./:<=>?@\\^~'.includes(ch));
  add('symbolic_hexadecimal', /^[A-Fa-f]$/.test(ch));
  add('upper', upper);
  add('whitespace', whitespace);
  out.push(compound('lower', [listFromItems([...ch.toLowerCase()].map(atom))]));
  out.push(compound('upper', [listFromItems([...ch.toUpperCase()].map(atom))]));
  return out;
}

function validCharType(term: any): any {
  return (term.type === ATOM && charTypeNames.has(term.name)) ||
    (term.type === COMPOUND && ['lower', 'upper'].includes(term.name) && term.arity === 1);
}

function charTypeBuiltin(context: any): any {
  const state = { pending: false };
  const iterator = charTypeSolutions(context, state);
  (iterator as any).hasPendingAlternatives = () => state.pending;
  return iterator;
}

function* charTypeSolutions({ goal, env }: any, state: any) {
  const char = deref(goal.args[0], env);
  const type = deref(goal.args[1], env);
  if (char.type === VAR && type.type === VAR) throw new PrologError('instantiation_error');
  if (char.type !== VAR && (char.type !== ATOM || [...char.name].length !== 1)) {
    throw new PrologError('type_error(character)', char);
  }
  if (type.type !== VAR && !validCharType(type)) throw new PrologError('domain_error(char_type)', type);

  const firstCode = char.type === VAR ? 0 : char.name.codePointAt(0);
  const lastCode = char.type === VAR ? 0x10ffff : firstCode;
  for (let code = firstCode; code <= lastCode; code++) {
    if (code >= 0xd800 && code <= 0xdfff) continue;
    const ch = String.fromCodePoint(code);
    const candidates = charTypeCandidates(ch).filter((candidate: any) =>
      type.type === VAR || (candidate.type === type.type && candidate.name === type.name));
    for (let index = 0; index < candidates.length; index++) {
      const candidate = candidates[index];
      const next = env.clone();
      if (unify(goal.args[0], atom(ch), next) && unify(goal.args[1], candidate, next)) {
        state.pending = index + 1 < candidates.length || code < lastCode;
        yield next;
      }
    }
  }
  state.pending = false;
}

export const shortMonths = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const longMonths = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];
export const shortWeekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const longWeekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];


export const charsioHostBuiltins = {
  register(registry: any): any {
    registry.add('eyeprolog__char_type', 2, charTypeBuiltin, { eyePrologLibrary: true });
    registry.add('eyeprolog__read_from_chars', 2, readFromCharsBuiltin, { deterministic: true, eyePrologLibrary: true });
    registry.add('eyeprolog__read_term_from_chars', 3, readTermFromCharsBuiltin, { deterministic: true, eyePrologLibrary: true });
    registry.add('eyeprolog__write_term_to_chars', 3, writeTermToCharsBuiltin, { deterministic: true, eyePrologLibrary: true });
    registry.add('eyeprolog__chars_base64', 3, charsBase64Builtin, { deterministic: true, eyePrologLibrary: true });
  },
};
