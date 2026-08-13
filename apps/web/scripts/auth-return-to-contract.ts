import assert from 'node:assert/strict';
import {
  EXTENSION_PUBLISH_RETURN_TO,
  normalizeListingLogJobId,
  normalizeLoginReturnTo,
} from '../src/lib/auth-return-to';

assert.equal(normalizeLoginReturnTo(EXTENSION_PUBLISH_RETURN_TO), EXTENSION_PUBLISH_RETURN_TO);
assert.equal(
  normalizeLoginReturnTo('/listing-logs?jobId=job_abc-123'),
  '/listing-logs?jobId=job_abc-123',
);
assert.equal(normalizeListingLogJobId('job_abc-123'), 'job_abc-123');

for (const value of [
  'https://attacker.example/listing-logs?jobId=job-1',
  '//attacker.example/listing-logs?jobId=job-1',
  '/listing-logs/../listing-logs?jobId=job-1',
  '/listing-logs?jobId=job-1&next=https://attacker.example',
  '/listing-logs?jobId=job-1&jobId=job-2',
  '/listing-logs?jobId=job%2D1',
  '/listing-logs?jobId=job-1#fragment',
  '/listing-logs?jobId=job%0A1',
  '/listing-logs?jobId=',
  '/listing-logs?jobId=job.1',
  '/listing-logs?JobId=job-1',
  '/listing-logs/?jobId=job-1',
  '/listing-logs?jobId= job-1',
  '/orders',
]) {
  assert.equal(normalizeLoginReturnTo(value), '', `must reject unsafe returnTo: ${value}`);
}

assert.equal(normalizeListingLogJobId('a'.repeat(201)), null);
assert.equal(normalizeListingLogJobId('job/1'), null);
assert.equal(normalizeListingLogJobId(' job-1'), null);

console.log('PASS Web login returnTo contract');
