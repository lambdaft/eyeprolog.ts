import { DCG } from '../../../src/index.js';
import * as path from 'path';

import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const grammarPath = path.join(__dirname, 'grammar.dcg');

const nlp = new DCG();
nlp.loadFile(grammarPath);

console.log("=== NLP Grammar Parser ===");

// 1. Basic parsing validation
const valid1 = nlp.parse('sentence(AST)', ['the', 'quick', 'brown', 'cat', 'chases', 'a', 'mouse']);
console.log("Parses 'the quick brown cat chases a mouse':", valid1);

const invalid1 = nlp.parse('sentence(AST)', ['the', 'cats', 'chases', 'a', 'mouse']);
console.log("Parses 'the cats chases a mouse' (wrong agreement):", invalid1);

// 2. Parsing with AST extraction
const astResult = nlp.parseWithBindings('sentence(AST)', ['john', 'sees', 'the', 'lazy', 'dog']);
console.log("\nParsed AST for 'john sees the lazy dog':");
console.log(JSON.stringify(astResult, null, 2));

// 3. Generation
console.log("\nGenerating some valid singular sentences:");
const generated = nlp.generate('sentence(AST)', 5);
generated.forEach((tokens, i) => {
    console.log(`${i+1}. ${tokens.join(' ')}`);
});
