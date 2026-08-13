import { DCG } from '../../../src/index.js';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const grammarPath = path.join(__dirname, 'grammar.dcg');

const md = new DCG();
md.loadFile(grammarPath);

console.log("=== Markdown Parser ===");
const input = "# Hello World\nThis is a paragraph\n## Subtitle\n";
const tokens = Array.from(input).map(c => c.charCodeAt(0));

const astResult = md.parseWithBindings('markdown(AST)', tokens);
console.log(JSON.stringify(astResult[0], null, 2));
