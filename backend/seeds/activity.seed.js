// Activity on the jobs: 44 applications on 25 jobs (some with several applicants, 25 jobs
// with none), chats, and 5 jobs taken through approval → chat → SafePay → completed → reviews
// both ways; others stopped at awaiting payment, paid, in progress and waiting for approval.
// Needs users.seed and jobs.seed. The SafePay records point at Stripe TEST-mode objects.
const { load } = require('./load');

module.exports = () =>
  load([
    'jobrequests',
    'chats',
    'orders',
    'payments',
    'payouts',
    'reviews',
    'safepayhistories',
    'contractevents',
    'stripetransferrecords',
    'stripefinancialoperations',
    'notifications',
    'lists',
  ]);
