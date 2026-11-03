import os
cands = [
 r"public\js\inline", r"public\css\inline",
]
import glob
files = []
for d in cands:
    files += glob.glob(d + r"\*")
files += [
 r"public\js\inline-00.js", r"public\js\inline-01.js", r"public\js\inline-02.js", r"public\js\inline-03.js",
 r"public\js\inline-04.js", r"public\js\inline-05.js", r"public\js\inline-06.js", r"public\js\inline-07.js",
 r"public\js\inline-08.js", r"public\js\inline-09.js",
 r"server\dispatch_swarm_seg1.py", r"server\dispatch_swarm_seg2.py",
 r"server\screen_recorder_seg1.py", r"server\screen_recorder_seg2.py", r"server\screen_recorder_seg3.py",
 r"server\brain\main_brain_seg1.py", r"server\brain\main_brain_seg2.py", r"server\brain\main_brain_seg3.py",
]
for f in files:
    if not os.path.isfile(f): continue
    sz = os.path.getsize(f)
    head = ""
    try:
        with open(f, "r", encoding="utf-8", errors="replace") as fh:
            head = fh.read(300).replace("\n", " ⏎ ")
    except Exception as e:
        head = str(e)
    print(f"=== {f} ({sz}B)")
    print(head[:280])
    print()
