// CI has no env file: give the session/JWT code a test-only secret when none is set, or
// express-session errors on every /api/auth request ("secret option required").
process.env.JWT_SECRET = process.env.JWT_SECRET || 'jest-only-jwt-secret';

jest.mock('./models/PushToken', () => ({
  find: jest.fn(() => ({
    select: jest.fn(() => ({ lean: jest.fn().mockResolvedValue([]) })),
  })),
  findOneAndUpdate: jest.fn().mockResolvedValue(null),
  updateOne: jest.fn().mockResolvedValue({ acknowledged: true }),
  updateMany: jest.fn().mockResolvedValue({ acknowledged: true }),
  deleteMany: jest.fn().mockResolvedValue({ acknowledged: true }),
}));
