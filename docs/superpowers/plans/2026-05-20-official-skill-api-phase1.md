# Official Skill API Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an optional official WeRead Agent API Gateway data source while preserving the existing Cookie data source and current Markdown output path.

**Architecture:** Keep `src/api.ts` as the public sync entry point. Add a focused official-provider module with pure normalizers for official responses, then route existing `ApiManager` methods to either Cookie logic or the official provider based on settings. Settings and UI expose the source switch and API Key without touching old Cookie credentials.

**Tech Stack:** TypeScript, Obsidian `requestUrl` and `Notice`, Svelte store settings, webpack, `svelte-check`, a small Node adapter test script using the installed `typescript` package.

---

## File Structure

- Create `src/wereadOfficialApi.ts`
  - Owns official Agent API Gateway calls.
  - Exports `OFFICIAL_WEREAD_SKILL_VERSION`, `OfficialWereadProvider`, `OfficialWereadApiError`, and pure normalizer functions.
  - Does not know about Cookie refresh.
- Create `scripts/test-official-api-adapters.mjs`
  - Runtime-tests pure normalizers by transpiling `src/wereadOfficialApi.ts` with `typescript.transpileModule`.
  - Uses Node `assert/strict`, no new test framework dependency.
- Modify `package.json`
  - Add `test:official-api` script.
- Modify `src/api.ts`
  - Instantiate `OfficialWereadProvider`.
  - Delegate existing public methods to official provider when `settings.dataSource === 'official'`.
  - Keep existing Cookie implementation intact.
- Modify `src/settings.ts`
  - Add `WereadDataSource` type, defaults, migration-safe validation, and store actions.
- Modify `src/settingTab.ts`
  - Add data source selector.
  - Show Cookie login controls only in Cookie mode.
  - Show API Key controls and connection test only in official mode.
  - Let sync book selector auth guard work for either source.
- Modify `main.ts`
  - Verify Cookie only in Cookie mode.
  - Skip Cookie auto-refresh timers while official mode is active.

## Task 1: Add Official Response Normalizers and Tests

**Files:**
- Create: `src/wereadOfficialApi.ts`
- Create: `scripts/test-official-api-adapters.mjs`
- Modify: `package.json`

- [ ] **Step 1: Write the adapter test script first**

Create `scripts/test-official-api-adapters.mjs` with:

```js
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';

const repoRoot = path.resolve(new URL('..', import.meta.url).pathname);
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
assert.deepEqual(reviews.removed, []);

const highlights = normalizeOfficialHighlightResponse({
	updated: [{ bookmarkId: 'b1', bookId: '1', chapterUid: 10, markText: '划线', createTime: 1, range: '1-2' }]
});
assert.equal(highlights.updated[0].type, 1);
assert.equal(highlights.updated[0].style, 0);
assert.deepEqual(highlights.removed, []);

console.log('official API adapter tests passed');
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```powershell
node scripts/test-official-api-adapters.mjs
```

Expected: FAIL with an error that `src/wereadOfficialApi.ts` cannot be found or exported normalizer functions are missing.

- [ ] **Step 3: Add `src/wereadOfficialApi.ts` with normalizers and provider skeleton**

Create `src/wereadOfficialApi.ts` with these exports:

```ts
import { Notice, requestUrl, RequestUrlParam } from 'obsidian';
import { get } from 'svelte/store';
import { settingsStore } from './settings';
import type {
	BookDetailResponse,
	BookProgressResponse,
	BookReviewResponse,
	Chapter,
	ChapterResponse,
	HighlightResponse
} from './models';

export const OFFICIAL_WEREAD_SKILL_VERSION = '1.0.3';
const OFFICIAL_WEREAD_GATEWAY_URL = 'https://i.weread.qq.com/api/agent/gateway';
const OFFICIAL_NOTEBOOK_PAGE_SIZE = 100;
const OFFICIAL_REVIEW_PAGE_SIZE = 200;

