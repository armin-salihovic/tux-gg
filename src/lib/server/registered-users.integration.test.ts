import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { getPool, closeDatabase, getDb } from '#lib/server/db/db.js';
import { authAccount, authUser, nativeReports } from '#lib/server/db/schema.js';
import { ADMIN_STEAM_IDS } from './admin-access.js';
import type { RegisteredUsersPage } from './registered-users.js';
import { load } from '../../routes/settings/users/+page.server.js';

const enabled = process.env.AUTH_INTEGRATION_TESTS === '1';
const testDatabase = process.env.DB_DATABASE;
const runId = randomUUID().replaceAll('-', '');
const fixturePrefix = `registered-users-${runId}`;
const fixtureUsernamePrefix = `regusers${runId.slice(0, 10)}`;
const initialAdminSteamId = ADMIN_STEAM_IDS[0]!;
const nonAdminSteamId = `7656119${String(Date.now()).slice(-10)}`;
const fixtureDate = new Date(Date.now() + 86_400_000);
const fixtureUsers = Array.from({ length: 26 }, (_, index) => {
	const suffix = String(index).padStart(2, '0');
	return {
		id: `${fixturePrefix}-${suffix}`,
		name: `Fixture user ${suffix}`,
		username: `${fixtureUsernamePrefix}${suffix}`
	};
});
const createdUserIds: string[] = [];
let adminUserId: string | undefined;
let testGameId: string | undefined;
let nonOwnerUserId: string | undefined;
let reportIds: string[] = [];

function makeEvent(
	userId: string | null,
	url = 'https://vapourdb.test/settings/users'
): Parameters<typeof load>[0] {
	return {
		locals: {
			user: userId ? { id: userId } : null,
			session: userId ? { id: `session-${userId}` } : null
		},
		url: new URL(url),
		setHeaders() {}
	} as unknown as Parameters<typeof load>[0];
}

async function loadUsersPage(event: Parameters<typeof load>[0]): Promise<RegisteredUsersPage> {
	const data = await load(event);
	if (!data) throw new Error('The registered-users page loader returned no data.');
	return data as RegisteredUsersPage;
}

