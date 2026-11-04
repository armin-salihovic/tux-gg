export const TIERS = ['platinum', 'gold', 'silver', 'bronze', 'borked', 'unknown'] as const;
export type CompatibilityTier = (typeof TIERS)[number];

export const TIER_LABELS: Record<CompatibilityTier, string> = {
	platinum: 'Platinum',
	gold: 'Gold',
	silver: 'Silver',
	bronze: 'Bronze',
	borked: 'Borked',
	unknown: 'Unknown'
};

export function tierForEvidence(
	weightedScore: number | null,
	totalWeight: number,
	effectiveSampleSize: number
): CompatibilityTier {
	if (weightedScore === null || totalWeight < 3 || effectiveSampleSize < 3) return 'unknown';
	if (weightedScore >= 0.95) return 'platinum';
	if (weightedScore >= 0.8) return 'gold';
	if (weightedScore >= 0.6) return 'silver';
	if (weightedScore >= 0.3) return 'bronze';
	return 'borked';
}

export function scoreSignal(verdict: string | null, legacyRating: string | null): number | null {
	if (verdict?.toLowerCase() === 'yes') return 1;
	if (verdict?.toLowerCase() === 'no') return 0;
	const rating = legacyRating?.toLowerCase();
	if (rating === 'platinum') return 1;
	if (rating === 'gold') return 0.8;
	if (rating === 'silver') return 0.6;
	if (rating === 'bronze') return 0.35;
	if (rating === 'borked') return 0;
	return null;
}

export function recencyWeight(submittedAt: Date | null, now = new Date()): number {
	if (!submittedAt || Number.isNaN(submittedAt.getTime())) return 0;
	const ageDays = Math.max(0, (now.getTime() - submittedAt.getTime()) / 86_400_000);
	return 2 ** (-ageDays / 365);
}