type OfficialGatewayParams = Record<string, string | number | boolean | object[] | undefined>;

export type OfficialUpgradeInfo = {
	message?: string;
	[key: string]: unknown;
};

export class OfficialWereadApiError extends Error {
	status?: number;
	errcode?: number;
	upgradeInfo?: OfficialUpgradeInfo;

	constructor(message: string, options: { status?: number; errcode?: number; upgradeInfo?: OfficialUpgradeInfo } = {}) {
		super(message);
		this.name = 'OfficialWereadApiError';
		this.status = options.status;
		this.errcode = options.errcode;
		this.upgradeInfo = options.upgradeInfo;
	}
}

export const normalizeOfficialBookInfo = (resp: any): BookDetailResponse => {
	return {
		...resp,
		totalWords: resp?.totalWords ?? resp?.wordCount ?? 0,
		newRating: resp?.newRating ?? 0
	} as BookDetailResponse;
};

const normalizeChapter = (chapter: any, fallbackUpdateTime: number): Chapter => {
	return {
		...chapter,
		updateTime: chapter?.updateTime ?? fallbackUpdateTime ?? 0,
		isMPChapter: chapter?.isMPChapter ?? 0,
		level: chapter?.level ?? 1
	};
};

export const normalizeOfficialChapterInfo = (resp: any): ChapterResponse => {
	const chapterUpdateTime = resp?.chapterUpdateTime ?? 0;
	return {
		data: [
			{
				bookId: resp?.bookId ?? '',
				chapterUpdateTime,
				updated: (resp?.chapters ?? []).map((chapter: any) =>
					normalizeChapter(chapter, chapterUpdateTime)
				)
			}
		]
	};
};

export const normalizeOfficialProgress = (resp: any): BookProgressResponse => {
	const book = resp?.book ?? {};
	const progress = book.progress ?? 0;
	return {
		...resp,
		bookId: resp?.bookId ?? book.bookId ?? '',
		book: {
			...book,
			readingTime: book.readingTime ?? book.recordReadingTime ?? 0,
			startReadingTime: book.startReadingTime ?? book.updateTime ?? 0,
			finishTime: progress === 100 ? book.finishTime ?? 0 : 0,
			progress
		},
		timestamp: resp?.timestamp ?? 0
	} as BookProgressResponse;
};

export const normalizeOfficialReviewResponse = (resp: any): BookReviewResponse => {
	return {
		...resp,
		synckey: resp?.synckey ?? 0,
		totalCount: resp?.totalCount ?? (resp?.reviews ?? []).length,
		reviews: (resp?.reviews ?? []).map((item: any) => (item?.review ? item : { review: item })),
		removed: resp?.removed ?? [],
		atUsers: resp?.atUsers ?? [],
		refUsers: resp?.refUsers ?? [],
		columns: resp?.columns ?? [],
		hasMore: resp?.hasMore ?? 0
	} as BookReviewResponse;
};

export const normalizeOfficialHighlightResponse = (resp: any): HighlightResponse => {
	return {
		...resp,
		synckey: resp?.synckey ?? 0,
		updated: (resp?.updated ?? []).map((item: any) => ({
			...item,
			style: item?.style ?? 0,
			colorStyle: item?.colorStyle ?? 0,
			type: item?.type ?? 1
		})),
		removed: resp?.removed ?? [],
		chapters: resp?.chapters ?? []
	} as HighlightResponse;
};

