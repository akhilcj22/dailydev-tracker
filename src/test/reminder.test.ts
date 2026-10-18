import * as assert from 'assert';
import {
	ReminderConfig,
	computeNextFireTime,
	decideOnActivate,
	nextWorkingDayAtReminderTime,
	reminderTimeOn,
	todayKey
} from '../reminder';

function config(overrides: Partial<ReminderConfig> = {}): ReminderConfig {
	return {
		enabled: true,
		hour: 18,
		minute: 0,
		workingDays: new Set([1, 2, 3, 4, 5]), // Mon-Fri
		...overrides
	};
}

suite('reminder scheduling', () => {
	test('reminderTimeOn sets the configured hour/minute on the given date', () => {
		const date = new Date(2026, 0, 5, 9, 30); // Monday, Jan 5 2026
		const result = reminderTimeOn(date, config({ hour: 18, minute: 30 }));
		assert.strictEqual(result.getHours(), 18);
		assert.strictEqual(result.getMinutes(), 30);
		assert.strictEqual(result.getDate(), 5);
	});

	test('nextWorkingDayAtReminderTime skips a weekend to reach Monday', () => {
		const saturday = new Date(2026, 0, 3, 10, 0); // Saturday, Jan 3 2026
		const result = nextWorkingDayAtReminderTime(saturday, config());
		assert.strictEqual(result.getDay(), 1, 'should land on Monday');
		assert.strictEqual(result.getDate(), 5);
		assert.strictEqual(result.getHours(), 18);
	});

	test('nextWorkingDayAtReminderTime falls back to tomorrow when no working days are configured', () => {
		const monday = new Date(2026, 0, 5, 10, 0);
		const result = nextWorkingDayAtReminderTime(monday, config({ workingDays: new Set() }));
		assert.strictEqual(result.getDate(), 6, 'falls back to the next calendar day rather than never firing');
	});

	test('computeNextFireTime picks later today when the reminder time has not passed yet', () => {
		const monday9am = new Date(2026, 0, 5, 9, 0);
		const result = computeNextFireTime(monday9am, config({ hour: 18, minute: 0 }));
		assert.strictEqual(result.getDate(), 5);
		assert.strictEqual(result.getHours(), 18);
	});

	test('computeNextFireTime rolls over to the next working day once today\'s time has passed', () => {
		const monday7pm = new Date(2026, 0, 5, 19, 0);
		const result = computeNextFireTime(monday7pm, config({ hour: 18, minute: 0 }));
		assert.strictEqual(result.getDate(), 6, 'Tuesday');
		assert.strictEqual(result.getHours(), 18);
	});

	test('computeNextFireTime skips the weekend from a Friday evening', () => {
		const friday7pm = new Date(2026, 0, 9, 19, 0); // Friday, Jan 9 2026
		const result = computeNextFireTime(friday7pm, config({ hour: 18, minute: 0 }));
		assert.strictEqual(result.getDay(), 1, 'should land on the following Monday');
		assert.strictEqual(result.getDate(), 12);
	});

	test('decideOnActivate returns disabled when reminders are turned off', () => {
		const monday7pm = new Date(2026, 0, 5, 19, 0);
		const decision = decideOnActivate(monday7pm, config({ enabled: false }), false);
		assert.strictEqual(decision.action, 'disabled');
	});

	test('decideOnActivate catches up when today\'s time already passed and nothing was shown yet', () => {
		const monday7pm = new Date(2026, 0, 5, 19, 0);
		const decision = decideOnActivate(monday7pm, config({ hour: 18, minute: 0 }), false);
		assert.strictEqual(decision.action, 'catch-up');
	});

	test('decideOnActivate schedules ahead instead of re-showing a reminder already shown today', () => {
		const monday7pm = new Date(2026, 0, 5, 19, 0);
		const decision = decideOnActivate(monday7pm, config({ hour: 18, minute: 0 }), true);
		assert.strictEqual(decision.action, 'schedule');
	});

	test('decideOnActivate schedules for later today when the reminder time has not arrived yet', () => {
		const monday9am = new Date(2026, 0, 5, 9, 0);
		const decision = decideOnActivate(monday9am, config({ hour: 18, minute: 0 }), false);
		assert.strictEqual(decision.action, 'schedule');
		assert.ok(decision.action === 'schedule' && decision.fireAt.getDate() === 5);
	});

	test('decideOnActivate does not catch up on a non-working day even if past the configured time', () => {
		const saturday7pm = new Date(2026, 0, 3, 19, 0); // Saturday
		const decision = decideOnActivate(saturday7pm, config({ hour: 18, minute: 0 }), false);
		assert.strictEqual(decision.action, 'schedule', 'weekends are not working days, so no catch-up is owed');
	});

	test('todayKey is stable for the same calendar day and differs across days', () => {
		const a = todayKey(new Date(2026, 0, 5, 1, 0));
		const b = todayKey(new Date(2026, 0, 5, 23, 59));
		const c = todayKey(new Date(2026, 0, 6, 1, 0));
		assert.strictEqual(a, b);
		assert.notStrictEqual(a, c);
	});
});
