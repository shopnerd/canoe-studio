import struct, json, zlib, uuid, sys

d = open(r'C:/Users/zolar/Downloads/canoe_script_012226.gh', 'rb').read()
b = zlib.decompressobj(-15).decompress(d)
p = 0

def rd(fmt):
    global p
    v = struct.unpack_from('<' + fmt, b, p)
    p += struct.calcsize('<' + fmt)
    return v

def rstr():
    global p
    n = 0; shift = 0
    while True:
        c = b[p]; p += 1
        n |= (c & 0x7f) << shift; shift += 7
        if c < 0x80: break
    s = b[p:p + n].decode('utf8', 'replace'); p += n
    return s

def ritem():
    global p
    name = rstr(); idx, = rd('i'); t, = rd('i')
    if t == 1: v = bool(rd('B')[0])
    elif t == 2: v = rd('B')[0]
    elif t == 3: v = rd('i')[0]
    elif t == 4: v = rd('q')[0]
    elif t == 5: v = rd('f')[0]
    elif t == 6: v = rd('d')[0]
    elif t == 7: v = rd('4i')
    elif t == 8: v = rd('q')[0]
    elif t == 9: v = str(uuid.UUID(bytes_le=bytes(b[p:p + 16]))); p += 16
    elif t == 10: v = rstr()
    elif t in (20, 37):
        n, = rd('i'); v = '<bytes %d>' % n; p += n
    elif t == 21:
        n, = rd('i'); v = list(rd('%dd' % n))
    elif t == 30: v = rd('2i')
    elif t == 31: v = rd('2f')
    elif t == 32: v = rd('2i')
    elif t == 33: v = rd('2f')
    elif t == 34: v = rd('4i')
    elif t == 35: v = rd('4f')
    elif t == 36: v = rd('i')[0]
    elif t == 50: v = rd('2d')
    elif t == 51: v = rd('3d')
    elif t == 52: v = rd('4d')
    elif t == 60: v = rd('2d')
    elif t == 61: v = rd('4d')
    elif t == 70: v = rd('6d')
    elif t == 71: v = rd('6d')
    elif t == 72: v = rd('9d')
    elif t == 80: v = rd('3i')
    else: raise Exception('unknown type %d at %d name %s' % (t, p, name))
    return name, idx, v

def rchunk():
    name = rstr(); idx, = rd('i'); ni, nc = rd('2i')
    ch = {'_name': name, '_idx': idx, 'items': {}, 'chunks': []}
    for _ in range(ni):
        n, i, v = ritem()
        key = n if i == -1 else '%s[%d]' % (n, i)
        ch['items'][key] = v
    for _ in range(nc):
        ch['chunks'].append(rchunk())
    return ch

root = rchunk()
print('parsed to', p, 'of', len(b))
json.dump(root, open('canoe.json', 'w'), indent=1, default=list)
