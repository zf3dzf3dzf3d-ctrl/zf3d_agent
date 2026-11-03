# -*- coding: utf-8 -*-
import io, sys
sys.stdout.reconfigure(encoding='utf-8')
s = io.open('server/routes/api_dispatch_post.py', encoding='utf-8').read()
for kw in ['_REL_META', '伴侣', '孩子', '父母']:
    print(kw, s.count(kw))
i = s.find('_REL_META')
print('--- _REL_META block ---')
print(s[i-300:i+700] if i >= 0 else 'NO _REL_META')
j = s.find("== 'relation'")
print('--- relation op block ---')
print(s[j-100:j+1500] if j >= 0 else 'no relation op')
