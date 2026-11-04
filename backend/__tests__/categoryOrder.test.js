// GET /api/categories returns the admin's order (the home page shows the first six).
const sort = jest.fn(() => ({ lean: async () => [] }));
jest.mock('../models/Category', () => ({ find: jest.fn(() => ({ sort })) }));
jest.mock('../utils/lean', () => ({ withDefaults: (_m, docs) => docs }));

const Category = require('../models/Category');
const { getAllCategories } = require('../controllers/categoryController');

test('active categories, sorted by sortOrder then name', async () => {
  const res = { json: jest.fn(), status: jest.fn(() => res) };
  await getAllCategories({}, res);
  expect(Category.find).toHaveBeenCalledWith({ isActive: true });
  expect(sort).toHaveBeenCalledWith({ sortOrder: 1, name: 1 });
  expect(res.json).toHaveBeenCalledWith([]);
});
