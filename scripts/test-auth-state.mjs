import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourcePath = path.join(repoRoot, 'src', 'utils', 'wereadAuth.ts');
const source = fs.readFileSync(sourcePath, 'utf8');
const compiled = ts.transpileModule(source, {
	compilerOptions: {
		module: ts.ModuleKind.CommonJS,
		target: ts.ScriptTarget.ES2020
	}
}).outputText;

const module = { exports: {} };
vm.runInNewContext(compiled, { module, exports: module.exports }, { filename: sourcePath });

const { getWereadAuthState, getWereadAuthStateKey } = module.exports;

const officialReady = getWereadAuthState({
	dataSource: 'official',
	wereadApiKey: 'wrk-example',
	isOfficialApiValid: false,
	isCookieValid: false,
	cookies: []
});
assert.equal(officialReady.ready, true);
assert.equal(officialReady.kind, 'official');
assert.equal(officialReady.title, '官方 API Key 已配置');
assert.equal(officialReady.actionText, '打开设置');

const officialMissing = getWereadAuthState({
	dataSource: 'official',
	wereadApiKey: '',
	isCookieValid: true,
	cookies: [{ name: 'wr_vid', value: '1' }]
});
assert.equal(officialMissing.ready, false);
assert.equal(officialMissing.title, '请先配置官方 API Key');

const cookieReady = getWereadAuthState({
	dataSource: 'cookie',
	wereadApiKey: '',
	isCookieValid: true,
	cookies: [{ name: 'wr_vid', value: '1' }]
});
assert.equal(cookieReady.ready, true);
assert.equal(cookieReady.kind, 'cookie');

const cookieMissing = getWereadAuthState({
	dataSource: 'cookie',
	wereadApiKey: 'wrk-example',
	isCookieValid: false,
	cookies: []
});
assert.equal(cookieMissing.ready, false);
assert.equal(cookieMissing.title, '请先登录');

assert.equal(
	getWereadAuthStateKey({
		dataSource: 'official',
		wereadApiKey: 'wrk-example',
		isOfficialApiValid: false,
		isCookieValid: false,
		cookies: []
	}),
	'official:has-key:invalid'
);
assert.equal(
	getWereadAuthStateKey({
		dataSource: 'cookie',
		wereadApiKey: '',
		isCookieValid: true,
		cookies: [{ name: 'wr_vid', value: '1' }]
	}),
	'cookie:valid:1'
);

console.log('weread auth state tests passed');
