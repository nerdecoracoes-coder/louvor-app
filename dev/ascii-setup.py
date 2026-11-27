#!/usr/bin/env python3
"""Converte um SQL para ASCII puro: acentos em literais viram E'\\uXXXX' e comentarios perdem os acentos.
Evita que a colagem no SQL Editor (Windows) corrompa a acentuacao. Uso: ascii-setup.py arquivo.sql [...]"""
import sys, unicodedata
def fold(s): return ''.join(c for c in unicodedata.normalize('NFKD', s) if ord(c) < 128)
def esc(s):
    o = []
    for c in s:
        n = ord(c)
        o.append(c if n < 128 else (f'\\u{n:04x}' if n < 0x10000 else f'\\U{n:08x}'))
    return ''.join(o)
def conv(t):
    out = []; i = 0; n = len(t)
    while i < n:
        c = t[i]
        if c == '-' and t[i:i+2] == '--':
            j = t.find('\n', i); j = n if j < 0 else j
            out.append(fold(t[i:j])); i = j
        elif c == '/' and t[i:i+2] == '/*':
            j = t.find('*/', i); j = n if j < 0 else j + 2
            out.append(fold(t[i:j])); i = j
        elif c == "'":
            j = i + 1
            while j < n:
                if t[j] == "'":
                    if t[j+1:j+2] == "'": j += 2; continue
                    break
                j += 1
            lit = t[i+1:j]
            if any(ord(x) > 127 for x in lit):
                assert '\\' not in lit, 'literal com acento e barra invertida: ' + lit[:60]
                pre = out[-1][-1:] if out else ''
                assert not pre.isalpha(), 'prefixo inesperado antes de literal: ' + lit[:60]
                out.append("E'" + esc(lit) + "'")
            else: out.append("'" + lit + "'")
            i = j + 1
        else:
            out.append(c); i += 1
    r = ''.join(out)
    bad = [x for x in r if ord(x) > 127]
    assert not bad, 'sobrou nao-ASCII: ' + ''.join(bad[:20])
    return r
for p in sys.argv[1:]:
    t = open(p, encoding='utf-8').read(); open(p, 'w', encoding='utf-8').write(conv(t)); print('ascii ok:', p)
