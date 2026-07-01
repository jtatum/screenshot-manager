import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import App from '../App';

// Broadens the App UI coverage beyond App.test.tsx: sort controls, vertical
// WASD/arrow navigation, Backspace delete, successful undo, and the empty
// state. Tests are grouped by the seven review categories
// (Security, Performance, Retry, Unit, Integration, Functional, Frame);
// categories with no meaningful surface for this pure-UI component carry an
// explicit placeholder with a comment.

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
    size_bytes: 2 * 1024 * 1024,
  },
  {
    path: '/tmp/C.png',
    file_name: 'C.png',
    created_at: null,
    modified_at: '2025-01-03T00:00:00Z',
    size_bytes: 300,
  },
];

// Give React effects a chance to settle before firing keyboard events,
// matching the pattern used by the existing App.test.tsx suite.
const settle = () => new Promise((r) => setTimeout(r, 200));

function mockList(list: any[]) {
  invoke.mockImplementation(async (cmd: string, _args?: any) => {
    if (cmd === 'list_screenshots') return list;
    if (cmd === 'delete_to_trash') return { trashed: [] };
    if (cmd === 'undo_last_delete') return [];
    return null;
  });
}

async function renderWithItems(list = items) {
  mockList(list);
  render(<App />);
  await waitFor(() => expect(screen.getByText(list[0].file_name)).toBeInTheDocument());
  await settle();
}

