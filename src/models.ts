export interface Project {
	id: number;
	name: string;
	createdAt: string;
	archived: boolean;
}

export type WorkCategory = 'project' | 'client-support';

export interface WorkLog {
	id: number;
	projectId: number | null;
	category: WorkCategory;
	description: string;
	startTime: string;
	endTime: string | null;
	durationSeconds: number | null;
}

export interface NewWorkLog {
	projectId: number | null;
	category: WorkCategory;
	description: string;
	startTime: string;
}

export interface WorkLogWithProjectName extends WorkLog {
	projectName: string;
}

export interface ActiveSession {
	workLogId: number;
	projectId: number | null;
	category: WorkCategory;
	label: string;
	description: string;
	startTime: string;
	/** Total milliseconds spent paused so far, excluded from the tracked duration. */
	accumulatedPauseMs: number;
	/** Set while paused; the moment the current pause began. */
	pausedAt: string | null;
}
