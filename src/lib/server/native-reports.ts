import { getPool } from '#lib/server/db/db.js';

export type NativeReportSubmission = {
	id: string;
	appId: string;
	authorId: string;
	verdict: 'yes' | 'no';
	protonVersion?: string | null;
	protonVariant?: string | null;
	customProtonVersion?: string | null;
	launchOptions?: string | null;
	performanceNotes?: string | null;
	knownIssues?: string | null;
	content: string;
};

export class SelectedDeviceNotFoundError extends Error {}

/** Read the owner's device and write its hardware snapshot under the same per-user lock. */
export async function insertNativeReportForDevice(
	report: NativeReportSubmission,
	deviceId: string
): Promise<void> {
	const pool = getPool();
	const client = await pool.connect();
	try {
		await client.query('BEGIN');
		await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [report.authorId]);
		const { rows } = await client.query<{
			name: string;
			device_type: 'steam_deck' | 'linux_desktop';
			cpu: string | null;
			gpu: string | null;
			gpu_vendor: string | null;
			ram: string | null;
			distribution: string | null;
			kernel: string | null;
			graphics_driver: string | null;
			gpu_driver_detail: string | null;
		}>(
			`SELECT name, device_type, cpu, gpu, gpu_vendor, ram, distribution, kernel,
				graphics_driver, gpu_driver_detail
			 FROM public.user_devices
			 WHERE id = $1 AND user_id = $2 AND source_verified_at IS NOT NULL
				AND device_type IN ('linux_desktop', 'steam_deck')
			 LIMIT 1`,
			[deviceId, report.authorId]
		);
		const device = rows[0];
		if (!device) throw new SelectedDeviceNotFoundError();
		await client.query(
			`INSERT INTO public.native_reports (
				id, app_id, author_id, verdict, platform, proton_version, proton_variant,
				custom_proton_version, distribution, kernel, cpu, gpu, gpu_vendor,
				graphics_driver, ram, launch_options, performance_notes, known_issues, content,
				gpu_driver_detail, device_id, device_name_snapshot
			) VALUES (
				$1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
				$16, $17, $18, $19, $20, $21, $22
			)`,
			[
				report.id,
				report.appId,
				report.authorId,
				report.verdict,
				device.device_type,
				report.protonVersion ?? null,
				report.protonVariant ?? null,
				report.customProtonVersion ?? null,
				device.distribution,
				device.kernel,
				device.cpu,
				device.gpu,
				device.gpu_vendor,
				device.graphics_driver,
				device.ram,
				report.launchOptions ?? null,
				report.performanceNotes ?? null,
				report.knownIssues ?? null,
				report.content,
				device.gpu_driver_detail,
				deviceId,
				device.name
			]
		);
		await client.query('COMMIT');
	} catch (cause) {
		await client.query('ROLLBACK').catch(() => undefined);
		throw cause;
	} finally {
		client.release();
	}
}
