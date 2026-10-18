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
