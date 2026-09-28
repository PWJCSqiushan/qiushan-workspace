import datetime as dt
import importlib.util
import json
from pathlib import Path
import tempfile
import types
import unittest
from unittest.mock import MagicMock, patch

spec = importlib.util.spec_from_file_location('qs_sync', Path(__file__).with_name('sync.py'))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class LocalSyncTests(unittest.TestCase):
    def setUp(self):
        # Kept under ignored work/; no permanent filesystem deletion in tests.
        folder = Path(__file__).parents[2] / 'work' / 'garmin-tests'
        folder.mkdir(parents=True, exist_ok=True)
        self.root = Path(tempfile.mkdtemp(dir=folder))
        self.root_patch = patch.object(m, 'ROOT', self.root)
        self.root_patch.start()
        self.addCleanup(self.root_patch.stop)
        m._heartbeats.clear()
        self.args = m.parser().parse_args(['--sync', '--watch', '30', '--config', str(self.root/'config.json'), '--state-file', str(self.root/'state.json')])
        m.save(Path(self.args.config), {'baseUrl':'https://example.test', 'connectionId':'synthetic', 'websiteToken':'synthetic-only'})

    def client(self):
        client = MagicMock()
        client.login.return_value = (None, None)
        return client

    def test_refresh_path_persists_sdk_tokens(self):
        (self.root/'tokenstore').mkdir()
        client = self.client()
        with patch.object(m.importlib, 'import_module', return_value=types.SimpleNamespace(Garmin=MagicMock(return_value=client))):
            self.assertIs(m.login({}), client)
        client.login.assert_called_once_with(str(self.root/'tokenstore'))
        client.client.dump.assert_called_once_with(str(self.root/'tokenstore'))

    def test_mfa_status_is_not_misreported_as_network(self):
        (self.root/'tokenstore').mkdir()
        client = self.client()
        client.login.return_value = ('needs_mfa', None)
        with patch.object(m.importlib, 'import_module', return_value=types.SimpleNamespace(Garmin=MagicMock(return_value=client))):
            with self.assertRaisesRegex(RuntimeError, '^reauth_required$'):
                m.login({})

    def test_local_mfa_callback_and_password_not_saved(self):
        client = self.client()
        factory = MagicMock(return_value=client)
        prompt = MagicMock(return_value='123456')
        def authenticate():
            self.assertEqual(factory.call_args.kwargs['prompt_mfa'](), '123456')
            return None, None
        client.login.side_effect = authenticate
        with patch.object(m.importlib, 'import_module', return_value=types.SimpleNamespace(Garmin=factory)):
            m.authenticate({}, 'synthetic-user', 'synthetic-password', prompt)
        self.assertIsNone(client.password)
        self.assertNotIn('synthetic-password', (self.root/'auth-status.json').read_text())
        self.assertNotIn('synthetic-user', (self.root/'auth-status.json').read_text())

    def test_missing_and_rejected_tokens_require_login(self):
        with self.assertRaisesRegex(RuntimeError, '^reauth_required$'):
            m.login({})
        error = type('GarminConnectAuthenticationError', (Exception,), {})('private response')
        self.assertEqual(m.auth_error(error), 'reauth_required')
        self.assertEqual(m.auth_error(TimeoutError('private response')), 'garmin_connection_unavailable')

    def test_dry_run_never_sends_heartbeat(self):
        with patch.object(m, 'api') as call:
            m.heartbeat({'baseUrl':'https://example.test'}, 'reading')
            call.assert_not_called()

    def test_website_proxy_is_local_and_keeps_https_target(self):
        config = {'baseUrl':'https://example.test','websiteProxy':'http://127.0.0.1:7890'}
        response = MagicMock()
        response.__enter__.return_value.read.return_value = b'{"status":"ok"}'
        with patch.object(m.urllib.request, 'build_opener') as opener:
            opener.return_value.open.return_value = response
            self.assertEqual(m.api(config, 'pull')['status'], 'ok')
            self.assertEqual(opener.call_args.args[1].proxies['https'], config['websiteProxy'])
            self.assertTrue(opener.return_value.open.call_args.args[0].full_url.startswith('https://'))
        for proxy in ('http://remote.test:7890', 'http://user:pass@localhost:7890', 'http://localhost:7890/path'):
            with self.assertRaisesRegex(RuntimeError, '^invalid_target$'):
                m.api({**config,'websiteProxy':proxy}, 'pull')

    def test_heartbeat_throttles_and_claims_request(self):
        config = {'baseUrl':'https://example.test','connectionId':'test','_syncEnabled':True}
        with patch.object(m, 'api') as call:
            m.heartbeat(config, 'reading', request_id='request-1')
            m.heartbeat(config, 'reading', request_id='request-1')
            self.assertEqual(call.call_count, 1)
            self.assertEqual(call.call_args.args[2]['requestId'], 'request-1')
            m.heartbeat(config, 'syncing')
            self.assertEqual(call.call_count, 2)

    def test_queued_request_bypasses_regular_interval(self):
        m.save(Path(self.args.state_file), {'lastSuccessAt':m.now().isoformat(), 'lastSyncedDate':'2026-09-28'})
        preview={'from':'2026-09-21','to':'2026-09-28','items':[], 'days':[]}
        def api(_config, action, extra=None):
            return {'status':'queued','requestId':'request-1','baseVersion':1} if action=='pull' else {'accepted':0}
        with patch.object(m, 'api', side_effect=api), patch.object(m, 'fetch', return_value=preview) as fetch:
            result=m.sync_once(self.args)
            self.assertEqual(result['status'], 'synced')
            fetch.assert_called_once()

    def test_pending_commit_reuses_operation_after_network_failure(self):
        preview={'from':'2026-09-01','to':'2026-09-28','items':[], 'days':[]}
        commits=[]
        def api(_config, action, extra=None):
            if action=='pull': return {'status':'queued','requestId':'request-1','baseVersion':7}
            if action=='commit':
                commits.append(dict(extra))
                if len(commits)==1: raise RuntimeError('website_offline')
                return {'accepted':0,'skipped':0}
            return {'status':'ok'}
        with patch.object(m, 'api', side_effect=api), patch.object(m, 'fetch', return_value=preview) as fetch:
            with self.assertRaisesRegex(RuntimeError, 'website_offline'):
                m.sync_once(self.args)
            pending=m.load(Path(self.args.state_file), {})['pendingCommit']
            m.sync_once(self.args)
            self.assertEqual(fetch.call_count,1)
            self.assertEqual(commits[1]['operationId'], pending['operationId'])
            self.assertNotIn('pendingCommit',m.load(Path(self.args.state_file), {}))

    def test_target_override_is_supported_without_writing_config(self):
        self.args.base_url='https://other.example.test'
        self.assertEqual(m.read_config(self.args)['baseUrl'], self.args.base_url)
        self.assertEqual(m.load(Path(self.args.config), {})['baseUrl'],'https://example.test')


if __name__ == '__main__':
    unittest.main()
