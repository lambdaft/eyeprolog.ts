import { DCG } from '../../../src/index.js';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const grammarPath = path.join(__dirname, 'grammar.dcg');

const parser = new DCG();
parser.loadFile(grammarPath);

console.log("=== ${ex.desc} ===");
console.log("Loaded grammar successfully.");\n