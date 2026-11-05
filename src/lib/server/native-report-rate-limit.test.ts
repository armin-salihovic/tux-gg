import { afterEach, describe, expect, it } from 'vitest';
import {
	clearNativeReportRateLimitForTests,
	releaseNativeReportSubmission,
	reserveNativeReportSubmission
} from './native-report-rate-limit.js';

afterEach(clearNativeReportRateLimitForTests);

describe('native report rate limiting', () => {
	it('allows five reports per account per hour and rejects the next one', () => {
		for (let i = 0; i < 5; i += 1)
			expect(reserveNativeReportSubmission('user-1', i)).not.toBeNull();
		expect(reserveNativeReportSubmission('user-1', 6)).toBeNull();
	});

	it('allows another account and resets after the window expires', () => {
		for (let i = 0; i < 5; i += 1) reserveNativeReportSubmission('user-1', i);
		expect(reserveNativeReportSubmission('user-2', 5)).not.toBeNull();
		expect(reserveNativeReportSubmission('user-1', 60 * 60 * 1000 + 1)).not.toBeNull();
	});

	it('releases only the failed request reservation', () => {
		const failedRequest = reserveNativeReportSubmission('user-1', 1);
		const successfulRequest = reserveNativeReportSubmission('user-1', 2);
		expect(failedRequest).not.toBeNull();
		expect(successfulRequest).not.toBeNull();
		releaseNativeReportSubmission('user-1', failedRequest!);
		for (let i = 0; i < 4; i += 1)
			expect(reserveNativeReportSubmission('user-1', i + 3)).not.toBeNull();
		expect(reserveNativeReportSubmission('user-1', 7)).toBeNull();
	});
});
