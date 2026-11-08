#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

const secret = 'doctor-test-secret-must-not-leak';
function runDoctor(url) {
	return spawnSync(process.execPath, ['scripts/db_doctor.mjs'], {
		encoding: 'utf8',
		timeout: 7000,
		windowsHide: true,
		env: {
			...process.env,
			DATABASE_URL: url,
			VAPOURDB_DATABASE_MODE: 'development',
			VAPOURDB_DOCTOR_SKIP_DOCKER: '1'
		}
	});
}

function assertSafeFailure(result, expected, hiddenSecret) {
	const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
	assert.equal(result.status, 1, 'invalid database configuration must fail');
	assert.match(output, expected);
	if (hiddenSecret) assert.doesNotMatch(output, new RegExp(hiddenSecret));
	assert.doesNotMatch(output, /postgres(?:ql)?:\/\/[^\s]+/i);
	return output;
}

const unreachable = runDoctor(`postgresql://vapourdb_dev:${secret}@127.0.0.1:1/vapourdb`);
const unreachableOutput = assertSafeFailure(unreachable, /TCP connection failed/, secret);
assert.match(unreachableOutput, /host=127\.0\.0\.1 port=1/);
assert.match(unreachableOutput, /Test-NetConnection 127\.0\.0\.1 -Port 1/);

if (process.env.DATABASE_URL) {
	const configured = new URL(process.env.DATABASE_URL);
	const badPassword = new URL(configured);
	badPassword.password = 'doctor-wrong-password';
	assertSafeFailure(
		runDoctor(badPassword.toString()),
		/PostgreSQL authentication failed/,
		'doctor-wrong-password'
	);

	const missingDatabase = new URL(configured);
	missingDatabase.pathname = '/vapourdb_doctor_missing';
	assertSafeFailure(
		runDoctor(missingDatabase.toString()),
		/PostgreSQL database does not exist/,
		configured.password
	);
}

console.log(
	'Database doctor reports unreachable ports, wrong credentials, and missing databases without leaking URLs.'
);