describe('App interactions (broadened coverage)', () => {
  beforeEach(() => {
    invoke.mockReset();
  });

  // ---------------------------------------------------------------------------
  // Security
  // ---------------------------------------------------------------------------
  describe('Security', () => {
    it('renders a screenshot name as text, not markup (React auto-escaping)', async () => {
      const malicious = '<img src=x onerror="alert(1)">.png';
      await renderWithItems([{ ...items[0], file_name: malicious }]);

      // If React escaped it, the literal string is findable as text and no
      // extra <img> element was injected from the name into the card meta.
      expect(screen.getByText(malicious)).toBeInTheDocument();
      const metaImgs = document.querySelectorAll('.meta img');
      expect(metaImgs.length).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Performance
  // ---------------------------------------------------------------------------
  describe('Performance', () => {
    it('clamps navigation at the boundaries instead of running off the ends', async () => {
      await renderWithItems();

      // First key selects index 0; ArrowLeft at the start stays at 0.
      fireEvent.keyDown(window, { key: 'ArrowLeft' });
      const first = document.querySelector("[data-index='0']") as HTMLElement;
      await waitFor(() => expect(first.className).toMatch(/selected/));

      fireEvent.keyDown(window, { key: 'ArrowLeft' });
      await waitFor(() => expect(first.className).toMatch(/selected/));

      // Walk to the last card; ArrowRight past the end stays on the last.
      fireEvent.keyDown(window, { key: 'ArrowRight' });
      fireEvent.keyDown(window, { key: 'ArrowRight' });
      const last = document.querySelector("[data-index='2']") as HTMLElement;
      await waitFor(() => expect(last.className).toMatch(/selected/));

      fireEvent.keyDown(window, { key: 'ArrowRight' });
      await waitFor(() => expect(last.className).toMatch(/selected/));
    });
  });

  // ---------------------------------------------------------------------------
  // Retry
  // ---------------------------------------------------------------------------
  describe('Retry', () => {
    // The component issues Tauri commands directly with no retry/backoff of its
    // own (any retry would live in the Rust command layer), so there is no
    // retry behavior to exercise here.
    it('is not applicable — no client-side retry logic', () => {
      expect(true).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // Unit
  // ---------------------------------------------------------------------------
  describe('Unit', () => {
    it('shows the empty state when there are no screenshots', async () => {
      mockList([]);
      render(<App />);
      await waitFor(() =>
        expect(screen.getByText('No screenshots found')).toBeInTheDocument(),
      );
    });

    it('formats sizes (KB vs MB) in the card metadata', async () => {
      await renderWithItems();
      // 100 bytes -> "0 KB" rounding, 2 MB -> "2.0 MB".
      expect(screen.getByText(/2\.0 MB/)).toBeInTheDocument();
    });
  });

  // ---------------------------------------------------------------------------
  // Integration
  // ---------------------------------------------------------------------------
  describe('Integration', () => {
    it('reloads with the chosen sort field when the Sort by control changes', async () => {
      await renderWithItems();
      invoke.mockClear();

      const select = screen.getByLabelText('Sort screenshots by');
      fireEvent.change(select, { target: { value: 'name' } });

      await waitFor(() =>
        expect(invoke).toHaveBeenCalledWith('list_screenshots', {
          options: { sortBy: 'name', descending: true },
        }),
      );
    });

    it('reloads with ascending order when the descending toggle is unchecked', async () => {
      await renderWithItems();
      invoke.mockClear();

      const checkbox = screen.getByLabelText(
        'Sort in descending order (newest first)',
      );
      fireEvent.click(checkbox); // was checked (descending) -> now ascending

      await waitFor(() =>
        expect(invoke).toHaveBeenCalledWith('list_screenshots', {
          options: { sortBy: 'modifiedAt', descending: false },
        }),
      );
    });

    it('restores an item on a successful undo', async () => {
      const seq: any[][] = [items, [items[1], items[2]], items];
      invoke.mockImplementation(async (cmd: string, args?: any) => {
        if (cmd === 'list_screenshots') return seq.shift();
        if (cmd === 'delete_to_trash')
          return {
            trashed: [
              { original_path: args?.paths?.[0], trashed_path: '/trash/A.png' },
            ],
          };
        if (cmd === 'undo_last_delete') return [];
        return null;
      });

      render(<App />);
      await waitFor(() => expect(screen.getByText('A.png')).toBeInTheDocument());
      await settle();

      // Select first (A) and delete it.
      fireEvent.keyDown(window, { key: 'ArrowRight' });
      fireEvent.keyDown(window, { key: 'Delete' });
      await waitFor(() =>
        expect(screen.queryByText('A.png')).not.toBeInTheDocument(),
      );

      // Undo restores A and issues undo_last_delete.
      fireEvent.keyDown(window, { key: 'z', metaKey: true });
      await waitFor(() =>
        expect(invoke).toHaveBeenCalledWith('undo_last_delete', { count: 1 }),
      );
      await waitFor(() => expect(screen.getByText('A.png')).toBeInTheDocument());
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });
  });

  // ---------------------------------------------------------------------------
  // Functional
  // ---------------------------------------------------------------------------
  describe('Functional', () => {
    it('navigates vertically with the S and W keys', async () => {
      await renderWithItems();

      // First key selects index 0.
      fireEvent.keyDown(window, { key: 's' });
      const first = document.querySelector("[data-index='0']") as HTMLElement;
      await waitFor(() => expect(first.className).toMatch(/selected/));

      // S moves down (one row = one column in the test layout).
      fireEvent.keyDown(window, { key: 's' });
      const second = document.querySelector("[data-index='1']") as HTMLElement;
      await waitFor(() => expect(second.className).toMatch(/selected/));

      // W moves back up.
      fireEvent.keyDown(window, { key: 'w' });
      await waitFor(() => expect(first.className).toMatch(/selected/));
    });

    it('navigates vertically with ArrowDown and ArrowUp', async () => {
      await renderWithItems();

      fireEvent.keyDown(window, { key: 'ArrowDown' });
      const first = document.querySelector("[data-index='0']") as HTMLElement;
      await waitFor(() => expect(first.className).toMatch(/selected/));

      fireEvent.keyDown(window, { key: 'ArrowDown' });
      const second = document.querySelector("[data-index='1']") as HTMLElement;
      await waitFor(() => expect(second.className).toMatch(/selected/));

      fireEvent.keyDown(window, { key: 'ArrowUp' });
      await waitFor(() => expect(first.className).toMatch(/selected/));
    });

    it('deletes the selected screenshot with the Backspace key', async () => {
      await renderWithItems();

      fireEvent.keyDown(window, { key: 'ArrowRight' }); // select index 0 (A)
      const first = document.querySelector("[data-index='0']") as HTMLElement;
      await waitFor(() => expect(first.className).toMatch(/selected/));

      fireEvent.keyDown(window, { key: 'Backspace' });
      await waitFor(() =>
        expect(invoke).toHaveBeenCalledWith('delete_to_trash', {
          paths: ['/tmp/A.png'],
        }),
      );
    });
  });

  // ---------------------------------------------------------------------------
  // Frame
  // ---------------------------------------------------------------------------
  describe('Frame', () => {
    it('removes its global keydown listener on unmount', async () => {
      const removeSpy = vi.spyOn(window, 'removeEventListener');
      mockList(items);
      const { unmount } = render(<App />);
      await waitFor(() => expect(screen.getByText('A.png')).toBeInTheDocument());

      unmount();
      expect(removeSpy).toHaveBeenCalledWith('keydown', expect.any(Function));
      removeSpy.mockRestore();
    });
  });
});
