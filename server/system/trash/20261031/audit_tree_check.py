import json,io
def count(p):
    d=json.load(io.open(p,encoding='utf-8'))
    acc=[]
    def walk(ns):
        if isinstance(ns,list):
            for v in ns:
                if isinstance(v,dict):
                    acc.append(v); walk(v.get('children',[]))
    walk(d.get('roots',[]))
    nulls=sum(1 for n in acc if n.get('x') is None or n.get('y') is None)
    return len(acc), nulls
base='public/canvas/进化树/maps/'
for p in ['_emergence.emergence.tree.json','_emergence.emergence.tree.json.bak.20261031_小树备份','_emergence_emergence_tree_json.emergence.tree.json']:
    try:
        n,nulls=count(base+p)
        print(unicode(p,'utf8') if isinstance(p,str) else p, 'nodes=',n,'null=',nulls)
    except Exception as e:
        print(p,'ERR',e)
