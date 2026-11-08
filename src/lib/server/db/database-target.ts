export const TEST_DATABASE_MARKER_TABLE = 'vapourdb_test_safety_marker';
export const TEST_DATABASE_MARKER_VALUE = 'vapourdb_disposable_test_database_v1';

export type RuntimeDatabaseTarget = {
	database: 'vapourdb' | 'vapourdb_test';
	requiresTestMarker: boolean;
};

export class DatabaseTargetIdentityError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'DatabaseTargetIdentityError';
	}
}

export function validateRuntimeDatabaseTarget(
	database: string | undefined,
	env: NodeJS.ProcessEnv = process.env
): RuntimeDatabaseTarget {
	if (database === 'vapourdb') return { database, requiresTestMarker: false };
	if (
		database === 'vapourdb_test' &&
		env.GITHUB_ACTIONS === 'true' &&
		env.VAPOURDB_TEST_DATABASE === '1'
	) {
		return { database, requiresTestMarker: true };
	}
	throw new Error('The web runtime requires DB_DATABASE=vapourdb.');
}

type DatabaseQuery = (query: string) => Promise<{ rows: Array<Record<string, unknown>> }>;

export async function verifyRuntimeDatabaseIdentity(
	query: DatabaseQuery,
	target: RuntimeDatabaseTarget
): Promise<void> {
	const result = await query('SELECT current_database() AS database');
	if (result.rows[0]?.database !== target.database) {
		throw new DatabaseTargetIdentityError(
			'Connected database identity does not match DB_DATABASE.'
		);
	}
	if (target.requiresTestMarker) {
		let markerResult: { rows: Array<Record<string, unknown>> };
		try {
			markerResult = await query(
				`SELECT marker FROM public.${TEST_DATABASE_MARKER_TABLE} WHERE id = 1`
			);
		} catch {
			throw new DatabaseTargetIdentityError(
				'Refusing vapourdb_test because its disposable safety marker could not be verified.'
			);
		}
		if (markerResult.rows[0]?.marker !== TEST_DATABASE_MARKER_VALUE) {
			throw new DatabaseTargetIdentityError(
				'Refusing vapourdb_test because its disposable safety marker is invalid.'
			);
		}
	}
}
