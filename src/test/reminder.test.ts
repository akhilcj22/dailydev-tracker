import * as assert from 'assert';
import {
	ReminderConfig,
	computeNextFireTime,
	decideOnActivate,
	nextWorkingDayAtReminderTime,
	reminderTimeOn,
	todayKey
} from '../reminder';
import { fromIstComponents, toIstCalendar } from '../istTime';

function config(overrides: Partial<ReminderConfig> = {}): ReminderConfig {
	return {
		enabled: true,
		hour: 18,
		minute: 0,
		workingDays: new Set([1, 2, 3, 4, 5]), // Mon-Fri
		...overrides
	};
}

// Fixtures are built as explicit IST wall-clock moments via fromIstComponents (not the local
// Date constructor), and results are decoded the same way, so these tests hold regardless of
// what timezone the machine actually running them is set to.
suite('reminder scheduling (IST-anchored)', () => {
	test('reminderTimeOn sets the configured hour/minute, in IST, on the given date', () => {
		const date = fromIstComponents(2026, 0, 5, 9, 30); // Monday, Jan 5 2026, 9:30 AM IST
		const result = reminderTimeOn(date, config({ hour: 18, minute: 30 }));
		const cal = toIstCalendar(result);
		assert.strictEqual(cal.getUTCHours(), 18);
		assert.strictEqual(cal.getUTCMinutes(), 30);
		assert.strictEqual(cal.getUTCDate(), 5);
	});

	test('nextWorkingDayAtReminderTime skips a weekend to reach Monday', () => {
		const saturday = fromIstComponents(2026, 0, 3, 10, 0); // Saturday, Jan 3 2026, 10am IST
		const result = nextWorkingDayAtReminderTime(saturday, config());
		const cal = toIstCalendar(result);
		assert.strictEqual(cal.getUTCDay(), 1, 'should land on Monday');
		assert.strictEqual(cal.getUTCDate(), 5);
		assert.strictEqual(cal.getUTCHours(), 18);
	});

	test('nextWorkingDayAtReminderTime falls back to tomorrow when no working days are configured', () => {
		const monday = fromIstComponents(2026, 0, 5, 10, 0);
		const result = nextWorkingDayAtReminderTime(monday, config({ workingDays: new Set() }));
		assert.strictEqual(toIstCalendar(result).getUTCDate(), 6, 'falls back to the next calendar day rather than never firing');
	});

	test('computeNextFireTime picks later today when the reminder time has not passed yet', () => {
		const monday9am = fromIstComponents(2026, 0, 5, 9, 0);
		const result = computeNextFireTime(monday9am, config({ hour: 18, minute: 0 }));
		const cal = toIstCalendar(result);
		assert.strictEqual(cal.getUTCDate(), 5);
		assert.strictEqual(cal.getUTCHours(), 18);
	});

	test('computeNextFireTime rolls over to the next working day once today\'s time has passed', () => {
		const monday7pm = fromIstComponents(2026, 0, 5, 19, 0);
		const result = computeNextFireTime(monday7pm, config({ hour: 18, minute: 0 }));
		const cal = toIstCalendar(result);
		assert.strictEqual(cal.getUTCDate(), 6, 'Tuesday');
		assert.strictEqual(cal.getUTCHours(), 18);
	});

	test('computeNextFireTime skips the weekend from a Friday evening', () => {
		const friday7pm = fromIstComponents(2026, 0, 9, 19, 0); // Friday, Jan 9 2026, 7pm IST
		const result = computeNextFireTime(friday7pm, config({ hour: 18, minute: 0 }));
		const cal = toIstCalendar(result);
		assert.strictEqual(cal.getUTCDay(), 1, 'should land on the following Monday');
		assert.strictEqual(cal.getUTCDate(), 12);
	});

	test('decideOnActivate returns disabled when reminders are turned off', () => {
		const monday7pm = fromIstComponents(2026, 0, 5, 19, 0);
		const decision = decideOnActivate(monday7pm, config({ enabled: false }), false);
		assert.strictEqual(decision.action, 'disabled');
	});

	test('decideOnActivate catches up when today\'s time already passed and nothing was shown yet', () => {
		const monday7pm = fromIstComponents(2026, 0, 5, 19, 0);
		const decision = decideOnActivate(monday7pm, config({ hour: 18, minute: 0 }), false);
		assert.strictEqual(decision.action, 'catch-up');
	});

	test('decideOnActivate schedules ahead instead of re-showing a reminder already shown today', () => {
		const monday7pm = fromIstComponents(2026, 0, 5, 19, 0);
		const decision = decideOnActivate(monday7pm, config({ hour: 18, minute: 0 }), true);
		assert.strictEqual(decision.action, 'schedule');
	});

	test('decideOnActivate schedules for later today when the reminder time has not arrived yet', () => {
		const monday9am = fromIstComponents(2026, 0, 5, 9, 0);
		const decision = decideOnActivate(monday9am, config({ hour: 18, minute: 0 }), false);
		assert.strictEqual(decision.action, 'schedule');
		assert.ok(decision.action === 'schedule' && toIstCalendar(decision.fireAt).getUTCDate() === 5);
	});

	test('decideOnActivate does not catch up on a non-working day even if past the configured time', () => {
		const saturday7pm = fromIstComponents(2026, 0, 3, 19, 0); // Saturday
		const decision = decideOnActivate(saturday7pm, config({ hour: 18, minute: 0 }), false);
		assert.strictEqual(decision.action, 'schedule', 'weekends are not working days, so no catch-up is owed');
	});

	test('todayKey is stable for the same IST calendar day and differs across days', () => {
		const a = todayKey(fromIstComponents(2026, 0, 5, 1, 0));
		const b = todayKey(fromIstComponents(2026, 0, 5, 23, 59));
		const c = todayKey(fromIstComponents(2026, 0, 6, 1, 0));
		assert.strictEqual(a, b);
		assert.notStrictEqual(a, c);
	});

	test('reminderTimeOn is anchored to IST even when the host system clock is in a different timezone', () => {
		// This is the exact bug this module was fixed for: a host system set to UTC must not
		// shift the configured reminder time away from the IST hour the user actually configured.
		const nowInUtcHost = new Date(Date.UTC(2026, 0, 5, 3, 0)); // an arbitrary real instant
		const result = reminderTimeOn(nowInUtcHost, config({ hour: 18, minute: 0 }));
		const cal = toIstCalendar(result);
		assert.strictEqual(cal.getUTCHours(), 18, 'the fire time must read as 18:00 in IST, regardless of host timezone');
	});
});
