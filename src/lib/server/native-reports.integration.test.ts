import { afterAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { parseSteamSystemInfo } from '#lib/steam-system-info.js';
import { canSubmitReports } from '#lib/server/authz.js';
import { getMyNativeReports, getPublishedNativeReports } from '#lib/server/db/queries.js';
import { closeDatabase, getDb, getPool } from '#lib/server/db/db.js';
import { authAccount, authUser, games, nativeReports } from '#lib/server/db/schema.js';
import { insertNativeReportForDevice, SelectedDeviceNotFoundError } from './native-reports.js';
import { createUserDevice, deleteUserDevice, updateUserDevice } from './user-devices.js';

const enabled = process.env.NATIVE_REPORT_INTEGRATION_TESTS === '1';
const databaseUrl = process.env.DATABASE_URL;

describe.skipIf(!enabled)('native report PostgreSQL integration', () => {
	it('requires a verified owner device and keeps its report hardware snapshot immutable', async () => {
		if (!databaseUrl || new URL(databaseUrl).pathname.replace(/^\//, '') !== 'tuxgg_test') {
			throw new Error('Native report integration tests require DATABASE_URL to target tuxgg_test.');
		}
		const pool = getPool();
		const identity = await pool.query('SELECT current_database(), current_user');
		if (identity.rows[0]?.current_database !== 'tuxgg_test') {
			throw new Error('Native report integration tests refused a database other than tuxgg_test.');
		}
		expect(identity.rows[0]?.current_user).toBe('tuxgg_web');
		const marker = await pool.query(
			' SELECT marker FROM public.tuxgg_test_safety_marker WHERE id = 1'
		);
		expect(marker.rows[0]?.marker).toBe('tuxgg_disposable_test_database_v1');
		const [game] = await getDb()
			.select({ appId: games.appId })
			.from(games)
			.where(eq(games.appId, '440'));
		expect(game).toBeTruthy();

		const suffix = randomUUID();
		const userId = `native-report-${suffix}`;
		const username = `report-${suffix.slice(0, 18)}`;
		await getDb()
			.insert(authUser)
			.values({
				id: userId,
				name: 'Native report test user',
				email: `${suffix}@steam.invalid`,
				username
			});
		expect(await canSubmitReports(userId)).toBe(false);
		await getDb()
			.insert(authAccount)
			.values({
				id: `native-report-account-${suffix}`,
				accountId: `7656119${String(Date.now()).slice(-10)}`,
				providerId: 'steam',
				userId
			});
		expect(await canSubmitReports(userId)).toBe(true);

		const systemInfo = `Computer Information:\nManufacturer: Gigabyte\nModel: B850M\nProcessor Information:\nCPU Brand: AMD Ryzen 7 9800X3D 8-Core Processor\nOperating System:\nCachyOS\nKernel Name: Linux\nKernel Version: 7.3\nVideo Card:\nDriver: AMD AMD Radeon RX 9070 XT (radeonsi)\nDriver Version: Mesa 26.2.6-arch3.1\nMemory:\nRAM: 31188 Mb`;
		const initialHardware = parseSteamSystemInfo(systemInfo);
		if (!initialHardware.ok) throw new Error('The test Steam fixture must be supported.');
		const deviceId = await createUserDevice(userId, 'Main Gaming PC', initialHardware.value);
		const reportId = randomUUID();
		const submission = {
			id: reportId,
			appId: '440',
			authorId: userId,
			verdict: 'yes' as const,
			content: 'A pending report from the database integration test.'
		};
		await insertNativeReportForDevice(submission, deviceId);
		const [saved] = await getDb()
			.select({
				moderationState: nativeReports.moderationState,
				platform: nativeReports.platform,
				deviceId: nativeReports.deviceId,
				deviceName: nativeReports.deviceNameSnapshot,
				cpu: nativeReports.cpu,
				gpu: nativeReports.gpu,
				ram: nativeReports.ram
			})
			.from(nativeReports)
			.where(eq(nativeReports.id, reportId));
		expect(saved).toEqual({
			moderationState: 'pending',
			platform: 'linux_desktop',
			deviceId,
			deviceName: 'Main Gaming PC',
			cpu: 'AMD Ryzen 7 9800X3D',
			gpu: 'AMD Radeon RX 9070 XT',
			ram: '30.5 GiB'
		});
		expect((await getMyNativeReports(userId)).reports.map((row) => row.id)).toContain(reportId);
		expect((await getMyNativeReports('another-user')).reports.map((row) => row.id)).not.toContain(
			reportId
		);
		expect((await getPublishedNativeReports('440')).reports.map((row) => row.id)).not.toContain(
			reportId
		);

		const steamDeck = parseSteamSystemInfo(
			'Computer Information:\nManufacturer: Valve\nModel: Galileo\nOperating System:\nSteamOS Holo (64 bit)\nProcessor Information:\nCPU Brand: AMD Custom APU 0406\nVideo Card:\nDriver: AMD AMD Custom GPU 0406 (RADV VANGOGH)\nMemory:\nRAM: 16384 Mb'
		);
		if (!steamDeck.ok) throw new Error('The test Steam Deck fixture must be supported.');
		const steamDeckId = await createUserDevice(userId, 'Steam Deck OLED', steamDeck.value);
		const steamDeckReportId = randomUUID();
		await insertNativeReportForDevice(
			{
				...submission,
				id: steamDeckReportId,
				content: 'A report from a verified Steam Deck.'
			},
			steamDeckId
		);
		expect(
			(
				await getDb()
					.select({
						platform: nativeReports.platform,
						deviceName: nativeReports.deviceNameSnapshot
					})
					.from(nativeReports)
					.where(eq(nativeReports.id, steamDeckReportId))
			)[0]
		).toEqual({ platform: 'steam_deck', deviceName: 'Steam Deck OLED' });

		const unverifiedDeviceId = randomUUID();
		await pool.query(
			`INSERT INTO public.user_devices (id, user_id, name, device_type, cpu, gpu)
			 VALUES ($1, $2, 'Legacy manual device', 'linux_desktop', 'Forged CPU', 'Forged GPU')`,
			[unverifiedDeviceId, userId]
		);
		await expect(
			insertNativeReportForDevice(
				{ ...submission, id: randomUUID(), content: 'A report from an unverified legacy device.' },
				unverifiedDeviceId
			)
		).rejects.toBeInstanceOf(SelectedDeviceNotFoundError);
		await pool.query('DELETE FROM public.user_devices WHERE id = $1', [unverifiedDeviceId]);
		await expect(
			insertNativeReportForDevice(
				{ ...submission, content: 'Duplicate browser request.' },
				deviceId
			)
		).rejects.toMatchObject({ code: '23505' });

		const refreshedHardware = parseSteamSystemInfo(
			systemInfo.replace('Ryzen 7 9800X3D', 'Ryzen 9 9900X').replace('RX 9070 XT', 'RX 10070 XT')
		);
		if (!refreshedHardware.ok) throw new Error('The refreshed Steam fixture must be supported.');
		await updateUserDevice(userId, deviceId, 'Upgraded PC', refreshedHardware.value);
		expect(
			(
				await getDb()
					.select({ gpu: nativeReports.gpu, deviceName: nativeReports.deviceNameSnapshot })
					.from(nativeReports)
					.where(eq(nativeReports.id, reportId))
			)[0]
		).toEqual({ gpu: 'AMD Radeon RX 9070 XT', deviceName: 'Main Gaming PC' });

		const otherUserId = `other-report-${randomUUID()}`;
		const otherSuffix = randomUUID();
		await getDb()
			.insert(authUser)
			.values({
				id: otherUserId,
				name: 'Other device owner',
				email: `${otherSuffix}@steam.invalid`,
				username: `other-${otherSuffix.slice(0, 18)}`
			});
		const otherDeviceId = await createUserDevice(otherUserId, 'Private PC', initialHardware.value);
		await expect(
			insertNativeReportForDevice(
				{ ...submission, id: randomUUID(), content: 'Cannot use another account device.' },
				otherDeviceId
			)
		).rejects.toBeInstanceOf(SelectedDeviceNotFoundError);
		await deleteUserDevice(userId, deviceId);
		expect(
			(
				await getDb()
					.select({
						deviceId: nativeReports.deviceId,
						deviceName: nativeReports.deviceNameSnapshot,
						gpu: nativeReports.gpu
					})
					.from(nativeReports)
					.where(eq(nativeReports.id, reportId))
			)[0]
		).toEqual({ deviceId: null, deviceName: 'Main Gaming PC', gpu: 'AMD Radeon RX 9070 XT' });

		await expect(
			pool.query(
				'INSERT INTO public.native_reports (id, app_id, author_id, verdict, platform, content, moderation_state) ' +
					"VALUES ($1, '440', $2, 'yes', 'linux_desktop', 'Attempt to set moderation.', 'published')",
				[randomUUID(), userId]
			)
		).rejects.toMatchObject({ code: '42501' });
		await expect(
			pool.query(
				'INSERT INTO public.native_reports (id, app_id, author_id, verdict, platform, content, published_at) ' +
					"VALUES ($1, '440', $2, 'yes', 'linux_desktop', 'Attempt to publish.', now())",
				[randomUUID(), userId]
			)
		).rejects.toMatchObject({ code: '42501' });
		await expect(
			pool.query('UPDATE public.native_reports SET moderation_state = $1 WHERE id = $2', [
				'published',
				reportId
			])
		).rejects.toMatchObject({ code: '42501' });
		await expect(
			pool.query('DELETE FROM public.native_reports WHERE id = $1', [reportId])
		).rejects.toMatchObject({ code: '42501' });
	});

	afterAll(async () => {
		await closeDatabase();
	});
});
