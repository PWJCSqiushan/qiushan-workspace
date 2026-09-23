import datetime as dt
import importlib.util
from pathlib import Path
import unittest
spec=importlib.util.spec_from_file_location("sync_helper",Path(__file__).parents[1]/"scripts"/"garmin"/"sync.py")
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class SleepTests(unittest.TestCase):
    def payload(self):
        start=dt.datetime(2026,9,19,16,tzinfo=dt.timezone.utc)
        millis=lambda x:int(x.timestamp()*1000)
        return {"dailySleepDTO":{"sleepStartTimestampGMT":millis(start),"sleepEndTimestampGMT":millis(start+dt.timedelta(hours=2)),
          "deepSleepSeconds":1800,"lightSleepSeconds":1800,"remSleepSeconds":1800,"awakeSleepSeconds":1800,"napTimeSeconds":600},
          "sleepLevels":[{"startGMT":(start+dt.timedelta(minutes=30*i)).isoformat(),"endGMT":(start+dt.timedelta(minutes=30*(i+1))).isoformat(),"activityLevel":v} for i,v in enumerate([0,3,1,2])]}
    def test_exact_awake_subtraction_and_utc(self):
        rows,issues=m.extract_sleep(self.payload(),"2026-09-20")
        self.assertEqual(len(rows),2);self.assertEqual(rows[0]["start"],"2026-09-20T00:00:00+08:00")
        self.assertEqual(rows[0]["end"],"2026-09-20T00:30:00+08:00");self.assertEqual(rows[1]["start"],"2026-09-20T01:00:00+08:00")
        self.assertFalse(any(r["estimated"] for r in rows));self.assertIn("nap_total_without_window",issues)
    def test_numeric_mapping_requires_matching_device_totals(self):
        data=self.payload();data["dailySleepDTO"]["awakeSleepSeconds"]=300
        rows,issues=m.extract_sleep(data,"2026-09-20")
        self.assertEqual(len(rows),1);self.assertTrue(rows[0]["estimated"])
        self.assertIn("sleep_window_estimate_awake_positions_unverified",issues)
    def test_total_duration_never_invents_window(self):
        rows,issues=m.extract_sleep({"dailySleepDTO":{"sleepTimeSeconds":7200,"napTimeSeconds":900}},"2026-09-20")
        self.assertEqual(rows,[]);self.assertIn("missing_or_invalid_sleep_window",issues)
    def test_nested_heart_rate_never_becomes_sleep(self):
        data=self.payload();data["sleepHeartRate"]=[{"start":1,"end":999999,"activityLevel":0}]
        a,_=m.extract_sleep(data,"2026-09-20");b,_=m.extract_sleep(self.payload(),"2026-09-20");self.assertEqual(a,b)
if __name__=="__main__":unittest.main()
