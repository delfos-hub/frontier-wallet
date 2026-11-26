#!/usr/bin/env python3
"""stamp.py - version every module at build time, not in the repo.

    python3 stamp.py            stamp ?v=<tag> on every import, script tag and app.css
    python3 stamp.py --clean    take every stamp out again (the repo's state)
    python3 stamp.py --print    print the tag only, change nothing

Why: Telegram's webview and some browsers keep modules fetched by a bare name,
so a page could run a mixture of old and new code. Every internal URL carries
the same tag, the first 8 hex of a SHA-1 over all modules and app.css with
their stamps removed. Change one line anywhere and every URL changes.

Why at build time: the stamps used to be committed (bust37.py in a pre-commit
hook). Every branch then changed the same line in almost every file, so each
merge put every other open PR in conflict and dismissed its approval. The repo
now keeps no stamps; Cloudflare Pages runs this as its build command:

    Build command:            python3 stamp.py
    Build output directory:   /

It is deterministic: the same commit gives the same tag, so `--print` on a
checkout of main can be compared with what is live (the ?v= in index.html).
No dependencies beyond the standard library. The wallet and the tests run
without it (a bare import is a valid import).
"""
import hashlib
import io
import os
import re
import sys

JS = os.path.join('assets', 'js')
CSS = os.path.join('assets', 'css', 'app.css')
IX = 'index.html'
VER = re.compile(r"\?v=[0-9a-f]{6,12}")


def read(p):
    return io.open(p, encoding='utf-8').read()


def write(p, s):
    io.open(p, 'w', encoding='utf-8', newline='').write(s)


def modules():
    return sorted(f for f in os.listdir(JS) if f.endswith('.js'))


def tag_of(files):
    # over the clean text, so a stamped and an unstamped checkout give one tag
    h = hashlib.sha1()
    for f in files:
        h.update(VER.sub('', read(os.path.join(JS, f))).encode('utf-8'))
    if os.path.exists(CSS):
        h.update(read(CSS).encode('utf-8'))
    return h.hexdigest()[:8]


def clean(files):
    n = 0
    for p in [os.path.join(JS, f) for f in files] + [IX]:
        s = read(p)
        t = VER.sub('', s)
        if t != s:
            write(p, t)
            n += 1
    return n


def stamp(files, tag):
    names = [f[:-3] for f in files]
    for f in files:
        p = os.path.join(JS, f)
        s = read(p)
        for n in names:
            s = s.replace("from './%s.js'" % n, "from './%s.js?v=%s'" % (n, tag))
            s = s.replace("import './%s.js'" % n, "import './%s.js?v=%s'" % (n, tag))
        write(p, s)
    s = read(IX)
    s = s.replace('href="assets/css/app.css"', 'href="assets/css/app.css?v=%s"' % tag)
    s = re.sub(r'src="assets/js/([a-z0-9_-]+\.js)"', lambda m: 'src="assets/js/%s?v=%s"' % (m.group(1), tag), s)
    write(IX, s)


def unstamped(files):
    bad = []
    for f in files:
        for m in re.finditer(r"(?:from|import) '\./([a-z0-9_-]+\.js)(\?v=[0-9a-f]+)?'", read(os.path.join(JS, f))):
            if not m.group(2):
                bad.append('%s -> %s' % (f, m.group(1)))
    s = read(IX)
    for m in re.finditer(r'src="assets/js/([a-z0-9_-]+\.js)(\?v=[0-9a-f]+)?"', s):
        if not m.group(2):
            bad.append('index.html -> %s' % m.group(1))
    if 'href="assets/css/app.css"' in s:
        bad.append('index.html -> app.css')
    return bad


def main(argv):
    if not os.path.isdir(JS) or not os.path.exists(IX):
        sys.exit('run this from the repo root')
    files = modules()
    tag = tag_of(files)
    if '--print' in argv:
        print(tag)
        return
    clean(files)
    if '--clean' in argv:
        print('no stamps left in %d modules and index.html' % len(files))
        return
    stamp(files, tag)
    bad = unstamped(files)
    if bad:
        print('these did not get a version:')
        for b in bad:
            print('  ' + b)
        sys.exit(1)
    print('version %s on every import, script tag and app.css (%d modules)' % (tag, len(files)))


if __name__ == '__main__':
    main(sys.argv[1:])
