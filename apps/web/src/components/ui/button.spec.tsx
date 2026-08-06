import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Button } from './button.tsx';

describe('Button', () => {
	it('renders a real button element', () => {
		render(<Button>go</Button>);
		expect(screen.getByRole('button', { name: 'go' })).toBeInTheDocument();
	});

	it('renders whatever asChild wraps, keeping the variant classes', () => {
		render(
			<Button asChild variant="link">
				<a href="/somewhere">go</a>
			</Button>,
		);

		const link = screen.getByRole('link', { name: 'go' });
		expect(link).toHaveAttribute('href', '/somewhere');
		expect(link.className).toContain('underline-offset-4');
		expect(screen.queryByRole('button')).not.toBeInTheDocument();
	});

	it('does not fire onClick while disabled', async () => {
		const onClick = vi.fn();
		render(
			<Button disabled onClick={onClick}>
				go
			</Button>,
		);

		await userEvent.click(screen.getByRole('button', { name: 'go' }));
		expect(onClick).not.toHaveBeenCalled();
	});

	it('fires onClick when it is enabled', async () => {
		const onClick = vi.fn();
		render(<Button onClick={onClick}>go</Button>);

		await userEvent.click(screen.getByRole('button', { name: 'go' }));
		expect(onClick).toHaveBeenCalledOnce();
	});

	it('reports its variant and size as data attributes', () => {
		render(
			<Button variant="destructive" size="sm">
				go
			</Button>,
		);

		const button = screen.getByRole('button');
		expect(button).toHaveAttribute('data-variant', 'destructive');
		expect(button).toHaveAttribute('data-size', 'sm');
	});

	it('lets a caller className win over the variant, which is why cn uses twMerge', () => {
		render(<Button className="rounded-none">go</Button>);

		const className = screen.getByRole('button').className;
		expect(className).toContain('rounded-none');
		expect(className).not.toContain('rounded-md');
	});

	it('carries the focus ring in its base classes', () => {
		render(<Button>go</Button>);
		expect(screen.getByRole('button').className).toContain('focus-visible:ring-ring/50');
	});

	it('defaults to type button only when the caller says so', () => {
		render(<Button type="submit">go</Button>);
		expect(screen.getByRole('button')).toHaveAttribute('type', 'submit');
	});
});
