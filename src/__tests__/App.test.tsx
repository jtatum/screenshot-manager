import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import App from '../App';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
  convertFileSrc: (p: string) => p,
}));

vi.mock('@tauri-apps/plugin-opener', () => ({
  revealItemInDir: vi.fn(),
}));

import { invoke as coreInvoke } from '@tauri-apps/api/core';
const invoke: any = coreInvoke as any;

const items = [
  {
    path: '/tmp/A.png',
    file_name: 'A.png',
    created_at: null,
    modified_at: '2025-01-01T00:00:00Z',
    size_bytes: 100,
  },
  {
    path: '/tmp/B.png',
    file_name: 'B.png',
    created_at: null,
    modified_at: '2025-01-02T00:00:00Z',
    size_bytes: 200,
  },
];

describe('App', () => {
  beforeEach(() => {
    invoke.mockReset();
  });

  it('renders gallery from list_screenshots and supports arrow navigation', async () => {
    invoke.mockImplementation(async (cmd: string, _args?: any) => {
      if (cmd === 'list_screenshots') return items;
      if (cmd === 'delete_to_trash') return { trashed: [] };
      if (cmd === 'undo_last_delete') return [];
      return null;
    });

    render(<App />);

    // Wait for an item to appear
    await waitFor(() => expect(screen.getByText('A.png')).toBeInTheDocument());

    // No selection initially; first ArrowRight selects first card
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    const first = document.querySelector("[data-index='0']") as HTMLElement;
    await waitFor(() => expect(first.className).toMatch(/selected/));

    // Next ArrowRight goes to second
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    const second = document.querySelector("[data-index='1']") as HTMLElement;
    await waitFor(() => expect(second.className).toMatch(/selected/));
  });

  it('delete removes current and selects next', async () => {
    const seq: any[][] = [
      // initial load
      items,
      // after delete of B -> only A remains
      [items[0]],
    ];

    invoke.mockImplementation(async (cmd: string, args?: any) => {
      if (cmd === 'list_screenshots') return seq.shift();
      if (cmd === 'delete_to_trash') return { trashed: [{ original_path: args?.paths?.[0], trashed_path: '/trash/B.png' }] };
      return [];
    });

    render(<App />);
    await waitFor(() => expect(screen.getByText('A.png')).toBeInTheDocument());

    // Select second (B)
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    const second = document.querySelector("[data-index='1']") as HTMLElement;
    await waitFor(() => expect(second.className).toMatch(/selected/));

    // Delete
    fireEvent.keyDown(window, { key: 'Delete' });

    // Should reload with only A visible
    await waitFor(() => expect(screen.queryByText('B.png')).not.toBeInTheDocument());
    expect(screen.getByText('A.png')).toBeInTheDocument();
  });

  it('undo error shows toast with Reveal', async () => {
    const seq: any[][] = [items, items];
    invoke.mockImplementation(async (cmd: string, _args?: any) => {
      if (cmd === 'list_screenshots') return seq.shift();
      if (cmd === 'delete_to_trash') return { trashed: [{ original_path: items[0].path, trashed_path: '/trash/A.png' }] };
      if (cmd === 'undo_last_delete') throw new Error('Permission denied');
      return [];
    });

    render(<App />);
    await waitFor(() => expect(screen.getByText('A.png')).toBeInTheDocument());

    // Select first and delete to create lastTrashed
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    fireEvent.keyDown(window, { key: 'Delete' });
    await waitFor(() => expect(screen.getByText('A.png')).toBeInTheDocument());

    // Click Undo button (rather than Cmd+Z)
    const undoBtn = screen.getByRole('button', { name: /Undo/ });
    fireEvent.click(undoBtn);

    // Toast appears with guidance
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(screen.getByText(/Full Disk Access/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reveal' })).toBeInTheDocument();
  });
});