export default class OfficialWereadProvider {
	private async requestGateway<T>(apiName: string, params: OfficialGatewayParams = {}): Promise<T> {
		const settings = get(settingsStore);
		const apiKey = (settings.wereadApiKey ?? '').trim();
		const skillVersion = settings.officialSkillVersion || OFFICIAL_WEREAD_SKILL_VERSION;
		if (!apiKey) {
			settingsStore.actions.setIsOfficialApiValid(false);
			throw new OfficialWereadApiError('请先在设置中填写微信读书官方 API Key');
		}

		const req: RequestUrlParam = {
			url: OFFICIAL_WEREAD_GATEWAY_URL,
			method: 'POST',
			headers: {
				Authorization: `Bearer ${apiKey}`,
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({
				api_name: apiName,
				skill_version: skillVersion,
				...params
			})
		};

		try {
			const resp = await requestUrl(req);
			const data: any = resp.json ?? {};
			this.assertGatewayResponse(apiName, data, resp.status);
			settingsStore.actions.setIsOfficialApiValid(true);
			return data as T;
		} catch (error: any) {
			if (error instanceof OfficialWereadApiError) {
				throw error;
			}
			if (error?.status === 401 || error?.status === 403) {
				settingsStore.actions.setIsOfficialApiValid(false);
				throw new OfficialWereadApiError('微信读书官方 API Key 无效或权限不足', {
					status: error.status
				});
			}
			throw new OfficialWereadApiError(`微信读书官方 API 请求失败：${apiName}`, {
				status: error?.status
			});
		}
	}

	private assertGatewayResponse(apiName: string, data: any, status?: number): void {
		if (data?.upgrade_info) {
			const message = data.upgrade_info.message || '微信读书官方 skill 需要升级';
			throw new OfficialWereadApiError(message, { status, upgradeInfo: data.upgrade_info });
		}
		if (data?.errcode && data.errcode !== 0) {
			if (status === 401 || status === 403 || data.errcode === 401 || data.errcode === 403) {
				settingsStore.actions.setIsOfficialApiValid(false);
			}
			throw new OfficialWereadApiError(
				data.errmsg || `微信读书官方 API 返回错误：${apiName}`,
				{ status, errcode: data.errcode }
			);
		}
	}

	async verifyApiKey(): Promise<boolean> {
		try {
			await this.requestGateway('/user/notebooks', { count: 1 });
			settingsStore.actions.setIsOfficialApiValid(true);
			return true;
		} catch (error) {
			settingsStore.actions.setIsOfficialApiValid(false);
			const message = error instanceof Error ? error.message : '微信读书官方 API 验证失败';
			new Notice(message);
			return false;
		}
	}

	async getNotebooksWithRetry(): Promise<any[]> {
		const books: any[] = [];
		let lastSort: number | undefined;
		while (true) {
			const resp: any = await this.requestGateway('/user/notebooks', {
				count: OFFICIAL_NOTEBOOK_PAGE_SIZE,
				lastSort
			});
			const batch = resp.books ?? [];
			books.push(...batch);
			if (resp.hasMore !== 1 || batch.length === 0) {
				return books;
			}
			lastSort = batch[batch.length - 1]?.sort;
			if (lastSort === undefined) {
				return books;
			}
		}
	}

	async getBook(bookId: string): Promise<BookDetailResponse> {
		const resp = await this.requestGateway('/book/info', { bookId });
		return normalizeOfficialBookInfo(resp);
	}

	async getNotebookHighlights(bookId: string): Promise<HighlightResponse> {
		const resp = await this.requestGateway('/book/bookmarklist', { bookId });
		return normalizeOfficialHighlightResponse(resp);
	}

	async getNotebookReviews(bookId: string): Promise<BookReviewResponse> {
		const resp = await this.requestGateway('/review/list/mine', {
			bookid: bookId,
			count: OFFICIAL_REVIEW_PAGE_SIZE,
			synckey: 0
		});
		return normalizeOfficialReviewResponse(resp);
	}

	async getChapters(bookId: string): Promise<ChapterResponse> {
		const resp = await this.requestGateway('/book/chapterinfo', { bookId });
		return normalizeOfficialChapterInfo(resp);
	}

	async getProgress(bookId: string): Promise<BookProgressResponse> {
		const resp = await this.requestGateway('/book/getprogress', { bookId });
		return normalizeOfficialProgress(resp);
	}
}
```

- [ ] **Step 4: Add the npm script**

In `package.json`, add this script beside `build`:

```json
"test:official-api": "node scripts/test-official-api-adapters.mjs"
```

- [ ] **Step 5: Run adapter tests**

Run:

```powershell
npm run test:official-api
```

Expected: PASS and output contains `official API adapter tests passed`.

- [ ] **Step 6: Commit Task 1**

Run:

```powershell
git add package.json scripts/test-official-api-adapters.mjs src/wereadOfficialApi.ts
git commit -m "feat: add official weread API adapters"
```

## Task 2: Route ApiManager to Cookie or Official Provider

**Files:**
- Modify: `src/api.ts`

- [ ] **Step 1: Import the official provider**

At the top of `src/api.ts`, add:

```ts
import OfficialWereadProvider from './wereadOfficialApi';
```

- [ ] **Step 2: Add provider state and source helper**

Inside `ApiManager`, near `readonly baseUrl`, add:

```ts
	private readonly officialProvider = new OfficialWereadProvider();

