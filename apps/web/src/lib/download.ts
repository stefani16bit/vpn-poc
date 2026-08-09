export function downloadTextFile(fileName: string, contents: string): void {
	const url = URL.createObjectURL(new Blob([contents], { type: 'text/plain' }));
	const anchor = document.createElement('a');

	anchor.href = url;
	anchor.download = fileName;
	document.body.append(anchor);
	anchor.click();
	anchor.remove();

	URL.revokeObjectURL(url);
}
