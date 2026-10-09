import test from 'node:test';
import assert from 'node:assert/strict';
import {investmentRefreshDue} from '../lib/investment-cron.ts';

test('investment background refresh uses Shanghai weekday windows and bounded quarter-hour slots',()=>{
 assert.equal(investmentRefreshDue(new Date('2026-10-09T01:30:00Z')),true);
 assert.equal(investmentRefreshDue(new Date('2026-10-09T07:15:00Z')),true);
 for(const stamp of ['2026-10-09T01:35:00Z','2026-10-09T07:30:00Z','2026-10-09T16:00:00Z','2026-10-10T02:00:00Z'])assert.equal(investmentRefreshDue(new Date(stamp)),false);
});