	private useOfficialDataSource(): boolean {
		return get(settingsStore).dataSource === 'official';
	}

	async verifyOfficialApiKey(): Promise<boolean> {
		return this.officialProvider.verifyApiKey();
	}
```

- [ ] **Step 3: Delegate public methods when official source is active**

Add an official guard at the top of each existing public method:

```ts
	async getNotebooksWithRetry() {
		if (this.useOfficialDataSource()) {
			return this.officialProvider.getNotebooksWithRetry();
		}
		// existing Cookie implementation remains below
	}

	async getNotebooks() {
		if (this.useOfficialDataSource()) {
			return this.officialProvider.getNotebooksWithRetry();
		}
		// existing Cookie implementation remains below
	}

	async getBook(bookId: string): Promise<BookDetailResponse | undefined> {
		if (this.useOfficialDataSource()) {
			return this.officialProvider.getBook(bookId);
		}
		// existing Cookie implementation remains below
	}

	async getNotebookHighlights(bookId: string): Promise<HighlightResponse | undefined> {
		if (this.useOfficialDataSource()) {
			return this.officialProvider.getNotebookHighlights(bookId);
		}
		// existing Cookie implementation remains below
	}

	async getNotebookReviews(bookId: string): Promise<BookReviewResponse | undefined> {
		if (this.useOfficialDataSource()) {
			return this.officialProvider.getNotebookReviews(bookId);
		}
		// existing Cookie implementation remains below
	}

	async getChapters(bookId: string): Promise<ChapterResponse | undefined> {
		if (this.useOfficialDataSource()) {
			return this.officialProvider.getChapters(bookId);
		}
		// existing Cookie implementation remains below
	}

	async getProgress(bookId: string): Promise<BookProgressResponse | undefined> {
		if (this.useOfficialDataSource()) {
			return this.officialProvider.getProgress(bookId);
		}
		// existing Cookie implementation remains below
	}
```

- [ ] **Step 4: Run adapter tests and type check**

Run:

```powershell
npm run test:official-api
npx svelte-check
```

Expected:
- Adapter test prints `official API adapter tests passed`.
- `svelte-check` exits 0. The existing warning about no `.svelte` input files can remain.

- [ ] **Step 5: Commit Task 2**

Run:

```powershell
git add src/api.ts
git commit -m "feat: route api manager by weread data source"
```

## Task 3: Add Settings State and UI

**Files:**
- Modify: `src/settings.ts`
- Modify: `src/settingTab.ts`

- [ ] **Step 1: Extend settings types and defaults**

In `src/settings.ts`, add:

```ts
export type WereadDataSource = 'cookie' | 'official';
```

Add fields to `WereadPluginSettings`:

```ts
	dataSource: WereadDataSource;
	wereadApiKey: string;
	isOfficialApiValid: boolean;
	officialSkillVersion: string;
```

Add defaults:

```ts
	dataSource: 'cookie',
	wereadApiKey: '',
	isOfficialApiValid: false,
	officialSkillVersion: '1.0.3',
```

After the `settings` object is built in `initialise`, normalize invalid values:

```ts
		if (settings.dataSource !== 'cookie' && settings.dataSource !== 'official') {
			settings.dataSource = 'cookie';
		}
		if (!settings.officialSkillVersion) {
			settings.officialSkillVersion = '1.0.3';
		}
```

- [ ] **Step 2: Add settings actions**

In `src/settings.ts`, add these action functions:

```ts
	const setDataSource = (dataSource: WereadDataSource) => {
		store.update((state) => {
			state.dataSource = dataSource;
			return state;
		});
	};

