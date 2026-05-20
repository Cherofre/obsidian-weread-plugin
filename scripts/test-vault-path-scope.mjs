import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourcePath = path.join(repoRoot, 'src', 'utils', 'vaultPath.ts');
const source = fs.readFileSync(sourcePath, 'utf8');
const compiled = ts.transpileModule(source, {
	compilerOptions: {
		module: ts.ModuleKind.CommonJS,
		target: ts.ScriptTarget.ES2020
	}
}).outputText;

const module = { exports: {} };
vm.runInNewContext(compiled, { module, exports: module.exports }, { filename: sourcePath });

const { isVaultPathInFolder, normalizeVaultFolder } = module.exports;

assert.equal(normalizeVaultFolder('/'), '/');
assert.equal(normalizeVaultFolder(''), '/');
assert.equal(normalizeVaultFolder('/读书笔记/微信读书-dev-test/'), '读书笔记/微信读书-dev-test');
assert.equal(normalizeVaultFolder('读书笔记\\微信读书-dev-test'), '读书笔记/微信读书-dev-test');

assert.equal(isVaultPathInFolder('读书笔记/微信读书-dev-test/三体.md', '读书笔记/微信读书-dev-test'), true);
assert.equal(isVaultPathInFolder('读书笔记/微信读书-dev-test/子目录/三体.md', '读书笔记/微信读书-dev-test'), true);
assert.equal(isVaultPathInFolder('读书笔记/微信读书/三体.md', '读书笔记/微信读书-dev-test'), false);
assert.equal(isVaultPathInFolder('读书笔记/微信读书-dev-test2/三体.md', '读书笔记/微信读书-dev-test'), false);
assert.equal(isVaultPathInFolder('任意/三体.md', '/'), true);

console.log('vault path scope tests passed');
