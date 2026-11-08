import { identityForDatabase, testIdentityForDatabase } from './database-identifiers.mjs';

export function parseInitializationArgs(args) {
	const options = { initializeEmpty: false, games: null };
	for (let index = 0; index < args.length; index += 1) {
		if (args[index] === '--initialize-empty') options.initializeEmpty = true;
		else if (args[index] === '--games') {
			options.games = args[++index];
			if (!options.games) throw new Error('--games requires a verified games backup CSV.');
		} else if (args[index] === '--force') {
			throw new Error(
				'--force is no longer accepted. Existing databases are never reset by this command.'
			);
		} else throw new Error(`Unknown option: ${args[index]}`);
	}
	if (!options.initializeEmpty)
		throw new Error(
			'Use --initialize-empty only for a verified local database with no application objects.'
		);
	return options;
}

export function requireDatabaseRoleUrl(raw, variable, role, allowTestDatabase = false) {
	if (!raw) throw new Error(`${variable} is required.`);
	const url = new URL(raw);
	if (!['postgres:', 'postgresql:'].includes(url.protocol))
		throw new Error(`${variable} must use PostgreSQL.`);
	const database = decodeURIComponent(url.pathname.slice(1));
	const identity = identityForDatabase(database);
	const testIdentity = testIdentityForDatabase(database);
	if (allowTestDatabase && !testIdentity)
		throw new Error(`${variable} must target a disposable test database.`);
	if (!allowTestDatabase && testIdentity)
		throw new Error(`${variable} must not target a disposable test database.`);
	const acceptedIdentity = allowTestDatabase
		? testIdentity
		: identity?.application === database
			? identity
			: null;
	const username = decodeURIComponent(url.username);
	const recognizedRole =
		allowTestDatabase && role === 'postgres'
			? username === 'postgres'
			: acceptedIdentity && Object.values(acceptedIdentity.roles).includes(username);
	if (!acceptedIdentity || !recognizedRole)
		throw new Error(`${variable} must use a recognized VapourDB or legacy TuxGG database role.`);
	if (username !== role) throw new Error(`${variable} must use the ${role} role.`);
	return { url, database, identity: testIdentity ?? identityForDatabase(database) };
}
