import sys, json
sys.dont_write_bytecode = True
sys.path.insert(0, sys.argv[1])
from backend.advisor import build_advice
sys.stdin.reconfigure(encoding='utf-8')
sys.stdout.reconfigure(encoding='utf-8')
cases = json.load(sys.stdin)
result = [build_advice(x['instruments'], x['snapshots'], x['market'], x['portfolio'], x['profile'], x['account_context'], as_of=x['as_of'], generated_at=x['generated_at'], context_id=x['context_id']) for x in cases]
json.dump(result, sys.stdout, ensure_ascii=False)
