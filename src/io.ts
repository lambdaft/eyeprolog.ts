// Synchronous ISO stream state shared by a solver and all of its inner solvers.
// @ts-expect-error TS7034: auto-suppressed
import { BufferCtor, fs } from './platform.js';

export class StreamManager {
  constructor(options: any = {}) {
    this.nextId = 2;
    this.streams = new Map();
    this.aliases = new Map();
    this.output = options.write ?? (() => {});
    this.add({ id: 0, alias: 'user_input', mode: 'read', type: 'text',
      content: String(options.input ?? ''), position: 0, path: '',
      reposition: false, eofAction: 'reset', standard: true, pastEnd: false });
    this.add({ id: 1, alias: 'user_output', mode: 'append', type: 'text',
      content: '', position: 0, path: '', reposition: false,
      eofAction: 'reset', standard: true, write: this.output, pastEnd: false });
    this.currentInput = 0;
    this.currentOutput = 1;
  }
  add(stream: any): any {
    this.streams.set(stream.id, stream);
    if (stream.alias) this.aliases.set(stream.alias, stream.id);
    return stream;
  }
  resolve(reference: any): any {
    if (typeof reference === 'string') {
      const id = this.aliases.get(reference);
      return id == null ? null : this.streams.get(id) ?? null;
    }
    return this.streams.get(reference) ?? null;
  }
  open(path: any, mode: any, options: any = {}): any {
    // @ts-expect-error TS7005: auto-suppressed
    if (!fs) throw new Error('file streams are unavailable in this runtime');
    const type = options.type ?? 'text';
    let content = type === 'binary' ? [] : '';
    if (mode === 'read') content = fs.readFileSync(path, type === 'binary' ? null : 'utf8');
    else if (mode === 'append' && fs.existsSync(path)) content = fs.readFileSync(path, type === 'binary' ? null : 'utf8');
    // @ts-expect-error TS7005: auto-suppressed
    if (BufferCtor?.isBuffer(content)) content = [...content];
    return this.add({
      id: this.nextId++, alias: options.alias ?? null, mode, type, content,
      position: mode === 'append' ? content.length : 0, path,
      reposition: options.reposition ?? false,
      eofAction: options.eof_action ?? 'error', standard: false,
      pastEnd: false,
    });
  }
  close(stream: any): any {
    if (!stream.standard && stream.mode !== 'read') {
      // @ts-expect-error TS7005: auto-suppressed
      fs.writeFileSync(stream.path, stream.type === 'binary' ? BufferCtor.from(stream.content) : stream.content);
    }
    if (stream.alias) this.aliases.delete(stream.alias);
    this.streams.delete(stream.id);
  }
  readUnit(stream: any, peek: any = false): any {
    if (stream.position >= stream.content.length) return null;
    const value = stream.type === 'binary' ? stream.content[stream.position] : String(stream.content)[stream.position];
    if (!peek) stream.position++;
    stream.pastEnd = false;
    return value;
  }
  writeUnit(stream: any, value: any): any {
    if (stream.standard && stream.write) stream.write(String(value));
    else if (stream.type === 'binary') stream.content.push(value);
    else stream.content += value;
    stream.position = stream.content.length;
  }

    streams: any;
    aliases: any;
    nextId: any;
    output: any;
    currentInput: any;
    currentOutput: any;
}
