import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import GroceryList from '../GroceryList';

// In-memory stand-in for the /groceryList endpoints, mirroring backend/routers/groceryList.py
let db;
const mockApiFetch = jest.fn();
jest.mock('../../api', () => ({ apiFetch: (...a) => mockApiFetch(...a) }));
jest.mock('../../contexts/ToastContext', () => ({
  useToast: () => ({ success: jest.fn(), error: jest.fn() }),
}));

const json = (body, ok = true) => Promise.resolve({ ok, json: () => Promise.resolve(body) });

function fakeBackend(path, opts = {}) {
  const method = opts.method || 'GET';
  const body = opts.body ? JSON.parse(opts.body) : null;
  let m;
  if (path.startsWith('/groceryList/userID/')) return json([db]);
  if ((m = path.match(/^\/groceryList\/L1\/items\/([^/]+)\/check$/)) && method === 'PATCH') {
    const it = db.items.find(i => i.id === m[1]);
    if (!it) return json({}, false);
    it.checked = !it.checked;
    return json({ checked: it.checked });
  }
  if ((m = path.match(/^\/groceryList\/L1\/items\/([^/]+)$/))) {
    const it = db.items.find(i => i.id === m[1]);
    if (!it) return json({}, false);
    if (method === 'DELETE') { db.items = db.items.filter(i => i.id !== m[1]); return json({}); }
    if (method === 'PATCH') { Object.assign(it, body); return json({ item: it }); }
  }
  // Older backend: delete by name
  if ((m = path.match(/^\/groceryList\/L1\/([^/]+)$/)) && method === 'DELETE') {
    db.items = db.items.filter(i => i.name !== decodeURIComponent(m[1]));
    return json({});
  }
  if (path === '/groceryList/L1' && method === 'PUT') {
    const item = { id: 'new' + db.items.length, sources: [], ...body };
    db.items.push(item);
    return json({ item });
  }
  return json({}, false);
}

const renderList = async () => {
  render(<GroceryList user={{ id: 'u1' }} />);
  await screen.findByText('Flour');
};

beforeEach(() => {
  db = {
    _id: 'L1',
    items: [
      { id: 'a', name: 'Flour', quantity: '2', unit: 'cup', category: 'pantry', checked: false, sources: [] },
      { id: 'b', name: 'Milk', quantity: '1', unit: '', category: 'dairy', checked: false, sources: [] },
      { id: 'c', name: '', quantity: '', unit: '', category: 'other', checked: false, sources: [] },
    ],
  };
  mockApiFetch.mockReset();
  mockApiFetch.mockImplementation(fakeBackend);
});

test('edit row shows name, qty and unit filled in, and saving persists them', async () => {
  await renderList();
  fireEvent.click(screen.getByText('Flour'));
  expect(screen.getByPlaceholderText('Name').value).toBe('Flour');
  expect(screen.getByPlaceholderText('Qty').value).toBe('2');
  expect(screen.getByPlaceholderText('Unit').value).toBe('cup');
  fireEvent.change(screen.getByPlaceholderText('Unit'), { target: { value: 'tbsp' } });
  fireEvent.click(screen.getByLabelText('Save item'));
  await waitFor(() => expect(db.items[0].unit).toBe('tbsp'));
  expect(screen.getByText('2 tbsp')).toBeTruthy();
});

test('delete removes the item, including one with an empty name', async () => {
  await renderList();
  const row = screen.getByText('Milk').closest('.grocery-item');
  fireEvent.click(within(row).getByLabelText('Remove'));
  await waitFor(() => expect(db.items.find(i => i.id === 'b')).toBeUndefined());
  const blank = screen.getByText('(no name)').closest('.grocery-item');
  fireEvent.click(within(blank).getByLabelText('Remove'));
  await waitFor(() => expect(db.items.find(i => i.id === 'c')).toBeUndefined());
});

test('items from a backend that sends no ids can still be deleted', async () => {
  db.items.forEach(i => { delete i.id; });
  await renderList();
  const row = screen.getByText('Milk').closest('.grocery-item');
  fireEvent.click(within(row).getByLabelText('Remove'));
  await waitFor(() => expect(screen.queryByText('Milk')).toBeNull());
  expect(mockApiFetch.mock.calls.some(([p]) => p.includes('undefined'))).toBe(false);
});
