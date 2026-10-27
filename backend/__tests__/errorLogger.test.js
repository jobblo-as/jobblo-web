const AdminActivity = require('../models/AdminActivity');
const ErrorLog = require('../models/ErrorLog');
const { logApplicationError } = require('../utils/errorLogger');

afterEach(() => {
  jest.restoreAllMocks();
});

describe('application error logging', () => {
  it('maps unknown integration error codes to a valid AdminActivity action', async () => {
    jest.replaceProperty(ErrorLog, 'db', { readyState: 1 }); // a connected database
    jest.spyOn(ErrorLog, 'findOne').mockReturnValue({ sort: () => ({ select: () => ({ lean: async () => null }) }) });
    const adminActivityCreate = jest.spyOn(AdminActivity, 'create').mockResolvedValue({});
    const errorLogCreate = jest.spyOn(ErrorLog, 'create').mockResolvedValue({});

    await logApplicationError({
      error: new Error('Subscription update could not be reconciled: subscription_not_found'),
      requestPath: '/api/stripe/webhook',
      httpMethod: 'POST',
      httpStatus: 500,
      ip: '127.0.0.1',
      userAgent: 'test',
      errorCode: 'STRIPE_WEBHOOK_HANDLER_FAILED',
      source: 'stripe_webhook',
    });

    expect(AdminActivity.schema.path('action').enumValues).toContain(
      adminActivityCreate.mock.calls[0][0].action
    );
    expect(adminActivityCreate).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'error', action: 'error_integration' })
    );
    expect(errorLogCreate).toHaveBeenCalledWith(
      expect.objectContaining({ errorCode: 'STRIPE_WEBHOOK_HANDLER_FAILED' })
    );
  });

  it('with MongoDB down it logs to the console and returns at once (no 10 s buffered writes)', async () => {
    jest.replaceProperty(ErrorLog, 'db', { readyState: 0 });
    const errorLogCreate = jest.spyOn(ErrorLog, 'create');
    const adminActivityCreate = jest.spyOn(AdminActivity, 'create');
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});

    const started = Date.now();
    await logApplicationError({ error: new Error('boom'), requestPath: '/api/x', httpMethod: 'GET', httpStatus: 500 });

    expect(Date.now() - started).toBeLessThan(1000);
    expect(errorLogCreate).not.toHaveBeenCalled();
    expect(adminActivityCreate).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('GET /api/x → 500: boom'));
  });
});
