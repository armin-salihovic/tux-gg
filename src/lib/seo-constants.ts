export const MIN_INDEXABLE_DESCRIPTION_LENGTH = 50;

export function isIndexableGame(title: string | null | undefined, metadata: unknown): boolean {
	if (!title?.trim() || !metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
		return false;
	}
	const steam = (metadata as Record<string, unknown>).steam;
	if (!steam || typeof steam !== 'object' || Array.isArray(steam)) return false;
	const shortDescription = (steam as Record<string, unknown>).shortDescription;
	return (
		typeof shortDescription === 'string' &&
		shortDescription.trim().length >= MIN_INDEXABLE_DESCRIPTION_LENGTH
	);
}
