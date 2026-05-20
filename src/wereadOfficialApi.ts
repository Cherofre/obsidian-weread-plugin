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

	constructor(
		message: string,
		options: { status?: number; errcode?: number; upgradeInfo?: OfficialUpgradeInfo } = {}
	) {
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
			style: item?.style ?? 1,
			colorStyle: item?.colorStyle ?? 0,
			type: item?.type ?? 1
		})),
		removed: resp?.removed ?? [],
		chapters: resp?.chapters ?? []
	} as HighlightResponse;
};

const setOfficialApiValid = (valid: boolean) => {
	(settingsStore.actions as any).setIsOfficialApiValid?.(valid);
};

export default class OfficialWereadProvider {
	private async requestGateway<T>(
		apiName: string,
		params: OfficialGatewayParams = {}
	): Promise<T> {
		const settings = get(settingsStore) as any;
		const apiKey = (settings.wereadApiKey ?? '').trim();
		const skillVersion = settings.officialSkillVersion || OFFICIAL_WEREAD_SKILL_VERSION;
		if (!apiKey) {
			setOfficialApiValid(false);
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
			setOfficialApiValid(true);
			return data as T;
		} catch (error: any) {
			if (error instanceof OfficialWereadApiError) {
				throw error;
			}
			if (error?.status === 401 || error?.status === 403) {
				setOfficialApiValid(false);
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
				setOfficialApiValid(false);
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
			setOfficialApiValid(true);
			return true;
		} catch (error) {
			setOfficialApiValid(false);
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
