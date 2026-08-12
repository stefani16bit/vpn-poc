export function downloadTextFile(fileName: string, contents: string): void {
	downloadBlob(fileName, new Blob([contents], { type: 'text/plain' }));
}

export function downloadBlob(fileName: string, blob: Blob): void {
	const url = URL.createObjectURL(blob);
	const anchor = document.createElement('a');

	anchor.href = url;
	anchor.download = fileName;
	document.body.append(anchor);
	anchor.click();
	anchor.remove();

	URL.revokeObjectURL(url);
}
