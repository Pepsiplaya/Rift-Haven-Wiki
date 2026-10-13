"""Public dungeon facts from the complete accepted artifact, never draft source."""
from pathlib import Path
from zipfile import ZipFile
import json,hashlib,re
root=Path(__file__).resolve().parents[2]
receipt=json.loads((root/'Plugin Source/deployment/current-release.json').read_text(encoding='utf-8-sig'))
jar=root/receipt['jar'];assert hashlib.sha256(jar.read_bytes()).hexdigest()==receipt['jarSha256']
inventory=json.loads((root/receipt['acceptedInventory']).read_text(encoding='utf-8-sig'))
with ZipFile(jar) as pack:
    raw=pack.read('defaults/dungeons/dungeons.json');assert hashlib.sha256(raw).hexdigest()==inventory['defaults/dungeons/dungeons.json']
    config=json.loads(raw)
tables={t['id']:t for t in config['lootTables']};details={}
def boss_name(key):
    key=re.sub(r'^(khaos\d+_|fear\d+_)','',key)
    key=re.sub(r'_(kd|boss)$','',key)
    return {'shadow_knight':'Shadow Knight','scarak_broodmother':'Scarak Broodmother','fire_dragon':'Fire Dragon','final_boss':'Final encounter','baron':'Baron','cult_werewolf_miniboss':'Werewolf miniboss'}.get(key,key.replace('_',' ').title())
for d in config['dungeons']:
    if d.get('queueBlockedMessage') or d.get('visibility')=='HIDDEN_WHILE_LOCKED':continue
    bosses=list(dict.fromkeys(boss_name(k) for k,v in d.get('npcLootOverrides',{}).items() if 'boss' in v))
    entry='Open /dungeon to select this dungeon, or use the random dungeon queue. Confirm your role when your party leader starts a ready check.'
    if d.get('preserveNativeEncounters'):
        bosses=['Gobliterator']
        entry='Native puzzles and shared checkpoints remain part of the run. Difficulty follows the entering group average, rounded to the nearest level and fixed for that run; each extra player adds 10% enemy health, without a party-size damage bonus.'
    used=set(d.get('npcLootOverrides',{}).values())|{d.get('defaultLootTableId')};item_ids={e.get('itemId','') for table in used if table in tables for e in tables[table]['entries'] if e.get('weight',0)>0}
    fixed=[re.search(r'_(\d+)_(UNCOMMON|RARE|EPIC|LEGENDARY)_\d+$',x) for x in item_ids];fixed=[m for m in fixed if m]
    rewards='Equipment and profession materials can drop from defeated enemies. Stronger encounters have their own reward pools.'
    if fixed:
        levels=[int(m[1]) for m in fixed];rarities=[q.title() for q in ['UNCOMMON','RARE','EPIC','LEGENDARY'] if any(m[2]==q for m in fixed)]
        rewards=f"Equipment reward pools include levels {min(levels)}–{max(levels)}, with {', '.join(rarities)} qualities. Normal foes also provide useful materials. Exact drops and stat rolls vary."
    if d.get('preserveNativeEncounters'):rewards='Rift Haven equipment follows the run’s fixed entering-group average level. Native encounter drops remain part of the dungeon; inspect each reward in game for its exact stats.'
    details[d['id']]={'bosses':bosses,'entry':entry,'rewards':rewards}
(root/'Website/assets/data/dungeon-details.json').write_text(json.dumps(details,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
print(f'Built {len(details)} public dungeon dossiers from {receipt["version"]}.')
