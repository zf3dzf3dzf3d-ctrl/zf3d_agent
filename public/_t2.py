import io, sys
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
lines = open('css/style-chatbox.css', encoding='utf-8').read().splitlines()
for a, b in [(380, 400), (560, 580), (1390, 1412)]:
    print('--- lines', a, b)
    for i in range(a - 1, min(b, len(lines))):
        print(i + 1, lines[i])
out = []
for i, l in enumerate(lines):
    if 'overflow: hidden' in l:
        for j in range(i - 1, max(0, i - 20), -1):
            t = lines[j].strip()
            if t.endswith('{'):
                out.append(f'{i+1} {lines[j][:120]}')
                break
open('_sel.txt', 'w', encoding='utf-8').write('\n'.join(out))
