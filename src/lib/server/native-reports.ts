import type { NativeReportInput } from '#lib/native-report-validation.js';
import { getPool } from '#lib/server/db/db.js';

type NativeReportSubmission = NativeReportInput & {
	appId: string;
	authorId: string;
};

/** Insert only client-approved fields; moderation state and timestamps use database defaults. */
export async function insertNativeReport(report: NativeReportSubmission): Promise<void> {
	await getPool().query(
		`INSERT INTO public.native_reports (
			id, app_id, author_id, verdict, platform, proton_version, proton_variant,
			custom_proton_version, distribution, kernel, cpu, gpu, gpu_vendor,
			graphics_driver, ram, launch_options, performance_notes, known_issues, content
		) VALUES (
			$1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19
		)`,
		[
			report.id,
			report.appId,
			report.authorId,
			report.verdict,
			report.platform,
			report.protonVersion ?? null,
			report.protonVariant ?? null,
			report.customProtonVersion ?? null,
			report.distribution ?? null,
			report.kernel ?? null,
			report.cpu ?? null,
			report.gpu ?? null,
			report.gpuVendor ?? null,
			report.graphicsDriver ?? null,
			report.ram ?? null,
			report.launchOptions ?? null,
			report.performanceNotes ?? null,
			report.knownIssues ?? null,
			report.content
		]
	);
}
