import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readingSource = fs.readFileSync(
	path.join(repoRoot, 'src', 'components', 'wereadReading.ts'),
	'utf8'
);
const bookshelfSource = fs.readFileSync(
	path.join(repoRoot, 'src', 'components', 'wereadBookshelf.ts'),
	'utf8'
);

const readConst = (source, name) => {
	const match = source.match(new RegExp(`export const ${name} = '([^']+)'`));
	assert.ok(match, `${name} should be exported as a string constant`);
	return match[1];
};

assert.equal(readConst(readingSource, 'WEREAD_BROWSER_VIEW_ID'), 'weread-dev-reading-view');
assert.equal(readConst(bookshelfSource, 'WEREAD_BOOKSHELF_VIEW_ID'), 'weread-dev-bookshelf-view');

console.log('dev plugin isolation tests passed');
