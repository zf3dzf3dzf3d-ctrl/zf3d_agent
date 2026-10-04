import io, re, sys
s = io.open(r'F:\朱峰社区智能体无限_新版本\朱峰社区智能体无限_5.5.0\public\js\icons.js', encoding='utf-8').read()
out = io.open(r'F:\朱峰社区智能体无限_新版本\朱峰社区智能体无限_5.5.0\public\keys_ascii.txt', 'w', encoding='ascii', errors='backslashreplace')
# list all mapping keys (emoji keys) - assume format "key": "value" in some structure; just print chars around each target
chars = ['\U0001F441', '\u2B50', '\u2B06', '\u2B07']
for ch in chars:
    for m in re.finditer(re.escape(ch), s):
        a = max(0, m.start() - 40)
        ctx = s[a:m.start() + 40].replace('\n', ' ')
        out.write(hex(ord(ch)) + ' | ' + repr(ctx) + '\n')
out.write('--- all keys ---\n')
keys = re.findall(r'"((?:[^"\\]|\\.))":', s)
out.write('count=' + str(len(keys)) + '\n')
for k in keys:
    out.write(repr(k) + '\n')
out.close()
print('ok')
