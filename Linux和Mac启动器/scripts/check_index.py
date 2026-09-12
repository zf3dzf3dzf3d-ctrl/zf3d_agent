# -*- coding: utf-8 -*-
import json, sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
from collections import Counter
d = json.load(open('extensions/skills/_market.json', encoding='utf-8'))
print(Counter(i['source'] for i in d['items']))
