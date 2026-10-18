import * as vscode from 'vscode';

export interface ModalInputOptions {
	title: string;
	prompt: string;
	placeholder?: string;
	value?: string;
	validate?: (value: string) => string | undefined;
}

function escapeHtml(value: string): string {
	return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

function getNonce(): string {
	const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	let text = '';
	for (let i = 0; i < 32; i++) {
		text += possible.charAt(Math.floor(Math.random() * possible.length));
	}
	return text;
}

function getHtml(options: ModalInputOptions): string {
	const nonce = getNonce();
	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<title>${escapeHtml(options.title)}</title>
<style>
	html, body { height: 100%; margin: 0; }
	body {
		display: flex;
		align-items: center;
		justify-content: center;
		background: var(--vscode-editor-background);
		font-family: var(--vscode-font-family);
		color: var(--vscode-foreground);
	}
	.modal-card {
		background: var(--vscode-editorWidget-background, var(--vscode-editor-background));
		border: 1px solid var(--vscode-widget-border, #444);
		border-radius: 8px;
		padding: 20px 24px;
		width: 360px;
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
	}
	.modal-card h3 { margin: 0 0 12px 0; font-size: 15px; font-weight: 600; }
	input[type="text"] {
		width: 100%;
		box-sizing: border-box;
		padding: 6px 8px;
		background: var(--vscode-input-background);
		color: var(--vscode-input-foreground);
		border: 1px solid var(--vscode-input-border, transparent);
		border-radius: 3px;
		font-size: 13px;
		font-family: var(--vscode-font-family);
	}
	input[type="text"]:focus { outline: 1px solid var(--vscode-focusBorder); }
	.error { color: var(--vscode-errorForeground, #f14c4c); font-size: 12px; min-height: 16px; margin-top: 6px; }
	.actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 14px; }
	button {
		background: var(--vscode-button-background);
		color: var(--vscode-button-foreground);
		border: none;
		padding: 6px 14px;
		border-radius: 3px;
		cursor: pointer;
		font-family: var(--vscode-font-family);
	}
	button:hover { background: var(--vscode-button-hoverBackground); }
	button.secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
</style>
</head>
<body>
	<div class="modal-card">
		<h3>${escapeHtml(options.prompt)}</h3>
		<input id="input" type="text" placeholder="${escapeHtml(options.placeholder ?? '')}" value="${escapeHtml(options.value ?? '')}" />
		<div class="error" id="error"></div>
		<div class="actions">
			<button class="secondary" id="cancelBtn">Cancel</button>
			<button id="okBtn">OK</button>
		</div>
	</div>
<script nonce="${nonce}">
	const vscode = acquireVsCodeApi();
	const input = document.getElementById('input');
	const errorEl = document.getElementById('error');
	input.focus();
	input.select();

	function submit() { vscode.postMessage({ type: 'submit', value: input.value }); }
	function cancel() { vscode.postMessage({ type: 'cancel' }); }

	input.addEventListener('keydown', (e) => {
		if (e.key === 'Enter') { submit(); }
		else if (e.key === 'Escape') { cancel(); }
	});
	input.addEventListener('input', () => vscode.postMessage({ type: 'validate', value: input.value }));
	document.getElementById('okBtn').addEventListener('click', submit);
	document.getElementById('cancelBtn').addEventListener('click', cancel);

	window.addEventListener('message', (event) => {
		const msg = event.data;
		if (msg.type === 'validation') {
			errorEl.textContent = msg.error || '';
		}
	});
</script>
</body>
</html>`;
}

/**
 * Shows a small, centered Webview-based popup for a single line of text, styled like a
 * modal dialog. Unlike vscode.window.showInputBox (which always renders as the top
 * Quick Input bar), this opens as its own editor tab with a centered card.
 */
export function showModalInput(options: ModalInputOptions): Promise<string | undefined> {
	return new Promise((resolve) => {
		const panel = vscode.window.createWebviewPanel(
			'dailydevModalInput',
			options.title,
			vscode.ViewColumn.Active,
			{ enableScripts: true, retainContextWhenHidden: false }
		);

		let resolved = false;
		const finish = (value: string | undefined) => {
			if (resolved) {
				return;
			}
			resolved = true;
			resolve(value);
			panel.dispose();
		};

		panel.webview.html = getHtml(options);

		panel.webview.onDidReceiveMessage((message: { type: string; value?: string }) => {
			if (message.type === 'validate') {
				const error = options.validate?.(message.value ?? '');
				panel.webview.postMessage({ type: 'validation', error });
			} else if (message.type === 'submit') {
				const value = message.value ?? '';
				const error = options.validate?.(value);
				if (error) {
					panel.webview.postMessage({ type: 'validation', error });
					return;
				}
				finish(value);
			} else if (message.type === 'cancel') {
				finish(undefined);
			}
		});

		panel.onDidDispose(() => finish(undefined));
	});
}
