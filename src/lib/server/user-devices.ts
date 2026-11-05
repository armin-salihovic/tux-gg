import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq } from 'drizzle-orm';
import type { PoolClient } from 'pg';
import { getDb, getPool } from '#lib/server/db/db.js';
import { userDevices } from '#lib/server/db/schema.js';
import type { UserDeviceInput } from '#lib/server/user-device-validation.js';
import { MAX_USER_DEVICES } from '#lib/device-limits.js';

export { MAX_USER_DEVICES };

export type UserDevice = typeof userDevices.$inferSelect;

export class DeviceLimitError extends Error {}
export class DeviceNotFoundError extends Error {}

async function withUserLock<T>(
	userId: string,
	callback: (client: PoolClient) => Promise<T>
): Promise<T> {
	const client = await getPool().connect();
	try {
		await client.query('BEGIN');
		await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [userId]);
		const result = await callback(client);
		await client.query('COMMIT');
		return result;
	} catch (cause) {
		await client.query('ROLLBACK').catch(() => undefined);
		throw cause;
	} finally {
		client.release();
	}
}

export async function listUserDevices(userId: string): Promise<UserDevice[]> {
	return getDb()
		.select()
		.from(userDevices)
		.where(eq(userDevices.userId, userId))
		.orderBy(desc(userDevices.isDefault), asc(userDevices.createdAt));
}

export async function getUserDevice(userId: string, id: string): Promise<UserDevice | undefined> {
	const [device] = await getDb()
		.select()
		.from(userDevices)
		.where(and(eq(userDevices.userId, userId), eq(userDevices.id, id)))
		.limit(1);
	return device;
}

export async function createUserDevice(userId: string, input: UserDeviceInput): Promise<string> {
	return withUserLock(userId, async (client) => {
		const { rows } = await client.query<{ count: number; has_default: boolean }>(
			'SELECT count(*)::int AS count, bool_or(is_default) AS has_default FROM public.user_devices WHERE user_id = $1',
			[userId]
		);
		if ((rows[0]?.count ?? 0) >= MAX_USER_DEVICES) throw new DeviceLimitError();
		const id = randomUUID();
		const isDefault = !(rows[0]?.has_default ?? false);
		await client.query(
			`INSERT INTO public.user_devices (
				id, user_id, name, device_type, cpu, gpu, gpu_vendor, ram,
				distribution, kernel, graphics_driver, gpu_driver_detail, is_default
			) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
			[
				id,
				userId,
				input.name,
				input.deviceType,
				input.cpu,
				input.gpu,
				input.gpuVendor,
				input.ram,
				input.distribution,
				input.kernel,
				input.graphicsDriver,
				input.gpuDriverDetail,
				isDefault
			]
		);
		return id;
	});
}

export async function updateUserDevice(
	userId: string,
	id: string,
	input: UserDeviceInput
): Promise<void> {
	await withUserLock(userId, async (client) => {
		const result = await client.query(
			`UPDATE public.user_devices SET
				name = $3, device_type = $4, cpu = $5, gpu = $6, gpu_vendor = $7,
				ram = $8, distribution = $9, kernel = $10, graphics_driver = $11,
				gpu_driver_detail = $12, updated_at = now()
			WHERE id = $1 AND user_id = $2`,
			[
				id,
				userId,
				input.name,
				input.deviceType,
				input.cpu,
				input.gpu,
				input.gpuVendor,
				input.ram,
				input.distribution,
				input.kernel,
				input.graphicsDriver,
				input.gpuDriverDetail
			]
		);
		if (result.rowCount !== 1) throw new DeviceNotFoundError();
	});
}

export async function setDefaultUserDevice(userId: string, id: string): Promise<void> {
	await withUserLock(userId, async (client) => {
		const target = await client.query(
			'SELECT id FROM public.user_devices WHERE id = $1 AND user_id = $2',
			[id, userId]
		);
		if (!target.rowCount) throw new DeviceNotFoundError();
		await client.query(
			'UPDATE public.user_devices SET is_default = false WHERE user_id = $1 AND is_default',
			[userId]
		);
		await client.query(
			'UPDATE public.user_devices SET is_default = true, updated_at = now() WHERE id = $1 AND user_id = $2',
			[id, userId]
		);
	});
}

export async function deleteUserDevice(userId: string, id: string): Promise<void> {
	await withUserLock(userId, async (client) => {
		const result = await client.query<{ was_default: boolean }>(
			'DELETE FROM public.user_devices WHERE id = $1 AND user_id = $2 RETURNING is_default AS was_default',
			[id, userId]
		);
		if (!result.rowCount) throw new DeviceNotFoundError();
		if (result.rows[0]?.was_default) {
			await client.query(
				`UPDATE public.user_devices SET is_default = true, updated_at = now()
				 WHERE id = (
					SELECT id FROM public.user_devices WHERE user_id = $1 ORDER BY created_at, id LIMIT 1
				 )`,
				[userId]
			);
		}
	});
}
