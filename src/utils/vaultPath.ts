export const normalizeVaultFolder = (folderPath: string | undefined): string => {
	const normalized = (folderPath ?? '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
	return normalized === '' ? '/' : normalized;
};

export const isVaultPathInFolder = (filePath: string, folderPath: string | undefined): boolean => {
	const normalizedFolder = normalizeVaultFolder(folderPath);
	if (normalizedFolder === '/') {
		return true;
	}

	const normalizedFilePath = filePath.replace(/\\/g, '/').replace(/^\/+/, '');
	return (
		normalizedFilePath === normalizedFolder ||
		normalizedFilePath.startsWith(`${normalizedFolder}/`)
	);
};
