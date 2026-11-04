export interface SteamDeckReportFields {
	os: string | null;
	batteryPerformance: string | null;
	readability: string | null;
	didChangeControlLayout: string | null;
	controlLayout: string | null;
	controlLayoutCustomization: string | null;
	frameRate: string | null;
}

export interface SteamDeckObservation {
	label: string;
	value: string;
}

const CONTROL_LAYOUTS: Record<string, string> = {
	community: 'Community layout',
	official: 'Official layout',
	keyboardAndMouse: 'Keyboard and mouse',
	gamepadWithMouseTrackpad: 'Gamepad with mouse trackpad',
	gamepad: 'Gamepad',
	gamepadWithJoystick: 'Gamepad with joystick',
	mouseOnly: 'Mouse only',
	gamepadWithGyro: 'Gamepad with gyro',
	touchscreenMouseEmulation: 'Touchscreen mouse emulation'
};

const FRAME_RATES: Record<string, string> = {
	gt60: 'Above 60 FPS',
	'30to60': '30–60 FPS',
	'20to30': '20–30 FPS',
	'10to20': '10–20 FPS',
	lt10: 'Below 10 FPS'
};

function yesNo(value: string | null): string | null {
	if (value === 'yes') return 'Yes';
	if (value === 'no') return 'No';
	return null;
}

export function steamDeckObservations(fields: SteamDeckReportFields): SteamDeckObservation[] {
	const observations: SteamDeckObservation[] = [];
	if (fields.os?.toLowerCase().includes('steamos')) {
		observations.push({ label: 'Reported system', value: 'SteamOS' });
	}
	const batteryPerformance = yesNo(fields.batteryPerformance);
	if (batteryPerformance)
		observations.push({ label: 'Battery performance acceptable', value: batteryPerformance });
	const readability = yesNo(fields.readability);
	if (readability) observations.push({ label: 'Text readable', value: readability });
	const changedLayout = yesNo(fields.didChangeControlLayout);
	if (changedLayout)
		observations.push({ label: 'Changed controller layout', value: changedLayout });
	const controlLayout = fields.controlLayout ? CONTROL_LAYOUTS[fields.controlLayout] : undefined;
	if (controlLayout) observations.push({ label: 'Controller layout', value: controlLayout });
	const customized = yesNo(fields.controlLayoutCustomization);
	if (customized) observations.push({ label: 'Customized layout', value: customized });
	const frameRate = fields.frameRate ? FRAME_RATES[fields.frameRate] : undefined;
	if (frameRate) observations.push({ label: 'Reported frame rate', value: frameRate });
	return observations;
}
