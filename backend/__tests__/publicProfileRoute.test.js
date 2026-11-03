// A shared profile link must open for a visitor who is not logged in. GET /api/users/:id
// required login, so guests got 401 and the page showed "Fant ikke brukeren".
jest.mock(
  '../controllers/userController',
  () =>
    new Proxy(
      { getUserById: (req, res) => res.json({ reached: true, userId: req.userId ?? null }) },
      { get: (target, key) => target[key] || ((req, res) => res.json({})) }
    )
);
jest.mock(
  '../controllers/serviceController',
  () => new Proxy({}, { get: () => (req, res) => res.json({}) })
);
jest.mock(
  '../controllers/reviewController',
  () =>
    new Proxy(
      { getUserReviews: (req, res) => res.json([{ reached: true }]) },
      { get: (target, key) => target[key] || ((req, res) => res.json({})) }
    )
);

const express = require('express');
const request = require('supertest');

const app = express()
  .use('/api/users', require('../routes/users'))
  .use('/api', require('../routes/review'));

test('a guest reaches the public profile, without a user id', async () => {
  const res = await request(app).get('/api/users/6aea3747f112ab8acd7e9bec');
  expect(res.status).toBe(200);
  expect(res.body).toEqual({ reached: true, userId: null });
});

test("a guest also gets the profile's reviews", async () => {
  const res = await request(app).get('/api/users/6aea3747f112ab8acd7e9bec/reviews?role=seeker');
  expect(res.status).toBe(200);
  expect(res.body).toEqual([{ reached: true }]);
});

test('the other user and review routes still need login', async () => {
  expect((await request(app).get('/api/users/search?q=a')).status).toBe(401);
  expect((await request(app).get('/api/users/blocked')).status).toBe(401);
  expect((await request(app).post('/api/services/x/reviews')).status).toBe(401);
});
