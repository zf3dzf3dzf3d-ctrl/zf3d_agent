from util_log import get_logger

log = get_logger('zf_patch')
NL = b"\r\n\r\n            "
old = (b"            left: 40px;" + NL + b"right: 40px;" + NL + b"top: 40px;" + NL
       + b"bottom: 40px;" + NL + b"width: auto;" + NL + b"max-width: 1800px;")
new = (b"            /* v533: clamp inset */" + NL + b"--chatbox-inset: clamp(16px, 2.5vw, 180px);" + NL
       + b"left: var(--chatbox-inset);" + NL + b"right: var(--chatbox-inset);" + NL
       + b"top: var(--chatbox-inset);" + NL + b"bottom: var(--chatbox-inset);" + NL
       + b"width: auto;" + NL + b"max-width: calc(100vw - 2 * var(--chatbox-inset));")

def fix(p):
    raw = open(p, 'rb').read()
    if old not in raw:
        return 'NOT_FOUND'
    open(p, 'wb').write(raw.replace(old, new))
    return 'OK inset=%d' % open(p, 'rb').read().count(b'chatbox-inset')

log.info('%s %s', 'pub css:', fix('public/css/style-chatbox.css'))
log.info('%s %s', 'srv css:', fix('server/public/css/style-chatbox.css'))
for h in ['public/index.html', 'server/public/index.html']:
    raw = open(h, 'rb').read()
    open(h, 'wb').write(raw.replace(b'style-chatbox.css?v=532', b'style-chatbox.css?v=533'))
    log.info('%s %s %s', h, 'v533=', open(h, 'rb').read().count(b'v=533'))
import time
time.sleep(4)
log.info('%s %s', 'after4s pub:', open('public/css/style-chatbox.css', 'rb').read().count(b'chatbox-inset'))
log.info('%s %s', 'after4s srv:', open('server/public/css/style-chatbox.css', 'rb').read().count(b'chatbox-inset'))
