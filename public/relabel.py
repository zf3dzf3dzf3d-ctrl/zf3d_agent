import io, re
p = r'F:\朱峰社区智能体无限_新版本\朱峰社区智能体无限_5.5.0\public\js\icons.js'
s = io.open(p, encoding='utf-8').read()

def eye_svg(gid):
    return ('<svg class="zf-svg" viewBox="0 0 24 24" width="1.18em" height="1.18em" style="vertical-align:-0.22em" aria-hidden="true">'
            '<defs><linearGradient id="' + gid + '" x1="0" y1="0" x2="0" y2="1">'
            '<stop offset="0" stop-color="#5B9BFF"/><stop offset="1" stop-color="#2F6BFF"/></linearGradient></defs>'
            '<path d="M2.5 12C4.8 7.6 8.2 5.4 12 5.4s7.2 2.2 9.5 6.6c-2.3 4.4-5.7 6.6-9.5 6.6S4.8 16.4 2.5 12z" '
            'fill="none" stroke="url(#' + gid + ')" stroke-width="1.9" stroke-linejoin="round"/>'
            '<circle cx="12" cy="12" r="3.4" fill="url(#' + gid + ')"/>'
            '<circle cx="12" cy="12" r="1.5" fill="#0B1E3F"/>'
            '<circle cx="13.1" cy="10.9" r="0.7" fill="#fff"/>'
            '</svg>')

def arrow(gid, rot):
    return ('<svg class="zf-svg" viewBox="0 0 24 24" width="1.18em" height="1.18em" style="vertical-align:-0.22em" aria-hidden="true">'
            '<defs><linearGradient id="' + gid + '" x1="0" y1="0" x2="0" y2="1">'
            '<stop offset="0" stop-color="#7DD0FF"/><stop offset="1" stop-color="#2F7BFF"/></linearGradient></defs>'
            '<g transform="rotate(' + str(rot) + ' 12 12)">'
            '<path d="M12 19V6" stroke="url(#' + gid + ')" stroke-width="2.6" stroke-linecap="round" fill="none"/>'
            '<path d="M6.2 11.2 12 5l5.8 6.2" stroke="url(#' + gid + ')" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" fill="none"/>'
            '</g></svg>')

def esc(v):
    return v.replace('\\', '\\\\').replace('"', '\\"')

def set_key(s, key, val):
    keypat = ''.join('\\u' + format(ord(c), '04x') for c in key)
    pat = re.compile('"' + keypat + '":"(.*?)(?<!\\\\)"', re.S)
    m = pat.search(s)
    if not m:
        return s, 0
    s2 = s[:m.start()] + '"' + key + '":"' + esc(val) + '"' + s[m.end():]
    return s2, 1

for key, gid, rot in [('\u2B06', 'gEyeArrU_X55', 0), ('\u2B07', 'gEyeArrD_X55', 180)]:
    s, n = set_key(s, key, arrow(gid, rot))
    print(hex(ord(key)), 'arrow replaced', n)
s, n = set_key(s, '\U0001F441', eye_svg('gEyeNew_X55'))
print('eye replaced', n)

io.open(p, 'w', encoding='utf-8').write(s)
print('saved')
