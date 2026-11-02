# -*- coding: utf-8 -*-
"""评测题库哈希锁定 + 自动判分。
用法:
  python eval_question_bank.py lock          # 首次:对题库生成哈希锁 eval_questions.lock
  python eval_question_bank.py verify        # 加载前校验(拒绝重复/被篡改题目)
  python eval_question_bank.py run <结果.json>  # 对模型输出自动判分(答案精确/包含匹配)
题库格式: JSON 列表,每题 {"id","question","answer"};也接受 {"questions":[...]}
"""
import io, sys, os, json, hashlib

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
BASE = os.path.dirname(os.path.abspath(__file__))
BANK = os.path.join(BASE, 'eval_questions.json')
LOCK = os.path.join(BASE, 'eval_questions.lock')


def load_bank():
    if not os.path.exists(BANK):
        print(f"[ERR] 题库不存在: {BANK}")
        sys.exit(2)
    data = json.load(open(BANK, encoding='utf-8'))
    qs = data['questions'] if isinstance(data, dict) else data
    assert isinstance(qs, list) and qs, "题库格式错误"
    return qs


def q_hash(q):
    norm = json.dumps({k: q.get(k, '') for k in ('id', 'question', 'answer')},
                      ensure_ascii=False, sort_keys=True)
    return hashlib.sha256(norm.encode('utf-8')).hexdigest()


def cmd_lock():
    qs = load_bank()
    locks, seen = {}, {}
    for q in qs:
        h = q_hash(q)
        if h in seen:
            print(f"[ERR] 重复题目: id={q.get('id')} 与 id={seen[h]} 哈希相同,拒绝锁定")
            sys.exit(1)
        seen[h] = q.get('id')
        locks[q.get('id')] = h
    json.dump(locks, open(LOCK, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print(f"[OK] 已锁定 {len(locks)} 道题 → {LOCK}")


def cmd_verify():
    qs = load_bank()
    if not os.path.exists(LOCK):
        print("[ERR] 无哈希锁,先运行 lock")
        sys.exit(2)
    locks = json.load(open(LOCK, encoding='utf-8'))
    seen, errs = set(), []
    for q in qs:
        h = q_hash(q)
        if h in seen:
            errs.append(f"重复题目 id={q.get('id')}")
        seen.add(h)
        exp = locks.get(q.get('id'))
        if exp is None:
            errs.append(f"未知题目 id={q.get('id')}(不在锁内)")
        elif exp != h:
            errs.append(f"题目被篡改 id={q.get('id')}")
    if errs:
        print("[REJECT] 校验失败:")
        for e in errs:
            print("  -", e)
        sys.exit(1)
    print(f"[OK] {len(qs)} 道题全部通过哈希校验,无重复/篡改")


def norm(s):
    return ''.join(str(s).split()).lower()


def cmd_run(result_path):
    qs = load_bank()
    answers = {q['id']: norm(q.get('answer', '')) for q in qs}
    res = json.load(open(result_path, encoding='utf-8'))
    items = res.get('results', res) if isinstance(res, dict) else res
    total = correct = 0
    for it in items:
        qid = it.get('id')
        if qid not in answers:
            print(f"[SKIP] 未知题号 {qid}")
            continue
        total += 1
        out = norm(it.get('output', ''))
        ans = answers[qid]
        ok = ans and ans in out
        correct += ok
        print(f"  {'PASS' if ok else 'FAIL'} {qid}")
    print(f"\n得分: {correct}/{total} = {(correct / total * 100 if total else 0):.1f}%")
    sys.exit(0 if total else 2)


if __name__ == '__main__':
    cmd = sys.argv[1] if len(sys.argv) > 1 else 'verify'
    {'lock': cmd_lock, 'verify': cmd_verify}.get(cmd, cmd_run)(*(sys.argv[2:3] if cmd not in ('lock', 'verify') else ()))
