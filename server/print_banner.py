import io, sys, json, os
import logging
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
base = r'F:\朱峰智能体无限_新版本\朱峰智能体无限_5.2.5'
ver = '5.2.5'
vj = os.path.join(base, 'private', 'version.json')
if os.path.exists(vj):
    try:
        ver = json.load(open(vj, encoding='utf-8-sig'))['version']
    except Exception:
        logging.debug("swallow", exc_info=True)
print('')
print('  ██████████  ██████████  ██████████  ████████        ██      ████████    ██████████  ██      ██  ██████████')
print('        ██    ██                  ██  ██      ██    ██  ██    ██          ██          ████    ██      ██')
print('      ██      ██████████  ██████████  ██      ██  ██████████  ██    ██    ██████████  ██  ██  ██      ██')
print('    ██        ██                  ██  ██      ██  ██      ██  ██    ██    ██          ██    ████      ██')
print('  ██████████  ██          ██████████  ████████    ██      ██  ████████    ██████████  ██      ██      ██')
print(f'                                              ZF3D Agent  v{ver}')
print('')


