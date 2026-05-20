import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourcePath = path.join(repoRoot, 'src', 'wereadOfficialApi.ts');
const source = fs.readFileSync(sourcePath, 'utf8');
const compiled = ts.transpileModule(source, {
	compilerOptions: {
		module: ts.ModuleKind.CommonJS,
		target: ts.ScriptTarget.ES2020,
		importsNotUsedAsValues: ts.ImportsNotUsedAsValues.Remove
	}
}).outputText;

const module = { exports: {} };
const sandbox = {
	module,
	exports: module.exports,
	require: (id) => {
		if (id === 'obsidian') return { Notice: class Notice {}, requestUrl: async () => ({ json: {} }) };
		if (id === 'svelte/store') return { get: () => ({}) };
		if (id === './settings') return { settingsStore: { actions: {} } };
		throw new Error(`Unexpected require in adapter test: ${id}`);
	},
	console
};
vm.runInNewContext(compiled, sandbox, { filename: sourcePath });

const {
	normalizeOfficialBookInfo,
	normalizeOfficialChapterInfo,
	normalizeOfficialProgress,
	normalizeOfficialReviewResponse,
	normalizeOfficialHighlightResponse
} = module.exports;

assert.equal(normalizeOfficialBookInfo({ bookId: '1', wordCount: 1234 }).totalWords, 1234);
assert.equal(normalizeOfficialBookInfo({ bookId: '1', totalWords: 55, wordCount: 1234 }).totalWords, 55);

const chapter = normalizeOfficialChapterInfo({
	bookId: '1',
	chapterUpdateTime: 99,
	chapters: [{ chapterUid: 10, chapterIdx: 1, title: '第一章' }]
});
assert.equal(chapter.data[0].bookId, '1');
assert.equal(chapter.data[0].chapterUpdateTime, 99);
assert.equal(chapter.data[0].updated[0].updateTime, 99);
assert.equal(chapter.data[0].updated[0].isMPChapter, 0);
assert.equal(chapter.data[0].updated[0].level, 1);

const progress = normalizeOfficialProgress({
	bookId: '1',
	book: { progress: 42, recordReadingTime: 3600, updateTime: 1000 }
});
assert.equal(progress.book.readingTime, 3600);
assert.equal(progress.book.startReadingTime, 1000);
assert.equal(progress.book.finishTime, 0);

const finished = normalizeOfficialProgress({
	bookId: '1',
	book: { progress: 100, recordReadingTime: 7200, finishTime: 2000 }
});
assert.equal(finished.book.finishTime, 2000);

const reviews = normalizeOfficialReviewResponse({
	reviews: [{ reviewId: 'r1', bookId: '1', content: '想法', createTime: 1, type: 1 }]
});
assert.equal(reviews.reviews[0].review.reviewId, 'r1');
assert.equal(reviews.removed.length, 0);

const highlights = normalizeOfficialHighlightResponse({
	updated: [
		{
			bookmarkId: 'b1',
			bookId: '1',
			chapterUid: 10,
			markText: '划线',
			createTime: 1,
			range: '1-2'
		}
	]
});
assert.equal(highlights.updated[0].type, 1);
assert.equal(highlights.updated[0].style, 1);
assert.equal(highlights.removed.length, 0);

console.log('official API adapter tests passed');
