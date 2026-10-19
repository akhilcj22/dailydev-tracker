import * as assert from 'assert';
import { buildCsv, buildSummaryText, DashboardState } from '../dashboard';

function stateWith(entries: DashboardState['entries']): DashboardState {
	const totalsByProject = new Map<string, number>();
	for (const entry of entries) {
		totalsByProject.set(entry.projectName, (totalsByProject.get(entry.projectName) ?? 0) + entry.durationSeconds);
	}
	return {
		active: null,
		entries,
		totals: [...totalsByProject.entries()].map(([projectName, totalSeconds]) => ({
			projectName,
			totalLabel: `${Math.round(totalSeconds / 60)}m`
		})),
		grandTotalLabel: '01:30:00',
		dateLabel: 'Monday, 19 Oct 2026',
		isToday: true,
		canGoForward: false
	};
}

suite('timesheet summary (Phase 6)', () => {
	test('buildSummaryText groups entries by project with subtotals and a grand total', () => {
		const state = stateWith([
			{ id: 1, projectName: 'ERPNext', description: 'Fix report', startLabel: '9:00 AM', endLabel: '10:00 AM', durationLabel: '01:00:00', durationSeconds: 3600 },
			{ id: 2, projectName: 'Client Support', description: 'Ticket #4', startLabel: '10:00 AM', endLabel: '10:30 AM', durationLabel: '00:30:00', durationSeconds: 1800 },
			{ id: 3, projectName: 'ERPNext', description: 'Review PR', startLabel: '10:30 AM', endLabel: '11:00 AM', durationLabel: '00:30:00', durationSeconds: 1800 }
		]);

		const text = buildSummaryText(state);

		assert.ok(text.startsWith('DailyDev Tracker — Monday, 19 Oct 2026'));
		assert.ok(text.includes('ERPNext'));
		assert.ok(text.includes('9:00 AM - 10:00 AM  Fix report  (01:00:00)'));
		assert.ok(text.includes('10:30 AM - 11:00 AM  Review PR  (00:30:00)'));
		// ERPNext's two entries (1h + 30m) should be subtotaled together, separately from Client Support.
		assert.ok(text.includes('Subtotal: 01:30:00'));
		assert.ok(text.includes('Client Support'));
		assert.ok(text.includes('Subtotal: 00:30:00'));
		assert.ok(text.includes('Total: 01:30:00'));

		// ERPNext's subtotal line must appear before the Client Support section starts.
		const erpnextIndex = text.indexOf('ERPNext');
		const supportIndex = text.indexOf('Client Support');
		assert.ok(erpnextIndex < supportIndex);
	});

	test('buildSummaryText reports no entries without throwing', () => {
		const text = buildSummaryText(stateWith([]));
		assert.ok(text.includes('No tracked entries.'));
	});

	test('buildCsv emits a header row and escapes commas/quotes/newlines in free-text fields', () => {
		const state = stateWith([
			{
				id: 1,
				projectName: 'ERPNext',
				description: 'Fix "Delivery, Tracker" report',
				startLabel: '9:00 AM',
				endLabel: '10:00 AM',
				durationLabel: '01:00:00',
				durationSeconds: 3600
			}
		]);

		const csv = buildCsv(state, '2026-10-19');
		const rows = csv.split('\n');

		assert.strictEqual(rows[0], 'Date,Project,Task,Start,End,Duration');
		assert.strictEqual(rows[1], '2026-10-19,ERPNext,"Fix ""Delivery, Tracker"" report",9:00 AM,10:00 AM,01:00:00');
	});
});
