import re, os, base64
B=os.path.expanduser('~/.pixelwall-build/mooboard-site/brand'); K=B+'/kit'
def inner(n):
    s=open(f'{B}/{n}').read().strip(); return re.sub(r'^<svg[^>]*>|</svg>$','',s).strip()
MARK={c:inner(f'mark-{c}.svg') for c in ['sky','black','white','orange']}
WORD={c:inner(f'wordmark-{c}.svg') for c in ['deep','white','sky','black']}
b64=lambda p: base64.b64encode(open(p,'rb').read()).decode()
def marksvg(c): return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 136 112" role="img" aria-label="mooboard mark">{MARK[c]}</svg>'
WH=67.2; WW=4483*WH/775; GAP=22.4; LW=136+GAP+WW
def lockbody(m,w):
    return (f'<svg x="0" y="0" width="136" height="112" viewBox="0 0 136 112">{MARK[m]}</svg>'
            f'<svg x="{136+GAP:.1f}" y="{(112-WH)/2:.1f}" width="{WW:.1f}" height="{WH}" viewBox="0 0 4483 775">{WORD[w]}</svg>')
def lockup(m,w,extra=''):
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {LW:.1f} 112" role="img" aria-label="mooboard" {extra}>{lockbody(m,w)}</svg>'
LOCK={'light':('sky','deep'),'dark':('sky','white'),'sky':('white','white')}
for k,(m,w) in LOCK.items():
    open(f'{K}/lockup-{k}.svg','w').write(lockup(m,w)+'\n')
# clear space diagram
M=56
cs=(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{-M-4} {-M-4} {LW+2*M+8:.1f} {112+2*M+8}">'
    '<defs><pattern id="hatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="8" height="8" fill="#E9FBF7"/><rect width="3" height="8" fill="#77EDD7" opacity=".35"/></pattern></defs>'
    f'<rect x="{-M}" y="{-M}" width="{LW+2*M:.1f}" height="{112+2*M}" rx="14" fill="url(#hatch)"/>'
    f'<rect x="0" y="0" width="{LW:.1f}" height="112" fill="#fff"/>'
    + lockbody('sky','deep') +
    f'<rect x="{-M}" y="{-M}" width="{LW+2*M:.1f}" height="{112+2*M}" rx="14" fill="none" stroke="#0E6B5E" stroke-width="2" stroke-dasharray="8 6"/>'
    f'<rect x="0" y="0" width="{LW:.1f}" height="112" fill="none" stroke="#FFB7C9" stroke-width="2"/>'
    # half-mark units: small marks in the margin
    f'<g opacity=".9"><svg x="{-M+6}" y="{-M+6}" width="44" height="44" viewBox="0 0 136 112">{MARK["sky"]}</svg>'
    f'<svg x="{LW+6:.1f}" y="{112+6}" width="44" height="44" viewBox="0 0 136 112">{MARK["sky"]}</svg></g>'
    '</svg>')
# swatches
def L(h):
    c=[int(h[i:i+2],16)/255 for i in (1,3,5)]
    c=[x/12.92 if x<=0.04045 else ((x+0.055)/1.055)**2.4 for x in c]
    return 0.2126*c[0]+0.7152*c[1]+0.0722*c[2]
def cr(a,b):
    a,b=L(a),L(b); return (max(a,b)+0.05)/(min(a,b)+0.05)
def grade(r): return 'AAA' if r>=7 else 'AA' if r>=4.5 else 'AA large' if r>=3 else 'Logo only'
SW=[('Sky Teal','#77EDD7','Hero, logo, buttons',[('#0E1A22','#77EDD7'),('#FFFFFF','#77EDD7')],'#0E1A22'),
    ('Deep Teal','#0E6B5E','Text, icons on light',[('#0E6B5E','#FFFFFF'),('#0E6B5E','#E9FBF7')],'#FFFFFF'),
    ('Ink','#0E1A22','Text, dark grounds',[('#0E1A22','#E9FBF7'),('#FFFFFF','#0E1A22')],'#FFFFFF'),
    ('Mist','#E9FBF7','Light ground',[('#0E1A22','#E9FBF7'),('#0E6B5E','#E9FBF7')],'#0E1A22'),
    ('Cream','#F5E9D6','Warm ground, horns',[('#0E1A22','#F5E9D6'),('#0E6B5E','#F5E9D6')],'#0E1A22'),
    ('Muzzle Pink','#FFB7C9','Tiny accents only',[('#0E1A22','#FFB7C9'),('#FFFFFF','#FFB7C9')],'#0E1A22')]
