export declare class StreamManager {
    constructor(options?: any);
    add(stream: any): any;
    resolve(reference: any): any;
    open(path: any, mode: any, options?: any): any;
    close(stream: any): any;
    readUnit(stream: any, peek?: any): any;
    writeUnit(stream: any, value: any): any;
    streams: any;
    aliases: any;
    nextId: any;
    output: any;
    currentInput: any;
    currentOutput: any;
}
