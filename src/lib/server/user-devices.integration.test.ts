import { afterAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
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
	updateUserDevice
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
		const base = {
			name: 'Gaming PC',
			deviceType: 'linux_desktop' as const,
			cpu: 'AMD Ryzen 7 9800X3D',
			gpu: 'AMD Radeon RX 9070 XT',
			gpuVendor: 'AMD' as const,
			ram: '30.5 GB',
			distribution: 'CachyOS',
			kernel: '7.3',
			graphicsDriver: 'Mesa 26.2.6-arch3.1',
			gpuDriverDetail: 'radeonsi'
		};
		const firstId = await createUserDevice(userId, base);
		const [secondId, thirdId] = await Promise.all([
			createUserDevice(userId, { ...base, name: 'Gaming Laptop' }),
			createUserDevice(userId, { ...base, name: 'Living Room PC' })
		]);
		const devices = await listUserDevices(userId);
		expect(devices).toHaveLength(3);
		expect(devices.filter((device) => device.isDefault)).toHaveLength(1);
		expect(await listUserDevices(otherId)).toEqual([]);
		expect(await getUserDevice(otherId, firstId)).toBeUndefined();
		await expect(
			updateUserDevice(otherId, firstId, { ...base, name: 'Changed by another user' })
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
		await updateUserDevice(userId, firstId, {
			...base,
			name: 'Updated Gaming PC',
			gpu: 'AMD Radeon RX 10070 XT'
		});
		expect(await getUserDevice(userId, firstId)).toMatchObject({
			name: 'Updated Gaming PC',
			gpu: 'AMD Radeon RX 10070 XT'
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
				has_table_privilege(current_user, 'public.user_devices', 'DELETE') AS can_delete,
				has_table_privilege(current_user, 'public.reports', 'INSERT') AS can_write_imported_reports,
				has_table_privilege(current_user, 'public.compatibility_summaries', 'UPDATE') AS can_edit_summaries`
		);
		expect(privileges.rows[0]).toEqual({
			can_select: true,
			can_insert: true,
			can_update: true,
			can_delete: true,
			can_write_imported_reports: false,
			can_edit_summaries: false
		});
	});

	afterAll(async () => {
		await closeDatabase();
	});
});
