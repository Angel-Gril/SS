import { describe, expect, it } from 'vitest';
import { isPictureUploadRepairJob } from '../routes/listing.js';

describe('listing picture repair jobs', () => {
  it('enables picture repair for collect clone jobs that saved offer image lists', () => {
    expect(isPictureUploadRepairJob({
      source: 'collect-publish',
      mode: 'clone',
      offerImageLists: {
        '1781155551-6DH6': ['https://cdn.example.com/xreal-white.jpg'],
      },
    })).toBe(true);
  });

  it('keeps generic listing batch jobs out of picture repair', () => {
    expect(isPictureUploadRepairJob({
      itemCount: 3,
    })).toBe(false);
  });
});
