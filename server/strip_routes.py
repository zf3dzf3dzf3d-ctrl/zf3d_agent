import re

PATH = r'F:\朱峰社区智能体无限_新版本\新版本生产\朱峰社区智能体无限_5.0.0\server\handler_routes.py'

# These methods existed ONLY in deleted handler_*.py Mixins.
DELETED_HANDLERS = {
    # tools
    '_handle_tools_post', '_handle_tools_get',
    '_handle_tool_action_post', '_handle_tool_action_get',
    # image_gen
    '_handle_image_gen',
    # zf3d
    '_handle_zf3d_login', '_handle_zf3d_checkin', '_handle_zf3d_status',
    '_handle_zf3d_heartbeat_config', '_handle_zf3d_heartbeat',
    '_handle_zf3d_site_config', '_handle_zf3d_logo_img',
    # health_guard
    '_handle_health_config_get', '_handle_health_config_save',
    # update_checker
    '_handle_update_status', '_handle_check_update', '_handle_do_update',
    # project memory
    '_handle_generate_project_memory', '_handle_project_image',
}

with open(PATH, 'r', encoding='utf-8') as f:
    text = f.read()
lines = text.split('\n')
print(f"Total lines: {len(lines)}")

to_remove = []
i = 0
while i < len(lines):
    line = lines[i]
    stripped = line.strip()
    m = re.match(r'^\s*if\s+path\s*(==|startswith\()\s*[\'"]?(/api/[^\\\'\")]+)', stripped)
    if m and i + 2 < len(lines):
        j = i + 1
        while j < len(lines) and lines[j].strip() == '':
            j += 1
        if j + 1 < len(lines):
            call_line = lines[j].strip()
            cm = re.match(r'self\._handle_(\w+)\s*\(', call_line)
            if cm:
                handler = '_handle_' + cm.group(1)
                if handler in DELETED_HANDLERS:
                    k = j + 1
                    while k < len(lines) and not lines[k].strip().startswith('return'):
                        k += 1
                    end = k + 1
                    while end < len(lines) and lines[end].strip() == '':
                        end += 1
                    # include preceding comment header (with ====) if it belongs to this block
                    start = i
                    ps = i - 1
                    last_comment_block_start = -1
                    while ps >= 0 and (lines[ps].strip().startswith('#') or lines[ps].strip() == ''):
                        if lines[ps].strip().startswith('#') and '=====' in lines[ps]:
                            last_comment_block_start = ps
                        ps -= 1
                    # only take the comment if there's no other code between comment and our block
                    # i.e., ps+1 == start OR (between ps+1 and start only comments/blanks)
                    if last_comment_block_start >= 0:
                        # verify no code between last_comment_block_start+1 and start
                        gap_clean = all(
                            lines[g].strip() == '' or lines[g].strip().startswith('#')
                            for g in range(last_comment_block_start + 1, start)
                        )
                        if gap_clean:
                            start = last_comment_block_start
                    to_remove.append((start, end, lines[i].strip(), handler))
                    i = end
                    continue
    i += 1

print(f"Blocks to remove: {len(to_remove)}")
for s, e, hdr, h in to_remove:
    print(f"  L{s+1}-L{e}: {hdr}  [{h}]")

remove_set = set()
for s, e, _, _ in to_remove:
    for idx in range(s, e):
        remove_set.add(idx)

new_lines = []
for idx, ln in enumerate(lines):
    if idx not in remove_set:
        new_lines.append(ln)

new_text = '\n'.join(new_lines)
with open(PATH + '.bak2', 'w', encoding='utf-8') as f:
    f.write(text)
with open(PATH, 'w', encoding='utf-8') as f:
    f.write(new_text)

print(f"\nOriginal: {len(lines)} lines")
print(f"New:      {len(new_lines)} lines")
print(f"Removed:  {len(lines) - len(new_lines)} lines")