	const setWereadApiKey = (wereadApiKey: string) => {
		store.update((state) => {
			state.wereadApiKey = wereadApiKey;
			state.isOfficialApiValid = false;
			return state;
		});
	};

	const setIsOfficialApiValid = (valid: boolean) => {
		store.update((state) => {
			state.isOfficialApiValid = valid;
			return state;
		});
	};

	const setOfficialSkillVersion = (officialSkillVersion: string) => {
		store.update((state) => {
			state.officialSkillVersion = officialSkillVersion.trim() || '1.0.3';
			return state;
		});
	};
```

Expose those four functions in `settingsStore.actions`.

- [ ] **Step 3: Import the new data source type in settings UI**

Change the `src/settingTab.ts` settings type import to include `WereadDataSource`:

```ts
import type {
	ReadingOpenMode,
	SyncMode,
	BookshelfSortMode,
	BookOpenMode,
	WereadDataSource
} from './settings';
```

- [ ] **Step 4: Add data source UI methods**

In `WereadSettingsTab`, add:

```ts
	private showDataSourceSettings(): void {
		const settings = get(settingsStore);
		new Setting(this.containerEl)
			.setName('数据源')
			.setDesc('选择同步时使用现有 Cookie 通路，还是官方 API Key 通路')
			.addDropdown((dropdown) => {
				return dropdown
					.addOption('cookie', 'Cookie（现有方式）')
					.addOption('official', '官方 API Key')
					.setValue(settings.dataSource ?? 'cookie')
					.onChange((value) => {
						settingsStore.actions.setDataSource(value as WereadDataSource);
						this.selectableBooksCache = [];
						this.selectableBooksLoadingPromise = null;
						this.plugin.setupCookieRefresh();
						this.display();
					});
			});
	}

