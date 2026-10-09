"""Read-only differential reference; does not open the source project's runtime."""
import copy
import json
import sys
sys.dont_write_bytecode = True
sys.stdin.reconfigure(encoding='utf-8')
sys.stdout.reconfigure(encoding='utf-8')
sys.path.insert(0, sys.argv[1])
from backend.ledger import Ledger

class MemoryStore:
    def __init__(self): self.values = {}
    def get(self, key, default=None): return copy.deepcopy(self.values.get(key, default))
    def put(self, key, value): self.values[key] = copy.deepcopy(value)
    def list(self, prefix): return [copy.deepcopy(v) for k, v in self.values.items() if k.startswith(prefix)]

result = []
for scenario in json.load(sys.stdin):
    store = MemoryStore()
    ledger = Ledger(store)
    if scenario.get('opening'): ledger.initialize(scenario['opening'], scenario['instruments'], scenario['profile'])
    for payload in scenario['transactions']:
        ledger.add_transaction(payload, scenario['instruments'], scenario['profile'], scenario['snapshots'])
    result.append(ledger.summary(scenario['instruments'], scenario['profile'], scenario['snapshots']))
print(json.dumps(result, ensure_ascii=False, allow_nan=False))
