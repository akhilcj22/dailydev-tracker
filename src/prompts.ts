import { showModalInput } from './modal';

export async function promptForDurationMinutes(promptText: string, defaultMinutes: number): Promise<number | undefined> {
	const input = await showModalInput({
		title: 'Duration',
		prompt: promptText,
		placeholder: '45',
		value: String(defaultMinutes),
		validate: (value) =>
			/^\d+$/.test(value.trim()) && Number(value.trim()) > 0 ? undefined : 'Enter a whole number of minutes greater than 0'
	});
	return input ? Number(input.trim()) : undefined;
}

export async function promptForDescriptionEdit(currentDescription: string): Promise<string | undefined> {
	const value = await showModalInput({
		title: 'Edit Description',
		prompt: 'Task description',
		value: currentDescription,
		validate: (v) => (v.trim() ? undefined : 'Description cannot be empty')
	});
	return value?.trim();
}
