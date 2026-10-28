import assert from 'node:assert/strict';
import test from 'node:test';
import { Wyd727AttemptLimiter } from './wyd-727-attempt-limiter.mjs';

test('attempt limiter blocks after the configured failures and resets at the window boundary', () => {
  let now = 10_000;
  const limiter = new Wyd727AttemptLimiter({ maxFailures: 3, windowMs: 1000, maxKeys: 2, now: () => now });

  assert.equal(limiter.canAttempt('127.0.0.1'), true);
  assert.equal(limiter.recordFailure('127.0.0.1'), 1);
  assert.equal(limiter.recordFailure('127.0.0.1'), 2);
  assert.equal(limiter.recordFailure('127.0.0.1'), 3);
  assert.equal(limiter.canAttempt('127.0.0.1'), false);
  assert.equal(limiter.recordFailure('127.0.0.1'), 3);

  now += 1000;
  assert.equal(limiter.canAttempt('127.0.0.1'), true);
  assert.equal(limiter.recordFailure('127.0.0.1'), 1);
});

test('attempt limiter clears successes and bounds distinct keys', () => {
  let now = 0;
  const limiter = new Wyd727AttemptLimiter({ maxFailures: 2, windowMs: 500, maxKeys: 1, now: () => now });
  limiter.recordFailure('account-a');
  assert.equal(limiter.canAttempt('account-b'), false);
  limiter.clear('account-a');
  assert.equal(limiter.canAttempt('account-b'), true);

  limiter.recordFailure('account-b');
  now = 500;
  assert.equal(limiter.canAttempt('account-c'), true);
});
