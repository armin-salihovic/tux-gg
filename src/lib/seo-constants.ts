export const MIN_INDEXABLE_REPORTS = 3;

export function isIndexableGame(reportCount: number, title: string | null | undefined): boolean {
	return (
		Number.isInteger(reportCount) && reportCount >= MIN_INDEXABLE_REPORTS && Boolean(title?.trim())
	);
}
