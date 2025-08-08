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

    // Allow DOM to fully settle before keyboard interaction
    await new Promise(resolve => setTimeout(resolve, 200));

    // No selection initially; first ArrowRight selects first card
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    const first = document.querySelector("[data-index='0']") as HTMLElement;
    await waitFor(() => expect(first.className).toMatch(/selected/), { timeout: 2000 });

    // Next ArrowRight goes to second
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    const second = document.querySelector("[data-index='1']") as HTMLElement;
    await waitFor(() => expect(second.className).toMatch(/selected/), { timeout: 2000 });
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

    // Allow DOM to fully settle before keyboard interaction  
    await new Promise(resolve => setTimeout(resolve, 200));

    // Select second (B)
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    const second = document.querySelector("[data-index='1']") as HTMLElement;
    await waitFor(() => expect(second.className).toMatch(/selected/), { timeout: 2000 });

    // Delete
    fireEvent.keyDown(window, { key: 'Delete' });

    // Should reload with only A visible
    await waitFor(() => expect(screen.queryByText('B.png')).not.toBeInTheDocument());
    expect(screen.getByText('A.png')).toBeInTheDocument();
  });

  it('supports WASD navigation and X delete', async () => {
    invoke.mockImplementation(async (cmd: string, _args?: any) => {
      if (cmd === 'list_screenshots') return items;
      if (cmd === 'delete_to_trash') return { trashed: [] };
      if (cmd === 'undo_last_delete') return [];
      return null;
    });

    render(<App />);

    // Wait for items to appear
    await waitFor(() => expect(screen.getByText('A.png')).toBeInTheDocument());

    // Allow DOM to fully settle before keyboard interaction
    await new Promise(resolve => setTimeout(resolve, 200));

    // Test WASD navigation: D (right) should select first card
    fireEvent.keyDown(window, { key: 'd' });
    const first = document.querySelector("[data-index='0']") as HTMLElement;
    await waitFor(() => expect(first.className).toMatch(/selected/), { timeout: 2000 });

    // D again goes to second
    fireEvent.keyDown(window, { key: 'd' });
    const second = document.querySelector("[data-index='1']") as HTMLElement;
    await waitFor(() => expect(second.className).toMatch(/selected/), { timeout: 2000 });

    // A (left) goes back to first
    fireEvent.keyDown(window, { key: 'a' });
    await waitFor(() => expect(first.className).toMatch(/selected/), { timeout: 2000 });

    // Test X for delete (should call delete_to_trash)
    fireEvent.keyDown(window, { key: 'x' });
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('delete_to_trash', { paths: ['/tmp/A.png'] }));
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

  it('lightbox toggles with space key and closes with escape', async () => {
    invoke.mockImplementation(async (cmd: string, _args?: any) => {
      if (cmd === 'list_screenshots') return items;
      return null;
    });

    render(<App />);
    await waitFor(() => expect(screen.getByText('A.png')).toBeInTheDocument());

    // Allow DOM to fully settle before keyboard interaction
    await new Promise(resolve => setTimeout(resolve, 200));

    // Select first item with arrow key
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    const first = document.querySelector("[data-index='0']") as HTMLElement;
    await waitFor(() => expect(first.className).toMatch(/selected/), { timeout: 2000 });

    // Press space to open lightbox
    fireEvent.keyDown(window, { key: ' ' });
    await waitFor(() => expect(document.querySelector('.lightbox-overlay')).toBeInTheDocument());

    // Check lightbox contains the image
    const lightboxImg = document.querySelector('.lightbox-overlay img') as HTMLImageElement;
    expect(lightboxImg).toBeInTheDocument();
    expect(lightboxImg.src).toContain('/tmp/A.png');
    expect(lightboxImg.alt).toBe('A.png');

    // Press space again to close lightbox (toggle)
    fireEvent.keyDown(window, { key: ' ' });
    await waitFor(() => expect(document.querySelector('.lightbox-overlay')).not.toBeInTheDocument());

    // Press space again to reopen
    fireEvent.keyDown(window, { key: ' ' });
    await waitFor(() => expect(document.querySelector('.lightbox-overlay')).toBeInTheDocument());

    // Press escape to close lightbox
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(document.querySelector('.lightbox-overlay')).not.toBeInTheDocument());
  });

  it('lightbox opens with double click and closes with background click', async () => {
    invoke.mockImplementation(async (cmd: string, _args?: any) => {
      if (cmd === 'list_screenshots') return items;
      return null;
    });

    render(<App />);
    await waitFor(() => expect(screen.getByText('A.png')).toBeInTheDocument());

    // Allow DOM to fully settle
    await new Promise(resolve => setTimeout(resolve, 200));

    // Double click on first card to open lightbox
    const first = document.querySelector("[data-index='0']") as HTMLElement;
    fireEvent.click(first, { detail: 2 });
    
    await waitFor(() => expect(document.querySelector('.lightbox-overlay')).toBeInTheDocument());
    
    // Check card is selected and lightbox is open
    expect(first.className).toMatch(/selected/);
    
    // Click on overlay background to close
    const overlay = document.querySelector('.lightbox-overlay') as HTMLElement;
    fireEvent.click(overlay);
    
    await waitFor(() => expect(document.querySelector('.lightbox-overlay')).not.toBeInTheDocument());
  });

  it('disables delete keys when lightbox is open', async () => {
    invoke.mockImplementation(async (cmd: string, _args?: any) => {
      if (cmd === 'list_screenshots') return items;
      if (cmd === 'delete_to_trash') return { trashed: [] };
      return null;
    });

    render(<App />);
    await waitFor(() => expect(screen.getByText('A.png')).toBeInTheDocument());

    // Allow DOM to fully settle
    await new Promise(resolve => setTimeout(resolve, 200));

    // Select first item and open lightbox
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    const first = document.querySelector("[data-index='0']") as HTMLElement;
    await waitFor(() => expect(first.className).toMatch(/selected/), { timeout: 2000 });

    fireEvent.keyDown(window, { key: ' ' });
    await waitFor(() => expect(document.querySelector('.lightbox-overlay')).toBeInTheDocument());

    // Try to delete with X key - should NOT call delete
    fireEvent.keyDown(window, { key: 'x' });
    await new Promise(resolve => setTimeout(resolve, 100));
    expect(invoke).not.toHaveBeenCalledWith('delete_to_trash', expect.anything());

    // Try to delete with Delete key - should NOT call delete
    fireEvent.keyDown(window, { key: 'Delete' });
    await new Promise(resolve => setTimeout(resolve, 100));
    expect(invoke).not.toHaveBeenCalledWith('delete_to_trash', expect.anything());

    // Close lightbox and try delete again - should work
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(document.querySelector('.lightbox-overlay')).not.toBeInTheDocument());

    fireEvent.keyDown(window, { key: 'x' });
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('delete_to_trash', { paths: ['/tmp/A.png'] }));
  });

  it('closes lightbox when image fails to load', async () => {
    invoke.mockImplementation(async (cmd: string, _args?: any) => {
      if (cmd === 'list_screenshots') return items;
      return null;
    });

    render(<App />);
    await waitFor(() => expect(screen.getByText('A.png')).toBeInTheDocument());

    // Allow DOM to fully settle
    await new Promise(resolve => setTimeout(resolve, 200));

    // Select first item and open lightbox
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    const first = document.querySelector("[data-index='0']") as HTMLElement;
    await waitFor(() => expect(first.className).toMatch(/selected/), { timeout: 2000 });

    fireEvent.keyDown(window, { key: ' ' });
    await waitFor(() => expect(document.querySelector('.lightbox-overlay')).toBeInTheDocument());

    // Simulate image error
    const lightboxImg = document.querySelector('.lightbox-overlay img') as HTMLImageElement;
    fireEvent.error(lightboxImg);

    // Lightbox should close automatically
    await waitFor(() => expect(document.querySelector('.lightbox-overlay')).not.toBeInTheDocument());
  });
});
