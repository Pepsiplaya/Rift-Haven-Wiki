"""Import only role names from a dedicated npcs.json; never publish spawn data."""
import hashlib,json,sys
from pathlib import Path
from zipfile import ZipFile

root=Path(__file__).resolve().parents[2]
receipt=json.loads((root/'Plugin Source/deployment/current-release.json').read_text(encoding='utf-8-sig'))
jar=root/receipt['jar']
assert hashlib.sha256(jar.read_bytes()).hexdigest()==receipt['jarSha256']
source=json.loads(Path(sys.argv[1]).read_text(encoding='utf-8-sig'))
assert isinstance(source.get('spawns'),list) and source['spawns']
templates={t['id']:t for t in source.get('templates',[])}
roles={}
with ZipFile(Path.home()/'AppData/Roaming/Hytale/install/release/package/game/latest/Assets.zip') as native,ZipFile(jar) as accepted:
    for pack in (native,accepted):
        for name in pack.namelist():
            if name.startswith('Server/NPC/Roles/') and name.endswith('.json'):
                role=Path(name).stem;roles[role.lower()]=role
placed=set()
for spawn in source['spawns']:
    if spawn.get('world')!='void':continue
    template=templates.get(spawn.get('template'),{})
    role=spawn.get('npcType') or template.get('npcType')
    assert role and role.lower() in roles, 'Unknown placed role: '+str(role)
    placed.add(roles[role.lower()])
assert placed
target=root/'Website/assets/data/map-npc-roles.json'
target.write_text(json.dumps(sorted(placed),indent=2)+'\n',encoding='utf-8')
print(f'Imported {len(placed)} placed creature types; coordinates and spawn settings excluded.')
