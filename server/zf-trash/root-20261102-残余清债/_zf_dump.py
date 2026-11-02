import io, re, sys

def dump(f, a=1, b=None):
    L = io.open(f, encoding='utf-8', errors='replace').read().splitlines()
    b = b or len(L)
    print('======== %s lines %d-%d ========' % (f, a, b))
    for i, l in enumerate(L[a - 1:b], start=a):
        print('%5d: %s' % (i, l.rstrip()))
    print()

if __name__ == '__main__':
    f = sys.argv[1]
    a = int(sys.argv[2]); b = int(sys.argv[3])
    dump(f, a, b)
