import { afterAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { parseSteamSystemInfo } from '#lib/steam-system-info.js';
import { closeDatabase, getPool } from '#lib/server/db/db.js';
import { authUser } from '#lib/server/db/schema.js';
import { getDb } from '#lib/server/db/db.js';
import {
	createUserDevice,
	deleteUserDevice,
	DeviceNotFoundError,
	getUserDevice,
	listUserDevices,
	setDefaultUserDevice,
	updateUserDevice,
	DeviceLimitError,
	listEligibleUserDevices
} from './user-devices.js';

const enabled = process.env.NATIVE_REPORT_INTEGRATION_TESTS === '1';
const databaseUrl = process.env.DATABASE_URL;

describe.skipIf(!enabled)('saved device PostgreSQL integration', () => {
	it('scopes device operations to the owner and keeps one default across concurrent changes', async () => {
		if (!databaseUrl || new URL(databaseUrl).pathname.replace(/^\//, '') !== 'tuxgg_test') {
			throw new Error('Device integration tests require DATABASE_URL to target tuxgg_test.');
		}
		const pool = getPool();
		const identity = await pool.query('SELECT current_database(), current_user');
		expect(identity.rows[0]).toEqual({ current_database: 'tuxgg_test', current_user: 'tuxgg_web' });
		const marker = await pool.query(
			'SELECT marker FROM public.tuxgg_test_safety_marker WHERE id = 1'
		);
		expect(marker.rows[0]?.marker).toBe('tuxgg_disposable_test_database_v1');

		const suffix = randomUUID();
		const userId = `device-${suffix}`;
		const otherId = `device-other-${suffix}`;
		await getDb()
			.insert(authUser)
			.values([
				{
					id: userId,
					name: 'Device owner',
					email: `${suffix}@device.invalid`,
					username: `device-${suffix.slice(0, 18)}`
				},
				{
					id: otherId,
					name: 'Other owner',
					email: `other-${suffix}@device.invalid`,
					username: `other-${suffix.slice(0, 18)}`
				}
			]);
		const systemInfo = `Computer Information:\nManufacturer: Gigabyte\nModel: B850M\nProcessor Information:\nCPU Brand: AMD Ryzen 7 9800X3D 8-Core Processor\nOperating System:\nCachyOS\nKernel Name: Linux\nKernel Version: 7.3\nVideo Card:\nDriver: AMD AMD Radeon RX 9070 XT (radeonsi)\nDriver Version: Mesa 26.2.6-arch3.1\nMemory:\nRAM: 31188 Mb`;
		const parsed = parseSteamSystemInfo(systemInfo);
		if (!parsed.ok) throw new Error('The test Steam fixture must be supported.');
		const base = parsed.value;
		const firstId = await createUserDevice(userId, 'Gaming PC', base);
		const [secondId, thirdId] = await Promise.all([
			createUserDevice(userId, 'Gaming Laptop', base),
			createUserDevice(userId, 'Living Room PC', base)
		]);
		const devices = await listUserDevices(userId);
		expect(devices).toHaveLength(3);
		expect(devices.filter((device) => device.isDefault)).toHaveLength(1);
		expect(await listUserDevices(otherId)).toEqual([]);
		expect(await getUserDevice(otherId, firstId)).toBeUndefined();
		await expect(
			updateUserDevice(otherId, firstId, 'Changed by another user')
		).rejects.toBeInstanceOf(DeviceNotFoundError);
		await expect(setDefaultUserDevice(otherId, firstId)).rejects.toBeInstanceOf(
			DeviceNotFoundError
		);
		await expect(deleteUserDevice(otherId, firstId)).rejects.toBeInstanceOf(DeviceNotFoundError);

		await setDefaultUserDevice(userId, secondId);
		expect(
			(await listUserDevices(userId))
				.filter((device) => device.isDefault)
				.map((device) => device.id)
		).toEqual([secondId]);
		const refreshed = parseSteamSystemInfo(
			systemInfo.replace('RX 9070 XT', 'RX 10070 XT').replace('Ryzen 7 9800X3D', 'Ryzen 9 9900X')
		);
		if (!refreshed.ok) throw new Error('The refreshed Steam fixture must be supported.');
		await updateUserDevice(userId, firstId, 'Updated Gaming PC', refreshed.value);
		expect(await getUserDevice(userId, firstId)).toMatchObject({
			name: 'Updated Gaming PC',
			gpu: 'AMD Radeon RX 10070 XT',
			cpu: 'AMD Ryzen 9 9900X',
			sourceVerifiedAt: expect.any(Date)
		});

		await deleteUserDevice(userId, secondId);
		const afterDelete = await listUserDevices(userId);
		expect(afterDelete).toHaveLength(2);
		expect(afterDelete.find((device) => device.isDefault)?.id).toBe(firstId);
		expect(afterDelete.some((device) => device.id === thirdId)).toBe(true);

		const privileges = await pool.query(
			`SELECT has_table_privilege(current_user, 'public.user_devices', 'SELECT') AS can_select,
				has_table_privilege(current_user, 'public.user_devices', 'INSERT') AS can_insert,
				has_table_privilege(current_user, 'public.user_devices', 'UPDATE') AS can_update,
				has_table_privilege(current_user, 'public.user_devices', 'DELETE') AS can_delete`
		);
		expect(privileges.rows[0]).toEqual({
			can_select: true,
			can_insert: true,
			can_update: true,
			can_delete: true
		});

		for (let index = 0; index < 10; index++) {
			await createUserDevice(otherId, `Gaming system ${index + 1}`, base);
		}
		await expect(createUserDevice(otherId, 'Eleventh system', base)).rejects.toBeInstanceOf(
			DeviceLimitError
		);
		const legacyId = randomUUID();
		await pool.query(
			`INSERT INTO public.user_devices (id, user_id, name, device_type, cpu, gpu, is_default)
			 VALUES ($1, $2, 'Old manual device', 'linux_desktop', 'Old manual CPU', 'Old manual GPU', false)`,
			[legacyId, otherId]
		);
		expect((await listEligibleUserDevices(otherId)).map((device) => device.id)).toHaveLength(10);
		expect(await getUserDevice(otherId, legacyId)).toMatchObject({
			cpu: 'Old manual CPU',
			sourceVerifiedAt: null
		});
	});

	afterAll(async () => {
		await closeDatabase();
	});
});
