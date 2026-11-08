export const DATABASE_IDENTITIES = Object.freeze({
	vapourdb: Object.freeze({
		application: 'vapourdb',
		test: 'vapourdb_test',
		roles: Object.freeze({
			web: 'vapourdb_web',
			importer: 'vapourdb_importer',
			migrator: 'vapourdb_migrator'
		}),
		markerTable: 'vapourdb_test_safety_marker',
		markerValue: 'vapourdb_disposable_test_database_v1'
	}),
	tuxgg: Object.freeze({
		application: 'tuxgg',
		test: 'tuxgg_test',
		roles: Object.freeze({
			web: 'tuxgg_web',
			importer: 'tuxgg_importer',
			migrator: 'tuxgg_migrator'
		}),
		markerTable: 'tuxgg_test_safety_marker',
		markerValue: 'tuxgg_disposable_test_database_v1'
	})
});

export function identityForDatabase(database) {
	return Object.values(DATABASE_IDENTITIES).find(
		(identity) => identity.application === database || identity.test === database
	);
}

export function testIdentityForDatabase(database) {
	return Object.values(DATABASE_IDENTITIES).find((identity) => identity.test === database);
}

export function isLocalHostname(hostname) {
	return ['localhost', '127.0.0.1', '::1'].includes(hostname.toLowerCase());
}
