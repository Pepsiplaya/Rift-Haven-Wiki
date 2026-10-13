"""Export only publicly selected talent labels from the accepted artifact."""
import hashlib
import json
from pathlib import Path
import zipfile

ROOT=Path(__file__).resolve().parents[2]
receipt=json.loads((ROOT/'Plugin Source/deployment/current-release.json').read_text())
jar=ROOT/receipt['jar']
if receipt.get('jarSha256') and hashlib.sha256(jar.read_bytes()).hexdigest()!=receipt['jarSha256']:
    raise SystemExit('Accepted artifact hash mismatch')
snapshot=json.loads((ROOT/'.runtime/public-snapshot.json').read_text())
used={key for player in snapshot.get('players',[]) for key,value in player.get('talents',{}).items()
      if isinstance(value,(int,float)) and value>0}
with zipfile.ZipFile(jar) as archive:
    catalogue=json.loads(archive.read('RiftCore/Talents/trees.json'))
result={}
for tree in catalogue['trees']:
    for node in tree['nodes']:
        if node['id'] not in used:continue
        result[node['id']]={'name':node['name'],'tree':tree['name'],'treeId':tree['id'],
            'mainClass':tree['mainClass'],'maxRank':node['maxRank'],'kind':node['kind'],
            'description':node['description']}
# Still saved by the legacy Hope tier. Keep its established label, without
# implying a ranked-tree description applies to this older storage key.
if 'steadfast' in used:
    result['steadfast']={'name':'Steadfast','tree':'Hope','treeId':'hope','mainClass':'paladin',
        'maxRank':1,'kind':'Passive','legacy':True,'description':''}
(ROOT/'Website/assets/data/talents.json').write_text(json.dumps(result,ensure_ascii=False,
    sort_keys=True,separators=(',',':'))+'\n',encoding='utf-8')
print(f'Selected public talent labels: {len(result)}; unknown selected IDs: {len(used-result.keys())}.')
