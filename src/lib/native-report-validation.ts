import { z } from 'zod';

const optionalText = (max: number) =>
	z.preprocess(
		(value) => (value === '' || value === null ? undefined : value),
		z.string().trim().max(max).optional()
	);

export const nativeReportSchema = z.object({
	id: z.uuid(),
	verdict: z.enum(['yes', 'no'], { error: 'Choose whether the game works.' }),
	deviceId: z.uuid({ error: 'Choose one of your saved devices.' }),
	content: z
		.string()
		.trim()
		.min(10, 'Describe your experience in at least 10 characters.')
		.max(5000, 'Keep your report under 5,000 characters.'),
	protonVersion: optionalText(100),
	protonVariant: optionalText(100),
	customProtonVersion: optionalText(100),
	launchOptions: optionalText(1000),
	performanceNotes: optionalText(2000),
	knownIssues: optionalText(2000)
});

export type NativeReportInput = z.infer<typeof nativeReportSchema>;

export const nativeReportLimits = {
	content: 5000,
	protonVersion: 100,
	protonVariant: 100,
	customProtonVersion: 100,
	launchOptions: 1000,
	performanceNotes: 2000,
	knownIssues: 2000
} as const;