	private showOfficialApiSettings(): void {
		const settings = get(settingsStore);
		const hasKey = Boolean(settings.wereadApiKey?.trim());
		const statusText = settings.isOfficialApiValid
			? '✅ 官方 API Key 已验证'
			: hasKey
			? '⚠️ 官方 API Key 尚未验证'
			: '❌ 未填写官方 API Key';

		new Setting(this.containerEl).setName('官方 API 状态').setDesc(statusText);

		new Setting(this.containerEl)
			.setName('官方 API Key')
			.setDesc('用于调用微信读书 Agent API Gateway；仅保存在当前 dev 插件配置中')
			.addText((text) => {
				text.inputEl.type = 'password';
				return text
					.setPlaceholder('wrk-')
					.setValue(settings.wereadApiKey ?? '')
					.onChange((value) => {
						settingsStore.actions.setWereadApiKey(value.trim());
					});
			})
			.addButton((button) => {
				return button.setButtonText('验证连接').onClick(async () => {
					const apiManager = new ApiManager();
					const ok = await apiManager.verifyOfficialApiKey();
					new Notice(ok ? '官方 API Key 验证成功' : '官方 API Key 验证失败');
					this.display();
				});
			})
			.addButton((button) => {
				return button.setButtonText('清空').onClick(() => {
					settingsStore.actions.setWereadApiKey('');
					settingsStore.actions.setIsOfficialApiValid(false);
					this.display();
				});
			});
	}
```

- [ ] **Step 5: Update `display()` to show the right auth controls**

In `display()`, after the heading and before login controls, call:

```ts
		this.showDataSourceSettings();
		const dataSource = get(settingsStore).dataSource ?? 'cookie';
```

Wrap existing Cookie login/status/refresh controls in:

```ts
		if (dataSource === 'official') {
			this.showOfficialApiSettings();
		} else {
			// existing desktop login method, login/logout, CookieCloud, Cookie status,
			// Cookie auto-refresh and Cookie interval calls stay in this block
		}
```

The block contents are the current login method, login/logout, `showCookieStatus`, `cookieAutoRefresh`, and `cookieRefreshInterval` calls.

- [ ] **Step 6: Update selectable book auth guard**

In `fetchSelectableBooks()`, replace the Cookie-only guard with:

```ts
		if (settings.dataSource === 'official') {
			if (!settings.wereadApiKey?.trim()) {
				throw new Error('请先填写微信读书官方 API Key 后再加载书籍列表');
			}
		} else if (!settings.isCookieValid || settings.cookies.length === 0) {
			throw new Error('请先登录微信读书后再加载书籍列表');
		}
```

- [ ] **Step 7: Run verification**

Run:

```powershell
npm run test:official-api
npx svelte-check
```

Expected:
- Adapter test passes.
- `svelte-check` exits 0 with only the existing no-Svelte-input warning.

- [ ] **Step 8: Commit Task 3**

Run:

```powershell
git add src/settings.ts src/settingTab.ts
git commit -m "feat: add official weread API settings"
```

## Task 4: Adjust Plugin Lifecycle for Data Source Separation

**Files:**
- Modify: `main.ts`

- [ ] **Step 1: Only verify Cookie in Cookie mode**

In `initializePlugin()`, replace:

```ts
		if (settings.cookies && settings.cookies.length > 0) {
```

with:

```ts
		if (settings.dataSource !== 'official' && settings.cookies && settings.cookies.length > 0) {
```

- [ ] **Step 2: Skip Cookie auto-refresh in official mode**

At the start of `setupCookieRefresh()`, after `this.clearCookieRefreshTimer();`, add:

```ts
		if (get(settingsStore).dataSource === 'official') {
			return;
		}
```

- [ ] **Step 3: Run verification**

Run:

```powershell
npm run test:official-api
npx svelte-check
npx webpack
```

Expected:
- Adapter test passes.
- `svelte-check` exits 0 with only the existing no-Svelte-input warning.
- `webpack` exits 0 and may emit bundle size warnings only.

- [ ] **Step 4: Commit Task 4**

Run:

```powershell
git add main.ts
git commit -m "feat: isolate cookie lifecycle from official source"
```

## Task 5: Final Review, Docs Check, and Push

**Files:**
- Review all changed files.

- [ ] **Step 1: Inspect git status and diff**

Run:

```powershell
git status --short --branch
git diff --stat origin/feat/official-skill-integration..HEAD
git diff --check
```

Expected:
- Only intended source, script, package, and plan files are changed relative to the previous remote state.
- `git diff --check` exits 0.

- [ ] **Step 2: Run final verification**

Run:

```powershell
npm run test:official-api
npx svelte-check
npx webpack
```

Expected:
- Adapter test passes.
- `svelte-check` exits 0 with only the existing no-Svelte-input warning.
- `webpack` exits 0.

- [ ] **Step 3: Confirm no secrets are tracked**

Run:

```powershell
git ls-files | rg "data\\.json|\\.bak$"
rg -n "wr_[a-zA-Z0-9_]+=|WEREAD_API_KEY|Bearer [A-Za-z0-9._-]+|wrk-" --glob '!node_modules/**'
```

Expected:
- No tracked `data.json` or `.bak` files.
- Secret scan only finds documentation or code examples such as `wrk-`; no real Cookie or API Key values appear.

- [ ] **Step 4: Push**

Run:

```powershell
git push
```

Expected: remote `feat/official-skill-integration` advances to the final implementation commit.
