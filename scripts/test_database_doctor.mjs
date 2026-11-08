#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

const secret = 'doctor-test-secret-must-not-leak';
function runDoctor(database, port, overrides = {}) {
	return spawnSync(process.execPath, ['scripts/db_doctor.mjs'], {
		encoding: 'utf8',
		timeout: 7000,
		windowsHide: true,
		env: {
			...process.env,
			DB_CONNECTION: 'pgsql',
			DB_HOST: '127.0.0.1',
			DB_PORT: String(port),
			DB_DATABASE: database,
			DB_USERNAME: 'postgres',
			DB_PASSWORD: secret,
			VAPOURDB_DOCTOR_SKIP_DOCKER: '1',
			...overrides
		}
	});
}

function assertSafeFailure(result, expected) {
	const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
	assert.equal(result.status, 1, 'invalid database configuration must fail');
	assert.match(output, expected);
	assert.doesNotMatch(output, new RegExp(secret));
	assert.doesNotMatch(output, /postgres(?:ql)?:\/\/[^\s]+/i);
	return output;
}

const unreachableOutput = assertSafeFailure(runDoctor('vapourdb', 1), /TCP connection failed/);
assert.match(unreachableOutput, /host=127\.0\.0\.1 port=1/);
assert.match(unreachableOutput, /Test-NetConnection 127\.0\.0\.1 -Port 1/);
assertSafeFailure(runDoctor('tuxgg', 5432), /DB_DATABASE must be exactly vapourdb/);

if (process.env.GITHUB_ACTIONS === 'true' && process.env.DB_DATABASE === 'vapourdb') {
	const wrongPassword = 'doctor-wrong-password-must-not-leak';
	const authOutput = assertSafeFailure(
		runDoctor('vapourdb', Number(process.env.DB_PORT || 5432), { DB_PASSWORD: wrongPassword }),
		/PostgreSQL authentication failed/
	);
	assert.doesNotMatch(authOutput, new RegExp(wrongPassword));
	assertSafeFailure(
		runDoctor('vapourdb', Number(process.env.DB_PORT || 5432), {
			DB_USERNAME: 'doctor-user-that-does-not-exist'
		}),
		/PostgreSQL authentication failed/
	);
}

console.log(
	'Database doctor reports unreachable ports, rejects legacy targets, and redacts invalid credentials.'
);
