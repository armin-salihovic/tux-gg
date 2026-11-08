export const DATABASE_IDENTITIES = Object.freeze({
	vapourdb: Object.freeze({
		application: 'vapourdb',
		test: 'vapourdb_test',
		markerTable: 'vapourdb_test_safety_marker',
		markerValue: 'vapourdb_disposable_test_database_v1'
	})
});

export function testIdentityForDatabase(database) {
	return Object.values(DATABASE_IDENTITIES).find((identity) => identity.test === database);
}
