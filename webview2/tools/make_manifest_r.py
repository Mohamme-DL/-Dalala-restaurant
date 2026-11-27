#!/usr/bin/env python3
"""Sign license.manifest for the restaurant package. Usage: make_manifest_r.py <pkgdir> <private.key>"""
import sys,hashlib,os
from cryptography.hazmat.primitives.asymmetric import ec, utils
from cryptography.hazmat.primitives import hashes
root,keyf=sys.argv[1:3]
FILES=['DalalaRestaurant.ps1','DalalaLauncher.ps1','DalalaLicense.dll','DalalaCore.dll','Dalala.exe']
for base in ('web','webview2'):
    for d,_,fs in os.walk(os.path.join(root,base)):
        for f in sorted(fs): FILES.append(os.path.relpath(os.path.join(d,f),root).replace(os.sep,'/'))
FILES=sorted(set(FILES))
k=ec.derive_private_key(int(open(keyf).read().strip(),16),ec.SECP256R1())
body=''.join(f"{r}|{hashlib.sha256(open(os.path.join(root,r),'rb').read()).hexdigest()}\n" for r in FILES)
r,s=utils.decode_dss_signature(k.sign(body.encode(),ec.ECDSA(hashes.SHA256())))
raw=r.to_bytes(32,'big')+s.to_bytes(32,'big')
A="0123456789ABCDEFGHJKMNPQRSTVWXYZ"
bits=''.join(format(x,'08b') for x in raw);bits+='0'*((5-len(bits)%5)%5)
e=''.join(A[int(bits[i:i+5],2)] for i in range(0,len(bits),5))
open(os.path.join(root,'license.manifest'),'w',newline='\n').write(body+"SIG|"+'-'.join(e[i:i+5] for i in range(0,len(e),5))+"\n")
print("manifest written:",len(FILES),"files")
