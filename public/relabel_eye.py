import io
p = r'F:\朱峰社区智能体无限_新版本\朱峰社区智能体无限_5.5.0\public\js\icons.js'
s = io.open(p, encoding='utf-8').read()
i = s.find('\U0001F441\uFE0F')
print('idx', i)
if i >= 0:
    # find closing quote of value: value starts after ':"' ; scan for unescaped "
    j = s.index('":"', i) + 3
    k = j
    while True:
        c = s[k]
        if c == '\\':
            k += 2
            continue
        if c == '"':
            break
        k += 1
    old_val = s[j:k]
    print('old val len', len(old_val))
    def esc(v):
        return v.replace('\\', '\\\\').replace('"', '\\"')
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
    s = s[:j] + esc(eye_svg('gEyeNew_X55')) + s[k:]
    io.open(p, 'w', encoding='utf-8').write(s)
    print('replaced ok')
else:
    print('key not found')
