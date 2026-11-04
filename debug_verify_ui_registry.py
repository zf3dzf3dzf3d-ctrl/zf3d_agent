import urllib.request, json
d = json.loads(urllib.request.urlopen('http://127.0.0.1:8580/api/ext/ui_registry', timeout=5).read())
for it in d.get('items', []):
    print(it.get('id'), '| position:', it.get('position'), '| enabled:', it.get('enabled'))
