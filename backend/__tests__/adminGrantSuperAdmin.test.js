/**
 * Granting superAdmin from the admin dashboard (PUT /api/admin/users/:id/role):
 *  - needs a step-up token for this admin and login session (emailed one-time code);
 *  - other role changes still work without one;
 *  - never to an inactive account, never your own role.
 * The route itself sits behind authenticate + requireAdmin (superAdmin only).
 * Models mocked; real controller and real step-up guard.
 */
jest.mock('../models/User', () => ({
  findById: jest.fn(),
  findByIdAndUpdate: jest.fn(),
  countDocuments: jest.fn(),
}));
jest.mock('../services/admin/activityService', () => ({ logActivity: jest.fn() }));

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';

const fs = require('fs');
const path = require('path');
const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const User = require('../models/User');
const { logActivity } = require('../services/admin/activityService');
const users = require('../controllers/admin/usersAdminController');

const ADMIN = new mongoose.Types.ObjectId();
const TARGET = new mongoose.Types.ObjectId();
const SESSION = 'sess-1';

const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  req.user = { _id: ADMIN, role: 'superAdmin' };
  req.userId = String(ADMIN);
  req.sessionId = SESSION;
  next();
});
app.put('/users/:id/role', users.requireStepUpForSuperAdmin, users.changeUserRole);

const stepUpToken = (sub = String(ADMIN), sid = SESSION) =>
  jwt.sign({ sub, sid, purpose: 'dev-step-up' }, process.env.JWT_SECRET, { expiresIn: 600 });

const leanResult = (value) => ({ select: () => ({ lean: async () => value }) });
const target = (fields = {}) =>
  User.findById.mockReturnValue(
    leanResult({ _id: TARGET, role: 'user', name: 'Kari', email: 'kari@test.no', ...fields })
  );

beforeEach(() => {
  jest.clearAllMocks();
  User.findByIdAndUpdate.mockImplementation((_id, update) => ({
    select: async () => ({ _id: TARGET, role: update.role }),
  }));
});

describe('grant superAdmin', () => {
  it('is refused without a step-up token, and nothing is written', async () => {
    target();
    const res = await request(app).put(`/users/${TARGET}/role`).send({ role: 'superAdmin' });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('STEP_UP_REQUIRED');
    expect(User.findByIdAndUpdate).not.toHaveBeenCalled();
  });

  it('is refused with a token from another admin or another session', async () => {
    target();
    for (const token of [stepUpToken('someone-else'), stepUpToken(String(ADMIN), 'old-sess')]) {
      const res = await request(app)
        .put(`/users/${TARGET}/role`)
        .set('X-Step-Up-Token', token)
        .send({ role: 'superAdmin' });
      expect(res.status).toBe(401);
    }
    expect(User.findByIdAndUpdate).not.toHaveBeenCalled();
  });

  it('works with a valid step-up token and is audited', async () => {
    target();
    const res = await request(app)
      .put(`/users/${TARGET}/role`)
      .set('X-Step-Up-Token', stepUpToken())
      .send({ role: 'superAdmin' });
    expect(res.status).toBe(200);
    expect(User.findByIdAndUpdate).toHaveBeenCalledWith(
      TARGET,
      { role: 'superAdmin' },
      expect.any(Object)
    );
    expect(logActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'role_change',
        metadata: { prevRole: 'user', newRole: 'superAdmin' },
      })
    );
  });

  it('never makes an inactive account superAdmin', async () => {
    target({ accountStatus: 'inactive' });
    const res = await request(app)
      .put(`/users/${TARGET}/role`)
      .set('X-Step-Up-Token', stepUpToken())
      .send({ role: 'superAdmin' });
    expect(res.status).toBe(400);
    expect(User.findByIdAndUpdate).not.toHaveBeenCalled();
  });

  it('cannot change your own role, even with step-up', async () => {
    const res = await request(app)
      .put(`/users/${ADMIN}/role`)
      .set('X-Step-Up-Token', stepUpToken())
      .send({ role: 'user' });
    expect(res.status).toBe(403);
  });

  it('other role changes still need no step-up; unknown roles are refused', async () => {
    target();
    const ok = await request(app).put(`/users/${TARGET}/role`).send({ role: 'provider' });
    expect(ok.status).toBe(200);
    for (const role of ['admin', ['superAdmin'], { $ne: 'x' }]) {
      const bad = await request(app).put(`/users/${TARGET}/role`).send({ role });
      expect([400, 401]).toContain(bad.status);
    }
  });

  it('the admin route uses the guard, behind requireAdmin', () => {
    const src = fs.readFileSync(path.join(__dirname, '../routes/admin/index.js'), 'utf8');
    expect(src).toMatch(/router\.use\(authenticate, requireAdmin/);
    expect(src).toMatch(
      /'\/users\/:id\/role',\s*usersAdminController\.requireStepUpForSuperAdmin,\s*usersAdminController\.changeUserRole/
    );
  });
});

describe('second lock in the controller', () => {
  it('refuses superAdmin when called without the step-up guard', async () => {
    const solo = express();
    solo.use(express.json());
    solo.use((req, _res, next) => {
      req.user = { _id: ADMIN, role: 'superAdmin' };
      req.sessionId = SESSION;
      next();
    });
    solo.put('/users/:id/role', users.changeUserRole);
    target();
    const res = await request(solo)
      .put(`/users/${TARGET}/role`)
      .set('X-Step-Up-Token', stepUpToken())
      .send({ role: 'superAdmin' });
    expect(res.status).toBe(401);
    expect(User.findByIdAndUpdate).not.toHaveBeenCalled();
  });
});
