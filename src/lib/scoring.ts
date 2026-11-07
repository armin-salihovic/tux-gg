export const TIERS = ['platinum', 'gold', 'silver', 'bronze', 'borked', 'unknown'] as const;
export type CompatibilityTier = (typeof TIERS)[number];
export const MIN_TOTAL_WEIGHT = 3 - 1e-6;
export const MIN_EFFECTIVE_SAMPLE_SIZE = 3 - 1e-6;

export const TIER_LABELS: Record<CompatibilityTier, string> = {
	platinum: 'Platinum',
	gold: 'Gold',
	silver: 'Silver',
	bronze: 'Bronze',
	borked: 'Borked',
	unknown: 'Unknown'
};

export interface ScoringReport {
	verdict: 'yes' | 'no';
	createdAt: Date;
	publishedAt?: Date | null;
}

export interface CompatibilityScore {
	tier: CompatibilityTier;
	weightedScore: number | null;
	effectiveSampleSize: number;
	totalWeight: number;
}

export function tierForEvidence(
	weightedScore: number | null,
	totalWeight: number,
	effectiveSampleSize: number
): CompatibilityTier {
	if (
		weightedScore === null ||
		totalWeight < MIN_TOTAL_WEIGHT ||
		effectiveSampleSize < MIN_EFFECTIVE_SAMPLE_SIZE
	) {
		return 'unknown';
	}
	if (weightedScore >= 0.95) return 'platinum';
	if (weightedScore >= 0.8) return 'gold';
	if (weightedScore >= 0.6) return 'silver';
	if (weightedScore >= 0.3) return 'bronze';
	return 'borked';
}

export function recencyWeight(publishedAt: Date | null | undefined, now = new Date()): number {
	if (!publishedAt || Number.isNaN(publishedAt.getTime())) return 0;
	const ageDays = Math.max(0, (now.getTime() - publishedAt.getTime()) / 86_400_000);
	return 2 ** (-ageDays / 365);
}

export function scoreCompatibility(
	reports: readonly ScoringReport[],
	now = new Date()
): CompatibilityScore {
	let weightedYes = 0;
	let totalWeight = 0;
	let squaredWeight = 0;
	for (const report of reports) {
		const weight = recencyWeight(report.publishedAt ?? report.createdAt, now);
		if (!weight) continue;
		totalWeight += weight;
		squaredWeight += weight * weight;
		if (report.verdict === 'yes') weightedYes += weight;
	}
	const weightedScore = totalWeight > 0 ? weightedYes / totalWeight : null;
	const effectiveSampleSize = squaredWeight > 0 ? (totalWeight * totalWeight) / squaredWeight : 0;
	return {
		tier: tierForEvidence(weightedScore, totalWeight, effectiveSampleSize),
		weightedScore,
		effectiveSampleSize,
		totalWeight
	};
}