sw=[]
for name,hx,use,pairs,fg in SW:
    rgb=' '.join(str(int(hx[i:i+2],16)) for i in (1,3,5))
    chips=''
    for f,g in pairs:
        r=cr(f,g); gr=grade(r)
        low=' class="low"' if r<3 else ''
        if r<3: gr='Logo only' if g=='#77EDD7' else 'Avoid'
        chips+=f'<span{low}><i style="color:{f};background:{g};box-shadow:0 0 0 1px rgba(14,26,34,.08)">Aa</i>{r:.1f} {gr}</span>'
    border=';box-shadow:inset 0 -1px 0 rgba(14,26,34,.08)' if hx in('#E9FBF7','#F5E9D6') else ''
    sw.append(f'<div class="sw"><div class="chip" style="background:{hx}{border}"><span style="color:{fg}">{name}</span></div>'
              f'<div class="meta"><div class="row"><span class="hex">{hx}</span><span class="mono">RGB {rgb}</span></div>'
              f'<div class="use">{use}</div><div class="cr">{chips}</div></div></div>')
# rules
TICK='<svg viewBox="0 0 16 16"><path d="M3 8.5l3.2 3L13 4.5" fill="none" stroke="#0E1A22" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>'
CROSS='<svg viewBox="0 0 16 16"><path d="M4 4l8 8M12 4l-8 8" fill="none" stroke="#0E1A22" stroke-width="2.4" stroke-linecap="round"/></svg>'
def rule(ok,label,bg,vis):
    ic=f'<span class="ic" style="background:{"#77EDD7" if ok else "#FFB7C9"}">{TICK if ok else CROSS}</span>'
    return f'<div class="it"><div class="vis" style="background:{bg}">{vis}</div><div class="lab">{ic}{label}</div></div>'
R=[rule(1,'Room to breathe','#E9FBF7',lockup('sky','deep','style="width:62%"')),
   rule(1,'White on sky','#77EDD7',lockup('white','white','style="width:62%"')),
   rule(1,'Mark when small','#0E1A22',f'<svg viewBox="0 0 136 112" style="width:30%">{MARK["sky"]}</svg>'),
   rule(1,'Frame colours','#F5E9D6','<div style="display:flex;gap:6%;width:84%">'+''.join(f'<svg viewBox="0 0 136 112" style="width:25%">{MARK[c]}</svg>' for c in ['sky','black','white','orange'])+'</div>'),
   rule(0,'Stretch','#fff',lockup('sky','deep','style="width:92%;height:22px" preserveAspectRatio="none"')),
   rule(0,'Recolour','#fff',f'<svg viewBox="0 0 136 112" style="width:34%;filter:hue-rotate(150deg) saturate(1.6)">{MARK["sky"]}</svg>'),
   rule(0,'Low contrast','#77EDD7',lockup('sky','sky','style="width:62%"')),
   rule(0,'Tilt or shadow','#fff',lockup('sky','deep','style="width:58%;transform:rotate(-10deg);filter:drop-shadow(6px 8px 0 rgba(14,26,34,.35))"'))]
def uri(p,mt): return f'data:{mt};base64,'+b64(p)
t=open(f'{K}/src/template.html').read()
rep={'FREDOKA':b64(f'{B}/fonts/Fredoka.ttf'),'NUNITO':b64(f'{B}/fonts/Nunito.ttf'),
     'CLEARSPACE':cs,'SWATCHES':'\n'.join(sw),'RULES':'\n'.join(R),
     'FAVSVG_URI':uri(f'{K}/favicon.svg','image/svg+xml'),
     'URI_ios':uri(f'{K}/app-icon-ios.svg','image/svg+xml'),'URI_app':uri(f'{K}/app-icon.svg','image/svg+xml'),
     'URI_andfg':uri(f'{K}/app-icon-android-foreground.svg','image/svg+xml'),'URI_avatar':uri(f'{K}/avatar.svg','image/svg+xml'),
     'PNG_fav16':uri(f'{K}/favicon-16.png','image/png'),'PNG_fav32':uri(f'{K}/favicon-32.png','image/png')}
for c in MARK: rep[f'MARK_{c}']=marksvg(c)
for k,(m,w) in LOCK.items(): rep[f'LOCKUP_{k}']=lockup(m,w)
for k,v in rep.items(): t=t.replace('{{'+k+'}}',v)
left=re.findall(r'\{\{\w+\}\}',t); assert not left,left
open(f'{K}/brand-kit.html','w').write(t)
print(len(t))