describe.skipIf(!enabled)('private registered-users page against the marked test database', () => {
	beforeAll(async () => {
		if (testDatabase !== 'vapourdb_test' || process.env.VAPOURDB_TEST_DATABASE !== '1') {
			throw new Error(
				'Registered-users integration tests require the explicitly marked vapourdb_test database.'
			);
		}
		const pool = getPool();
		const identity = await pool.query('SELECT current_database() AS database');
		if (identity.rows[0]?.database !== 'vapourdb_test') {
			throw new Error(
				'Registered-users integration tests refused a database other than vapourdb_test.'
			);
		}
		const marker = await pool.query(
			' SELECT marker FROM public.vapourdb_test_safety_marker WHERE id = 1'
		);
		if (marker.rows[0]?.marker !== 'vapourdb_disposable_test_database_v1') {
			throw new Error('Registered-users integration tests require the disposable database marker.');
		}

		const existingOwner = await pool.query<{ user_id: string }>(
			"SELECT user_id FROM public.account WHERE provider_id = 'steam' AND account_id = $1 LIMIT 1",
			[initialAdminSteamId]
		);
		adminUserId = existingOwner.rows[0]?.user_id;
		if (!adminUserId) {
			adminUserId = `${fixturePrefix}-admin`;
			createdUserIds.push(adminUserId);
			await getDb()
				.insert(authUser)
				.values({
					id: adminUserId,
					name: 'Fixture owner with changed username',
					email: `${adminUserId}@steam.invalid`,
					username: `${fixtureUsernamePrefix}owner`,
					createdAt: new Date('2000-01-01T00:00:00.000Z')
				});
			await getDb()
				.insert(authAccount)
				.values({
					id: `${adminUserId}-account`,
					accountId: initialAdminSteamId,
					providerId: 'steam',
					userId: adminUserId
				});
		}

		nonOwnerUserId = `${fixturePrefix}-non-owner`;
		createdUserIds.push(nonOwnerUserId);
		await getDb()
			.insert(authUser)
			.values({
				id: nonOwnerUserId,
				name: 'Fixture non-owner',
				email: `${nonOwnerUserId}@steam.invalid`,
				username: `${fixtureUsernamePrefix}nonowner`
			});
		await getDb()
			.insert(authAccount)
			.values({
				id: `${nonOwnerUserId}-account`,
				accountId: nonAdminSteamId,
				providerId: 'steam',
				userId: nonOwnerUserId
			});

		await getDb()
			.insert(authUser)
			.values(
				fixtureUsers.map((user) => ({
					...user,
					email: `${user.id}@steam.invalid`,
					createdAt: fixtureDate,
					updatedAt: fixtureDate
				}))
			);
		createdUserIds.push(...fixtureUsers.map(({ id }) => id));
		const game = await pool.query<{ app_id: string }>(
			' SELECT app_id FROM public.games ORDER BY app_id LIMIT 1'
		);
		testGameId = game.rows[0]?.app_id;
		if (testGameId) {
			const states = ['pending', 'published', 'hidden', 'removed'] as const;
			const reports = states.map((moderationState) => ({
				id: randomUUID(),
				appId: testGameId!,
				authorId: fixtureUsers[25]!.id,
				verdict: 'yes',
				moderationState,
				content: `private-report-body-${runId}`
			}));
			reportIds = reports.map(({ id }) => id);
			await getDb().insert(nativeReports).values(reports);
		}
	});

	afterAll(async () => {
		if (testDatabase !== 'vapourdb_test' || process.env.VAPOURDB_TEST_DATABASE !== '1') return;
		const pool = getPool();
		if (reportIds.length) {
			await pool.query('DELETE FROM public.native_reports WHERE id = ANY($1::uuid[])', [reportIds]);
		}
		if (createdUserIds.length) {
			await pool.query('DELETE FROM public."user" WHERE id = ANY($1::text[])', [createdUserIds]);
		}
		await closeDatabase();
	});

	it('redirects guests and returns no data to non-admins despite request-supplied IDs', async () => {
		await expect(loadUsersPage(makeEvent(null))).rejects.toMatchObject({
			status: 303,
			location: '/login'
		});
		await expect(
			loadUsersPage(
				makeEvent(
					nonOwnerUserId!,
					`https://vapourdb.test/settings/users?page=1&steamId=${initialAdminSteamId}`
				)
			)
		).rejects.toMatchObject({ status: 404 });
	});

	it('authorizes the persisted allowlisted Steam link regardless of the VapourDB username', async () => {
		const data = await loadUsersPage(makeEvent(adminUserId!));
		expect(data.users.length).toBeGreaterThan(0);
		expect(data.totalUsers).toBeGreaterThanOrEqual(28);
		expect(JSON.stringify(data)).not.toContain(`${adminUserId}@steam.invalid`);
		expect(JSON.stringify(data)).not.toContain('accessToken');
		expect(JSON.stringify(data)).not.toContain('private-report-body');
	});

	it('returns stable 25-user pages, accurate totals, and all-state review counts', async (context) => {
		if (!testGameId) context.skip();
		const firstPage = await loadUsersPage(
			makeEvent(adminUserId!, 'https://vapourdb.test/settings/users?page=1')
		);
		const secondPage = await loadUsersPage(
			makeEvent(adminUserId!, 'https://vapourdb.test/settings/users?page=2')
		);
		const newestFixtureUsers = fixtureUsers
			.slice(1)
			.reverse()
			.map(({ username }) => username);
		expect(firstPage.users).toHaveLength(25);
		expect(firstPage.users.map(({ username }) => username)).toEqual(newestFixtureUsers);
		expect(secondPage.users[0]?.username).toBe(fixtureUsers[0]!.username);
		expect(
			new Set([...firstPage.users, ...secondPage.users].map(({ username }) => username)).size
		).toBe(firstPage.users.length + secondPage.users.length);
		expect(firstPage.totalUsers).toBe(secondPage.totalUsers);
		expect(firstPage.page).toBe(1);
		expect(secondPage.page).toBe(2);
		expect(firstPage.pageCount).toBe(Math.ceil(firstPage.totalUsers / 25));
		expect(
			firstPage.users.find(({ username }) => username === fixtureUsers[25]!.username)
				?.reviewsSubmitted
		).toBe(4);
		expect(
			firstPage.users.find(({ username }) => username === fixtureUsers[24]!.username)
				?.reviewsSubmitted
		).toBe(0);
	});

	it('normalizes invalid pages and clamps huge out-of-range values to the last page', async () => {
		const invalid = await loadUsersPage(
			makeEvent(adminUserId!, 'https://vapourdb.test/settings/users?page=-2')
		);
		const huge = await loadUsersPage(
			makeEvent(adminUserId!, 'https://vapourdb.test/settings/users?page=2147483647')
		);
		expect(invalid.page).toBe(1);
		expect(huge.page).toBe(huge.pageCount);
		expect(huge.page).toBeGreaterThanOrEqual(1);
	});
});
