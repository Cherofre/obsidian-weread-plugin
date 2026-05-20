import type { WereadPluginSettings } from '../settings';

export type WereadAuthState = {
	ready: boolean;
	kind: 'cookie' | 'official';
	title: string;
	description: string;
	actionText: string;
};

export const getWereadAuthState = (settings: Partial<WereadPluginSettings>): WereadAuthState => {
	if (settings.dataSource === 'official') {
		const hasApiKey = Boolean(settings.wereadApiKey?.trim());
		return {
			ready: hasApiKey,
			kind: 'official',
			title: hasApiKey ? '官方 API Key 已配置' : '请先配置官方 API Key',
			description: hasApiKey
				? '正在使用微信读书官方 API Key 读取数据'
				: '请在设置中填写并验证微信读书官方 API Key 后开始使用',
			actionText: '打开设置'
		};
	}

	const cookieCount = settings.cookies?.length ?? 0;
	const isCookieReady = Boolean(settings.isCookieValid && cookieCount > 0);
	return {
		ready: isCookieReady,
		kind: 'cookie',
		title: isCookieReady ? 'Cookie 已登录' : '请先登录',
		description: isCookieReady ? '正在使用 Cookie 读取数据' : '请在设置中登录后开始使用',
		actionText: '前往登录'
	};
};

export const getWereadAuthStateKey = (settings: Partial<WereadPluginSettings>): string => {
	if (settings.dataSource === 'official') {
		const keyState = settings.wereadApiKey?.trim() ? 'has-key' : 'missing-key';
		const validityState = settings.isOfficialApiValid ? 'valid' : 'invalid';
		return `official:${keyState}:${validityState}`;
	}
	return `cookie:${settings.isCookieValid ? 'valid' : 'invalid'}:${settings.cookies?.length ?? 0}`;
};
