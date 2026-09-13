import json
root = json.load(open('canoe.json'))

def find(ch, name):
    for c in ch['chunks']:
        if c['_name'] == name: return c

defn = find(root, 'Definition')
objs = find(defn, 'DefinitionObjects')
comps = []
owner = {}  # param guid -> (comp idx, label)

def pdata(c):
    pd = find(c, 'PersistentData')
    if not pd: return None
    vals = []
    for br in pd['chunks']:
        for it in br['chunks']:
            v = dict(it['items'])
            for sub in it['chunks']:
                v[sub['_name']] = sub['items']
            vals.append(v)
    return vals

for o in objs['chunks']:
    cname = o['items'].get('Name')
    cont = find(o, 'Container')
    it = cont['items']
    comp = {'type': cname, 'nick': it.get('NickName'), 'guid': it.get('InstanceGuid'), 'attrs': {}, 'in': [], 'out': [], 'extra': []}
    bounds = None
    for k, v in it.items():
        if k not in ('Name', 'NickName', 'InstanceGuid', 'Description'):
            comp['attrs'][k] = v
    owner[comp['guid']] = (len(comps), '')
    for c in cont['chunks']:
        n = c['_name']
        if n == 'Attributes':
            comp['pivot'] = c['items'].get('Pivot')
        elif n in ('param_input', 'InputParam'):
            ci = c['items']
            srcs = [v for k, v in ci.items() if k.startswith('Source')and k != 'SourceCount']
            comp['in'].append({'nick': ci.get('NickName'), 'name': ci.get('Name'), 'guid': ci.get('InstanceGuid'), 'src': srcs, 'pd': pdata(c), 'extra': {k: v for k, v in ci.items() if k not in ('NickName', 'Name', 'InstanceGuid', 'Description', 'Optional', 'SourceCount') and not k.startswith('Source')}})
            owner[ci.get('InstanceGuid')] = (len(comps), ci.get('NickName'))
        elif n in ('param_output', 'OutputParam'):
            ci = c['items']
            comp['out'].append({'nick': ci.get('NickName'), 'guid': ci.get('InstanceGuid')})
            owner[ci.get('InstanceGuid')] = (len(comps), ci.get('NickName'))
        elif n == 'ParameterData':
            for sub in c['chunks']:
                ci = sub['items']
                if sub['_name']=='InputParam':
                    srcs = [v for k, v in ci.items() if k.startswith('Source') and k != 'SourceCount']
                    comp['in'].append({'nick': ci.get('NickName'), 'name': ci.get('Name'), 'guid': ci.get('InstanceGuid'), 'src': srcs, 'pd': pdata(sub), 'extra': {}})
                    owner[ci.get('InstanceGuid')] = (len(comps), ci.get('NickName'))
                else:
                    comp['out'].append({'nick': ci.get('NickName'), 'guid': ci.get('InstanceGuid')})
                    owner[ci.get('InstanceGuid')] = (len(comps), ci.get('NickName'))
        else:
            comp['extra'].append({n: c['items'], 'sub': [(s['_name'], s['items']) for s in c['chunks']]})
    # floating params have their own sources at container level
    srcs = [v for k, v in it.items() if k.startswith('Source') and k != 'SourceCount']
    if srcs: comp['src'] = srcs
    pd = pdata(cont)
    if pd: comp['pd'] = pd
    comps.append(comp)

def lab(g):
    if g not in owner: return '?' + g[:8]
    i, pn = owner[g]
    c = comps[i]
    return '#%d %s(%s)%s' % (i, c['type'], c['nick'], '.' + pn if pn else '')

out = []
for i, c in enumerate(comps):
    line = '#%d %s "%s"' % (i, c['type'], c['nick'])
    if c['type']=='Group':
        out.append('#%d GROUP "%s" members=%d' % (i, c['nick'], c['attrs'].get('ID_Count',0))); continue
    a = {k: v for k, v in c['attrs'].items() if k not in ('Optional', 'SourceCount', 'Hidden', 'Locked', 'Mutable') and not k.startswith('Source')}
    a={k:v for k,v in a.items() if not k.startswith('ID')}
    if a: line += ' ' + json.dumps(a)
    out.append(line)
    if c.get('src'): out.append('   <= ' + ', '.join(lab(s) for s in c['src']))
    if c.get('pd'): out.append('   data ' + json.dumps(c['pd'])[:600])
    for e in c['extra']: out.append('   extra ' + json.dumps(e)[:1500])
    for inp in c['in']:
        s = '   in %s' % inp['nick']
        if inp['src']: s += ' <= ' + ', '.join(lab(x) for x in inp['src'])
        if inp['pd']: s += ' data=' + json.dumps(inp['pd'])[:200]
        if inp['extra']: s += ' ' + json.dumps(inp['extra'])[:300]
        out.append(s)
    
open('graph.txt', 'w', encoding='utf8').write('\n'.join(out))
print(len(comps))
