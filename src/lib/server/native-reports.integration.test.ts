import { afterAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { parseSteamSystemInfo } from '#lib/steam-system-info.js';
import { canSubmitReports } from '#lib/server/authz.js';
import {
	getHomeData,
	getCatalog,
	getGameById,
	getMyNativeReports,
	getNativeReportFilters,
	getProfile,
	getPublicNativeReports
} from '#lib/server/db/queries.js';
import { closeDatabase, getDb, getPool } from '#lib/server/db/db.js';
import { authAccount, authUser, games, nativeReports } from '#lib/server/db/schema.js';
import { insertNativeReportForDevice, SelectedDeviceNotFoundError } from './native-reports.js';
import { createUserDevice, deleteUserDevice, updateUserDevice } from './user-devices.js';

const enabled = process.env.NATIVE_REPORT_INTEGRATION_TESTS === '1';
const testDatabase = process.env.DB_DATABASE;

describe.skipIf(!enabled)('native report PostgreSQL integration', () => {
	it('requires a verified owner device and keeps its report hardware snapshot immutable', async () => {
		if (testDatabase !== 'vapourdb_test' || process.env.VAPOURDB_TEST_DATABASE !== '1') {
			throw new Error(
				'Native report integration tests require the explicitly marked vapourdb_test database.'
			);
		}
		const pool = getPool();
		const identity = await pool.query('SELECT current_database(), current_user');
		if (identity.rows[0]?.current_database !== 'vapourdb_test') {
			throw new Error(
				'Native report integration tests refused a database other than vapourdb_test.'
			);
		}
		expect(identity.rows[0]?.current_user).toBe(process.env.DB_USERNAME);
		const marker = await pool.query(
			' SELECT marker FROM public.vapourdb_test_safety_marker WHERE id = 1'
		);
		expect(marker.rows[0]?.marker).toBe('vapourdb_disposable_test_database_v1');
		const [game] = await getDb()
			.select({ appId: games.appId })
			.from(games)
			.where(eq(games.appId, '440'));
		expect(game).toBeTruthy();
		const gameBefore = await getGameById('440');
		const homeBefore = await getHomeData();

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
			protonVersion: 'GE-Proton 9-20',
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
		expect((await getMyNativeReports(userId)).reports).toContainEqual(
			expect.objectContaining({ id: reportId, isPublic: true })
		);
		expect((await getMyNativeReports('another-user')).reports.map((row) => row.id)).not.toContain(
			reportId
		);
		const publicReport = await getPublicNativeReports('440', { page: 1, verdict: 'yes' });
		expect(publicReport.reports.map((row) => row.id)).toContain(reportId);
		expect(publicReport.reports.find((row) => row.id === reportId)).toMatchObject({
			authorUsername: username,
			content: submission.content,
			createdAt: expect.any(Date)
		});
		expect(await getGameById('440')).toMatchObject({
			reportCount: (gameBefore?.reportCount ?? 0) + 1,
			yesCount: (gameBefore?.yesCount ?? 0) + 1
		});
		expect(
			(await getCatalog({ q: '440', sort: 'reports', page: 1 })).games.find(
				(row) => row.appId === '440'
			)
		).toMatchObject({ reportCount: (gameBefore?.reportCount ?? 0) + 1 });
		expect((await getHomeData()).totalReports).toBe(homeBefore.totalReports + 1);
		expect(await getProfile(username)).toMatchObject({ contributionCount: 1 });
		expect(await getNativeReportFilters('440')).toMatchObject({
			gpuVendors: expect.arrayContaining(['AMD']),
			distributions: expect.arrayContaining(['CachyOS']),
			proton: expect.arrayContaining([{ value: 'version:GE-Proton 9-20', label: 'GE-Proton 9-20' }])
		});
		expect(
			(
				await getPublicNativeReports('440', {
					page: 1,
					gpuVendor: 'AMD',
					distribution: 'CachyOS',
					proton: 'version:GE-Proton 9-20',
					verdict: 'yes',
					since: new Date('2000-01-01T00:00:00.000Z'),
					until: new Date('2099-01-01T00:00:00.000Z')
				})
			).reports.map((row) => row.id)
		).toContain(reportId);

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
	});

	it('recalculates public tiers as reports move through moderation states', async () => {
		if (testDatabase !== 'vapourdb_test' || process.env.VAPOURDB_TEST_DATABASE !== '1') {
			throw new Error(
				'Scoring integration tests require the explicitly marked vapourdb_test database.'
			);
		}
		const operator = getPool();
		const identity = await operator.query('SELECT current_database(), current_user');
		expect(identity.rows[0]?.current_database).toBe('vapourdb_test');
		expect(identity.rows[0]?.current_user).toBe(process.env.DB_USERNAME);
		const appId = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
		const userId = `score-${randomUUID()}`;
		const reportIds = [randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID()];
		const homeBefore = await getHomeData();
		try {
			await operator.query('INSERT INTO public.games (app_id, title, slug) VALUES ($1, $2, $3)', [
				appId,
				`Scoring fixture ${appId}`,
				`scoring-fixture-${appId}`
			]);
			await operator.query(
				'INSERT INTO public.user (id, name, email, username) VALUES ($1, $2, $3, $4)',
				[userId, 'Scoring fixture', `${userId}@score.invalid`, `score-${appId}`]
			);
			for (const [index, id] of reportIds.entries()) {
				await operator.query(
					`INSERT INTO public.native_reports
					 (id, app_id, author_id, verdict, content, moderation_state, created_at, published_at,
					  gpu_vendor, distribution, proton_version)
					 VALUES ($1, $2, $3, $4, 'Scoring fixture report', $5,
					         CASE WHEN $7 THEN now() - interval '365 days' ELSE now() END, $6, $8, $9, $10)`,
					[
						id,
						appId,
						userId,
						index === 3 ? 'no' : 'yes',
						index >= 2 ? 'pending' : 'published',
						index >= 2 ? null : new Date(),
						index === 3,
						index === 4 ? 'Intel' : index === 2 ? 'NVIDIA' : 'AMD',
						index === 4 ? 'Pending Distro' : index === 2 ? 'Removed Distro' : 'Scoring Distro',
						index === 4 ? 'Pending Proton' : index === 2 ? 'Removed Proton' : 'Scoring Proton'
					]
				);
			}
			const pendingScore = await getGameById(appId);
			expect(pendingScore).toMatchObject({ reportCount: 5, yesCount: 4, noCount: 1, tier: 'gold' });
			expect((await getHomeData()).totalReports).toBe(homeBefore.totalReports + 5);
			expect(await getProfile(`score-${appId}`)).toMatchObject({ contributionCount: 5 });
			expect((await getPublicNativeReports(appId, { page: 1 })).reports).toHaveLength(5);
			expect(await getPublicNativeReports(appId, { page: 1, pageSize: 2 })).toMatchObject({
				total: 5,
				pageCount: 3
			});
			const pendingFilter = await getPublicNativeReports(appId, {
				page: 1,
				gpuVendor: 'Intel',
				distribution: 'Pending Distro',
				proton: 'version:Pending Proton',
				verdict: 'yes',
				since: new Date('2000-01-01T00:00:00.000Z'),
				until: new Date('2099-01-01T00:00:00.000Z')
			});
			expect(pendingFilter.reports.map((row) => row.id)).toEqual([reportIds[4]]);
			expect(await getNativeReportFilters(appId)).toMatchObject({
				gpuVendors: expect.arrayContaining(['Intel']),
				distributions: expect.arrayContaining(['Pending Distro']),
				proton: expect.arrayContaining([
					{ value: 'version:Pending Proton', label: 'Pending Proton' }
				])
			});
			const pendingFilters = await getPublicNativeReports(appId, { page: 1, verdict: 'no' });
			expect(pendingFilters.reports.map((row) => row.id)).toContain(reportIds[3]);
			await operator.query(
				"UPDATE public.native_reports SET moderation_state = 'published', published_at = now() WHERE id = $1",
				[reportIds[3]]
			);
			const approvedScore = await getGameById(appId);
			expect(pendingScore?.weightedScore).toEqual(expect.any(Number));
			expect(approvedScore?.weightedScore).toEqual(expect.any(Number));
			expect(pendingScore?.total_weight).toEqual(expect.any(Number));
			expect(approvedScore?.total_weight).toEqual(expect.any(Number));
			expect(approvedScore).toMatchObject({
				reportCount: pendingScore?.reportCount,
				tier: pendingScore?.tier
			});
			expect(approvedScore!.weightedScore!).toBeCloseTo(pendingScore!.weightedScore!, 6);
			expect(approvedScore!.total_weight!).toBeCloseTo(pendingScore!.total_weight!, 6);
			expect((await getPublicNativeReports(appId, { page: 1 })).reports.at(-1)?.id).toBe(
				reportIds[3]
			);
			await operator.query(
				"UPDATE public.native_reports SET moderation_state = 'hidden', published_at = NULL WHERE id = $1",
				[reportIds[4]]
			);
			expect(await getGameById(appId)).toMatchObject({
				reportCount: 4,
				yesCount: 3,
				noCount: 1,
				tier: 'gold'
			});
			expect((await getHomeData()).totalReports).toBe(homeBefore.totalReports + 4);
			expect(await getProfile(`score-${appId}`)).toMatchObject({ contributionCount: 4 });
			expect(
				(await getPublicNativeReports(appId, { page: 1 })).reports.map((row) => row.id)
			).not.toContain(reportIds[4]);
			expect((await getMyNativeReports(userId)).reports).toContainEqual(
				expect.objectContaining({ id: reportIds[4], isPublic: false })
			);
			expect(
				await getPublicNativeReports(appId, {
					page: 1,
					gpuVendor: 'Intel',
					distribution: 'Pending Distro',
					proton: 'version:Pending Proton',
					verdict: 'yes'
				})
			).toMatchObject({ total: 0, reports: [] });
			const remainingFilters = await getNativeReportFilters(appId);
			expect(remainingFilters.gpuVendors).not.toContain('Intel');
			expect(remainingFilters.distributions).not.toContain('Pending Distro');
			expect(remainingFilters.proton).not.toContainEqual({
				value: 'version:Pending Proton',
				label: 'Pending Proton'
			});
			expect(await getPublicNativeReports(appId, { page: 1, pageSize: 2 })).toMatchObject({
				total: 4,
				pageCount: 2
			});
			await operator.query(
				"UPDATE public.native_reports SET moderation_state = 'hidden', published_at = NULL WHERE id = $1",
				[reportIds[0]]
			);
			expect(await getGameById(appId)).toMatchObject({
				reportCount: 3,
				yesCount: 2,
				noCount: 1,
				tier: 'unknown'
			});
			expect((await getHomeData()).totalReports).toBe(homeBefore.totalReports + 3);
			expect(
				(await getPublicNativeReports(appId, { page: 1 })).reports.map((row) => row.id)
			).not.toContain(reportIds[0]);
			await operator.query(
				"UPDATE public.native_reports SET moderation_state = 'removed', published_at = NULL WHERE id = $1",
				[reportIds[1]]
			);
			expect(await getGameById(appId)).toMatchObject({
				reportCount: 2,
				yesCount: 1,
				noCount: 1,
				tier: 'unknown'
			});
			expect((await getHomeData()).totalReports).toBe(homeBefore.totalReports + 2);
			expect(
				(await getPublicNativeReports(appId, { page: 1 })).reports.map((row) => row.id)
			).not.toContain(reportIds[1]);
			expect((await getMyNativeReports(userId)).reports).toContainEqual(
				expect.objectContaining({ id: reportIds[1], isPublic: false })
			);
			await operator.query(
				"UPDATE public.native_reports SET moderation_state = 'removed', published_at = NULL WHERE id = $1",
				[reportIds[2]]
			);
			expect(await getGameById(appId)).toMatchObject({
				reportCount: 1,
				yesCount: 0,
				noCount: 1,
				tier: 'unknown'
			});
			expect((await getHomeData()).totalReports).toBe(homeBefore.totalReports + 1);
			expect((await getMyNativeReports(userId)).reports).toContainEqual(
				expect.objectContaining({ id: reportIds[2], isPublic: false })
			);
			expect(await getProfile(`score-${appId}`)).toMatchObject({ contributionCount: 1 });
			const finalFilters = await getNativeReportFilters(appId);
			expect(finalFilters.gpuVendors).not.toContain('NVIDIA');
			expect(finalFilters.distributions).not.toContain('Removed Distro');
			expect(finalFilters.proton).not.toContainEqual({
				value: 'version:Removed Proton',
				label: 'Removed Proton'
			});
			const finalPublicPage = await getPublicNativeReports(appId, { page: 1, pageSize: 2 });
			expect(finalPublicPage).toMatchObject({ total: 1, pageCount: 1 });
			expect(finalPublicPage.reports.map((row) => row.id)).toEqual([reportIds[3]]);
		} finally {
			await operator.query('DELETE FROM public.games WHERE app_id = $1', [appId]);
			await operator.query('DELETE FROM public.user WHERE id = $1', [userId]);
		}
	});

	afterAll(async () => {
		await closeDatabase();
	});
});
