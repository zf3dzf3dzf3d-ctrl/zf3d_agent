import io, time, os
p1 = r'public\index.html'
p2 = r'public\_clean_index\index.html.clean'
out = []
def stat(p):
    s = io.open(p, encoding='utf-8').read()
    return (s.count('filetree.js?v=45'), s.count('filetree.js?v=44'), os.path.getsize(p))
s = io.open(p1, encoding='utf-8').read()
a = s.replace('app-filetree.js?v=44','app-filetree.js?v=45').replace('style-filetree.css?v=11','style-filetree.css?v=12')
assert a != s, 'no change'
io.open(p1,'w',encoding='utf-8',newline='').write(a)
s2 = io.open(p2, encoding='utf-8').read()
a2 = s2.replace('app-filetree.js?v=44','app-filetree.js?v=45').replace('style-filetree.css?v=11','style-filetree.css?v=12')
io.open(p2,'w',encoding='utf-8',newline='').write(a2)
out.append('write done')
for i in range(5):
    time.sleep(5)
    out.append('t+%ds p1(v45,v44,size)=%s p2=%s' % ((i+1)*5, stat(p1), stat(p2)))
io.open(r'_guard_exp_result.txt','w').write('\n'.join(out))
