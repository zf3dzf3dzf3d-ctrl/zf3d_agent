import io, re
p = r'F:\朱峰社区智能体无限_新版本\朱峰社区智能体无限_5.5.0\public\js\icons.js'
s = io.open(p, encoding='utf-8').read()
# find the eye key context: raw char may be stored as surrogate escapes in file
i = s.find('\U0001F441')
print('raw char found:', i)
# search escaped form \ud83d\udc41
j = s.find('\\ud83d\\udc41')
print('escaped found:', j)
if j >= 0:
    print(repr(s[j-5:j+40]))
